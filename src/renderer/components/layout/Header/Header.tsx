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
import MentionsBell from './MentionsBell';
import { profileSpaceOf } from '../../profiles/ProfilePicker';
import { isEnterpriseHidden } from '../../../../config/enterprise';
import { selectActiveSpace, selectCurrentOrg } from '../../../../store/selectors/authSelectors';
import { FilarrLogo } from '../../ui/FilarrLogo';
import { Dropdown } from '../../ui/Dropdown/Dropdown';
import type { DropdownItem } from '../../ui/Dropdown/Dropdown';
import { useNotification } from '../../ui/Notification';
import useUI from '../../../../hooks/useUI';
import { useDebounce } from '../../../../hooks/useDebounce';
import { setQuery, executeSearch } from '../../../../store/slices/searchSlice';
import { setDensityMode, requestProfileSwitch } from '../../../../store/slices/uiSlice';
import { showWidget as showPomodoroWidget } from '../../../../store/slices/pomodoroSlice';
import { SearchResults } from '../SearchResults/SearchResults';
import type { RootState, AppDispatch } from '../../../../store';
import type { DensityMode } from '../../../../services/platform/themeService';
import { applyDensity, saveDensitySettings } from '../../../../services/platform/themeService';
import SyncStatusIcon from '../../sync/SyncStatusIcon';
import { selectHeaderBarSide } from '../../../../store/selectors/uiSelectors';
import { searchFieldProps } from '../../ui/searchFieldProps';

