/**
 * ProfilePicker — Full-screen profile selection
 *
 * Displays at app launch (after onboarding) to let the user pick a profile.
 * Contextual greeting based on time of day. Subtle gradient background.
 * Auto-selects if only 1 profile without PIN.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';

import { restoreCloudProfiles } from '../../../services/core/cloudProfileRestore';
import { useTranslation } from 'react-i18next';
import { useSelector, useDispatch } from 'react-redux';
import type { RootState, AppDispatch } from '../../../store';
import {
  fetchManifest,
  activateProfile,
  verifyPin,
  clearPinError,
} from '../../../store/slices/profilesSlice';
import { setActiveProfile } from '../../../services/core/profileStorage';
import { canCreateProfile } from '../../../services/core/profileLimits';
import type { ProfileMetadata } from '../../../types/profiles';
import ProfileCard from './ProfileCard';
import PinOverlay from './PinOverlay';
import CreateProfileModal from './CreateProfileModal';
import ManageProfilesModal from './ManageProfilesModal';
import ProfileGroupHeader from './ProfileGroupHeader';
import { Button } from '../ui/Button/Button';
import { readPendingInvites } from '../../../services/invites/pendingInvite';
import { setInviteSignInHint } from '../../../services/invites/inviteSignInHint';
import {
  apiGetOrgInvitationPreview,
  apiGetVaultInvitationPreview,
} from '../../../services/vault/vaultApi';
import { findProfileForAddress } from '../vaults/inviteAccountMatch';

interface ProfilePickerProps {
  onProfileSelected: (profileId: string) => void;
  /** When true, always show the picker (don't auto-select single profile) */
  skipAutoSelect?: boolean;
  /**
   * The workspace space chosen on the launch SpaceSelector. Only profiles whose
   * account is of this type are shown — personal and enterprise accounts are
   * strictly distinct (a personal account can never belong to an org).
   */
  space: 'personal' | 'enterprise';
  /** Return to the SpaceSelector to switch space (= pick a different account type). */
  onChangeSpace?: () => void;
  /**
   * Rattacher un compte cloud à cet appareil : l'assistant s'ouvre sur la
   * CONNEXION, et c'est lui qui décide ensuite s'il faut ouvrir un profil
   * existant du compte, en proposer plusieurs, ou en créer un.
   *
   * En espace entreprise, c'est aussi le geste du « + » (les comptes personnels
   * et entreprise sont strictement distincts, on ne crée pas un profil local
   * qu'on rattacherait après coup).
   */
  /**
   * Ouvrir l'assistant pour rattacher un compte à cet espace. `mode` distingue
   * « j'en ai déjà un » de « je n'en ai pas » — deux intentions que l'écran
   * d'accueil de l'espace entreprise pose comme deux boutons distincts, parce
   * que confondre les deux est précisément ce qui envoyait quelqu'un créer un
   * second compte alors qu'il en avait déjà un.
   */
  onAddAccount?: (space: 'personal' | 'enterprise', mode?: 'login' | 'register') => void;
  /**
   * Compte fraîchement ajouté dont plusieurs profils viennent d'arriver : son
   * groupe est déplié et signalé, pour que la personne voie tout de suite ce
   * qu'elle a récupéré plutôt que d'avoir à le chercher.
   */
  highlightAccountEmail?: string;
}

/**
 * A profile's space is fixed by its account type. We classify from the best
 * available pre-activation signal, in order of reliability: the persisted space
 * hint, the denormalized cloud-account type, then the presence of any real org
 * hint. This keeps a legacy enterprise-account profile (whose spaceMode hint is
 * still undefined before its first post-upgrade activation) in the enterprise
 * picker instead of leaking it into personal.
 */
export function profileSpaceOf(p: ProfileMetadata): 'personal' | 'enterprise' {
  if (p.spaceMode) return p.spaceMode;
  if (p.cloudAccount?.accountType) return p.cloudAccount.accountType;
  if ((p.orgs?.length ?? 0) > 0) return 'enterprise';
  return 'personal';
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'profiles.goodMorning';
  if (hour < 18) return 'profiles.goodAfternoon';
  return 'profiles.goodEvening';
}

function getGradient(): string {
  const hour = new Date().getHours();
  if (hour < 7) return 'from-indigo-950/20 via-transparent to-transparent';
  if (hour < 12) return 'from-amber-50/30 via-transparent to-transparent';
  if (hour < 18) return 'from-sky-50/20 via-transparent to-transparent';
  return 'from-indigo-950/10 via-transparent to-transparent';
}

