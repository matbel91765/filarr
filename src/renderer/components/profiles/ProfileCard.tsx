/**
 * ProfileCard — Individual profile avatar card
 *
 * Displays a profile avatar with name, last accessed time, and lock indicator.
 * Used inside ProfilePicker.
 */

import React from 'react';
import type { ProfileMetadata } from '../../../types/profiles';
import ProfileAvatar from './ProfileAvatar';

interface ProfileCardProps {
  profile: ProfileMetadata;
  isActive?: boolean;
  onClick: () => void;
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

const ProfileCard: React.FC<ProfileCardProps> = ({ profile, isActive, onClick }) => {
  const hasPin = !!profile.pinHash;

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
      aria-label={`Select profile ${profile.name}`}
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

      {/* Last accessed */}
      <span className="text-xs text-[var(--color-text-tertiary)]">
        {formatRelativeTime(profile.lastAccessedAt)}
      </span>
    </button>
  );
};

export default ProfileCard;
