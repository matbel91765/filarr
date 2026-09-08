/**
 * SpaceSelector — the launch-time workspace chooser.
 *
 * Shown before the ProfilePicker. Personal and enterprise accounts are strictly
 * distinct (a personal account can never belong to an org), so the user first
 * picks WHICH space to enter; the picker then lists only that space's profiles.
 */

import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector, useDispatch } from 'react-redux';
import type { RootState, AppDispatch } from '../../../store';
import { fetchManifest } from '../../../store/slices/profilesSlice';
import { FilarrLogo } from '../ui/FilarrLogo';
import { profileSpaceOf } from './ProfilePicker';
import { ENTERPRISE_ACCESSIBLE, isEnterpriseHidden } from '../../../config/enterprise';

interface SpaceSelectorProps {
  onSelect: (space: 'personal' | 'enterprise') => void;
}

const SpaceSelector: React.FC<SpaceSelectorProps> = ({ onSelect }) => {
  const { t } = useTranslation();
  const dispatch = useDispatch<AppDispatch>();
  const manifest = useSelector((s: RootState) => s.profiles.manifest);

  useEffect(() => {
    dispatch(fetchManifest());
  }, [dispatch]);

  const profiles = manifest?.profiles ?? [];
  const personalCount = profiles.filter((p) => profileSpaceOf(p) === 'personal').length;
  const enterpriseCount = profiles.filter((p) => profileSpaceOf(p) === 'enterprise').length;
  // The enterprise card is hidden entirely when the user opted out at startup.
  const showEnterprise = !isEnterpriseHidden();

  const card = (
    space: 'personal' | 'enterprise',
    title: string,
    desc: string,
    count: number,
    icon: React.ReactNode,
    comingSoon = false
  ) => (
    <button
      onClick={() => !comingSoon && onSelect(space)}
      disabled={comingSoon}
      aria-disabled={comingSoon}
      className={`relative text-left p-6 rounded-2xl border-2 transition-all ${
        comingSoon ? 'cursor-not-allowed' : 'hover:shadow-lg hover:scale-[1.02] cursor-pointer'
      }`}
      style={{
        borderColor: 'var(--color-border)',
        backgroundColor: 'var(--color-surface)',
        opacity: comingSoon ? 0.6 : 1,
      }}
      onMouseEnter={(e) => {
        if (comingSoon) return;
        e.currentTarget.style.borderColor = 'var(--color-primary-400)';
        e.currentTarget.style.backgroundColor = 'var(--color-primary-50)';
      }}
      onMouseLeave={(e) => {
        if (comingSoon) return;
        e.currentTarget.style.borderColor = 'var(--color-border)';
        e.currentTarget.style.backgroundColor = 'var(--color-surface)';
      }}
    >
      {comingSoon && (
        <span
          className="absolute top-3 right-3 text-[10px] font-semibold px-2 py-0.5 rounded-full"
          style={{ backgroundColor: 'var(--color-neutral-200)', color: 'var(--color-neutral-600)' }}
        >
          {t('spaces.comingSoon', 'Prochainement')}
        </span>
      )}
      <div className="mb-3" style={{ color: 'var(--color-primary-600)' }}>
        {icon}
      </div>
      <h3 className="text-lg font-semibold mb-1" style={{ color: 'var(--color-text-primary)' }}>
        {title}
      </h3>
      <p className="text-sm mb-3" style={{ color: 'var(--color-text-secondary)' }}>
        {desc}
      </p>
      {!comingSoon && (
        <span
          className="inline-block text-xs font-medium px-2.5 py-1 rounded-full"
          style={{
            backgroundColor: 'var(--color-background-secondary)',
            color: 'var(--color-text-tertiary)',
          }}
        >
          {count > 0
            ? t('spaces.profileCount', '{{count}} profil(s)', { count })
            : t('spaces.noProfile', 'Aucun profil')}
        </span>
      )}
    </button>
  );

  return (
    // chrome:free — ecran centre, aucun controle dans la bande haute.
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[var(--color-background)]">
      <div className="mb-8 text-center animate-fadeIn">
        <div className="mx-auto mb-4">
          <FilarrLogo size={56} />
        </div>
        <h1 className="text-2xl font-bold mb-1" style={{ color: 'var(--color-text-primary)' }}>
          {t('spaces.title', 'Choisissez votre espace')}
        </h1>
        <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
          {t('spaces.subtitle', 'Vos espaces personnel et entreprise sont séparés.')}
        </p>
      </div>

      <div
        className={`grid ${showEnterprise ? 'grid-cols-2' : 'grid-cols-1 max-w-sm'} gap-5 w-full max-w-2xl px-8 animate-fadeIn`}
        style={{ animationDelay: '80ms' }}
      >
        {card(
          'personal',
          t('spaces.personalTitle', 'Personnel'),
          t('spaces.personalDesc', 'Vos fichiers et notes personnels. Local ou avec sync cloud.'),
          personalCount,
          <svg
            className="w-9 h-9"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M17.982 18.725A7.488 7.488 0 0012 15.75a7.488 7.488 0 00-5.982 2.975m11.963 0a9 9 0 10-11.963 0m11.963 0A8.966 8.966 0 0112 21a8.966 8.966 0 01-5.982-2.275M15 9.75a3 3 0 11-6 0 3 3 0 016 0z"
            />
          </svg>
        )}
        {showEnterprise &&
          card(
            'enterprise',
            t('spaces.enterpriseTitle', 'Entreprise'),
            t(
              'spaces.enterpriseDesc',
              'Coffres partagés et administration. Compte entreprise distinct.'
            ),
            enterpriseCount,
            <svg
              className="w-9 h-9"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21"
              />
            </svg>,
            !ENTERPRISE_ACCESSIBLE
          )}
      </div>

      <style>{`
        .animate-fadeIn { animation: fadeIn 400ms ease-out both; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
    </div>
  );
};

export default SpaceSelector;
