/**
 * ProfileGroupHeader — Thin section header for the grouped ProfilePicker.
 *
 * Rendered above a cluster of profile cards when ProfilePicker has more
 * than one group (e.g. 2 cloud accounts, or 1 cloud + local). Single-group
 * layouts skip it to avoid noise.
 *
 * Visual: two thin dotted lines flanking a compact label. The label is the
 * cloud account's email + tier pill, OR "Local" for the local-only bucket.
 */

import React from 'react';
import { Dropdown } from '../ui/Dropdown/Dropdown';
import type { DropdownItem } from '../ui/Dropdown/Dropdown';

const TIER_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  free: { bg: 'var(--color-neutral-100)', text: 'var(--color-neutral-600)', label: 'Free' },
  solo: { bg: '#dbeafe', text: '#1d4ed8', label: 'Solo' },
  pro: { bg: '#ede9fe', text: '#7c3aed', label: 'Pro' },
};

interface ProfileGroupHeaderProps {
  /** Cloud account info, or null for the local-only group. */
  cloud: { email: string; tier: string } | null;
  /** i18n'd label for the local group — passed in so the header stays presentation-only. */
  localLabel: string;
  /** Current collapsed state — if null, the header is static (not interactive). */
  collapsed?: boolean;
  /** Toggle handler — when provided, the header becomes a button and shows a chevron. */
  onToggle?: () => void;
  /** Profile count shown as a badge when collapsed (so the user knows what's hidden). */
  profileCount?: number;
  /**
   * When provided, a kebab (⋮) is rendered on the right that opens a
   * Dropdown with these items — account-level actions (manage devices,
   * disconnect all, etc.). Click propagation from the kebab is stopped
   * so opening the menu doesn't simultaneously toggle the collapse.
   */
  menuItems?: DropdownItem[];
}

const ProfileGroupHeader: React.FC<ProfileGroupHeaderProps> = ({
  cloud,
  localLabel,
  collapsed,
  onToggle,
  profileCount,
  menuItems,
}) => {
  const tier = cloud ? TIER_COLORS[cloud.tier] || TIER_COLORS.free : null;
  const interactive = !!onToggle;

  const content = (
    <>
      {/* Left rule */}
      <div
        className="flex-1 h-px"
        style={{
          borderTop: '1px dashed var(--color-border)',
        }}
      />

      {/* Label */}
      <div className="flex items-center gap-2">
        {interactive && (
          <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--color-text-tertiary)"
            strokeWidth="2.5"
            style={{
              transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
              transition: 'transform 150ms ease',
            }}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        )}
        {cloud ? (
          <>
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--color-text-secondary)"
              strokeWidth="1.8"
            >
              <path d="M2.25 15a4.5 4.5 0 004.5 4.5H18a3.75 3.75 0 001.332-7.257 3 3 0 00-3.758-3.848 5.25 5.25 0 00-10.233 2.33A4.502 4.502 0 002.25 15z" />
            </svg>
            <span
              className="text-xs font-medium truncate max-w-[200px]"
              style={{ color: 'var(--color-text-secondary)' }}
            >
              {cloud.email}
            </span>
            {tier && (
              <span
                className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                style={{ backgroundColor: tier.bg, color: tier.text }}
              >
                {tier.label}
              </span>
            )}
          </>
        ) : (
          <>
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--color-text-tertiary)"
              strokeWidth="1.8"
            >
              <path d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
            </svg>
            <span className="text-xs font-medium" style={{ color: 'var(--color-text-tertiary)' }}>
              {localLabel}
            </span>
          </>
        )}
        {collapsed && typeof profileCount === 'number' && profileCount > 0 && (
          <span
            className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
            style={{
              backgroundColor: 'var(--color-neutral-100)',
              color: 'var(--color-neutral-600)',
            }}
          >
            {profileCount}
          </span>
        )}
      </div>

      {/* Right rule */}
      <div
        className="flex-1 h-px"
        style={{
          borderTop: '1px dashed var(--color-border)',
        }}
      />

      {/* Account-level actions menu (cloud groups only).
          Rendered *outside* the clickable area so opening it doesn't also
          toggle the collapse — the span wrapper's onClick stops propagation
          before the parent's handler fires. */}
      {menuItems && menuItems.length > 0 && cloud && (
        <span onClick={(e) => e.stopPropagation()}>
          <Dropdown
            trigger={
              <button
                type="button"
                className="p-1 rounded hover:bg-[var(--color-hover-overlay)] cursor-pointer bg-transparent border-0"
                style={{ color: 'var(--color-text-tertiary)' }}
                aria-label="Account menu"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <circle cx="12" cy="5" r="1.5" />
                  <circle cx="12" cy="12" r="1.5" />
                  <circle cx="12" cy="19" r="1.5" />
                </svg>
              </button>
            }
            items={menuItems}
            position="bottom-right"
          />
        </span>
      )}
    </>
  );

  const baseClass = 'flex items-center gap-3 w-full max-w-3xl px-8 mb-4';
  if (interactive) {
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggle();
          }
        }}
        className={`${baseClass} cursor-pointer`}
        aria-expanded={!collapsed}
      >
        {content}
      </div>
    );
  }
  return <div className={baseClass}>{content}</div>;
};

export default React.memo(ProfileGroupHeader);
