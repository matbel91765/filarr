/**
 * Header Component
 *
 * En-tête principal style Google Drive avec barre de recherche proéminente
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import ProfileAvatar from '../../profiles/ProfileAvatar';
import { FilarrLogo } from '../../ui/FilarrLogo';
import { Dropdown } from '../../ui/Dropdown/Dropdown';
import type { DropdownItem } from '../../ui/Dropdown/Dropdown';
import useUI from '../../../../hooks/useUI';
import { useDebounce } from '../../../../hooks/useDebounce';
import { setQuery, executeSearch } from '../../../../store/slices/searchSlice';
import { setDensityMode, requestProfileSwitch } from '../../../../store/slices/uiSlice';
import { showWidget as showPomodoroWidget } from '../../../../store/slices/pomodoroSlice';
import { SearchResults } from '../SearchResults/SearchResults';
import type { RootState, AppDispatch } from '../../../../store';
import type { DensityMode } from '../../../../services/platform/themeService';
import { applyDensity, saveDensitySettings } from '../../../../services/platform/themeService';

/**
 * Props for Header component
 */
export interface HeaderProps {
  onMenuToggle?: () => void;
  sidebarOpen?: boolean;
  showSearch?: boolean;
  className?: string;
}

/**
 * Composant Header - Style Google Drive
 */
