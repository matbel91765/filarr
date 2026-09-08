/**
 * Shared primitives for the enterprise admin console (E1 / E3 / E7).
 *
 * Compose these instead of bespoke markup so every admin screen shares one visual
 * language — section panels, status badges, copyable opaque IDs, relative time,
 * callouts, danger zone. Styling lives in enterprise.css (tokens only).
 */

import React, { FC, ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import './enterprise.css';
import { useNotification } from '../../ui/Notification';
import type { OrgRole } from '../../../../types/org';

// ── Section panel ────────────────────────────────────────────────────────────

interface AdminSectionProps {
  title: string;
  description?: string;
  icon?: ReactNode;
  actions?: ReactNode;
  /** Drop body padding (for full-bleed tables). */
  flush?: boolean;
  children: ReactNode;
  className?: string;
}

export const AdminSection: FC<AdminSectionProps> = ({
  title,
  description,
  icon,
  actions,
  flush,
  children,
  className = '',
}) => (
  <section className={`ent-section ${className}`}>
    <header className="ent-section__head">
      {icon && <span className="ent-section__icon">{icon}</span>}
      <div className="ent-section__head-text">
        <h3 className="ent-section__title">{title}</h3>
        {description && <p className="ent-section__desc">{description}</p>}
      </div>
      {actions && <div className="ent-section__actions">{actions}</div>}
    </header>
    <div className={`ent-section__body ${flush ? 'ent-section__body--flush' : ''}`}>{children}</div>
  </section>
);

// ── Status badge ─────────────────────────────────────────────────────────────

export type BadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'error' | 'brand';

interface StatusBadgeProps {
  tone?: BadgeTone;
  dot?: boolean;
  icon?: ReactNode;
  children: ReactNode;
  title?: string;
}

export const StatusBadge: FC<StatusBadgeProps> = ({
  tone = 'neutral',
  dot,
  icon,
  children,
  title,
}) => (
  <span className={`ent-badge ent-badge--${tone}`} title={title}>
    {dot && <span className="ent-badge__dot" />}
    {icon}
    {children}
  </span>
);

const ROLE_TONE: Record<OrgRole, BadgeTone> = {
  owner: 'brand',
  admin: 'info',
  security_admin: 'warning',
  editor: 'neutral',
  viewer: 'neutral',
};

export const RoleBadge: FC<{ role: OrgRole }> = ({ role }) => {
  const { t } = useTranslation();
  return <StatusBadge tone={ROLE_TONE[role] ?? 'neutral'}>{t(`org.role.${role}`)}</StatusBadge>;
};

export const TierBadge: FC<{ tier: string }> = ({ tier }) => {
  const tone: BadgeTone = tier === 'enterprise' ? 'brand' : tier === 'teams' ? 'info' : 'neutral';
  const label = tier ? tier.charAt(0).toUpperCase() + tier.slice(1) : '—';
  return <StatusBadge tone={tone}>{label}</StatusBadge>;
};

export const MemberStatusBadge: FC<{ status: string }> = ({ status }) => {
  const { t } = useTranslation();
  const tone: BadgeTone =
    status === 'active' ? 'success' : status === 'pending' ? 'warning' : 'neutral';
  return (
    <StatusBadge tone={tone} dot>
      {t(`org.status.${status}`, status)}
    </StatusBadge>
  );
};

// ── Copyable opaque ID ───────────────────────────────────────────────────────

const CopyIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

interface CopyableIdProps {
  value: string | null;
  /** Optional prefix shown before the id, e.g. a target type. */
  prefix?: string | null;
  /** Visible character count before truncation. */
  head?: number;
}

export const CopyableId: FC<CopyableIdProps> = ({ value, prefix, head = 8 }) => {
  const { t } = useTranslation();
  const { info } = useNotification();
  const [copied, setCopied] = useState(false);
  if (!value) return <span className="ent-mono">—</span>;
  const shown = value.length > head + 1 ? `${value.slice(0, head)}…` : value;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      info(t('common.copied', 'Copied'));
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard unavailable */
    }
  };
  return (
    <button
      type="button"
      className="ent-copy"
      onClick={copy}
      title={`${prefix ? prefix + ':' : ''}${value}`}
    >
      <span className="ent-copy__text">
        {prefix ? <span style={{ opacity: 0.6 }}>{prefix}:</span> : null}
        {shown}
      </span>
      <span className="ent-copy__icon">
        {copied ? (
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        ) : (
          <CopyIcon />
        )}
      </span>
    </button>
  );
};

// ── Relative time (absolute on hover) ────────────────────────────────────────

function relative(ms: number, now: number): string {
  const s = Math.round((now - ms) / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(ms).toLocaleDateString();
}

export const RelativeTime: FC<{ ms: number }> = ({ ms }) => {
  let abs: string;
  try {
    abs = new Date(ms).toLocaleString();
  } catch {
    abs = String(ms);
  }
  return (
    <span className="ent-time" title={abs}>
      {relative(ms, Date.now())}
    </span>
  );
};

// ── Callout ──────────────────────────────────────────────────────────────────

/**
 * `warning` s'est ajouté au trio d'origine (F23) et il MÉRITE d'exister à part.
 *
 * `danger` dit « quelque chose ne va pas », et son rouge est réservé aux faits
 * qui coûtent quelque chose : une clé substituée, un scellé qui ne s'ouvre pas.
 * Un coffre gelé n'est ni une panne ni un incident — c'est un état VOULU par
 * quelqu'un, réversible d'un clic, qui change seulement ce que l'écran propose.
 * Le peindre en rouge apprendrait à ignorer le rouge, et le peindre en bleu
 * (`info`) le ferait passer pour un détail alors qu'il fait disparaître tous les
 * boutons d'écriture de la page. L'ambre est exactement l'entre-deux, et c'est
 * déjà le ton des pastilles (`ent-badge--warning`).
 *
 * L'icône est celle de `danger` — le triangle — parce que le sens est le même
 * (« lisez ceci avant de cliquer ») ; seule la couleur diffère.
 */
type CalloutTone = 'info' | 'success' | 'warning' | 'danger';

const CalloutIcon: FC<{ tone: CalloutTone }> = ({ tone }) => {
  if (tone === 'danger' || tone === 'warning')
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
    );
  if (tone === 'success')
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
        <polyline points="22 4 12 14.01 9 11.01" />
      </svg>
    );
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
};

export const InfoCallout: FC<{ tone?: CalloutTone; children: ReactNode }> = ({
  tone = 'info',
  children,
}) => (
  <div className={`ent-callout ent-callout--${tone}`}>
    <span className="ent-callout__icon">
      <CalloutIcon tone={tone} />
    </span>
    <div>{children}</div>
  </div>
);

// ── Danger zone ──────────────────────────────────────────────────────────────

export const DangerZone: FC<{ title: string; hint?: string; children: ReactNode }> = ({
  title,
  hint,
  children,
}) => (
  <div className="ent-danger">
    <p className="ent-danger__title">{title}</p>
    {hint && <p className="ent-danger__hint">{hint}</p>}
    {children}
  </div>
);
