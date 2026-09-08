/**
 * OrgDashboard — the top-level "Organisation" destination (sidebar → /organization).
 *
 * Replaces the old OrgConsole-buried-in-Settings. A tabbed monitoring + management hub:
 * Overview (stats + charts) and the management sections (members, invitations, audit, SIEM,
 * billing, settings). Owner/admin only; editors/viewers never reach the route.
 */

import React, { ReactNode, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { selectCurrentOrg, selectCanManageOrg } from '../../../store/selectors/authSelectors';
import { TierBadge, RoleBadge, InfoCallout } from './enterprise/AdminPrimitives';
import OrgOverview from './OrgOverview';
import OrgMembersSection from './OrgMembersSection';
import OrgInvitationsSection from './OrgInvitationsSection';
import OrgAuditSection from './OrgAuditSection';
import OrgSinksSection from './OrgSinksSection';
import OrgBillingSection from './OrgBillingSection';
import OrgSettingsSection from './OrgSettingsSection';
import OrgEscrowSection from './enterprise/OrgEscrowSection';
import SsoSection from './enterprise/SsoSection';
import OrgGovernanceSection from './OrgGovernanceSection';
import OrgPolicySection from './enterprise/OrgPolicySection';
import OrgWorkspacePolicySection from './OrgWorkspacePolicySection';
import OrgGuideSection from './OrgGuideSection';
import { isEnterpriseFeatureAvailable } from '../../../config/enterprise';
import './enterprise/enterprise.css';

type TabId =
  | 'overview'
  | 'guide'
  | 'members'
  | 'invitations'
  | 'audit'
  | 'sinks'
  | 'governance'
  | 'workspace'
  | 'billing'
  | 'escrow'
  | 'sso'
  | 'settings';

const I = {
  grid: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
    </svg>
  ),
  users: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
    </svg>
  ),
  mail: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" />
      <polyline points="22,6 12,13 2,6" />
    </svg>
  ),
  shield: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  ),
  stream: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2" y="3" width="20" height="7" rx="2" />
      <rect x="2" y="14" width="20" height="7" rx="2" />
    </svg>
  ),
  card: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="1" y="4" width="22" height="16" rx="2" />
      <line x1="1" y1="10" x2="23" y2="10" />
    </svg>
  ),
  cog: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  ),
  key: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3" />
    </svg>
  ),
  puzzle: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 7h3V5.5a2.5 2.5 0 0 1 5 0V7h3a1 1 0 0 1 1 1v3h1.5a2.5 2.5 0 0 1 0 5H16v3a1 1 0 0 1-1 1h-3v-1.5a2.5 2.5 0 0 0-5 0V20H4a1 1 0 0 1-1-1v-3h1.5a2.5 2.5 0 0 0 0-5H3V8a1 1 0 0 1 1-1z" />
    </svg>
  ),
  book: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  ),
};