export const Header: React.FC<HeaderProps> = React.memo(function Header({
  onMenuToggle,
  sidebarOpen = false,
  showSearch = true,
  className,
}) {
  const { t } = useTranslation();
  const { theme, changeTheme } = useUI();
  const dispatch = useDispatch<AppDispatch>();
  const navigate = useNavigate();

  const density = useSelector((state: RootState) => state.ui.density);

  const [searchInput, setSearchInput] = useState('');
  const [showResults, setShowResults] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);

  const { query, results, loading } = useSelector((state: RootState) => state.search);
  const { localProfile } = useSelector((state: RootState) => state.auth);

  // Get active profile metadata from manifest (profiles slice)
  const activeProfileMeta = useSelector((state: RootState) => {
    const manifest = state.profiles.manifest;
    if (manifest?.activeProfileId) {
      return manifest.profiles.find((p) => p.id === manifest.activeProfileId) ?? null;
    }
    return null;
  });

  const debouncedSearchInput = useDebounce(searchInput, 300);

  useEffect(() => {
    if (debouncedSearchInput.trim()) {
      dispatch(setQuery(debouncedSearchInput));
      dispatch(executeSearch() as any);
      setShowResults(true);
    } else {
      setShowResults(false);
    }
  }, [debouncedSearchInput, dispatch]);

  const handleThemeToggle = useCallback((): void => {
    changeTheme(theme === 'dark' ? 'light' : 'dark');
  }, [changeTheme, theme]);

  const handleMenuToggle = useCallback((): void => {
    if (onMenuToggle) {
      onMenuToggle();
    }
  }, [onMenuToggle]);

  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>): void => {
    setSearchInput(e.target.value);
  }, []);

  const handleSearchBlur = useCallback((): void => {
    setSearchFocused(false);
    setTimeout(() => setShowResults(false), 200);
  }, []);

  const handleSearchFocus = useCallback((): void => {
    setSearchFocused(true);
    if (searchInput.trim() && results.length > 0) {
      setShowResults(true);
    }
  }, [searchInput, results.length]);

  const handleClearSearch = useCallback((): void => {
    setSearchInput('');
    setShowResults(false);
  }, []);

  const handleSettings = useCallback((): void => {
    navigate('/settings');
  }, [navigate]);

  const handleProfile = useCallback((): void => {
    navigate('/profile');
  }, [navigate]);

  const handleResultClick = useCallback((): void => {
    setShowResults(false);
  }, []);

  const handleSwitchProfile = useCallback((): void => {
    dispatch(requestProfileSwitch());
  }, [dispatch]);

  const handleDensityChange = useCallback(
    (mode: DensityMode): void => {
      try {
        const currentDensity = density || {
          mode: 'comfortable',
          viewType: 'grid' as const,
          listColumns: ['name', 'size', 'date', 'type'],
          gridItemSize: 'medium' as const,
        };
        const newDensity = { ...currentDensity, mode };
        applyDensity(newDensity);
        saveDensitySettings(newDensity);
        dispatch(setDensityMode(mode));
      } catch (error) {
        console.error('Error changing density mode:', error);
      }
    },
    [dispatch, density]
  );

  const densityMenuItems: DropdownItem[] = useMemo(
    () => [
      {
        label: t('header.comfortable', 'Comfortable'),
        icon: (
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <rect x="3" y="3" width="18" height="4" rx="1" />
            <rect x="3" y="10" width="18" height="4" rx="1" />
            <rect x="3" y="17" width="18" height="4" rx="1" />
          </svg>
        ),
        onClick: () => handleDensityChange('comfortable'),
      },
      {
        label: t('header.compact', 'Compact'),
        icon: (
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <rect x="3" y="4" width="18" height="3" rx="1" />
            <rect x="3" y="10" width="18" height="3" rx="1" />
            <rect x="3" y="16" width="18" height="3" rx="1" />
          </svg>
        ),
        onClick: () => handleDensityChange('compact'),
      },
      {
        label: t('header.dense', 'Dense'),
        icon: (
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <rect x="3" y="4" width="18" height="2" rx="0.5" />
            <rect x="3" y="8" width="18" height="2" rx="0.5" />
            <rect x="3" y="12" width="18" height="2" rx="0.5" />
            <rect x="3" y="16" width="18" height="2" rx="0.5" />
            <rect x="3" y="20" width="18" height="2" rx="0.5" />
          </svg>
        ),
        onClick: () => handleDensityChange('dense'),
      },
    ],
    [t, handleDensityChange]
  );

  const displayName = activeProfileMeta?.name || localProfile?.name || 'User';

  const userMenuItems: DropdownItem[] = useMemo(
    () => [
      {
        label: displayName,
        icon: (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
            width="16"
            height="16"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z"
            />
          </svg>
        ),
        disabled: true,
      },
      {
        label: t('header.profile', 'Profil'),
        icon: (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
            width="16"
            height="16"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M17.982 18.725A7.488 7.488 0 0012 15.75a7.488 7.488 0 00-5.982 2.975m11.963 0a9 9 0 10-11.963 0m11.963 0A8.966 8.966 0 0112 21a8.966 8.966 0 01-5.982-2.275M15 9.75a3 3 0 11-6 0 3 3 0 016 0z"
            />
          </svg>
        ),
        onClick: handleProfile,
      },
      {
        label: t('header.switchProfile', 'Changer de profil'),
        icon: (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
            width="16"
            height="16"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5"
            />
          </svg>
        ),
        onClick: handleSwitchProfile,
        divider: true,
      },
      {
        label: t('header.settings', 'Parametres'),
        icon: (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
            width="16"
            height="16"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
            />
          </svg>
        ),
        onClick: handleSettings,
      },
    ],
    [displayName, t, handleProfile, handleSwitchProfile, handleSettings]
  );

  return (
    <header
      className={`sticky top-0 left-0 right-0 z-50
        bg-[var(--color-surface)]/95 backdrop-blur-md
        border-b border-[var(--color-border)]
        ${className || ''}`}
    >
      <div className="flex items-center h-16 px-4 pr-[140px] gap-3">
        {/* ===== Left: Hamburger + Logo ===== */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={handleMenuToggle}
            className="w-10 h-10 flex items-center justify-center rounded-full
              text-[var(--color-text-secondary)] hover:bg-[var(--color-hover-overlay)]
              transition-colors duration-150"
            aria-label={
              sidebarOpen
                ? t('header.closeMenu', 'Fermer le menu')
                : t('header.openMenu', 'Ouvrir le menu')
            }
            aria-expanded={sidebarOpen}
          >
            {sidebarOpen ? (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
                className="w-6 h-6"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            ) : (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
                className="w-6 h-6"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5"
                />
              </svg>
            )}
          </button>

          <div className="flex items-center gap-2.5 select-none cursor-default">
            <FilarrLogo size={36} />
            <span className="text-[22px] font-semibold text-[var(--color-text-primary)] tracking-tight hidden sm:inline">
              Filarr
            </span>
          </div>
        </div>

        {/* ===== Center: Search Bar ===== */}
        {showSearch && (
          <div
            className="flex-1 flex justify-center max-w-[720px] mx-auto relative"
            data-tour-search
          >
            <div
              className={`relative w-full flex items-center rounded-full transition-all duration-200
                ${
                  searchFocused
                    ? 'bg-[var(--color-surface)] shadow-lg ring-1 ring-[var(--color-primary-300)]'
                    : 'bg-[var(--color-background-secondary)] hover:shadow-md'
                }`}
            >
              <div className="absolute left-4 flex items-center pointer-events-none">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                  stroke="currentColor"
                  className="w-5 h-5 text-[var(--color-text-tertiary)]"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
                  />
                </svg>
              </div>

              <input
                type="text"
                value={searchInput}
                onChange={handleSearchChange}
                onBlur={handleSearchBlur}
                onFocus={handleSearchFocus}
                placeholder={t('header.search', 'Rechercher dans Filarr')}
                className="w-full h-12 pl-12 pr-12 bg-transparent rounded-full
                  text-[var(--color-text-primary)] text-base
                  placeholder:text-[var(--color-text-tertiary)]
                  focus:outline-none"
              />

              {searchInput && (
                <button
                  onClick={handleClearSearch}
                  className="absolute right-4 flex items-center justify-center w-6 h-6 rounded-full
                    text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]
                    hover:bg-[var(--color-hover-overlay)] transition-colors duration-150"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={2}
                    stroke="currentColor"
                    className="w-4 h-4"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>

            {showResults && (
              <div className="absolute top-full left-0 right-0 mt-1 z-50">
                <SearchResults
                  results={results}
                  loading={loading}
                  query={query}
                  onResultClick={handleResultClick}
                />
              </div>
            )}
          </div>
        )}

        {/* ===== Right: Actions ===== */}
        <div className="flex items-center gap-1 shrink-0">
          {/* Theme toggle */}
          <button
            onClick={handleThemeToggle}
            className="w-10 h-10 flex items-center justify-center rounded-full
              text-[var(--color-text-secondary)] hover:bg-[var(--color-hover-overlay)]
              transition-colors duration-150"
            aria-label={t('header.toggleTheme')}
            data-tour-theme
          >
            {theme === 'dark' ? (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
                className="w-5 h-5"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z"
                />
              </svg>
            ) : (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
                className="w-5 h-5"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z"
                />
              </svg>
            )}
          </button>

          {/* Focus timer (Pomodoro) */}
          <button
            onClick={() => dispatch(showPomodoroWidget())}
            className="w-10 h-10 flex items-center justify-center rounded-full
              text-[var(--color-text-secondary)] hover:bg-[var(--color-hover-overlay)]
              transition-colors duration-150"
            aria-label={t('header.focusTimer', 'Focus timer')}
            title={t('header.focusTimer', 'Focus timer')}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
              className="w-5 h-5"
            >
              <circle cx="12" cy="13" r="8" />
              <path strokeLinecap="round" d="M12 9v4l2.5 2.5M9 2h6M12 5V2" />
            </svg>
          </button>

          {/* Density dropdown */}
          <Dropdown
            trigger={
              <button
                className="w-10 h-10 flex items-center justify-center rounded-full
                  text-[var(--color-text-secondary)] hover:bg-[var(--color-hover-overlay)]
                  transition-colors duration-150"
                aria-label={t('header.density', 'Density')}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                  className="w-5 h-5"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75"
                  />
                </svg>
              </button>
            }
            items={densityMenuItems}
            position="bottom-right"
            closeOnSelect={true}
          />

          {/* Divider */}
          <div className="w-px h-8 bg-[var(--color-border)] mx-1.5 hidden sm:block" />

          {/* User avatar dropdown */}
          <Dropdown
            trigger={
              <button
                className="p-1 rounded-full hover:bg-[var(--color-hover-overlay)] transition-colors duration-150"
                data-tour-profile
              >
                <ProfileAvatar
                  name={activeProfileMeta?.name || localProfile?.name || 'U'}
                  avatarColor={
                    activeProfileMeta?.avatarColor || localProfile?.avatarColor || '#4682B4'
                  }
                  avatarImage={activeProfileMeta?.avatarImage}
                  size={36}
                />
              </button>
            }
            items={userMenuItems}
            position="bottom-right"
            closeOnSelect={true}
          />
        </div>
      </div>
    </header>
  );
});

export default Header;
