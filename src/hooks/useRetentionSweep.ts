/**
 * useRetentionSweep — E9-2 client-side data retention.
 *
 * Applies the org governance retention policy's trashRetentionDays to THIS device: permanently purges
 * files + notes that have sat in the trash longer than the configured window. Runs on mount + on a
 * timer, and ONLY when an org policy is actively configured (Teams/Enterprise, version ≥ 1, with a
 * trashRetentionDays set) — so a personal user's trash behaviour is unchanged (their trash is never
 * auto-purged, exactly as today).
 *
 * Note version retention (retention.versionRetentionDays) is applied SEPARATELY, in the main process
 * on every notes:save (electron/noteVersionService.recordSnapshots), since version history lives on
 * disk per-profile and is pruned at write time.
 *
 * Best-effort + client-applied (like the E9-10 offline guards): a determined offline user can bypass
 * it, and it does not yet exclude data under a legal hold — the server-side E9-6 gates cover the
 * org-scoped destruction paths. Mounted in AppContent.
 */

import { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import type { AppDispatch } from '../store';
import { selectPolicyActive, selectGovernancePolicy } from '../store/slices/governanceSlice';
import { emptyTrash } from '../store/slices/trashSlice';
import { purgeExpiredTrashedNotes } from '../store/slices/notesSlice';

const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000; // re-sweep every 6h

export function useRetentionSweep(): void {
  const dispatch = useDispatch<AppDispatch>();
  const policyActive = useSelector(selectPolicyActive);
  const policy = useSelector(selectGovernancePolicy);

  // Engage ONLY when an active org policy configures a trash-retention window. null = inert (personal
  // contexts + orgs that left retention unset keep the current "never auto-purge trash" behaviour).
  const orgTrashDays =
    policyActive && policy?.retention?.trashRetentionDays && policy.retention.trashRetentionDays > 0
      ? policy.retention.trashRetentionDays
      : null;

  useEffect(() => {
    if (!orgTrashDays) return;
    const run = () => {
      void dispatch(emptyTrash({ olderThanDays: orgTrashDays })); // files / folders
      void dispatch(purgeExpiredTrashedNotes(orgTrashDays)); // notes
    };
    run();
    const timer = setInterval(run, SWEEP_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [orgTrashDays, dispatch]);
}
