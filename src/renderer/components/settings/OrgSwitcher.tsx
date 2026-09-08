/**
 * OrgSwitcher (E1-6 → intra-enterprise org picker)
 *
 * For an ENTERPRISE account that belongs to more than one real organization (or
 * that has none currently bound), this lets the user choose which org is active
 * (drives X-Org-Id via setCurrentOrg). Personal accounts can never belong to an
 * org, so this renders nothing for them — the personal/enterprise choice itself
 * is made on the launch SpaceSelector by picking the right profile/account.
 */

import React, { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector, useDispatch } from 'react-redux';
import type { RootState, AppDispatch } from '../../../store';
import { Select } from '../ui';
import { initOrgContext, setCurrentOrg } from '../../../store/slices/orgSlice';
import {
  selectOrgs,
  selectCurrentOrgId,
  selectActiveSpace,
} from '../../../store/selectors/authSelectors';

const ROLE_LABEL_KEYS: Record<string, string> = {
  owner: 'org.role.owner',
  admin: 'org.role.admin',
  security_admin: 'org.role.admin',
  editor: 'org.role.editor',
  viewer: 'org.role.viewer',
};

const OrgSwitcher: React.FC = () => {
  const { t } = useTranslation();
  const dispatch = useDispatch<AppDispatch>();
  const accountMode = useSelector((s: RootState) => s.auth.accountMode);
  const allOrgs = useSelector(selectOrgs);
  const currentOrgId = useSelector(selectCurrentOrgId);
  const spaceMode = useSelector(selectActiveSpace);

  // Only REAL orgs matter — the auto-provisioned personal org is never picked.
  const realOrgs = useMemo(() => allOrgs.filter((o) => !o.isPersonal), [allOrgs]);

  // Restore the active space + org + refresh the list when entering cloud mode.
  useEffect(() => {
    if (accountMode === 'cloud') {
      dispatch(initOrgContext());
    }
  }, [accountMode, dispatch]);

  // Personal accounts / local mode / accounts with no real org: nothing to pick.
  if (accountMode !== 'cloud' || spaceMode !== 'enterprise' || realOrgs.length === 0) {
    return null;
  }
  // A single already-bound org means there is no choice to offer.
  if (realOrgs.length === 1 && currentOrgId) {
    return null;
  }

  const currentRole = realOrgs.find((o) => o.id === currentOrgId)?.role;

  return (
    <div className="org-switcher px-6 py-4 flex items-end gap-3">
      <div className="flex-1">
        <Select
          label={t('org.switcher.label', 'Organisation active')}
          options={[
            ...(currentOrgId
              ? []
              : [{ value: '', label: t('org.switcher.choose', 'Choisir une organisation…') }]),
            ...realOrgs.map((o) => ({ value: o.id, label: o.name })),
          ]}
          value={currentOrgId ?? ''}
          onChange={(value) => {
            const next = Array.isArray(value) ? value[0] : value;
            if (next) dispatch(setCurrentOrg(next));
          }}
        />
      </div>
      {currentRole && (
        <span
          className="text-xs font-semibold px-2.5 py-1 rounded-full mb-1"
          style={{
            backgroundColor: 'var(--color-neutral-100)',
            color: 'var(--color-neutral-600)',
          }}
        >
          {t(ROLE_LABEL_KEYS[currentRole] ?? 'org.role.viewer')}
        </span>
      )}
    </div>
  );
};

export default OrgSwitcher;