const ProfilePicker: React.FC<ProfilePickerProps> = ({
  onProfileSelected,
  skipAutoSelect = false,
  space,
  onChangeSpace,
  onAddAccount,
  highlightAccountEmail,
}) => {
  const { t } = useTranslation();
  const dispatch = useDispatch<AppDispatch>();

  const manifest = useSelector((state: RootState) => state.profiles.manifest);
  const allProfiles = manifest?.profiles ?? [];
  // Only profiles of the selected space's account type are shown. MUST be
  // memoized: a fresh .filter() array every render would destabilize every
  // [profiles]-dependent hook (e.g. the pauseFlags effect) into an infinite
  // re-render + IPC loop.
  const profiles = React.useMemo(
    () => (manifest?.profiles ?? []).filter((p) => profileSpaceOf(p) === space),
    [manifest, space]
  );
  const pinError = useSelector((state: RootState) => state.profiles.pinError);
  const pinLockedUntil = useSelector((state: RootState) => state.profiles.pinLockedUntil);
  const pinVerifying = useSelector((state: RootState) => state.profiles.pinVerifying);

  const [selectedProfile, setSelectedProfile] = useState<ProfileMetadata | null>(null);
  const [showPin, setShowPin] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showManage, setShowManage] = useState(false);
  const [ready, setReady] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetPassword, setResetPassword] = useState('');
  const [resetError, setResetError] = useState('');
  const [resetVerifying, setResetVerifying] = useState(false);
  // Recovery flow: forgot encryption password → enter phrase → new password
  const [showRecovery, setShowRecovery] = useState(false);
  const [recoveryPhrase, setRecoveryPhrase] = useState('');
  const [recoveryNewPassword, setRecoveryNewPassword] = useState('');
  const [recoveryNewPasswordConfirm, setRecoveryNewPasswordConfirm] = useState('');
  const [recoveryError, setRecoveryError] = useState('');
  const [recoveryVerifying, setRecoveryVerifying] = useState(false);

  const handleActivate = useCallback(
    async (profileId: string) => {
      try {
        // Space is fixed by the profile's account type — no per-activation
        // choice. App.handleProfileSelected hydrates it via initOrgContext.
        setActiveProfile(profileId);
        await dispatch(activateProfile(profileId)).unwrap();
        onProfileSelected(profileId);
      } catch (err) {
        console.error('Failed to activate profile:', err);
      }
    },
    [dispatch, onProfileSelected]
  );

  // Fetch manifest on mount
  useEffect(() => {
    dispatch(fetchManifest()).then(() => setReady(true));
  }, [dispatch]);

  /**
   * LES PROFILS DU COMPTE, RAMENÉS EN ARRIÈRE-PLAN.
   *
   * ── LE DÉFAUT QUE CECI FERME ──────────────────────────────────────────────
   *
   * Le sélecteur ne connaissait que le manifeste LOCAL, et il range par
   * `cloudAccount`. Or le bureau n'estampille que le profil COURANT, au moment
   * où on l'ouvre en étant connecté (`saveUserCache`). Un profil créé sur un
   * autre appareil, ou simplement pas rouvert ici depuis que le compte existe,
   * restait donc sans estampille et s'affichait sous « Local ».
   *
   * L'étiquette est localement exacte — ce profil n'est rattaché à rien SUR
   * CETTE MACHINE — et trompeuse dans ce qu'elle laisse croire : elle suggère
   * que les données ne sont pas sauvegardées, alors que le compte connaît ces
   * profils et qu'ils se synchroniseront dès l'ouverture. Le web, lui, affiche
   * les mêmes en « Solo », parce que sa synchronisation appelle déjà
   * `restoreAccountProfiles`.
   *
   * ── POURQUOI EN ARRIÈRE-PLAN, ET NON AVANT L'AFFICHAGE ────────────────────
   *
   * C'est un appel réseau, et c'est le TOUT PREMIER écran. L'attendre
   * ajouterait une latence à chaque lancement pour corriger une étiquette. Le
   * sélecteur s'affiche donc immédiatement avec ce qu'il sait ; les étiquettes
   * se corrigent quand la réponse arrive (`restoreCloudProfiles` relit le
   * manifeste lui-même).
   *
   * Sans session, l'appel sort tout seul côté principal : rien à lister.
   */
  useEffect(() => {
    // Pas de nettoyage : `restoreCloudProfiles` n'écrit que dans le magasin,
    // et une écriture qui arrive après le démontage est sans effet — un drapeau
    // « annulé » n'aurait rien annulé, il aurait juste eu l'air de le faire.
    void restoreCloudProfiles().catch(() => {
      // Réseau absent, session fermée : le sélecteur reste utilisable tel
      // quel. Une correction d'étiquette qui échoue ne doit pas empêcher
      // d'entrer dans l'application.
    });
  }, []);

  // Forward-declared refs used by the keyboard-navigation useEffect, which
  // is initialised further down after `groups` and `showGroupHeaders` are
  // known (those depend on computations that happen later in this render).
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);
  const cardsOrderRef = useRef<ProfileMetadata[]>([]);

  // Auto-select: 1 profile without PIN → skip picker (only on first launch, not on switch)
  useEffect(() => {
    if (!ready || !manifest || skipAutoSelect) return;
    if (profiles.length === 1 && !profiles[0].pinHash) {
      handleActivate(profiles[0].id);
    }
  }, [ready, manifest, profiles, handleActivate, skipAutoSelect]);

  const handleProfileClick = useCallback(
    (profile: ProfileMetadata) => {
      if (profile.pinHash) {
        setSelectedProfile(profile);
        setShowPin(true);
        dispatch(clearPinError());
      } else {
        handleActivate(profile.id);
      }
    },
    [handleActivate, dispatch]
  );

  const handlePinSubmit = useCallback(
    async (pin: string) => {
      if (!selectedProfile) return;
      try {
        await dispatch(verifyPin({ profileId: selectedProfile.id, pin })).unwrap();
        handleActivate(selectedProfile.id);
      } catch {
        // Error handled by Redux state
      }
    },
    [selectedProfile, dispatch, handleActivate]
  );

  const handleForgotPin = useCallback(() => {
    if (!selectedProfile) return;
    setResetPassword('');
    setResetError('');
    setShowResetConfirm(true);
  }, [selectedProfile]);

  const handleConfirmResetPin = useCallback(async () => {
    if (!selectedProfile || !resetPassword.trim()) return;
    setResetVerifying(true);
    setResetError('');
    try {
      // Verify the encryption password by attempting to unwrap the FEK
      const { initHybridCrypto } = await import('../../../services/auth/hybridCrypto');
      await initHybridCrypto(resetPassword.trim());

      // Password is correct — reset the PIN
      await window.electron.ipcRenderer.invoke(
        'profile:resetPin',
        selectedProfile.id,
        selectedProfile.name
      );
      await dispatch(fetchManifest());
      setShowPin(false);
      setShowResetConfirm(false);
      setSelectedProfile(null);
    } catch (err) {
      setResetError(
        t('profiles.wrongEncryptionPassword', 'Mot de passe de chiffrement incorrect.')
      );
    } finally {
      setResetVerifying(false);
    }
  }, [selectedProfile, resetPassword, dispatch, t]);

  const handleRecoverWithPhrase = useCallback(async () => {
    if (!selectedProfile || !recoveryPhrase.trim() || !recoveryNewPassword.trim()) return;
    if (recoveryNewPassword !== recoveryNewPasswordConfirm) {
      setRecoveryError(t('onboarding.passwordMismatch', 'Les mots de passe ne correspondent pas'));
      return;
    }
    if (recoveryNewPassword.length < 8) {
      setRecoveryError(t('profiles.passwordTooShort', '8 caractères minimum'));
      return;
    }
    setRecoveryVerifying(true);
    setRecoveryError('');
    try {
      const { recoverWithPhrase } = await import('../../../services/auth/hybridCrypto');
      await recoverWithPhrase(recoveryPhrase.trim(), recoveryNewPassword.trim());

      // Recovery successful — also reset the PIN
      await window.electron.ipcRenderer.invoke(
        'profile:resetPin',
        selectedProfile.id,
        selectedProfile.name
      );
      await dispatch(fetchManifest());
      setShowPin(false);
      setShowResetConfirm(false);
      setShowRecovery(false);
      setSelectedProfile(null);
    } catch {
      setRecoveryError(t('profiles.wrongRecoveryPhrase', 'Phrase de récupération incorrecte.'));
    } finally {
      setRecoveryVerifying(false);
    }
  }, [
    selectedProfile,
    recoveryPhrase,
    recoveryNewPassword,
    recoveryNewPasswordConfirm,
    dispatch,
    t,
  ]);

  const handlePinCancel = useCallback(() => {
    setShowPin(false);
    setSelectedProfile(null);
    dispatch(clearPinError());
  }, [dispatch]);

  const canAdd = manifest ? canCreateProfile(null, allProfiles.length) : false;

  // ── Sync dot state per profile ──────────────────────────────────────────
  //
  // Active profile uses the live sync state from Redux (populated by the
  // daemon). Non-active cloud profiles only expose a pause hint — we read
  // the per-profile `sync-paused-<id>` flag once on mount and show an
  // amber dot if paused, green otherwise. Local profiles get no dot.
  const activeSyncState = useSelector((state: RootState) => state.sync.state);
  const activeSyncEnabled = useSelector((state: RootState) => state.auth.syncEnabled);
  const activeSyncFailed = useSelector((state: RootState) => state.sync.failedItems);

  const [pauseFlags, setPauseFlags] = useState<Record<string, boolean>>({});
  useEffect(() => {
    const ipc = window.electron?.ipcRenderer;
    if (!ipc || profiles.length === 0) return;
    let cancelled = false;
    (async () => {
      const result: Record<string, boolean> = {};
      for (const p of profiles) {
        if (!p.cloudAccount) continue;
        try {
          const v = await ipc.invoke('flag:get', `sync-paused-${p.id}`);
          result[p.id] = v === 'true';
        } catch {
          /* ignore */
        }
      }
      if (!cancelled) setPauseFlags(result);
    })();
    return () => {
      cancelled = true;
    };
  }, [profiles]);

  const getSyncDot = (profile: ProfileMetadata): 'ok' | 'paused' | 'error' | 'offline' | null => {
    if (!profile.cloudAccount) return null;
    const isActive = manifest?.activeProfileId === profile.id;
    if (isActive) {
      if (!activeSyncEnabled) return 'paused';
      if (activeSyncState === 'error' || activeSyncFailed > 0) return 'error';
      if (activeSyncState === 'offline') return 'offline';
      return 'ok';
    }
    return pauseFlags[profile.id] ? 'paused' : 'ok';
  };

  // Filter input — only rendered when there are more than 6 profiles
  // (short lists don't need search; it just adds visual clutter). Search
  // is case-insensitive and matches profile name OR bound cloud email.
  const [filterQuery, setFilterQuery] = useState('');
  const showFilter = profiles.length > 6;

  const visibleProfiles = React.useMemo(() => {
    const q = filterQuery.trim().toLowerCase();
    if (!q) return profiles;
    return profiles.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.cloudAccount?.email?.toLowerCase().includes(q) ?? false)
    );
  }, [profiles, filterQuery]);

  // Group profiles by cloud account (or 'local' bucket). Headers are only
  // rendered when the user actually has multiple groups — single-cloud
  // setups stay flat so we don't add visual noise for the 90% case.
  type ProfileGroup = {
    key: string; // 'local' or `cloud:<email>`
    cloud: { email: string; tier: string } | null;
    profiles: ProfileMetadata[];
  };

  const groups: ProfileGroup[] = (() => {
    const byKey = new Map<string, ProfileGroup>();
    for (const p of visibleProfiles) {
      if (p.cloudAccount?.email) {
        const key = `cloud:${p.cloudAccount.email.toLowerCase()}`;
        let g = byKey.get(key);
        if (!g) {
          g = {
            key,
            cloud: { email: p.cloudAccount.email, tier: p.cloudAccount.tier },
            profiles: [],
          };
          byKey.set(key, g);
        }
        g.profiles.push(p);
      } else {
        const key = 'local';
        let g = byKey.get(key);
        if (!g) {
          g = { key, cloud: null, profiles: [] };
          byKey.set(key, g);
        }
        g.profiles.push(p);
      }
    }
    // Ordering: active profile's group first, then other cloud groups (by
    // linkedAt ascending — longest-standing first), then local at the end.
    const activeGroupKey = (() => {
      const active = profiles.find((p) => p.id === manifest?.activeProfileId);
      if (!active) return null;
      if (active.cloudAccount?.email) {
        return `cloud:${active.cloudAccount.email.toLowerCase()}`;
      }
      return 'local';
    })();
    const all = Array.from(byKey.values());
    return all.sort((a, b) => {
      if (a.key === activeGroupKey) return -1;
      if (b.key === activeGroupKey) return 1;
      if (a.cloud && !b.cloud) return -1; // cloud before local
      if (!a.cloud && b.cloud) return 1;
      if (a.cloud && b.cloud) {
        const la = a.profiles[0]?.cloudAccount?.linkedAt ?? '';
        const lb = b.profiles[0]?.cloudAccount?.linkedAt ?? '';
        return la.localeCompare(lb); // oldest first
      }
      return 0;
    });
  })();

  // Show headers when (multiple groups) OR (at least one cloud group and
  // a local group coexist). Single-group layouts render flat.
  const cloudGroupCount = groups.filter((g) => g.cloud).length;
  const hasLocalGroup = groups.some((g) => !g.cloud);
  const showGroupHeaders =
    groups.length >= 2 && (cloudGroupCount >= 2 || (cloudGroupCount >= 1 && hasLocalGroup));

  // Collapsed state per group — persisted in localStorage so a user's choice
  // to hide a rarely-used account stays hidden across launches. The key
  // encodes the group identity (email or 'local') so new/renamed accounts
  // default to expanded.
  const groupCollapseKey = (g: ProfileGroup) => `filarr.profilepicker.collapsed.${g.key}`;
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    try {
      for (const g of groups) {
        initial[g.key] = localStorage.getItem(groupCollapseKey(g)) === '1';
      }
    } catch {
      /* ignore */
    }
    return initial;
  });

  /**
   * Le compte qu'on vient d'ajouter s'ouvre, même s'il avait été replié un jour.
   *
   * Sans cela, quelqu'un qui avait masqué ce compte à une session précédente
   * verrait l'assistant se terminer sur un sélecteur où ses profils
   * n'apparaissent pas — ils sont bien là, sous un en-tête fermé, et rien ne le
   * dit. Le repli persiste par groupe dans localStorage : c'est justement une
   * préférence qui survit trop bien à cet instant précis.
   */
  const highlightKey = highlightAccountEmail
    ? `cloud:${highlightAccountEmail.toLowerCase()}`
    : null;
  useEffect(() => {
    if (!highlightKey) return;
    setCollapsedGroups((prev) => (prev[highlightKey] ? { ...prev, [highlightKey]: false } : prev));
    try {
      localStorage.removeItem(`filarr.profilepicker.collapsed.${highlightKey}`);
    } catch {
      /* ignore */
    }
  }, [highlightKey]);

  /**
   * UNE INVITATION ATTEND — et le sélecteur l'ignorait complètement (F29).
   *
   * LE DÉFAUT QUE CECI FERME. Sur le bureau, chaque profil porte SON compte
   * cloud. Le porteur d'invitation, lui, est armé bien avant le choix du profil
   * (au chargement de la page, ou par le lien profond `filarr://invite`). On
   * ouvrait donc un profil au hasard — le dernier utilisé, le plus souvent — et
   * on ne découvrait qu'ensuite, dans l'écran d'acceptation, que l'invitation
   * visait le compte d'un AUTRE profil. Il fallait ressortir, revenir ici,
   * recommencer. Dire ici « invitation pour b@… » et surligner le profil qui
   * porte cette adresse supprime tout l'aller-retour.
   *
   * L'APERÇU NE DOIT NI BLOQUER NI RETARDER CET ÉCRAN. Le sélecteur s'affiche
   * exactement comme avant ; le bandeau apparaît si et quand la réponse arrive.
   * Un échec (hors ligne, plafond de requêtes, invitation morte) ne laisse
   * simplement rien — c'est un ornement, pas une garde.
   *
   * ON LIT LE STOCKAGE DIRECTEMENT, sans le store : `readPendingInvites` ne
   * dépend de rien, et aucun profil n'est actif à cet instant — donc ni redux
   * ni `profileStorage` (qui préfixe ses clés par le profil) ne sont
   * disponibles. Et JAMAIS de jeton dans un journal : seule l'adresse sort d'ici.
   */
  const [invitedEmail, setInvitedEmail] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    // La PLUS RÉCENTE : c'est le lien que la personne vient d'ouvrir. Les autres
    // restent en attente, et l'écran d'acceptation les reprendra une à une.
    const latest = readPendingInvites()[0];
    if (latest) {
      const asked =
        latest.kind === 'org'
          ? apiGetOrgInvitationPreview(latest.token).then((p) => p?.invitedEmail ?? null)
          : apiGetVaultInvitationPreview(latest.token).then((p) => p?.invitedEmail ?? null);
      void asked.then((mail) => {
        if (cancelled || !mail) return;
        setInvitedEmail(mail);
        // Le repère sert au cas « aucun profil ne correspond » : si la personne
        // ajoute un compte depuis ce même écran, le formulaire de connexion
        // s'ouvrira déjà rempli avec l'adresse invitée. Il se consomme à la
        // lecture et périme en trente minutes.
        setInviteSignInHint(mail);
      });
    }
    // Rendu dans TOUS les cas : un nettoyage qui ne sort que d'une branche fait
    // échouer la compilation (TS7030).
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Le profil de CET ESPACE qui porte l'adresse invitée.
   *
   * Cherché parmi les profils AFFICHÉS, et pas dans tout le manifeste : ce sont
   * les seuls que cet écran puisse ouvrir. Un compte de l'autre espace (les
   * comptes personnels et entreprise sont strictement distincts) ne
   * correspondra donc à rien ici, et le bandeau dira honnêtement qu'aucun profil
   * ne correspond — plutôt que de désigner une carte qui n'est pas à l'écran.
   */
  const invitedProfile = React.useMemo(
    () =>
      findProfileForAddress(
        profiles.map((p) => ({
          id: p.id,
          name: p.name,
          cloudEmail: p.cloudAccount?.email ?? null,
        })),
        invitedEmail
      ),
    [profiles, invitedEmail]
  );

  const toggleGroupCollapsed = (g: ProfileGroup) => {
    setCollapsedGroups((prev) => {
      const next = !prev[g.key];
      try {
        if (next) localStorage.setItem(groupCollapseKey(g), '1');
        else localStorage.removeItem(groupCollapseKey(g));
      } catch {
        /* ignore */
      }
      return { ...prev, [g.key]: next };
    });
  };

  // Build the account-level actions menu for a given cloud group. Called
  // per-render; each action resolves by activating the first profile of
  // the group (so we have a cloud auth context) and optionally signalling
  // to Settings to auto-open a section via sessionStorage.
  const buildGroupMenu = (group: ProfileGroup) => {
    if (!group.cloud) return [];
    const firstProfile = group.profiles[0];
    if (!firstProfile) return [];
    return [
      {
        label: t('profiles.groupMenu.manageDevices', 'Gérer les appareils'),
        onClick: async () => {
          try {
            sessionStorage.setItem('filarr.pending-settings-section', 'devices');
          } catch {
            /* ignore */
          }
          setActiveProfile(firstProfile.id);
          await dispatch(activateProfile(firstProfile.id)).unwrap();
          onProfileSelected(firstProfile.id);
        },
      },
      {
        label: t('profiles.groupMenu.goToSettings', 'Aller aux paramètres du compte'),
        onClick: async () => {
          try {
            sessionStorage.setItem('filarr.pending-settings-section', 'account');
          } catch {
            /* ignore */
          }
          setActiveProfile(firstProfile.id);
          await dispatch(activateProfile(firstProfile.id)).unwrap();
          onProfileSelected(firstProfile.id);
        },
      },
      {
        label: t('profiles.groupMenu.disconnectAll', 'Déconnecter tous les profils de ce compte'),
        danger: true,
        onClick: async () => {
          const confirmMsg = t(
            'profiles.groupMenu.disconnectAllConfirm',
            'Déconnecter tous les profils liés à {{email}} ? Vos données locales restent intactes.',
            { email: group.cloud!.email }
          );
          if (!window.confirm(confirmMsg)) return;
          try {
            // Unbind the cloud account field on each profile in the group.
            // Tokens still live under each profile dir and will be cleared
            // on next explicit logout from Settings. This is a "soft"
            // disconnect that removes the badge but leaves the data in
            // place — intentional escape hatch if the user clicked by
            // mistake.
            const ipc = window.electron?.ipcRenderer;
            if (!ipc) return;
            for (const p of group.profiles) {
              await ipc.invoke('profile:unlinkCloud', p.id);
            }
            await dispatch(fetchManifest());
          } catch (err) {
            console.error('[ProfilePicker] disconnectAll failed:', err);
          }
        },
      },
    ];
  };

  // ── Keyboard navigation ────────────────────────────────────────────────
  //
  // ArrowLeft/ArrowRight/Home/End move focus between visible profile cards.
  // Enter on a focused card activates it. Cmd/Ctrl + digit (1-9) directly
  // switches to the Nth visible profile — power-user shortcut. The active
  // "visible order" follows the on-screen order (respecting group collapse
  // and search filter).
  useEffect(() => {
    const flat: ProfileMetadata[] = [];
    if (showGroupHeaders) {
      for (const g of groups) {
        if (collapsedGroups[g.key]) continue;
        flat.push(...g.profiles);
      }
    } else {
      flat.push(...visibleProfiles);
    }
    cardsOrderRef.current = flat;
  }, [visibleProfiles, groups, collapsedGroups, showGroupHeaders]);

  useEffect(() => {
    if (showPin || showCreate || showManage || showResetConfirm || showRecovery) return;
    const handler = (e: KeyboardEvent) => {
      const cards = cardsOrderRef.current;
      if (cards.length === 0) return;

      // Cmd/Ctrl + 1-9 → quick switch
      if ((e.metaKey || e.ctrlKey) && e.key >= '1' && e.key <= '9') {
        const idx = parseInt(e.key, 10) - 1;
        const target = cards[idx];
        if (target) {
          e.preventDefault();
          handleProfileClick(target);
        }
        return;
      }

      if (e.key === 'ArrowRight') {
        e.preventDefault();
        setFocusedIndex((i) => Math.min(cards.length - 1, Math.max(0, i) + 1));
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setFocusedIndex((i) => Math.max(0, (i < 0 ? 1 : i) - 1));
      } else if (e.key === 'Home') {
        e.preventDefault();
        setFocusedIndex(0);
      } else if (e.key === 'End') {
        e.preventDefault();
        setFocusedIndex(cards.length - 1);
      } else if (e.key === 'Enter' && focusedIndex >= 0 && focusedIndex < cards.length) {
        e.preventDefault();
        handleProfileClick(cards[focusedIndex]);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [
    showPin,
    showCreate,
    showManage,
    showResetConfirm,
    showRecovery,
    focusedIndex,
    handleProfileClick,
  ]);

  // Move DOM focus to the card matching focusedIndex.
  useEffect(() => {
    if (focusedIndex < 0) return;
    const target = cardsOrderRef.current[focusedIndex];
    if (!target) return;
    const el = document.querySelector<HTMLButtonElement>(`[data-profile-card-id="${target.id}"]`);
    if (el) el.focus();
  }, [focusedIndex]);

  /**
   * Une carte de profil, éventuellement SURLIGNÉE parce que c'est elle que
   * l'invitation en attente désigne.
   *
   * Le surlignage est posé par un conteneur, et non par une propriété de
   * `ProfileCard` : la carte n'a pas à connaître les invitations, et l'anneau
   * disparaîtra avec ce bandeau le jour où il n'aura plus lieu d'être. Les deux
   * dispositions — groupée et à plat — passent par ici, sinon l'une des deux
   * aurait été oubliée à la première retouche.
   */
  const renderProfileCard = (profile: ProfileMetadata) => {
    const invited = invitedProfile?.id === profile.id;
    const card = (
      <ProfileCard
        profile={profile}
        isActive={manifest?.activeProfileId === profile.id}
        onClick={() => handleProfileClick(profile)}
        syncDot={getSyncDot(profile)}
      />
    );
    if (!invited) return <React.Fragment key={profile.id}>{card}</React.Fragment>;
    return (
      <div
        key={profile.id}
        className="rounded-2xl p-1"
        style={{
          outline: '2px solid var(--color-primary-600)',
          outlineOffset: '2px',
          borderRadius: '1rem',
        }}
        title={t('teamVaults.join.invitationFor', {
          email: invitedEmail,
          defaultValue: 'Invitation pour {{email}}',
        })}
      >
        {card}
      </div>
    );
  };

  /**
   * L'ACCUEIL DE L'ESPACE ENTREPRISE, quand il est vide.
   *
   * ── LA PAGE QUI MANQUAIT ─────────────────────────────────────────────────
   *
   * Choisir « Entreprise » menait droit à un sélecteur de profils vide, dont le
   * seul geste était un « + » discret. Trois questions restaient alors sans
   * réponse, et ce sont exactement celles que se pose quelqu'un qui vient de
   * créer son organisation sur le site :
   *
   *   · « où sont mes profils ? » — ils sont personnels, et les deux mondes
   *     sont étanches par construction. Le taire donne l'impression d'une perte
   *     de données ;
   *   · « je me connecte comment ? » — avec le compte d'organisation, qui n'est
   *     PAS le compte personnel, distinction qu'aucun écran ne faisait ;
   *   · « et si je n'en ai pas ? » — il faut en créer un, ce qu'aucun bouton ne
   *     proposait.
   *
   * D'où deux actions nommées plutôt qu'un « + » : se connecter, ou créer. La
   * sortie vers l'espace personnel est gardée à portée, parce qu'arriver ici par
   * erreur est le cas le plus probable de tous.
   */
  const enterpriseWelcome = (
    <div className="w-full max-w-xl px-8 animate-fadeIn" style={{ animationDelay: '80ms' }}>
      <div
        className="rounded-2xl border p-8 text-center"
        style={{
          borderColor: 'var(--color-border)',
          backgroundColor: 'var(--color-surface)',
        }}
      >
        <div
          className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl"
          style={{ backgroundColor: 'var(--color-selected)', color: 'var(--color-primary-600)' }}
        >
          <svg
            className="h-7 w-7"
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
          </svg>
        </div>

        <h2 className="text-xl font-semibold" style={{ color: 'var(--color-text-primary)' }}>
          {t('profiles.enterpriseEmptyTitle', 'Aucun compte d’organisation sur cet appareil')}
        </h2>
        <p
          className="mx-auto mt-3 max-w-md text-sm leading-relaxed"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          {t(
            'profiles.enterpriseEmptyBody',
            'Un compte d’organisation est distinct de vos comptes personnels : c’est ce qui garantit qu’aucune donnée personnelle n’entre dans l’espace professionnel. Vos profils personnels ne s’affichent donc pas ici — ils n’ont pas disparu, ils sont dans l’espace Personnel.'
          )}
        </p>

        <div className="mt-6 flex flex-col gap-2">
          <button
            onClick={() => onAddAccount?.('enterprise', 'login')}
            className="w-full rounded-xl px-4 py-3 text-sm font-semibold transition-colors
              focus:outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)] focus:ring-offset-2"
            style={{
              backgroundColor: 'var(--color-primary-600)',
              color: 'var(--color-text-inverted)',
            }}
          >
            {t('profiles.enterpriseSignIn', 'Me connecter avec mon compte d’organisation')}
          </button>
          <button
            onClick={() => onAddAccount?.('enterprise', 'register')}
            className="w-full rounded-xl border px-4 py-3 text-sm font-medium transition-colors
              focus:outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)] focus:ring-offset-2"
            style={{
              borderColor: 'var(--color-border-strong)',
              color: 'var(--color-text-primary)',
              backgroundColor: 'transparent',
            }}
          >
            {t('profiles.enterpriseCreate', 'Créer un compte d’organisation')}
          </button>
        </div>

        {onChangeSpace && (
          <button
            onClick={onChangeSpace}
            className="mt-5 text-sm underline transition-colors"
            style={{ color: 'var(--color-text-tertiary)' }}
          >
            {t('profiles.enterpriseBackToPersonal', 'Revenir à l’espace personnel')}
          </button>
        )}
      </div>
    </div>
  );

  const addProfileButton = (
    <button
      onClick={() => {
        if (!canAdd) return;
        // Enterprise accounts are provisioned through the enterprise onboarding
        // (register + join/create org); personal uses the local create modal.
        if (space === 'enterprise') onAddAccount?.('enterprise');
        else setShowCreate(true);
      }}
      disabled={!canAdd}
      className="flex flex-col items-center gap-2 p-4 rounded-2xl
        transition-all duration-200 ease-out cursor-pointer
        hover:scale-105
        focus:outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)] focus:ring-offset-2
        disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100"
      title={
        !canAdd
          ? t('profiles.maxReached')
          : space === 'enterprise'
            ? t(
                'profiles.addEnterpriseAccount',
                'Ajouter un compte entreprise (connexion ou création)'
              )
            : t('profiles.addProfile')
      }
    >
      <div
        className="w-20 h-20 rounded-full border-2 border-dashed
        border-[var(--color-border-strong)]
        flex items-center justify-center
        transition-colors duration-200
        group-hover:border-[var(--color-primary-400)]"
      >
        <svg
          width="28"
          height="28"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--color-text-tertiary)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </div>
      <span className="text-sm font-medium text-[var(--color-text-tertiary)]">
        {t('profiles.add')}
      </span>
    </button>
  );

  // Loading / auto-select state
  if (!ready) {
    return (
      <div
        // chrome:free — voile de chargement centre.
        className="fixed inset-0 z-50 flex items-center justify-center
        bg-[var(--color-background)]"
      >
        <div
          className="w-8 h-8 border-2 border-[var(--color-primary-300)] border-t-transparent
          rounded-full animate-spin"
        />
      </div>
    );
  }

  // Auto-selecting single profile (show spinner while redirecting)
  if (!skipAutoSelect && profiles.length === 1 && !profiles[0].pinHash) {
    return (
      <div
        // chrome:free — voile de chargement centre.
        className="fixed inset-0 z-50 flex items-center justify-center
        bg-[var(--color-background)]"
      >
        <div
          className="w-8 h-8 border-2 border-[var(--color-primary-300)] border-t-transparent
          rounded-full animate-spin"
        />
      </div>
    );
  }

  // PIN overlay
  if (showPin && selectedProfile) {
    return (
      <>
        <PinOverlay
          profileName={selectedProfile.name}
          avatarColor={selectedProfile.avatarColor}
          onSubmit={handlePinSubmit}
          onCancel={handlePinCancel}
          onForgotPin={handleForgotPin}
          allowPinReset={selectedProfile.allowPinReset}
          error={pinError}
          lockedUntil={pinLockedUntil}
          verifying={pinVerifying}
        />
        {showResetConfirm && (
          <div
            // chrome:free — fenetre centree.
            className="fixed inset-0 z-[60] flex items-center justify-center"
            style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
            onClick={() => setShowResetConfirm(false)}
          >
            <div
              className="rounded-xl p-5 w-full max-w-sm mx-4"
              style={{
                backgroundColor: 'var(--color-surface, #fff)',
                border: '1px solid var(--color-border)',
                boxShadow: '0 16px 40px rgba(0,0,0,0.2)',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <h3
                className="text-base font-semibold mb-1"
                style={{ color: 'var(--color-text-primary)' }}
              >
                {t('profiles.resetPinTitle', 'Réinitialiser le PIN')}
              </h3>
              <p className="text-sm mb-3" style={{ color: 'var(--color-text-secondary)' }}>
                {t(
                  'profiles.resetPinDesc',
                  'Entrez votre mot de passe de chiffrement pour prouver votre identité.'
                )}
              </p>
              <input
                type="password"
                value={resetPassword}
                onChange={(e) => {
                  setResetPassword(e.target.value);
                  setResetError('');
                }}
                placeholder={t(
                  'profiles.encryptionPasswordPlaceholder',
                  'Mot de passe de chiffrement'
                )}
                autoFocus
                className="w-full px-3 py-2 rounded-lg text-sm mb-1"
                style={{
                  backgroundColor: 'var(--color-background)',
                  border: `1px solid ${resetError ? '#ef4444' : 'var(--color-border)'}`,
                  color: 'var(--color-text-primary)',
                  outline: 'none',
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleConfirmResetPin();
                  if (e.key === 'Escape') setShowResetConfirm(false);
                }}
              />
              {resetError && (
                <p className="text-xs mb-2" style={{ color: '#ef4444' }}>
                  {resetError}
                </p>
              )}
              {!resetError && <div style={{ height: 8 }} />}
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setShowResetConfirm(false)}
                  className="px-3 py-1.5 text-sm rounded-lg"
                  style={{
                    border: '1px solid var(--color-border)',
                    backgroundColor: 'transparent',
                    color: 'var(--color-text-secondary)',
                    cursor: 'pointer',
                  }}
                >
                  {t('common.cancel', 'Annuler')}
                </button>
                <button
                  onClick={handleConfirmResetPin}
                  disabled={!resetPassword.trim() || resetVerifying}
                  className="px-3 py-1.5 text-sm rounded-lg font-medium"
                  style={{
                    backgroundColor:
                      resetPassword.trim() && !resetVerifying
                        ? 'var(--color-primary-600, #4682b4)'
                        : 'var(--color-background-secondary)',
                    color:
                      resetPassword.trim() && !resetVerifying
                        ? '#fff'
                        : 'var(--color-text-tertiary)',
                    border: 'none',
                    cursor: resetPassword.trim() && !resetVerifying ? 'pointer' : 'not-allowed',
                  }}
                >
                  {resetVerifying
                    ? t('profiles.verifying', 'Vérification...')
                    : t('profiles.resetPin', 'Réinitialiser le PIN')}
                </button>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowResetConfirm(false);
                  setShowRecovery(true);
                  setRecoveryPhrase('');
                  setRecoveryNewPassword('');
                  setRecoveryNewPasswordConfirm('');
                  setRecoveryError('');
                }}
                className="w-full mt-3 text-xs text-center"
                style={{
                  color: 'var(--color-primary-600)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  textDecoration: 'underline',
                }}
              >
                {t('profiles.forgotEncryptionPassword', 'Mot de passe de chiffrement oublié ?')}
              </button>
            </div>
          </div>
        )}
        {/* Recovery: forgot encryption password → enter phrase + new password */}
        {showRecovery && (
          <div
            // chrome:free — fenetre centree.
            className="fixed inset-0 z-[60] flex items-center justify-center"
            style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
            onClick={() => setShowRecovery(false)}
          >
            <div
              className="rounded-xl p-5 w-full max-w-md mx-4"
              style={{
                backgroundColor: 'var(--color-surface, #fff)',
                border: '1px solid var(--color-border)',
                boxShadow: '0 16px 40px rgba(0,0,0,0.2)',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <h3
                className="text-base font-semibold mb-1"
                style={{ color: 'var(--color-text-primary)' }}
              >
                {t('profiles.recoveryTitle', 'Récupération par phrase')}
              </h3>
              <p className="text-sm mb-4" style={{ color: 'var(--color-text-secondary)' }}>
                {t(
                  'profiles.recoveryDesc',
                  'Entrez les 12 mots de votre phrase de récupération, puis choisissez un nouveau mot de passe de chiffrement.'
                )}
              </p>

              <label
                className="text-xs font-medium mb-1 block"
                style={{ color: 'var(--color-text-secondary)' }}
              >
                {t('profiles.recoveryPhraseLabel', 'Phrase de récupération (12 mots)')}
              </label>
              <textarea
                value={recoveryPhrase}
                onChange={(e) => {
                  setRecoveryPhrase(e.target.value);
                  setRecoveryError('');
                }}
                placeholder="apple arrow beach blade bloom brave..."
                rows={2}
                autoFocus
                className="w-full px-3 py-2 rounded-lg text-sm mb-3 font-mono"
                style={{
                  backgroundColor: 'var(--color-background)',
                  border: `1px solid ${recoveryError && !recoveryNewPassword ? '#ef4444' : 'var(--color-border)'}`,
                  color: 'var(--color-text-primary)',
                  outline: 'none',
                  resize: 'none',
                }}
              />

              <label
                className="text-xs font-medium mb-1 block"
                style={{ color: 'var(--color-text-secondary)' }}
              >
                {t('profiles.newEncryptionPassword', 'Nouveau mot de passe de chiffrement')}
              </label>
              <input
                type="password"
                value={recoveryNewPassword}
                onChange={(e) => {
                  setRecoveryNewPassword(e.target.value);
                  setRecoveryError('');
                }}
                placeholder={t('profiles.newPasswordPlaceholder', '8 caractères minimum')}
                className="w-full px-3 py-2 rounded-lg text-sm mb-2"
                style={{
                  backgroundColor: 'var(--color-background)',
                  border: '1px solid var(--color-border)',
                  color: 'var(--color-text-primary)',
                  outline: 'none',
                }}
              />
              <input
                type="password"
                value={recoveryNewPasswordConfirm}
                onChange={(e) => {
                  setRecoveryNewPasswordConfirm(e.target.value);
                  setRecoveryError('');
                }}
                placeholder={t('profiles.confirmNewPassword', 'Confirmer le mot de passe')}
                className="w-full px-3 py-2 rounded-lg text-sm mb-1"
                style={{
                  backgroundColor: 'var(--color-background)',
                  border: `1px solid ${recoveryNewPasswordConfirm && recoveryNewPassword !== recoveryNewPasswordConfirm ? '#ef4444' : 'var(--color-border)'}`,
                  color: 'var(--color-text-primary)',
                  outline: 'none',
                }}
              />

              {recoveryError && (
                <p className="text-xs mb-2" style={{ color: '#ef4444' }}>
                  {recoveryError}
                </p>
              )}
              {!recoveryError && <div style={{ height: 8 }} />}

              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setShowRecovery(false)}
                  className="px-3 py-1.5 text-sm rounded-lg"
                  style={{
                    border: '1px solid var(--color-border)',
                    backgroundColor: 'transparent',
                    color: 'var(--color-text-secondary)',
                    cursor: 'pointer',
                  }}
                >
                  {t('common.cancel', 'Annuler')}
                </button>
                <button
                  onClick={handleRecoverWithPhrase}
                  disabled={
                    !recoveryPhrase.trim() ||
                    !recoveryNewPassword.trim() ||
                    recoveryNewPassword !== recoveryNewPasswordConfirm ||
                    recoveryVerifying
                  }
                  className="px-3 py-1.5 text-sm rounded-lg font-medium"
                  style={{
                    backgroundColor:
                      recoveryPhrase.trim() &&
                      recoveryNewPassword.trim() &&
                      recoveryNewPassword === recoveryNewPasswordConfirm &&
                      !recoveryVerifying
                        ? 'var(--color-primary-600, #4682b4)'
                        : 'var(--color-background-secondary)',
                    color:
                      recoveryPhrase.trim() && recoveryNewPassword.trim() && !recoveryVerifying
                        ? '#fff'
                        : 'var(--color-text-tertiary)',
                    border: 'none',
                    cursor:
                      recoveryPhrase.trim() && recoveryNewPassword.trim() && !recoveryVerifying
                        ? 'pointer'
                        : 'not-allowed',
                  }}
                >
                  {recoveryVerifying
                    ? t('profiles.verifying', 'Vérification...')
                    : t('profiles.recoverAccess', "Récupérer l'accès")}
                </button>
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    // chrome:free — l'ecran est centre quand tout tient ; au-dela, ce conteneur
    // defile plutot que de laisser le contenu deborder hors ecran sans recours
    // (overflow-y-auto + `margin: auto` sur le bloc interne degrade la
    // centration en alignement haut+scroll au lieu du decoupage symetrique que
    // ferait `justify-center` seul). Le SEUL controle ancre en dehors de ce
    // flux est le bouton « changer d'espace » ci-dessous, fixe a l'ecran.
    <div
      className={`fixed inset-0 z-50 overflow-y-auto flex flex-col items-center
      bg-[var(--color-background)] bg-gradient-to-b ${getGradient()}`}
    >
      {/* Change-space affordance — returns to the launch SpaceSelector. Fixed
          (not part of the scrolling flow) so it stays reachable regardless of
          scroll position. */}
      {onChangeSpace && (
        <button
          onClick={onChangeSpace}
          // chrome:free — le decalage vit dans `style` ci-dessous : les feux
          // macOS (x 12-66, y 12-28) recouvraient ce bouton a top-6 left-6.
          style={{
            top: 'max(1.5rem, calc(var(--chrome-inset-top) + 8px))',
            left: 'max(1.5rem, calc(var(--chrome-inset-left) + 8px))',
          }}
          className="fixed inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm z-10
            text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]
            hover:bg-[var(--color-background-secondary)] transition-colors animate-fadeIn"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>
            {space === 'enterprise'
              ? t('profiles.spaceEnterprise', 'Entreprise')
              : t('profiles.spacePersonal', 'Personnel')}
          </span>
          <span className="opacity-60">·</span>
          <span>{t('profiles.changeSpace', "Changer d'espace")}</span>
        </button>
      )}

      {/* This wrapper is what actually centers (via `margin: auto`, not
          `justify-content`): when content fits the viewport it sits centered
          like before, but once it grows taller than the viewport the auto
          margins collapse to 0 instead of clipping evenly off both edges, so
          the list starts at the top and the parent's overflow-y-auto can
          reach every card. */}
      <div className="m-auto flex flex-col items-center w-full py-12">
        {/* Greeting */}
        <div className="text-center mb-10 animate-fadeIn">
          <h1 className="text-3xl font-light text-[var(--color-text-primary)] mb-2">
            {t(getGreeting())}
          </h1>
          <p className="text-base text-[var(--color-text-tertiary)]">
            {space === 'enterprise'
              ? t('profiles.whoIsUsingEnterprise', 'Espace entreprise — quel profil ?')
              : t('profiles.whoIsUsing')}
          </p>
        </div>

        {/* Search input — visible when > 6 profiles */}
        {showFilter && (
          <div
            className="w-full max-w-sm px-8 mb-4 animate-fadeIn"
            style={{ animationDelay: '80ms' }}
          >
            <input
              type="text"
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              placeholder={t(
                'profiles.filterPlaceholder',
                'Rechercher un profil (nom ou email)...'
              )}
              className="w-full px-4 py-2 rounded-lg text-sm
              bg-[var(--color-background-secondary)]
              border border-[var(--color-border)]
              text-[var(--color-text-primary)]
              focus:outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]
              placeholder:text-[var(--color-text-tertiary)]"
            />
          </div>
        )}

        {/* Compte tout juste ajouté, plusieurs profils revenus du nuage : on dit
          ce qui vient de se passer et ce qu'il reste à faire. Sans cette phrase,
          l'assistant se refermerait sur un sélecteur d'apparence inchangée, et
          la personne n'aurait aucun moyen de savoir que ses profils sont
          arrivés — ni qu'on attend maintenant qu'elle en ouvre un. */}
        {highlightKey && (
          <div
            className="w-full max-w-lg px-8 mb-4 animate-fadeIn"
            style={{ animationDelay: '60ms' }}
          >
            <div
              className="px-4 py-3 rounded-lg text-sm text-center"
              style={{
                backgroundColor: 'color-mix(in srgb, var(--color-primary-600) 12%, transparent)',
                color: 'var(--color-text-secondary)',
                border: '1px solid color-mix(in srgb, var(--color-primary-600) 30%, transparent)',
              }}
            >
              {t(
                'profiles.accountAddedPickOne',
                '{{count}} profils retrouvés sur {{email}}. Choisissez celui que vous voulez ouvrir.',
                {
                  count: groups.find((g) => g.key === highlightKey)?.profiles.length ?? 0,
                  email: highlightAccountEmail,
                }
              )}
            </div>
          </div>
        )}

        {/* Une invitation attend, et elle vise UNE adresse précise (F29). On la
            nomme AVANT le choix du profil, et on désigne celui qui la porte —
            sans jamais en créer un : ouvrir un compte est un geste qui
            s'assume, pas un effet de bord d'un lien reçu par e-mail. */}
        {invitedEmail && (
          <div
            className="w-full max-w-lg px-8 mb-4 animate-fadeIn"
            style={{ animationDelay: '70ms' }}
          >
            <div
              className="px-4 py-3 rounded-lg text-sm text-center"
              style={{
                backgroundColor: 'color-mix(in srgb, var(--color-primary-600) 12%, transparent)',
                color: 'var(--color-text-secondary)',
                border: '1px solid color-mix(in srgb, var(--color-primary-600) 30%, transparent)',
              }}
            >
              <p className="m-0 font-medium text-[var(--color-text-primary)]">
                {t('teamVaults.join.invitationFor', {
                  email: invitedEmail,
                  defaultValue: 'Invitation pour {{email}}',
                })}
              </p>
              {invitedProfile ? (
                <div className="mt-2 flex justify-center">
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => {
                      const target = profiles.find((p) => p.id === invitedProfile.id);
                      if (target) handleProfileClick(target);
                    }}
                  >
                    {t('teamVaults.join.openThisProfile', {
                      defaultValue: 'Ouvrir ce profil',
                    })}
                  </Button>
                </div>
              ) : (
                <p className="m-0 mt-1 text-xs text-[var(--color-text-tertiary)]">
                  {t('teamVaults.join.noProfileForAddress', {
                    email: invitedEmail,
                    defaultValue:
                      "Aucun profil de cet appareil n'est lié à {{email}} : connectez-vous avec cette adresse dans le profil que vous ouvrez.",
                  })}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Profile groups */}
        <div
          className="flex flex-col items-center gap-4 animate-fadeIn"
          style={{ animationDelay: '100ms' }}
        >
          {showGroupHeaders ? (
            groups.map((group, groupIdx) => {
              const isLastGroup = groupIdx === groups.length - 1;
              const collapsed = !!collapsedGroups[group.key];
              return (
                <React.Fragment key={group.key}>
                  <ProfileGroupHeader
                    cloud={group.cloud}
                    localLabel={t('profiles.groupLocal', 'Local')}
                    collapsed={collapsed}
                    onToggle={() => toggleGroupCollapsed(group)}
                    profileCount={group.profiles.length}
                    menuItems={buildGroupMenu(group)}
                  />
                  {!collapsed && (
                    <div className="flex items-start gap-6 flex-wrap justify-center max-w-3xl px-8 mb-4">
                      {group.profiles.map((profile) => renderProfileCard(profile))}
                      {/* The "+" add-profile button lives in the LAST group.
                        It creates a local profile by default — contextually
                        it feels most natural at the end of the list. */}
                      {isLastGroup && addProfileButton}
                    </div>
                  )}
                  {/* When the last group is collapsed, the "+" button has
                    nowhere to show — render it inline below so it remains
                    reachable. */}
                  {collapsed && isLastGroup && (
                    <div className="flex items-center justify-center px-8 mb-4">
                      {addProfileButton}
                    </div>
                  )}
                </React.Fragment>
              );
            })
          ) : space === 'enterprise' && visibleProfiles.length === 0 ? (
            // Espace entreprise encore vide : on explique et on propose, au lieu
            // de laisser un « + » seul au milieu d'un écran sans réponse.
            enterpriseWelcome
          ) : (
            // Flat layout when only one group (no header noise).
            <div className="flex items-start gap-6 flex-wrap justify-center max-w-3xl px-8">
              {visibleProfiles.map((profile) => renderProfileCard(profile))}
              {addProfileButton}
            </div>
          )}
        </div>

        {/* Footer links */}
        <div
          className="mt-12 flex items-center gap-6 text-sm animate-fadeIn"
          style={{ animationDelay: '200ms' }}
        >
          <button
            onClick={() => setShowManage(true)}
            className="text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]
            transition-colors"
          >
            {t('profiles.manage')}
          </button>
          {canAdd && space === 'personal' && (
            <button
              /**
               * LA CONNEXION D'ABORD, le profil ensuite — l'ordre inverse de ce que
               * ce bouton faisait.
               *
               * Il créait un profil vide, l'activait, puis posait un drapeau que
               * les Réglages relisaient pour ouvrir la migration : « ajouter un
               * compte » était en réalité « créer un compte ». Quelqu'un qui
               * possédait déjà des profils sur ce compte repartait donc avec un
               * profil neuf en trop, à côté de ceux que la restauration ramenait.
               *
               * L'assistant s'ouvre maintenant sur l'écran de connexion et
               * arbitre après coup : un profil → on entre ; plusieurs → le
               * sélecteur reprend la main ; aucun → création et onboarding.
               */
              onClick={() => onAddAccount?.('personal')}
              className="text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]
              transition-colors inline-flex items-center gap-1.5"
              title={t(
                'profiles.addCloudAccountTooltip',
                'Se connecter à un compte cloud et retrouver ses profils'
              )}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M2.25 15a4.5 4.5 0 004.5 4.5H18a3.75 3.75 0 001.332-7.257 3 3 0 00-3.758-3.848 5.25 5.25 0 00-10.233 2.33A4.502 4.502 0 002.25 15z" />
              </svg>
              {t('profiles.addCloudAccount', 'Ajouter un compte cloud')}
            </button>
          )}
        </div>
      </div>

      {/* Modals */}
      <CreateProfileModal
        isOpen={showCreate}
        onClose={() => setShowCreate(false)}
        /**
         * Le « + » crée un profil LOCAL et rend la main au sélecteur : plus de
         * drapeau `filarr.pending-cloud-setup`, plus d'activation forcée, plus
         * de détour par les Réglages. Rattacher un compte cloud est devenu un
         * geste distinct, qui commence par la connexion (`onAddAccount`).
         */
        onCreated={async () => {
          await dispatch(fetchManifest());
        }}
      />
      <ManageProfilesModal
        isOpen={showManage}
        onClose={() => {
          setShowManage(false);
          dispatch(fetchManifest());
        }}
      />

      {/* Inline fade animation */}
      <style>{`
        .animate-fadeIn {
          animation: fadeIn 400ms ease-out both;
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
};

export default ProfilePicker;
