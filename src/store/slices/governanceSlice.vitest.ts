/**
 * E9-10 governanceSlice — reducer invariants + the cross-slice idle-override / grace selectors.
 * Pure logic (no IPC / no network); run via `npm run test:crypto` (scoped to *.vitest.ts).
 */

import { describe, it, expect } from 'vitest';
import reducer, {
  setPolicy,
  enterDegraded,
  setGovernanceOnline,
  resetGovernance,
  selectEffectiveAutoLock,
  selectGraceDays,
  selectPolicyActive,
  selectIsPolicyDegraded,
  DEFAULT_OFFLINE_GRACE_DAYS,
  type EffectivePolicy,
  type GovernanceState,
} from './governanceSlice';
import type { RootState } from '../index';

const POLICY = (over: Partial<EffectivePolicy['session']> = {}): EffectivePolicy => ({
  session: {
    idleTimeoutMinutes: null,
    absoluteTimeoutMinutes: null,
    reauthForSensitiveActions: false,
    offlineGraceDays: null,
    ...over,
  },
  sharing: {
    externalSharesDisabled: false,
    forceExpiry: false,
    maxExpiryDays: null,
    forcePassword: false,
    restrictDownload: false,
  },
  retention: { trashRetentionDays: null, versionRetentionDays: null },
});

const stateWith = (
  g: Partial<GovernanceState>,
  security?: { autoLockEnabled: boolean; autoLockTimeout: number }
) =>
  ({
    governance: {
      orgId: 'o1',
      policy: POLICY(),
      policyVersion: 1,
      fetchedAt: 1000,
      online: true,
      fromCache: false,
      degraded: false,
      ...g,
    },
    settings: { security: security ?? { autoLockEnabled: false, autoLockTimeout: 15 } },
  }) as unknown as RootState;

describe('E9-10 governanceSlice reducer invariants', () => {
  it('applying a CACHED policy keeps degraded; a FRESH fetch clears it + marks online', () => {
    let s = reducer(undefined, enterDegraded());
    s = reducer({ ...s, online: false }, setGovernanceOnline(false));
    // cached apply must NOT clear degraded (we never reached the server)
    const cached = reducer(
      s,
      setPolicy({ orgId: 'o1', policy: POLICY(), version: 2, fetchedAt: 5, fromCache: true })
    );
    expect(cached.degraded).toBe(true);
    expect(cached.fetchedAt).toBe(5);
    // a fresh fetch = successful re-sync → leave degraded + online true
    const fresh = reducer(
      cached,
      setPolicy({ orgId: 'o1', policy: POLICY(), version: 3, fetchedAt: 9, fromCache: false })
    );
    expect(fresh.degraded).toBe(false);
    expect(fresh.online).toBe(true);
  });

  it('resetGovernance returns to the inert defaults', () => {
    const s = reducer(stateWith({ degraded: true }).governance, resetGovernance());
    expect(s.degraded).toBe(false);
    expect(s.policy).toBeNull();
    expect(s.policyVersion).toBe(0);
  });
});

describe('E9-10 selectPolicyActive / selectGraceDays', () => {
  it('inactive (version 0) → not active, grace null (no enforcement implied)', () => {
    const st = stateWith({ policyVersion: 0 });
    expect(selectPolicyActive(st)).toBe(false);
    expect(selectGraceDays(st)).toBeNull();
  });

  it('active → grace = org value, or the client default when unset', () => {
    expect(selectGraceDays(stateWith({ policy: POLICY({ offlineGraceDays: 7 }) }))).toBe(7);
    expect(selectGraceDays(stateWith({ policy: POLICY({ offlineGraceDays: null }) }))).toBe(
      DEFAULT_OFFLINE_GRACE_DAYS
    );
  });
});

describe('E9-10 selectEffectiveAutoLock (org cap ∩ user setting)', () => {
  it('no org idle cap → exactly the user setting (non-regression)', () => {
    expect(
      selectEffectiveAutoLock(
        stateWith({ policy: POLICY() }, { autoLockEnabled: true, autoLockTimeout: 10 })
      )
    ).toEqual({ enabled: true, timeoutMinutes: 10 });
    expect(
      selectEffectiveAutoLock(
        stateWith({ policy: POLICY() }, { autoLockEnabled: false, autoLockTimeout: 15 })
      )
    ).toEqual({ enabled: false, timeoutMinutes: 15 });
  });

  it('org idle cap forces auto-lock ON even when the user disabled it', () => {
    const r = selectEffectiveAutoLock(
      stateWith(
        { policy: POLICY({ idleTimeoutMinutes: 5 }) },
        { autoLockEnabled: false, autoLockTimeout: 15 }
      )
    );
    expect(r).toEqual({ enabled: true, timeoutMinutes: 5 });
  });

  it('the shorter of (org cap, user choice) wins when the user also enabled it', () => {
    // user shorter than org → user wins (more secure)
    expect(
      selectEffectiveAutoLock(
        stateWith(
          { policy: POLICY({ idleTimeoutMinutes: 30 }) },
          { autoLockEnabled: true, autoLockTimeout: 10 }
        )
      )
    ).toEqual({ enabled: true, timeoutMinutes: 10 });
    // org shorter than user → org cap wins
    expect(
      selectEffectiveAutoLock(
        stateWith(
          { policy: POLICY({ idleTimeoutMinutes: 5 }) },
          { autoLockEnabled: true, autoLockTimeout: 60 }
        )
      )
    ).toEqual({ enabled: true, timeoutMinutes: 5 });
  });

  it('an org idle cap on an INACTIVE policy (version 0) is ignored', () => {
    const r = selectEffectiveAutoLock(
      stateWith(
        { policyVersion: 0, policy: POLICY({ idleTimeoutMinutes: 5 }) },
        { autoLockEnabled: false, autoLockTimeout: 15 }
      )
    );
    expect(r).toEqual({ enabled: false, timeoutMinutes: 15 });
    expect(selectIsPolicyDegraded(stateWith({ degraded: true }))).toBe(true);
  });
});
