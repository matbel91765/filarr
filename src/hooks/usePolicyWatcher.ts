/**
 * usePolicyWatcher — E9-10 offline org-policy enforcement orchestrator.
 *
 * Mounted ABOVE the lock gate (in AppContent) so it keeps running even while the app is locked —
 * that's how a degraded device clears degraded mode the moment it reconnects. Responsibilities:
 *   1. Hydrate the cached policy from disk on mount / org switch (offline-first).
 *   2. Re-fetch the effective policy on reconnect + on a periodic timer, persisting each success and
 *      applying the delta immediately (a hardened policy takes effect as soon as the device sees it).
 *   3. Run the offline-grace clock: once the cached policy is older than offlineGraceDays, forget the
 *      FEK + lock the vault (degraded mode) until a successful re-sync.
 *
 * Only engages for a CLOUD account actively in a Teams/Enterprise org with a configured policy
 * (version ≥ 1). Personal/unconfigured contexts never get an idle override or a degraded lockout.
 * All client enforcement is best-effort and disclosed as such (anti-faux-enforcement).
 */

import { useEffect, useRef, useCallback } from 'react';
import { useDispatch, useSelector, useStore } from 'react-redux';
import type { RootState } from '../store';
import {
  selectCurrentOrgId,
  selectIsOrgPlan,
  selectIsEnterpriseSpace,
} from '../store/selectors/authSelectors';
import {
  setPolicy,
  setGovernanceOnline,
  enterDegraded,
  resetGovernance,
  DEFAULT_OFFLINE_GRACE_DAYS,
} from '../store/slices/governanceSlice';
import { lockApp } from '../store/slices/authSlice';
import { forgetSessionSecrets } from '../services/auth/sessionTeardown';
import { purgeCollabOnKeyLoss } from '../services/collab/collabSession';
import {
  fetchEffectivePolicy,
  loadCachedPolicy,
  saveCachedPolicy,
  clearCachedPolicy,
  ackResync,
} from '../services/governance/policyService';

const RESYNC_INTERVAL_MS = 2 * 60 * 1000; // re-fetch every 2 min while running
const GRACE_TICK_MS = 30 * 1000; // evaluate the offline-grace clock every 30s

export function usePolicyWatcher(): void {
  const dispatch = useDispatch();
  const store = useStore<RootState>();

  const orgId = useSelector(selectCurrentOrgId);
  // Teams/Enterprise PLAN, not the shared-vault entitlement: the latter now covers
  // the personal paid tiers too, and governance is an org-plan capability.
  const isTeamsTier = useSelector(selectIsOrgPlan);
  const isEnterpriseSpace = useSelector(selectIsEnterpriseSpace);
  const accountMode = useSelector((s: RootState) => s.auth.accountMode);
  const isAuthenticated = useSelector((s: RootState) => s.auth.isAuthenticated);

  // Governance applies only to a cloud account actively in ENTERPRISE space,
  // scoped to a Teams/Enterprise org. In personal space no policy is fetched and
  // no degraded lockout can fire, even for a genuine org member.
  const eligible =
    isEnterpriseSpace && accountMode === 'cloud' && isAuthenticated && !!orgId && isTeamsTier;

  const attemptSync = useCallback(
    async (currentOrgId: string) => {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        dispatch(setGovernanceOnline(false));
        return;
      }
      const prev = store.getState().governance;
      try {
        const { policy, version } = await fetchEffectivePolicy(currentOrgId);
        const now = Date.now();
        dispatch(
          setPolicy({ orgId: currentOrgId, policy, version, fetchedAt: now, fromCache: false })
        );
        void saveCachedPolicy({
          orgId: currentOrgId,
          policyJson: policy,
          policyVersion: version,
          fetchedAt: now,
        });
        // Audit a re-sync only after a meaningful offline gap (best-effort, never blocks).
        if (prev.orgId === currentOrgId && prev.fetchedAt) {
          const offlineHours = Math.floor((now - prev.fetchedAt) / 3_600_000);
          if (offlineHours >= 1) {
            void ackResync(currentOrgId, {
              fromVersion: prev.policyVersion,
              toVersion: version,
              offlineHours,
            });
          }
        }
      } catch (err) {
        const status = (err as { response?: { status?: number } })?.response?.status;
        if (status === 403) {
          // 403 from the member endpoint = no longer an active member (removed/revoked). Stop
          // enforcing this org's policy and drop the cache — don't keep a revoked member on it.
          void clearCachedPolicy();
          dispatch(resetGovernance());
          return;
        }
        // Network/API failure → treat as offline; the cached policy + grace clock take over.
        dispatch(setGovernanceOnline(false));
      }
    },
    [dispatch, store]
  );

  // Mount / org switch: hydrate from the on-disk cache (offline-first), then attempt a fresh sync.
  const wasEligibleRef = useRef(false);
  useEffect(() => {
    if (!eligible || !orgId) {
      // Only wipe the disk cache when we LEAVE a governance context (downgrade / left org / switched
      // to a local account) — a true→false transition. NEVER on cold start (false→true), which would
      // destroy the offline-first cache before it can hydrate.
      if (wasEligibleRef.current) void clearCachedPolicy();
      wasEligibleRef.current = false;
      dispatch(resetGovernance());
      return;
    }
    wasEligibleRef.current = true;
    let cancelled = false;
    void (async () => {
      const cached = await loadCachedPolicy();
      if (cancelled) return;
      if (cached && cached.orgId === orgId) {
        dispatch(
          setPolicy({
            orgId,
            policy: cached.policyJson,
            version: cached.policyVersion,
            fetchedAt: cached.fetchedAt,
            fromCache: true,
          })
        );
      } else {
        // No cache for THIS org (different org / first run) — start clean, don't apply a stale grace.
        dispatch(resetGovernance());
      }
      await attemptSync(orgId);
    })();
    return () => {
      cancelled = true;
    };
  }, [eligible, orgId, dispatch, attemptSync]);

  // Reconnect + periodic re-sync.
  useEffect(() => {
    if (!eligible || !orgId) return;
    const onOnline = () => void attemptSync(orgId);
    const onOffline = () => dispatch(setGovernanceOnline(false));
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    const timer = setInterval(() => void attemptSync(orgId), RESYNC_INTERVAL_MS);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      clearInterval(timer);
    };
  }, [eligible, orgId, dispatch, attemptSync]);

  // Offline-grace clock: lock the vault once the cached policy outlives the grace window.
  const lastTickRef = useRef(0);
  useEffect(() => {
    if (!eligible) return;
    const tick = () => {
      const s = store.getState();
      const g = s.governance;
      if (g.policyVersion < 1 || !g.policy || !g.fetchedAt) return; // nothing configured to enforce
      const graceDays = g.policy.session.offlineGraceDays ?? DEFAULT_OFFLINE_GRACE_DAYS;
      const stale = Date.now() - g.fetchedAt > graceDays * 86_400_000;
      if (stale && !s.auth.isLocked && !g.degraded) {
        // Honest best-effort: forget the FEK + show the lock screen with the degraded disclosure. A
        // password-holder can re-unlock offline — that residual is disclosed, never pretended away.
        dispatch(enterDegraded());
        void forgetSessionSecrets(dispatch, 'policy');
      }
      lastTickRef.current = Date.now();
    };
    tick();
    const timer = setInterval(tick, GRACE_TICK_MS);
    return () => clearInterval(timer);
  }, [eligible, dispatch, store]);
}
