/**
 * ProfileCard — Individual profile avatar card
 *
 * Displays a profile avatar with name, last accessed time, and lock indicator.
 * Used inside ProfilePicker.
 */

import React from 'react';
import type { ProfileMetadata } from '../../../types/profiles';
import ProfileAvatar from './ProfileAvatar';

type SyncDotState = 'ok' | 'paused' | 'error' | 'offline' | null;

interface ProfileCardProps {
  profile: ProfileMetadata;
  isActive?: boolean;
  onClick: () => void;
  /**
   * Sync state badge to render on top of the cloud chip.
   * null = no dot (local profile or unknown).
   * Live state is only available for the active profile — we derive it
   * from the pause flag for non-active cloud profiles.
   */
  syncDot?: SyncDotState;
}

function getInitials(name: string): string {
  return name.trim().charAt(0).toUpperCase();
}

function lightenColor(hex: string, amount: number): string {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.min(255, (num >> 16) + amount);
  const g = Math.min(255, ((num >> 8) & 0x00ff) + amount);
  const b = Math.min(255, (num & 0x0000ff) + amount);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

function formatRelativeTime(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(isoDate).toLocaleDateString();
}

// Colors that match the plan badge in AccountSyncSection — kept in sync
// with that component's `PLAN_COLORS` so the visual language is identical.
const CLOUD_CHIP_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  free: { bg: 'var(--color-neutral-100)', text: 'var(--color-neutral-600)', label: 'Free' },
  solo: { bg: '#dbeafe', text: '#1d4ed8', label: 'Solo' },
  pro: { bg: '#ede9fe', text: '#7c3aed', label: 'Pro' },
  teams: { bg: '#dcfce7', text: '#15803d', label: 'Teams' },
  enterprise: { bg: '#fef3c7', text: '#b45309', label: 'Enterprise' },
};

const DOT_COLORS: Record<NonNullable<SyncDotState>, { bg: string; tooltip: string }> = {
  ok: { bg: '#10b981', tooltip: 'Sync à jour' },
  paused: { bg: '#f59e0b', tooltip: 'Sync en pause' },
  error: { bg: '#ef4444', tooltip: 'Erreur de sync' },
  offline: { bg: 'var(--color-neutral-400)', tooltip: 'Hors ligne' },
};

const ProfileCard: React.FC<ProfileCardProps> = ({ profile, isActive, onClick, syncDot }) => {
  const hasPin = !!profile.pinHash;
  const cloud = profile.cloudAccount;
  const chipStyle = cloud ? CLOUD_CHIP_COLORS[cloud.tier] || CLOUD_CHIP_COLORS.free : null;
  const dot = syncDot && cloud ? DOT_COLORS[syncDot] : null;

  return (
    <button
      onClick={onClick}
      className="group flex flex-col items-center gap-2 p-4 rounded-2xl
        transition-all duration-200 ease-out cursor-pointer
        hover:scale-105 hover:shadow-lg
        focus:outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)] focus:ring-offset-2"
      style={{
        backgroundColor: isActive ? 'var(--color-selected)' : 'transparent',
      }}
      aria-label={`Select profile ${profile.name}${cloud ? ` — ${cloud.email}` : ' — local'}`}
      title={cloud ? `${profile.name} — ${cloud.email} (${chipStyle?.label})` : undefined}
      data-profile-card-id={profile.id}
    >
      {/* Avatar */}
      <div className="relative">
        <ProfileAvatar
          name={profile.name}
          avatarColor={profile.avatarColor}
          avatarImage={profile.avatarImage}
          size={80}
          className="shadow-md group-hover:shadow-xl transition-shadow duration-200"
        />

        {/* Lock badge */}
        {hasPin && (
          <div
            className="absolute -bottom-0.5 -right-0.5 w-6 h-6 rounded-full
              flex items-center justify-center
              border-2 border-[var(--color-background)]
              bg-[var(--color-neutral-700)] text-white"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </div>
        )}
      </div>

      {/* Name */}
      <span className="text-sm font-semibold text-[var(--color-text-primary)] max-w-[100px] truncate">
        {profile.name}
      </span>

      {/* Cloud account chip — tier label + cloud glyph, or "Local" if none */}
      {cloud && chipStyle ? (
        <div className="inline-flex items-center gap-1.5">
          <span
            className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full max-w-[110px] truncate"
            style={{ backgroundColor: chipStyle.bg, color: chipStyle.text }}
          >
            <svg
              width="9"
              height="9"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M2.25 15a4.5 4.5 0 004.5 4.5H18a3.75 3.75 0 001.332-7.257 3 3 0 00-3.758-3.848 5.25 5.25 0 00-10.233 2.33A4.502 4.502 0 002.25 15z" />
            </svg>
            {chipStyle.label}
          </span>
          {dot && (
            <span
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: dot.bg }}
              title={dot.tooltip}
              aria-label={dot.tooltip}
            />
          )}
        </div>
      ) : (
        <span
          className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full"
          style={{
            backgroundColor: 'var(--color-neutral-100)',
            color: 'var(--color-neutral-500)',
          }}
        >
          Local
        </span>
      )}

      {/* Last accessed */}
      <span className="text-xs text-[var(--color-text-tertiary)]">
        {formatRelativeTime(profile.lastAccessedAt)}
      </span>
    </button>
  );
};

export default ProfileCard;