// Les DEUX bords de la bande native : les boutons de fenêtre à droite sous
// Windows/Linux, les feux à GAUCHE sous macOS — où le hamburger passait
// jusqu'ici sous les trois pastilles, pendant que 140 px étaient réservés du
// mauvais côté. La réserve est mesurée (styles/chrome.css) et vaut 0 dans un
// navigateur : plus aucune constante de plateforme ici.
const headerChromeInset = 'chrome-safe-inline';

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
  // Disposition « rail » : la barre est une colonne de 56 px collée à gauche.
  // Un menu ancré à droite s'ouvrirait alors hors de l'écran — et comme les
  // SEULS menus de la barre (densité, profil) vivent dans `header__actions`,
  // épinglé au BAS de la colonne, un menu ouvert vers le bas tombait sous le
  // bord de la fenêtre. On demande donc l'ouverture vers le haut ; le Dropdown
  // rebascule tout seul si jamais elle ne tenait pas non plus.
  const isRail = useSelector(selectHeaderBarSide);
  const menuPosition = isRail ? 'top-left' : 'bottom-right';

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
  const { success: notifySuccess } = useNotification();

  // After a profile switch from the dropdown (triggers window.location.reload),
  // show a one-shot toast confirming the new identity. The flag is stashed
  // in sessionStorage before reload and consumed once here.
  useEffect(() => {
    try {
      const switchedTo = sessionStorage.getItem('filarr.recently-switched');
      if (!switchedTo || !activeProfileMeta) return;
      if (switchedTo !== activeProfileMeta.id) return;
      sessionStorage.removeItem('filarr.recently-switched');
      const label = activeProfileMeta.cloudAccount
        ? `${activeProfileMeta.name} — ${activeProfileMeta.cloudAccount.email}`
        : `${activeProfileMeta.name} — Local`;
      notifySuccess(`Profil actif : ${label}`);
    } catch {
      /* ignore */
    }
  }, [activeProfileMeta, notifySuccess]);

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

  // Header label for the current identity — profile name + cloud email if
  // bound, making the active account unambiguous at a glance.
  const activeIdentityLabel = activeProfileMeta?.cloudAccount
    ? `${displayName} — ${activeProfileMeta.cloudAccount.email}`
    : displayName;

  /**
   * Les autres profils DU MÊME ESPACE.
   *
   * ── LE DÉFAUT QUE CE FILTRE FERME ───────────────────────────────────────
   *
   * Cette liste ne filtrait rien. Depuis un profil d'organisation on voyait
   * donc tous ses profils personnels, et réciproquement — alignés dans le même
   * menu, sans la moindre marque, avec leurs adresses. Or la séparation des
   * deux mondes n'est pas une préférence d'affichage : c'est l'invariant sur
   * lequel repose la promesse faite au salarié comme à l'employeur (règle
   * 0059, un compte ne peut pas appartenir aux deux). Un menu qui les mélange
   * dit exactement le contraire de ce que le produit vend.
   *
   * L'ESPACE SE DÉDUIT DU PROFIL ACTIF, pas du magasin. `selectActiveSpace`
   * décrit l'intention de session ; ici on veut l'appartenance du profil
   * lui-même, celle qui vaut avant toute activation — c'est ce que
   * `profileSpaceOf` répond, et c'est déjà elle qui range le sélecteur de
   * lancement. Deux réponses différentes à « à quel espace appartient ce
   * profil » finiraient par diverger.
   */
  const otherProfiles = useSelector((state: RootState) => {
    const manifest = state.profiles.manifest;
    if (!manifest?.activeProfileId) return [];
    const active = manifest.profiles.find((p) => p.id === manifest.activeProfileId);
    if (!active) return [];
    const space = profileSpaceOf(active);
    return manifest.profiles.filter(
      (p) => p.id !== manifest.activeProfileId && profileSpaceOf(p) === space
    );
  });

  /** L'espace du profil actif — décide du libellé de la porte vers l'autre. */
  const activeSpace = useSelector((state: RootState) => {
    const manifest = state.profiles.manifest;
    const active = manifest?.profiles.find((p) => p.id === manifest.activeProfileId);
    return active ? profileSpaceOf(active) : 'personal';
  });

  /** Les profils de l'AUTRE espace présents sur cette machine (section à part, plus bas). */
  const otherSpaceProfiles = useSelector((state: RootState) => {
    const manifest = state.profiles.manifest;
    if (!manifest?.activeProfileId) return [];
    const active = manifest.profiles.find((p) => p.id === manifest.activeProfileId);
    if (!active) return [];
    const space = profileSpaceOf(active);
    return manifest.profiles.filter(
      (p) => p.id !== manifest.activeProfileId && profileSpaceOf(p) !== space
    );
  });

  /**
   * La marque d'espace lit l'INTENTION DE SESSION (`spaceMode`), pas
   * l'appartenance du profil : c'est bien « où je travaille en ce moment »
   * qu'elle annonce. Elle ne dépend pas de `selectIsEnterpriseSpace`, qui exige
   * en plus une organisation liée — quelqu'un entré dans l'espace mais dont la
   * liste d'organisations n'est pas encore chargée doit malgré tout savoir où
   * il est, sinon la marque clignote au démarrage.
   */
  const isEnterpriseSpaceHeader = useSelector(selectActiveSpace) === 'enterprise';
  const headerOrgName = useSelector(selectCurrentOrg)?.name ?? null;
  /** Tous les profils du manifeste — pour retrouver l'ESPACE du profil visé par une bascule. */
  const manifestProfiles = useSelector((state: RootState) => state.profiles.manifest?.profiles);

  const handleSwitchToProfile = useCallback(
    async (profileId: string) => {
      try {
        const { activateProfile } = await import('../../../../store/slices/profilesSlice');
        // Update the renderer-side active-profile pointer BEFORE reload.
        // Without this, the next boot reads the stale `filarr-active-profile`
        // from localStorage and re-hydrates redux-persist from the previous
        // profile's prefixed keys, leaking that profile's folders/tabs into
        // the new session. profileStorage.setActiveProfile writes both the
        // in-memory pointer and the localStorage key.
        const { setActiveProfile } = await import('../../../../services/core/profileStorage');
        // L'INTENTION doit survivre au rechargement. Tout l'état de lancement
        // d'App est local au composant : sans elle, la fenêtre rechargée
        // repartait de sa première porte — le portail des espaces, puis le
        // sélecteur — et demandait de rechoisir ce qu'on venait de choisir.
        // Posée AVANT l'activation : sur le web, `profile:activate` peut
        // recharger la page lui-même (adoption de la session du compte).
        try {
          const target = manifestProfiles?.find((p) => p.id === profileId);
          sessionStorage.setItem(
            'filarr.switch-intent',
            JSON.stringify({ profileId, space: target ? profileSpaceOf(target) : 'personal' })
          );
        } catch {
          /* ignore */
        }
        setActiveProfile(profileId);
        await dispatch(activateProfile(profileId) as any).unwrap();
        // Stash the target profile id so App.tsx can show a "recently
        // switched" toast after the reload. Read-once, cleared immediately.
        try {
          sessionStorage.setItem('filarr.recently-switched', profileId);
        } catch {
          /* ignore */
        }
        // Re-run the full post-selection pipeline by reloading the window.
        // Simpler + safer than re-wiring every slice (folders, files, notes,
        // sync) in place — Electron reload is instant.
        window.location.reload();
      } catch (err) {
        console.error('[Header] switchToProfile failed:', err);
      }
    },
    [dispatch, manifestProfiles]
  );

  const userMenuItems: DropdownItem[] = useMemo(
    () => [
      {
        label: activeIdentityLabel,
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
        divider: otherProfiles.length === 0,
      },
      // Quick-switch entries: one per other profile. PIN-protected profiles
      // are still routed through the picker (handleSwitchProfile) so the PIN
      // gate runs — here we only auto-switch for profiles without a PIN.
      ...otherProfiles.map((p, i) => ({
        label: p.cloudAccount ? `${p.name} — ${p.cloudAccount.email}` : `${p.name} — Local`,
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
            {p.cloudAccount ? (
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M2.25 15a4.5 4.5 0 004.5 4.5H18a3.75 3.75 0 001.332-7.257 3 3 0 00-3.758-3.848 5.25 5.25 0 00-10.233 2.33A4.502 4.502 0 002.25 15z"
              />
            ) : (
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z"
              />
            )}
          </svg>
        ),
        onClick: p.pinHash ? handleSwitchProfile : () => handleSwitchToProfile(p.id),
        divider: i === otherProfiles.length - 1 && otherSpaceProfiles.length === 0,
      })),

      /**
       * VOTRE AUTRE ESPACE — le passage d'un monde à l'autre, en un geste.
       *
       * ── POURQUOI UNE SECTION À PART, ET SURTOUT PAS LA MÊME LISTE ───────────
       *
       * Ce menu listait autrefois tous les profils sans distinction : depuis une
       * organisation on voyait ses profils personnels alignés avec ceux du
       * travail, sans une marque. C'est ce qui fait ranger un dossier client
       * dans son espace privé — une erreur que le chiffrement ne rattrape pas,
       * puisque les deux mondes sont justement étanches.
       *
       * Les profils de l'autre espace sont donc SÉPARÉS et NOMMÉS. On garde le
       * geste (basculer d'un clic, sans ressaisir de mot de passe) en retirant
       * la confusion : la personne voit qu'elle change de monde.
       *
       * ── LE LIEN VIT SUR L'APPAREIL, ET NULLE PART AILLEURS ─────────────────
       *
       * Ce qui rapproche ces deux comptes, c'est d'être installés sur la même
       * machine. Le serveur, lui, n'apprend rien : il voit deux comptes sans
       * relation, ce qui est très exactement la propriété qu'on vend. Fusionner
       * les deux en un seul compte donnerait le même confort en inscrivant le
       * lien dans la base — visible, réquisitionnable — pour ne rien gagner
       * d'autre, puisque les données ne passent de toute façon pas d'un espace
       * à l'autre.
       */
      /**
       * L'AUTRE ESPACE N'EXISTE PAS ENCORE : on propose de l'ouvrir.
       *
       * C'était la porte manquante. Depuis un profil personnel, fonder son
       * organisation demandait de revenir au sélecteur, puis de trouver
       * « changer d'espace », puis de cliquer sur la carte Entreprise — trois
       * gestes pour une intention qui tient en une phrase. L'entrée vise
       * directement le sélecteur de l'autre espace, lequel, vide, affiche
       * désormais l'écran d'accueil qui explique et propose ses deux portes.
       *
       * Rien n'est créé ici : on ouvre un chemin, on ne prend aucune décision
       * à la place de la personne.
       */
      ...(otherSpaceProfiles.length === 0 && !isEnterpriseHidden()
        ? [
            {
              label:
                activeSpace === 'enterprise'
                  ? t('header.openPersonalSpace', 'Ouvrir mon espace personnel')
                  : t('header.openOrgSpace', 'Ouvrir mon espace professionnel'),
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
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
              ),
              onClick: () =>
                dispatch(
                  requestProfileSwitch(activeSpace === 'enterprise' ? 'personal' : 'enterprise')
                ),
              divider: true,
            },
          ]
        : []),

      ...(otherSpaceProfiles.length > 0
        ? [
            {
              label: t('header.otherSpace', 'Votre autre espace'),
              icon: null,
              onClick: () => {},
              disabled: true,
            },
            ...otherSpaceProfiles.map((p, i) => ({
              label: p.cloudAccount ? `${p.name} — ${p.cloudAccount.email}` : `${p.name} — Local`,
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
                  {profileSpaceOf(p) === 'enterprise' ? (
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M3.75 21h16.5M5.25 3v18m13.5-18v18M4.5 3h15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21"
                    />
                  ) : (
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M17.982 18.725A7.488 7.488 0 0012 15.75a7.488 7.488 0 00-5.982 2.975m11.963 0a9 9 0 10-11.963 0m11.963 0A8.966 8.966 0 0112 21a8.966 8.966 0 01-5.982-2.275M15 9.75a3 3 0 11-6 0 3 3 0 016 0z"
                    />
                  )}
                </svg>
              ),
              // Un profil protégé par un code repasse par le sélecteur, qui
              // porte la porte du code — comme pour le même espace.
              onClick: p.pinHash ? handleSwitchProfile : () => handleSwitchToProfile(p.id),
              divider: i === otherSpaceProfiles.length - 1,
            })),
          ]
        : []),
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
    [
      activeIdentityLabel,
      t,
      handleProfile,
      handleSwitchProfile,
      handleSettings,
      otherProfiles,
      otherSpaceProfiles,
      activeSpace,
      dispatch,
      handleSwitchToProfile,
    ]
  );

  return (
    <header
      className={`sticky top-0 left-0 right-0 z-50
        bg-[var(--color-surface)]/95 backdrop-blur-md
        border-b border-[var(--color-border)]
        ${className || ''}`}
    >
      {/* Les crochets header__* ne portent aucun style par défaut : ils
          donnent aux dispositions « flottante » et « rail » (Layout.css) une
          prise pour replier la barre sans dupliquer le Header. */}
      <div
        className={`header__inner flex items-center h-16 gap-3 ${headerChromeInset}`}
        // Le padding PROPRE de la barre, auquel `chrome-safe-inline` ajoute la
        // réserve native. En variable et non en `px-4` : un utilitaire Tailwind
        // et la classe se disputeraient la même propriété.
        style={{ '--chrome-bar-pad': '1rem' } as React.CSSProperties}
      >
        {/* ===== Left: Hamburger + Logo ===== */}
        <div className="header__left flex items-center gap-3 shrink-0">
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

          <div className="header__brand flex items-center gap-2.5 select-none cursor-default">
            <FilarrLogo size={36} />
            <span className="header__brand-name text-[22px] font-semibold text-[var(--color-text-primary)] tracking-tight hidden sm:inline">
              Filarr
            </span>
            {/*
              DANS QUEL ESPACE SUIS-JE ? La question n'avait aucune réponse à
              l'écran : l'application est rigoureusement identique en personnel
              et en organisation, et le seul indice — le sélecteur d'org — vit
              enfoui dans les Réglages. Or ce n'est pas un détail de confort :
              quelqu'un qui ignore où il se trouve range un document
              professionnel dans son espace privé, ou l'inverse.

              La marque est permanente et discrète, posée contre le nom du
              produit, et elle NOMME l'organisation quand on la connaît — « je
              suis chez Filarr, dans l'espace de Cabinet Vernier ». L'espace
              personnel n'en porte pas : c'est le cas ordinaire, et l'étiqueter
              ferait du bruit sans rien apprendre.
            */}
            {isEnterpriseSpaceHeader && (
              <span
                className="hidden md:inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold tracking-wide"
                style={{
                  borderColor: 'var(--color-selected-border)',
                  backgroundColor: 'var(--color-selected)',
                  color: 'var(--color-text-primary)',
                }}
                title={t(
                  'header.enterpriseSpaceHint',
                  'Vous travaillez dans l’espace de votre organisation'
                )}
              >
                <svg
                  width="11"
                  height="11"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                >
                  <path d="M3.75 21h16.5M5.25 3v18m13.5-18v18M4.5 3h15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" />
                </svg>
                {headerOrgName ?? t('header.enterpriseSpace', 'Organisation')}
              </span>
            )}
          </div>
        </div>

        {/* ===== Center: Search Bar ===== */}
        {showSearch && (
          <div
            className={`header__search flex-1 flex justify-center max-w-[720px] mx-auto relative ${
              searchFocused || showResults ? 'header__search--expanded' : ''
            }`}
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
              <div className="header__search-icon absolute left-4 flex items-center pointer-events-none">
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
                {...searchFieldProps(
                  'filarr-global-search',
                  t('header.search', 'Rechercher dans Filarr')
                )}
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
        {/* Sous 640px (téléphone), thème / minuteur / densité se replient : ce
            sont des réglages, ils restent accessibles depuis Paramètres, et la
            place rendue revient à la recherche. Restent le hamburger, la
            recherche, l'état de synchro et l'avatar. */}
        <div className="header__actions flex items-center gap-1 shrink-0">
          {/* « On vous a nommé » — muette hors compte cloud. */}
          <MentionsBell />
          {/* Theme toggle */}
          <button
            onClick={handleThemeToggle}
            className="w-10 h-10 hidden sm:flex items-center justify-center rounded-full
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
            className="w-10 h-10 hidden sm:flex items-center justify-center rounded-full
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

          {/* Sync status (cloud mode only) */}
          <SyncStatusIcon />

          {/* Density dropdown */}
          <div className="hidden sm:flex items-center">
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
              position={menuPosition}
              closeOnSelect={true}
            />
          </div>

          {/* Divider */}
          <div className="header__divider w-px h-8 bg-[var(--color-border)] mx-1.5 hidden sm:block" />

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
            position={menuPosition}
            closeOnSelect={true}
          />
        </div>
      </div>
    </header>
  );
});

export default Header;