const OrgDashboard: React.FC = () => {
  const { t } = useTranslation();
  const org = useSelector(selectCurrentOrg);
  const canManage = useSelector(selectCanManageOrg);
  const [tab, setTab] = useState<TabId>('overview');

  // B2B keypair bootstrap — best-effort, idempotent. Ensure the admin's own keypair first
  // (so they're a valid escrow recipient), then provision the org keypair (E4-1) if missing.
  useEffect(() => {
    if (!org || !canManage) return;
    const orgId = org.id;
    void (async () => {
      try {
        const { ensureUserKeypair } = await import('../../../services/auth/userKeypairSync');
        await ensureUserKeypair();
      } catch {
        /* best-effort */
      }
      try {
        const { ensureOrgKeypair } = await import('../../../services/org/orgKeySync');
        await ensureOrgKeypair(orgId);
      } catch {
        /* best-effort */
      }
    })();
  }, [org?.id, canManage]);

  if (!org || !canManage) {
    return (
      <div style={{ padding: 'var(--spacing-8)', maxWidth: 640, margin: '0 auto' }}>
        <InfoCallout>
          {t('org.dashboard.noOrg', 'Select a Teams or Enterprise organization to manage it.')}
        </InfoCallout>
      </div>
    );
  }

  const canSinks = org.role === 'owner' || org.role === 'security_admin';
  const canGovern = org.role === 'owner' || org.role === 'admin' || org.role === 'security_admin';

  /**
   * `show` = ce rôle a-t-il le droit de voir cet onglet. `soon` = la fonction
   * n'est pas encore tenable devant un client.
   *
   * LES DEUX SONT DISTINCTS, ET C'EST TOUT L'INTÉRÊT. Un onglet caché parce que
   * le rôle ne l'autorise pas ne doit rien apprendre à celui qui ne l'a pas ;
   * un onglet à venir doit au contraire se MONTRER, marqué, sinon un
   * administrateur qui cherche « où est le SSO » conclut à l'absence pure et
   * simple et écrit au support. Le drapeau par fonction vit dans
   * `config/enterprise.ts` et ne bascule qu'une fois la fonction éprouvée.
   */
  /**
   * L'ORDRE SUIT L'URGENCE, PAS L'HISTORIQUE DES LIVRAISONS.
   *
   * « Facturation » était en onzième position et tombait donc hors-champ, alors
   * que c'est LA première chose à faire d'une organisation neuve : sans
   * abonnement, elle n'a ni siège, ni coffre, ni marque, ni journal. L'onglet le
   * plus urgent était le plus difficile à atteindre.
   *
   * Les onglets « bientôt » ferment la marche : ils se montrent — un
   * administrateur qui cherche le SSO doit apprendre qu'il arrive plutôt que de
   * conclure à son absence — mais ils ne coûtent aucune place à ceux qui
   * servent.
   */
  const tabs: { id: TabId; label: string; icon: ReactNode; show: boolean; soon?: boolean }[] = [
    { id: 'overview', label: t('org.dashboard.tab.overview'), icon: I.grid, show: true },
    {
      id: 'guide',
      label: t('org.dashboard.tab.guide', 'Guide'),
      icon: I.book,
      show: true,
    },
    { id: 'members', label: t('org.dashboard.tab.members'), icon: I.users, show: true },
    { id: 'invitations', label: t('org.dashboard.tab.invitations'), icon: I.mail, show: true },
    { id: 'billing', label: t('org.dashboard.tab.billing'), icon: I.card, show: true },
    {
      id: 'workspace',
      label: t('org.dashboard.tab.workspace', 'Poste de travail'),
      icon: I.puzzle,
      // Même permission que la gouvernance : c'est la même autorité, appliquée à
      // l'application plutôt qu'à la session.
      show: canGovern,
      soon: !isEnterpriseFeatureAvailable('workspacePolicy'),
    },
    {
      id: 'governance',
      label: t('org.dashboard.tab.governance', 'Governance'),
      icon: I.shield,
      // MANAGE_GOVERNANCE holders (owner/admin/security_admin) — mirrors the Worker gate.
      show: canGovern,
    },
    { id: 'audit', label: t('org.dashboard.tab.audit'), icon: I.shield, show: true },
    { id: 'sinks', label: t('org.dashboard.tab.sinks'), icon: I.stream, show: canSinks },
    { id: 'escrow', label: t('org.dashboard.tab.escrow'), icon: I.key, show: true },
    { id: 'settings', label: t('org.dashboard.tab.settings'), icon: I.cog, show: true },
    // À venir — montré, marqué, et en dernier.
    {
      id: 'sso',
      label: t('org.dashboard.tab.sso'),
      icon: I.shield,
      show: org.role === 'owner' || org.role === 'admin',
      soon: !isEnterpriseFeatureAvailable('sso'),
    },
  ];

  return (
    <div style={{ height: '100%', overflowY: 'auto' }}>
      <div
        className="ent-console"
        style={{
          // Repli = le plafond d'avant. Voir `services/platform/pageWidth.ts`.
          maxWidth: 'var(--page-max-width, 1120px)',
          margin: '0 auto',
          padding: 'var(--spacing-6) var(--spacing-6) var(--spacing-8)',
        }}
      >
        <div className="ent-pagehead">
          <div className="ent-pagehead__titles">
            <h1 className="ent-pagehead__title">{t('org.dashboard.title')}</h1>
            <p className="ent-pagehead__subtitle">{org.name}</p>
          </div>
          <div className="ent-pagehead__meta">
            <TierBadge tier={org.tier} />
            <RoleBadge role={org.role} />
          </div>
        </div>

        {/* Douze onglets passent à la ligne — voir `.ent-tabs`. Aucune
            glissière, et aucun onglet hors-champ. */}
        <div className="ent-tabs" role="tablist">
          {tabs
            .filter((x) => x.show)
            .map((x) => (
              <button
                key={x.id}
                type="button"
                role="tab"
                aria-selected={tab === x.id}
                className={`ent-tab ${tab === x.id ? 'ent-tab--active' : ''}`}
                onClick={() => setTab(x.id)}
              >
                {x.icon}
                {x.label}
                {x.soon && (
                  <span className="ent-tab__soon">{t('org.dashboard.soon', 'bientôt')}</span>
                )}
              </button>
            ))}
        </div>

        {tab === 'overview' && <OrgOverview orgId={org.id} tier={org.tier} myRole={org.role} />}
        {tab === 'guide' && <OrgGuideSection org={org} onNavigate={setTab} />}
        {tab === 'members' && <OrgMembersSection orgId={org.id} myRole={org.role} />}
        {tab === 'invitations' && <OrgInvitationsSection orgId={org.id} />}
        {tab === 'audit' && <OrgAuditSection orgId={org.id} tier={org.tier} />}
        {tab === 'sinks' && <OrgSinksSection orgId={org.id} tier={org.tier} myRole={org.role} />}
        {tab === 'governance' && (
          <>
            <OrgPolicySection orgId={org.id} />
            <OrgGovernanceSection orgId={org.id} myRole={org.role} />
          </>
        )}
        {tab === 'workspace' && <OrgWorkspacePolicySection orgId={org.id} />}
        {tab === 'escrow' && <OrgEscrowSection orgId={org.id} myRole={org.role} />}
        {/* Une fonction « bientôt » se MONTRE et s'explique — elle ne rend pas un
            écran à moitié câblé que l'administrateur croirait avoir configuré. */}
        {tab === 'sso' &&
          (isEnterpriseFeatureAvailable('sso') ? (
            <SsoSection orgId={org.id} />
          ) : (
            <InfoCallout>
              {t(
                'org.dashboard.ssoSoon',
                "L'authentification unique (SAML / OIDC) est en cours de finition. Elle n'est pas activable pour l'instant : une configuration incomplète casserait la connexion de toute votre équipe. Vos membres se connectent par e-mail + mot de passe, avec la double authentification si votre politique de session l'exige."
              )}
            </InfoCallout>
          ))}
        {tab === 'billing' && <OrgBillingSection orgId={org.id} />}
        {tab === 'settings' && <OrgSettingsSection org={org} />}
      </div>
    </div>
  );
};

export default OrgDashboard;
