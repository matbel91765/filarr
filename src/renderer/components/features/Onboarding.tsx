/**
 * Onboarding Wizard — Filarr
 *
 * 8-step wizard shown on first launch:
 * 1. Welcome — splash with feature highlights
 * 2. Language — FR/EN choice (applies immediately)
 * 3. Profile — name, avatar color, optional PIN
 * 4. Appearance — theme (light/dark/system) + accent color
 * 5. Use Case — personal/student/professional/creative → starter content
 * 6. Discovery — visual tour of 4 app areas
 * 7. Security — encryption warning + checkbox
 * 8. Ready — recap + "Let's go" button
 */

import React, { useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useDispatch } from 'react-redux';
import { setTheme, setUseSystemTheme } from '../../../store/slices/uiSlice';
import { createProfile, activateProfile } from '../../../store/slices/profilesSlice';
import { setCloudAuth, setSyncEnabled } from '../../../store/slices/authSlice';
import { createFolder } from '../../../store/slices/foldersSlice';
import { createNewNote } from '../../../store/slices/notesSlice';
import { createTag } from '../../../store/slices/tagsSlice';
import type { AppDispatch } from '../../../store';
import {
  applyAccentColorPalette,
  PRESET_ACCENT_COLORS,
  detectSystemTheme,
} from '../../../services/platform/themeService';
import {
  USE_CASE_OPTIONS,
  STARTER_TEMPLATES,
  DISCOVERY_AREAS,
  getWelcomeNoteContent,
  getWelcomeNotePlainText,
  type UseCase,
} from '../../../services/onboarding/starterTemplates';
import { avatarGradient } from '../../../utils/avatarGradient';
import { ENTERPRISE_ACCESSIBLE, isEnterpriseHidden } from '../../../config/enterprise';
import { FilarrLogo } from '../ui/FilarrLogo';
import { CloudRegisterStep, CloudRecoveryStep, CloudVerifyStep } from '../auth/cloud';
import * as authApi from '../../../services/auth/authApi';
import { restoreCloudProfiles } from '../../../services/core/cloudProfileRestore';
import * as profileStorage from '../../../services/core/profileStorage';
import { profilesOfAccount, landingForAccount } from '../../../services/core/accountProfiles';
import { beginPendingCloudSession } from '../../../services/core/pendingCloudSession';
import OnboardingPairingStep from './OnboardingPairingStep';
import './Onboarding.css';

// ==================== Constants ====================

const AVATAR_COLORS = [
  // Blues
  '#4682B4',
  '#3498DB',
  '#2563EB',
  '#1D4ED8',
  '#0EA5E9',
  // Greens
  '#2ECC71',
  '#16A34A',
  '#059669',
  '#1ABC9C',
  '#10B981',
  // Reds / Pinks
  '#E74C3C',
  '#DC2626',
  '#E91E63',
  '#EC4899',
  '#F43F5E',
  // Oranges / Yellows
  '#F39C12',
  '#E67E22',
  '#FF5722',
  '#F59E0B',
  '#EAB308',
  // Purples
  '#9B59B6',
  '#8B5CF6',
  '#7C3AED',
  '#A855F7',
  '#6366F1',
  // Teals / Cyans
  '#00BCD4',
  '#06B6D4',
  '#14B8A6',
  '#0D9488',
  // Neutrals
  '#64748B',
  '#475569',
  '#78716C',
  '#6B7280',
];

type StepId =
  | 'space'
  | 'choice'
  | 'welcome'
  | 'profile'
  | 'appearance'
  | 'usecase'
  | 'discovery'
  | 'security'
  | 'ready'
  | 'cloud-register'
  | 'cloud-recovery'
  | 'cloud-verify'
  | 'cloud-pairing'
  | 'ent-welcome'
  | 'org';

const LOCAL_STEPS: StepId[] = [
  'space',
  'choice',
  'welcome',
  'profile',
  'appearance',
  'usecase',
  'discovery',
  'security',
  'ready',
];
const CLOUD_STEPS: StepId[] = [
  'space',
  'choice',
  'cloud-register',
  'cloud-recovery',
  'cloud-verify',
  'profile',
  'appearance',
  'usecase',
  'discovery',
  'ready',
];
// Enterprise: cloud is forced (no local/cloud choice); an org join/create step
// sits after email verification and before profile setup.
/**
 * Le parcours d'entrée dans l'espace entreprise.
 *
 * ── CE QU'IL AVAIT DE FAUX ───────────────────────────────────────────────────
 *
 * Il réutilisait les écrans du parcours personnel tels quels : on choisissait
 * « Entreprise » au premier écran et on atterrissait sur une inscription
 * rigoureusement identique à celle d'un particulier, sans un mot sur le fait que
 * ce compte est distinct, ni la moindre porte pour celui qui en avait DÉJÀ créé
 * un sur le site — lequel repartait donc avec un second compte.
 *
 * Deux changements, et ils vont dans des sens opposés :
 *
 *   · 'ent-welcome' EST AJOUTÉ en tête. C'est l'écran qui nomme les deux portes
 *     — « j'en ai déjà un » et « je n'en ai pas » — et qui dit où sont passés les
 *     profils personnels, la première question de quelqu'un qui ne les voit plus.
 *   · 'usecase' et 'discovery' SONT RETIRÉS. Demander à quelqu'un qui installe
 *     l'outil parce que son employeur le lui demande s'il compte plutôt prendre
 *     des notes ou ranger ses photos n'appelle aucune réponse utile. L'écran
 *     final le remplace par l'ordre de marche de son organisation.
 */
const ENTERPRISE_STEPS: StepId[] = [
  'space',
  'ent-welcome',
  'cloud-register',
  'cloud-recovery',
  'cloud-verify',
  'org',
  'profile',
  'appearance',
  'ready',
];
// Login on secondary device: pairing → done (skip profile/appearance/etc.)
const CLOUD_PAIRING_STEPS: StepId[] = [
  'space',
  'choice',
  'cloud-register',
  'cloud-pairing',
  'ready',
];

// ==================== State ====================

// BIP-39 inspired recovery word list (simplified — 128 common words)
const RECOVERY_WORDS = [
  'apple',
  'arrow',
  'beach',
  'blade',
  'bloom',
  'brave',
  'bread',
  'brick',
  'brush',
  'cabin',
  'candy',
  'chain',
  'chalk',
  'charm',
  'chase',
  'chess',
  'cliff',
  'clock',
  'cloud',
  'coral',
  'crane',
  'crown',
  'dance',
  'delta',
  'dream',
  'eagle',
  'ember',
  'fable',
  'flame',
  'flint',
  'frost',
  'ghost',
  'globe',
  'grain',
  'grape',
  'green',
  'grove',
  'guide',
  'heart',
  'honey',
  'ivory',
  'jewel',
  'karma',
  'kneel',
  'latch',
  'level',
  'light',
  'lilac',
  'lunar',
  'maple',
  'march',
  'medal',
  'melon',
  'metal',
  'might',
  'north',
  'novel',
  'ocean',
  'olive',
  'orbit',
  'panda',
  'pearl',
  'piano',
  'pilot',
  'plaza',
  'polar',
  'pride',
  'prism',
  'pulse',
  'quake',
  'raven',
  'realm',
  'ridge',
  'river',
  'royal',
  'saint',
  'scale',
  'scout',
  'shade',
  'shell',
  'sigma',
  'silky',
  'solar',
  'solid',
  'spark',
  'spice',
  'spine',
  'stamp',
  'steel',
  'stone',
  'storm',
  'sugar',
  'swift',
  'sword',
  'table',
  'terra',
  'thorn',
  'tiger',
  'torch',
  'tower',
  'trail',
  'trend',
  'tulip',
  'umbra',
  'unity',
  'urban',
  'vapor',
  'vivid',
  'voice',
  'watch',
  'water',
  'wheat',
  'whirl',
  'width',
  'windy',
  'world',
  'wound',
  'yacht',
  'zebra',
  'zippy',
  'amber',
  'badge',
  'cedar',
  'drift',
  'faith',
  'haste',
  'index',
  'jumbo',
];

function generateRecoveryPhrase(): string {
  const words: string[] = [];
  const arr = new Uint32Array(12);
  crypto.getRandomValues(arr);
  for (let i = 0; i < 12; i++) {
    words.push(RECOVERY_WORDS[arr[i] % RECOVERY_WORDS.length]);
  }
  return words.join(' ');
}

interface OnboardingState {
  stepIndex: number;
  mode: 'local' | 'cloud' | null;
  /** The chosen workspace space. Enterprise forces cloud + an org step. */
  spaceType: 'personal' | 'enterprise' | null;
  /**
   * Connexion ou inscription, choisi aux deux portes de l'écran d'accueil
   * entreprise. C'est un ÉTAT et non une prop parce que la personne le décide
   * en cours de parcours ; le figer à l'ouverture rendait la seconde porte
   * inopérante.
   *
   * `null` = RIEN N'EST ENCORE CHOISI, et cette troisième valeur n'est pas un
   * détail : sans elle, une des deux portes serait cochée d'office à l'ouverture
   * de l'écran, et « Suivant » emmènerait quelque part sans que personne n'ait
   * rien décidé.
   */
  authMode: 'register' | 'login' | null;
  language: 'en' | 'fr';
  name: string;
  avatarColor: string;
  pinEnabled: boolean;
  pin: string;
  pinConfirm: string;
  allowPinReset: boolean;
  themeChoice:
    | 'light'
    | 'dark'
    | 'space'
    | 'lofi'
    | 'sky'
    | 'aurora'
    | 'sakura'
    | 'crepuscule'
    | 'foret'
    | 'system';
  accentColor: string;
  useCase: UseCase | null;
  securityAcknowledged: boolean;
  encryptionPassword: string;
  encryptionPasswordConfirm: string;
  recoveryPhrase: string;
  recoveryPhraseSaved: boolean;
  isFinishing: boolean;
  finishError: string | null;
  // Cloud registration
  cloudEmail: string;
  cloudPassword: string;
  cloudPasswordConfirm: string;
  cloudRegistering: boolean;
  cloudRegisterError: string | null;
  cloudRecoveryCodes: string[] | null;
  cloudRecoveryAcknowledged: boolean;
  // Cloud vault password
  vaultPassword: string;
  vaultPasswordConfirm: string;
  vaultAcknowledged: boolean;
  // Secondary device pairing
  isSecondaryDevice: boolean;
  // Enterprise org onboarding (join via invite token / create)
  orgAction: 'join' | 'create' | null;
  orgInviteToken: string;
  orgName: string;
  orgWorking: boolean;
  orgError: string | null;
  /** Set once the user has joined or created an org during onboarding. */
  joinedOrgId: string | null;
}

// ==================== Component ====================

interface OnboardingProps {
  onComplete: () => void;
  /**
   * "Add account" mode: reuse the wizard to provision an ADDITIONAL profile
   * (not first run). When set, the space step is skipped and the flow starts
   * directly in that space (used for "create an enterprise account" from the
   * enterprise picker, since personal/enterprise are distinct accounts).
   */
  initialSpace?: 'personal' | 'enterprise';
  /**
   * Which auth form to show first. 'login' is used for "connect to an existing
   * enterprise account" (add a profile to an account you already have) vs
   * 'register' for creating a brand-new account.
   */
  initialAuthMode?: 'register' | 'login';
  /**
   * Quitter la démarche « ajouter un compte » sans rien provisionner. Rendu
   * comme un lien discret : sans lui, le « + » du sélecteur était une porte à
   * sens unique — on entrait dans l'assistant et on ne pouvait plus en sortir
   * qu'en le menant à son terme.
   */
  onCancel?: () => void;
  /**
   * Le compte ajouté possède PLUSIEURS profils : à l'appelant de rendre la main
   * au sélecteur, où ils apparaissent désormais groupés sous leur adresse. On ne
   * choisit pas à la place de la personne, et on n'invente pas un second
   * sélecteur au milieu de l'assistant.
   *
   * La session reste en attente : c'est le profil qu'elle activera qui
   * l'adoptera (cf. `profile:activate`).
   */
  onProfilesRestored?: (info: { email: string; profileIds: string[] }) => void;
}

/**
 * L'étape par laquelle l'assistant COMMENCE.
 *
 * 0 au premier lancement : on demande l'espace. Entrer par « ajouter un compte »
 * saute ce choix — il vient d'être fait au portail — et, en entreprise, saute
 * aussi l'écran des deux portes, que le sélecteur de profils vient de poser.
 * Reposer une question à laquelle on vient de répondre se lit comme une panne.
 */
function entryIndexFor(space?: 'personal' | 'enterprise'): number {
  if (!space) return 0;
  return space === 'enterprise' ? 2 : 1;
}

const Onboarding: React.FC<OnboardingProps> = ({
  onComplete,
  initialSpace,
  initialAuthMode,
  onCancel,
  onProfilesRestored,
}) => {
  const ENTRY_INDEX = entryIndexFor(initialSpace);
  const { t, i18n } = useTranslation();
  const dispatch = useDispatch<AppDispatch>();

  // Detect OS language for auto-selection
  const detectedLang = (() => {
    const nav = navigator.language || navigator.languages?.[0] || '';
    if (nav.startsWith('fr')) return 'fr';
    return 'en';
  })();

  const [s, setS] = useState<OnboardingState>({
    // Add mode with a forced space skips the space step and starts in that flow.
    // Entrer par « ajouter un compte » saute le choix d'espace — il est déjà
    // fait — ET, en entreprise, l'écran des deux portes : le sélecteur de
    // profils vient de poser la question, la reposer serait la contredire.
    stepIndex: ENTRY_INDEX,
    mode: initialSpace === 'enterprise' ? 'cloud' : null,
    spaceType: initialSpace ?? null,
    // Entrer par « ajouter un compte » a DÉJÀ répondu (le sélecteur de profils
    // vient de poser la question), et l'écran des deux portes est sauté.
    authMode: initialAuthMode ?? null,
    language: detectedLang,
    name: '',
    avatarColor: AVATAR_COLORS[0],
    pinEnabled: false,
    pin: '',
    pinConfirm: '',
    allowPinReset: true,
    themeChoice: 'light',
    accentColor: '#87CEEB',
    useCase: null,
    securityAcknowledged: false,
    encryptionPassword: '',
    encryptionPasswordConfirm: '',
    recoveryPhrase: '',
    recoveryPhraseSaved: false,
    isFinishing: false,
    finishError: null,
    cloudEmail: '',
    cloudPassword: '',
    cloudPasswordConfirm: '',
    cloudRegistering: false,
    cloudRegisterError: null,
    cloudRecoveryCodes: null,
    cloudRecoveryAcknowledged: false,
    vaultPassword: '',
    vaultPasswordConfirm: '',
    vaultAcknowledged: false,
    isSecondaryDevice: false,
    orgAction: null,
    orgInviteToken: '',
    orgName: '',
    orgWorking: false,
    orgError: null,
    joinedOrgId: null,
  });

  const update = useCallback((patch: Partial<OnboardingState>) => {
    setS((prev) => ({ ...prev, ...patch }));
  }, []);

  // Apply detected OS language on mount so the welcome page renders correctly
  useEffect(() => {
    if (detectedLang !== i18n.language) {
      i18n.changeLanguage(detectedLang);
    }
  }, []);

  /**
   * Mode « ajouter un compte » : la zone d'attente s'ouvre AVANT la première
   * saisie, pas après.
   *
   * Tout ce que l'authentification qui suit va écrire — jetons, cache
   * utilisateur, enveloppe de la FEK — doit atterrir hors de tout profil. Ouvrir
   * après coup ne rattraperait rien : les octets seraient déjà chez le profil
   * précédent, et `initHybridCrypto` y aurait déjà lu l'enveloppe du MAUVAIS
   * compte, celle qui ne s'ouvre pas avec le mot de passe qu'on vient de saisir.
   *
   * Au premier lancement (pas de mode ajout), il n'y a aucun profil à protéger :
   * le repli historique fait l'affaire, et l'adoption n'a pas lieu d'être.
   */
  const isAddAccount = !!initialSpace;
  const [pendingRealmReady, setPendingRealmReady] = useState(!initialSpace);
  useEffect(() => {
    if (!isAddAccount) return;
    let vivant = true;
    void beginPendingCloudSession().finally(() => {
      if (vivant) setPendingRealmReady(true);
    });
    return () => {
      vivant = false;
    };
  }, [isAddAccount]);

  const steps = s.isSecondaryDevice
    ? CLOUD_PAIRING_STEPS
    : s.spaceType === 'enterprise'
      ? ENTERPRISE_STEPS
      : s.mode === 'cloud'
        ? CLOUD_STEPS
        : LOCAL_STEPS;
  const currentStep = steps[s.stepIndex];

  /** L'utilisateur est entre par la porte entreprise : memes ecrans, autres phrases. */
  const isEnterpriseSpace = s.spaceType === 'enterprise';

  const canNext = (): boolean => {
    switch (currentStep) {
      case 'space':
        return false; // clicking a card advances directly
      case 'choice':
        return false; // clicking a card advances directly
      case 'ent-welcome':
        // On CHOISIT, puis on avance. L'écran portait un bouton « Suivant » — et
        // cliquer une porte emmenait aussitôt ailleurs : la carte se comportait
        // comme un lien tout en ressemblant à un choix, et le bouton restait gris
        // sans qu'on sache quoi en faire. Il fallait trancher, et c'est ce sens-là
        // qui respecte ce que l'écran MONTRE.
        return s.authMode !== null;
      case 'org':
        return false; // join/create/skip buttons handle advancement
      case 'cloud-register':
        return false; // submit button handles advancement
      case 'cloud-recovery':
        return s.cloudRecoveryAcknowledged;
      case 'cloud-verify':
        return false; // auto-advances on email verification
      case 'cloud-pairing':
        return false; // pairing step handles its own flow
      case 'profile':
        if (!s.name.trim()) return false;
        if (s.pinEnabled) {
          if (!/^\d{4,6}$/.test(s.pin)) return false;
          if (s.pin !== s.pinConfirm) return false;
        }
        return true;
      case 'usecase':
        return s.useCase !== null;
      case 'security':
        if (s.mode === 'cloud') {
          // Cloud: vault password only (recovery codes were shown in cloud-recovery)
          return (
            s.securityAcknowledged &&
            s.encryptionPassword.length >= 8 &&
            s.encryptionPassword === s.encryptionPasswordConfirm
          );
        }
        return (
          s.securityAcknowledged &&
          s.encryptionPassword.length >= 8 &&
          s.encryptionPassword === s.encryptionPasswordConfirm &&
          s.recoveryPhraseSaved
        );
      default:
        return true;
    }
  };

  const handleNext = () => update({ stepIndex: Math.min(s.stepIndex + 1, steps.length - 1) });
  const handleBack = () => {
    // In add-account mode the space is fixed by the entry point (enterprise "+"),
    // so the space step is skipped and Back must never reach it — clamp to the
    // first real step and never clear spaceType/mode.
    const minIndex = ENTRY_INDEX;
    const prevIndex = Math.max(s.stepIndex - 1, minIndex);
    const prevStep = steps[prevIndex];
    if (!initialSpace && prevStep === 'space') {
      // Back to the space choice resets the whole downstream branch.
      update({ stepIndex: 0, mode: null, spaceType: null });
    } else if (prevStep === 'choice') {
      // Back to the local/cloud choice resets the mode.
      update({ stepIndex: prevIndex, mode: null });
    } else {
      update({ stepIndex: prevIndex });
    }
  };

  // ==================== Finish ====================

  const handleFinish = useCallback(async () => {
    update({ isFinishing: true, finishError: null });

    try {
      // ── Secondary device: the FEK first, THEN the profiles it unlocks ──
      if (s.isSecondaryDevice) {
        /**
         * LA CLÉ AVANT LES PROFILS, et c'est tout le correctif.
         *
         * Cette branche lisait le manifeste local, n'y trouvait rien sur un
         * appareil neuf, et créait un profil nommé d'après l'adresse e-mail —
         * puis installait la FEK. Or les métadonnées d'un profil (nom, couleur)
         * vivent dans `manifest.enc`, chiffré : la restauration ne peut avoir
         * lieu qu'une fois la clé en place. L'ordre condamnait donc le seul
         * geste capable de ramener les profils, avant même de l'avoir tenté.
         */
        try {
          const hasKey = await window.electron?.ipcRenderer?.invoke('hybrid:hasKey');
          if (!hasKey && s.cloudPassword) {
            const { initHybridCrypto } = await import('../../../services/auth/hybridCrypto');
            await initHybridCrypto(s.cloudPassword);
          } else if (hasKey) {
            const { tryRestoreFEKFromSafeStorage } =
              await import('../../../services/auth/hybridCrypto');
            await tryRestoreFEKFromSafeStorage();
          }
        } catch {
          /* non-fatal — user can set password manually from Settings */
        }

        /**
         * RAMENER LES PROFILS DU NUAGE. Le commentaire précédent affirmait ici
         * qu'ils l'avaient été « par pairingService.joinPairing » — vrai
         * uniquement quand on passait par les six chiffres. Les deux branches
         * qui sautent l'appairage (le serveur détient une copie enveloppée de
         * la FEK, ou l'appareil a déjà la sienne) n'appelaient donc jamais la
         * restauration, et tombaient droit sur le repli.
         *
         * Idempotent, donc sans danger quand l'appairage l'a déjà faite.
         */
        let restoredIds: string[] = [];
        try {
          restoredIds = (await restoreCloudProfiles()).profileIds;
        } catch {
          /* non-fatal — on se rabat sur ce qui existe en local */
        }

        const profileManifest = await window.electron.ipcRenderer.invoke('profile:getManifest');
        const allProfiles: any[] = profileManifest?.profiles ?? [];

        /**
         * LES PROFILS DE CE COMPTE — pas « les profils ».
         *
         * Cette branche prenait `profiles.find(isDefault) || profiles[0]` sur le
         * manifeste LOCAL ENTIER. Depuis l'onboarding d'un appareil vierge,
         * c'était juste : tout ce qui s'y trouvait venait du compte qui venait
         * de se connecter. Depuis le sélecteur, la machine porte déjà des
         * profils — un autre compte, du travail purement local — et « prendre le
         * premier » ouvre celui de quelqu'un d'autre, avec sa session, ses
         * fichiers et son nom à l'écran.
         *
         * La règle vit dans `accountProfiles` : c'est elle qui décide qui entre
         * dans quoi, elle mérite d'être éprouvée seule.
         */
        const landing = landingForAccount(
          profilesOfAccount(allProfiles, s.cloudEmail, restoredIds)
        );

        if (landing.kind === 'choose' && onProfilesRestored) {
          /**
           * PLUSIEURS : on rend la main. Le sélecteur sait déjà les grouper sous
           * l'adresse du compte, et c'est à la personne de dire lequel elle
           * ouvre — pas à l'assistant de parier sur `isDefault`, qui désigne le
           * profil par défaut de l'APPAREIL, pas celui du compte.
           *
           * La session reste en attente : le profil qu'elle activera l'adoptera.
           */
          update({ isFinishing: false });
          onProfilesRestored({ email: s.cloudEmail, profileIds: landing.profileIds });
          return;
        }

        if (landing.kind === 'enter') {
          await dispatch(activateProfile(landing.profileId)).unwrap();
        } else if (landing.kind === 'choose') {
          // Personne pour arbitrer (premier lancement, sans appelant) : le
          // défaut de l'appareil reste le meilleur choix disponible.
          const mine = profilesOfAccount(allProfiles, s.cloudEmail, restoredIds);
          const defaultProfile = mine.find((p: any) => p.isDefault) || mine[0];
          await dispatch(activateProfile(defaultProfile.id)).unwrap();
        } else if (!isAddAccount && allProfiles.length > 0) {
          // PREMIER LANCEMENT, restauration bredouille (manifestes illisibles,
          // hors ligne) mais des profils existent déjà sur l'appareil : on entre
          // dans celui-là plutôt que d'en fabriquer un doublon. Comportement
          // d'origine, préservé tel quel — hors mode ajout, il n'y a aucun autre
          // compte à qui ce profil pourrait appartenir.
          const defaultProfile = allProfiles.find((p: any) => p.isDefault) || allProfiles[0];
          await dispatch(activateProfile(defaultProfile.id)).unwrap();
        } else {
          // DERNIER RECOURS, et il l'est enfin : ni profil restauré, ni profil
          // local. Avant, ce chemin était le chemin ORDINAIRE d'une connexion.
          const profile = await dispatch(
            createProfile({
              name: s.cloudEmail.split('@')[0] || 'User',
              avatarColor: AVATAR_COLORS[0],
            })
          ).unwrap();
          await dispatch(activateProfile(profile.id)).unwrap();
        }

        // Activate cloud sync
        const meResult = await authApi.getMe();
        let effectiveSpace: 'personal' | 'enterprise' =
          s.spaceType === 'enterprise' ? 'enterprise' : 'personal';
        if (meResult.success && meResult.user) {
          dispatch(setCloudAuth(meResult.user));
          if (meResult.user.accountType) {
            effectiveSpace = meResult.user.accountType === 'enterprise' ? 'enterprise' : 'personal';
          }
          await authApi.setSyncEnabled(true);
          dispatch(setSyncEnabled(true));
        }

        // Trigger initial sync
        try {
          const manifest = await window.electron.ipcRenderer.invoke('profile:getManifest');
          const pid = manifest?.activeProfileId;
          if (pid) {
            await window.electron.ipcRenderer.invoke('sync:triggerSync', pid);
          }
        } catch {
          /* non-fatal */
        }

        // Persist the space from the AUTHORITATIVE account type (0059), not the
        // raw choice — a login can resolve to a different type than was picked.
        try {
          await window.electron?.ipcRenderer?.invoke(
            'space:set',
            effectiveSpace,
            effectiveSpace === 'enterprise' ? (s.joinedOrgId ?? undefined) : undefined
          );
        } catch {
          /* non-fatal — defaults to personal, user can switch from the profile */
        }

        localStorage.setItem('i18nextLng', s.language);
        localStorage.setItem('filarr-onboarding-complete', 'true');
        try {
          await window.electron?.ipcRenderer?.invoke('flag:set', 'onboarding-complete', 'true');
        } catch {
          /* non-fatal */
        }
        onComplete();
        return;
      }

      // ── Normal flow (first device or local) ─────────────────────────────────

      // 1. Profile (FATAL if fails)
      const profile = await dispatch(
        createProfile({
          name: s.name.trim() || 'User',
          avatarColor: s.avatarColor,
          ...(s.pinEnabled && s.pin ? { pin: s.pin, allowPinReset: s.allowPinReset } : {}),
        })
      ).unwrap();

      // 1b. Activate the profile so StorageService points to the right directory
      await dispatch(activateProfile(profile.id)).unwrap();

      /**
       * Le pointeur de `profileStorage` suit, et il doit suivre ICI.
       *
       * Tout ce que la suite de cette fonction enregistre — thème, accent,
       * langue — est une préférence de PROFIL. Sans ce pointeur, ces écritures
       * atterrissent sur les clés nues, communes au poste : le profil suivant
       * créé sur cette machine en hériterait par le repli hérité de
       * `getItemWithLegacyFallback`, et s'ouvrirait habillé comme celui-ci.
       */
      profileStorage.setActiveProfile(profile.id);

      // 1c. Initialize hybrid encryption with the master password
      // In cloud mode, the account password doubles as the vault password (Option B)
      const cryptoPassword = s.mode === 'cloud' ? s.cloudPassword : s.encryptionPassword;
      if (cryptoPassword) {
        try {
          const { initHybridCrypto, wrapFEKWithRecoveryPhrase, applyRecoveryPhrase } =
            await import('../../../services/auth/hybridCrypto');
          await initHybridCrypto(cryptoPassword);

          // Wrap the FEK (and keypair) under the recovery phrase so the account
          // can be recovered later.
          if (s.recoveryPhrase && s.mode !== 'cloud') {
            const recoveryData = await wrapFEKWithRecoveryPhrase(s.recoveryPhrase);
            // Update the wrapped key file to include recovery data
            const existingWrapped =
              await window.electron?.ipcRenderer?.invoke('hybrid:loadWrappedKey');
            if (existingWrapped) {
              await window.electron?.ipcRenderer?.invoke('hybrid:saveWrappedKey', {
                ...existingWrapped,
                ...recoveryData,
              });
            }
            // E2-5: the keypair MUST get its recovery wrap at the same moment as
            // the FEK — otherwise we'd create a keypair that can't be recovered by
            // phrase (its private key would orphan after a password reset).
            const { attachRecoveryWrap } = await import('../../../services/auth/userKeypairSync');
            await attachRecoveryWrap(s.recoveryPhrase);
          } else if (s.mode === 'cloud' && s.cloudRecoveryCodes?.length) {
            // Cloud accounts get a server-issued recovery phrase but the FEK was
            // never wrapped under it — so phrase recovery (recoverCloudAccount)
            // was impossible. Wrap FEK + keypair under the codes now and publish.
            // (Return value ignored here — a transient cloud-push miss self-heals
            // via backfill on the next launch; the regenerate path surfaces it.)
            await applyRecoveryPhrase(s.cloudRecoveryCodes.join(' '), cryptoPassword);
          }
        } catch (err) {
          console.warn('[Onboarding] Encryption init failed (non-fatal):', err);
        }
      }

      // 2. Theme
      if (s.themeChoice === 'system') {
        dispatch(setUseSystemTheme(true));
        const resolved = detectSystemTheme();
        document.documentElement.setAttribute('data-theme', resolved);
      } else {
        dispatch(setTheme(s.themeChoice));
        document.documentElement.setAttribute('data-theme', s.themeChoice);
      }
      localStorage.setItem(
        'theme',
        s.themeChoice === 'system' ? detectSystemTheme() : s.themeChoice
      );

      // 3. Accent color
      if (s.accentColor !== '#87CEEB') {
        applyAccentColorPalette(s.accentColor);
      }
      try {
        profileStorage.setItem(
          'filarr-settings',
          JSON.stringify({
            theme: s.themeChoice === 'system' ? detectSystemTheme() : s.themeChoice,
            primaryColor: s.accentColor,
            language: s.language,
            notificationsEnabled: true,
            soundEnabled: true,
          })
        );
      } catch {
        /* non-fatal */
      }

      // 4. Language persistence
      localStorage.setItem('i18nextLng', s.language);

      // 5. Starter content
      if (s.useCase) {
        const template = STARTER_TEMPLATES[s.useCase];
        const createdFolderIds: Record<string, string> = {};

        // 5a. Folders + subfolders
        for (const folderTpl of template.folders) {
          try {
            const folder = await dispatch(
              createFolder({
                name: t(folderTpl.nameKey),
                color: folderTpl.color,
              })
            ).unwrap();
            createdFolderIds[folderTpl.nameKey] = folder.id;

            if (folderTpl.children) {
              for (const child of folderTpl.children) {
                try {
                  await dispatch(
                    createFolder({
                      name: t(child.nameKey),
                      color: child.color,
                      parentId: folder.id,
                    })
                  ).unwrap();
                } catch {
                  /* non-fatal */
                }
              }
            }
          } catch (err) {
            console.warn('[Onboarding] Folder creation failed:', folderTpl.nameKey, err);
          }
        }

        // 5b. Tags
        for (const tagTpl of template.tags) {
          try {
            await dispatch(
              createTag({
                name: t(tagTpl.nameKey),
                color: tagTpl.color,
              })
            ).unwrap();
          } catch {
            /* non-fatal */
          }
        }

        // 5c. Welcome note
        const firstFolderKey = template.folders[0]?.nameKey;
        const firstFolderName = firstFolderKey ? t(firstFolderKey) : 'Documents';
        const firstFolderId = firstFolderKey ? createdFolderIds[firstFolderKey] : undefined;

        try {
          await dispatch(
            createNewNote({
              title: s.language === 'fr' ? 'Bienvenue dans Filarr' : 'Welcome to Filarr',
              content: getWelcomeNoteContent(s.language, firstFolderName),
              parentId: firstFolderId || null,
            })
          ).unwrap();
        } catch {
          /* non-fatal */
        }
      }

      // The account's server-side type is authoritative (0059). It equals the
      // onboarding choice for a fresh REGISTER, but for a LOGIN to an existing
      // account it wins over the chosen space (e.g. logging into a personal
      // account while the enterprise flow was selected → the profile is personal).
      let effectiveSpace: 'personal' | 'enterprise' =
        s.spaceType === 'enterprise' ? 'enterprise' : 'personal';

      // 6. Cloud mode: activate sync in Redux + trigger initial sync
      if (s.mode === 'cloud') {
        try {
          const meResult = await authApi.getMe();
          if (meResult.success && meResult.user) {
            dispatch(setCloudAuth(meResult.user));
            if (meResult.user.accountType) {
              effectiveSpace =
                meResult.user.accountType === 'enterprise' ? 'enterprise' : 'personal';
            }
            await authApi.setSyncEnabled(true);
            dispatch(setSyncEnabled(true));
          }
          // Trigger initial sync so data uploads immediately
          window.electron?.ipcRenderer?.invoke('sync:triggerSync', profile.id).catch(() => {});
        } catch {
          /* non-fatal — auth state will be hydrated on next startup */
        }
      }

      // 6b. Persist the space for this profile from the AUTHORITATIVE account type
      // (never the raw choice — see effectiveSpace above). Enterprise binds the org
      // joined/created during onboarding (X-Org-Id + gating); personal forces the
      // org context off.
      try {
        await window.electron?.ipcRenderer?.invoke(
          'space:set',
          effectiveSpace,
          effectiveSpace === 'enterprise' ? (s.joinedOrgId ?? undefined) : undefined
        );
      } catch {
        /* non-fatal — defaults to personal, user can switch from the profile */
      }

      // 7. Complete — write to disk via IPC (survives localStorage resets)
      localStorage.setItem('filarr-onboarding-complete', 'true');
      try {
        await window.electron?.ipcRenderer?.invoke('flag:set', 'onboarding-complete', 'true');
      } catch {
        /* IPC unavailable in dev browser */
      }
      onComplete();
    } catch (err) {
      console.error('[Onboarding] Fatal error:', err);
      update({
        isFinishing: false,
        finishError: t('onboarding.finishError', 'Une erreur est survenue. Veuillez reessayer.'),
      });
    }
  }, [s, dispatch, t, onComplete, update]);

  // ==================== Render helpers ====================

  const Bullet: React.FC<{ icon: React.ReactNode; text: string }> = ({ icon, text }) => (
    <div
      className="flex items-center gap-3 p-3 rounded-lg"
      style={{ backgroundColor: 'var(--color-background-secondary)' }}
    >
      <span className="text-lg">{icon}</span>
      <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
        {text}
      </p>
    </div>
  );

  const RadioCard: React.FC<{
    selected: boolean;
    onClick: () => void;
    children: React.ReactNode;
  }> = ({ selected, onClick, children }) => (
    <button
      onClick={onClick}
      className="w-full text-left p-4 rounded-xl border-2 transition-all"
      style={{
        borderColor: selected ? 'var(--color-primary-600)' : 'var(--color-border)',
        backgroundColor: selected ? 'var(--color-primary-50)' : 'transparent',
      }}
    >
      {children}
    </button>
  );

  // ==================== Render ====================

  /**
   * Rien ne s'affiche tant que la zone d'attente n'est pas ouverte.
   *
   * Ce n'est pas une coquetterie : montrer le formulaire avant, c'est offrir la
   * possibilité — mince, mais réelle — d'envoyer une connexion pendant que les
   * domaines visent encore le profil précédent. Les jetons du nouveau compte
   * atterriraient alors chez l'ancien, et l'adoption n'aurait plus rien à
   * déménager. On préfère une fraction de seconde de vide.
   */
  if (!pendingRealmReady) {
    return (
      // chrome:free — voile d'attente vide, aucun controle.
      <div
        className="fixed inset-0 z-50 flex items-center justify-center"
        style={{ backgroundColor: 'var(--color-background)' }}
      />
    );
  }

  return (
    // chrome:free — fenetre centree (max-w-2xl), aucun controle dans la bande.
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'var(--color-background)' }}
    >
      <div
        className="w-full max-w-2xl mx-4 rounded-2xl"
        style={{
          backgroundColor: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)',
          maxHeight: 'calc(100vh - 48px)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Progress bar */}
        <div
          style={{ height: 4, backgroundColor: 'var(--color-background-secondary)', flexShrink: 0 }}
        >
          <div
            style={{
              height: '100%',
              backgroundColor: 'var(--color-primary-600)',
              width: `${((s.stepIndex + 1) / steps.length) * 100}%`,
              transition: 'width 0.3s ease',
            }}
          />
        </div>

        <div style={{ padding: '2rem', overflowY: 'auto', flex: 1, minHeight: 0 }}>
          {/* ======== Step 0: Space (personal / enterprise) ======== */}
          {currentStep === 'space' && (
            <div>
              <div className="text-center mb-6">
                <div className="mx-auto mb-4">
                  <FilarrLogo size={56} />
                </div>
                <h1
                  className="text-2xl font-bold mb-2"
                  style={{ color: 'var(--color-text-primary)' }}
                >
                  {t('onboarding.space.title', 'Comment allez-vous utiliser Filarr ?')}
                </h1>
                <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                  {t(
                    'onboarding.space.subtitle',
                    'Vous pourrez basculer entre les deux à tout moment.'
                  )}
                </p>

                {/* Language quick-switch */}
                <div className="flex items-center justify-center gap-2 mt-3">
                  <button
                    onClick={() => {
                      update({ language: 'fr' });
                      i18n.changeLanguage('fr');
                    }}
                    className="px-3 py-1 text-xs rounded-lg transition-all"
                    style={{
                      border: '1px solid var(--color-border)',
                      background: s.language === 'fr' ? 'var(--color-primary-50)' : 'transparent',
                      fontWeight: s.language === 'fr' ? 600 : 400,
                      color: 'var(--color-text-primary)',
                      cursor: 'pointer',
                    }}
                  >
                    FR
                  </button>
                  <button
                    onClick={() => {
                      update({ language: 'en' });
                      i18n.changeLanguage('en');
                    }}
                    className="px-3 py-1 text-xs rounded-lg transition-all"
                    style={{
                      border: '1px solid var(--color-border)',
                      background: s.language === 'en' ? 'var(--color-primary-50)' : 'transparent',
                      fontWeight: s.language === 'en' ? 600 : 400,
                      color: 'var(--color-text-primary)',
                      cursor: 'pointer',
                    }}
                  >
                    EN
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                {/* Personal card */}
                <button
                  onClick={() => update({ spaceType: 'personal', stepIndex: 1 })}
                  className="text-left p-5 rounded-xl border-2 transition-all hover:shadow-md"
                  style={{
                    borderColor: 'var(--color-border)',
                    backgroundColor: 'var(--color-surface)',
                    cursor: 'pointer',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = 'var(--color-primary-400)';
                    e.currentTarget.style.backgroundColor = 'var(--color-primary-50)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = 'var(--color-border)';
                    e.currentTarget.style.backgroundColor = 'var(--color-surface)';
                  }}
                >
                  <div className="mb-3">
                    <svg
                      className="w-8 h-8"
                      style={{ color: 'var(--color-primary-600)' }}
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
                  </div>
                  <h3
                    className="text-base font-semibold mb-1"
                    style={{ color: 'var(--color-text-primary)' }}
                  >
                    {t('onboarding.space.personalTitle', 'Personnel')}
                  </h3>
                  <p className="text-xs mb-2" style={{ color: 'var(--color-text-secondary)' }}>
                    {t(
                      'onboarding.space.personalDesc',
                      'Pour votre usage individuel. Local ou avec sync cloud.'
                    )}
                  </p>
                </button>

                {/* Enterprise card — "coming soon" (disabled) while enterprise is
                    not yet shipped; hidden entirely if the user opted out. */}
                {!isEnterpriseHidden() && (
                  <button
                    onClick={() => {
                      if (ENTERPRISE_ACCESSIBLE)
                        update({ spaceType: 'enterprise', mode: 'cloud', stepIndex: 1 });
                    }}
                    disabled={!ENTERPRISE_ACCESSIBLE}
                    className={`relative text-left p-5 rounded-xl border-2 transition-all ${ENTERPRISE_ACCESSIBLE ? 'hover:shadow-md' : 'cursor-not-allowed'}`}
                    style={{
                      borderColor: 'var(--color-primary-400)',
                      backgroundColor: 'var(--color-surface)',
                      cursor: ENTERPRISE_ACCESSIBLE ? 'pointer' : 'not-allowed',
                      opacity: ENTERPRISE_ACCESSIBLE ? 1 : 0.6,
                    }}
                    onMouseEnter={(e) => {
                      if (!ENTERPRISE_ACCESSIBLE) return;
                      e.currentTarget.style.borderColor = 'var(--color-primary-600)';
                      e.currentTarget.style.backgroundColor = 'var(--color-primary-50)';
                    }}
                    onMouseLeave={(e) => {
                      if (!ENTERPRISE_ACCESSIBLE) return;
                      e.currentTarget.style.borderColor = 'var(--color-primary-400)';
                      e.currentTarget.style.backgroundColor = 'var(--color-surface)';
                    }}
                  >
                    {!ENTERPRISE_ACCESSIBLE && (
                      <span
                        className="absolute top-2.5 right-2.5 text-[10px] font-semibold px-2 py-0.5 rounded-full"
                        style={{
                          backgroundColor: 'var(--color-neutral-200)',
                          color: 'var(--color-neutral-600)',
                        }}
                      >
                        {t('spaces.comingSoon', 'Prochainement')}
                      </span>
                    )}
                    <div className="mb-3">
                      <svg
                        className="w-8 h-8"
                        style={{ color: 'var(--color-primary-600)' }}
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
                    <h3
                      className="text-base font-semibold mb-1"
                      style={{ color: 'var(--color-text-primary)' }}
                    >
                      {t('onboarding.space.enterpriseTitle', 'Entreprise / Équipe')}
                    </h3>
                    <p className="text-xs mb-2" style={{ color: 'var(--color-text-secondary)' }}>
                      {t(
                        'onboarding.space.enterpriseDesc',
                        'Coffres partagés, administration et gouvernance. Requiert un compte cloud.'
                      )}
                    </p>
                  </button>
                )}
              </div>
            </div>
          )}

          {/* ======== Step 0: Choice (local / cloud) ======== */}
          {currentStep === 'choice' && (
            <div>
              <div className="text-center mb-6">
                <div className="mx-auto mb-4">
                  <FilarrLogo size={56} />
                </div>
                <h1
                  className="text-2xl font-bold mb-2"
                  style={{ color: 'var(--color-text-primary)' }}
                >
                  {t('onboarding.cloud.choiceTitle', 'Comment voulez-vous utiliser Filarr ?')}
                </h1>
                <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                  {t(
                    'onboarding.cloud.choiceSubtitle',
                    'Vous pourrez changer plus tard dans les Paramètres.'
                  )}
                </p>

                {/* Language quick-switch */}
                <div className="flex items-center justify-center gap-2 mt-3">
                  <button
                    onClick={() => {
                      update({ language: 'fr' });
                      i18n.changeLanguage('fr');
                    }}
                    className="px-3 py-1 text-xs rounded-lg transition-all"
                    style={{
                      border: '1px solid var(--color-border)',
                      background: s.language === 'fr' ? 'var(--color-primary-50)' : 'transparent',
                      fontWeight: s.language === 'fr' ? 600 : 400,
                      color: 'var(--color-text-primary)',
                      cursor: 'pointer',
                    }}
                  >
                    FR
                  </button>
                  <button
                    onClick={() => {
                      update({ language: 'en' });
                      i18n.changeLanguage('en');
                    }}
                    className="px-3 py-1 text-xs rounded-lg transition-all"
                    style={{
                      border: '1px solid var(--color-border)',
                      background: s.language === 'en' ? 'var(--color-primary-50)' : 'transparent',
                      fontWeight: s.language === 'en' ? 600 : 400,
                      color: 'var(--color-text-primary)',
                      cursor: 'pointer',
                    }}
                  >
                    EN
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                {/* Local card */}
                <button
                  onClick={() => update({ mode: 'local', stepIndex: 2 })}
                  className="text-left p-5 rounded-xl border-2 transition-all hover:shadow-md"
                  style={{
                    borderColor: 'var(--color-border)',
                    backgroundColor: 'var(--color-surface)',
                    cursor: 'pointer',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = 'var(--color-primary-400)';
                    e.currentTarget.style.backgroundColor = 'var(--color-primary-50)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = 'var(--color-border)';
                    e.currentTarget.style.backgroundColor = 'var(--color-surface)';
                  }}
                >
                  <div className="mb-3">
                    <svg
                      className="w-8 h-8"
                      style={{ color: 'var(--color-primary-600)' }}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={1.5}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25A2.25 2.25 0 015.25 3h13.5A2.25 2.25 0 0121 5.25z"
                      />
                    </svg>
                  </div>
                  <h3
                    className="text-base font-semibold mb-1"
                    style={{ color: 'var(--color-text-primary)' }}
                  >
                    {t('onboarding.cloud.localCard.title', 'Local uniquement')}
                  </h3>
                  <p
                    className="text-xs font-medium mb-3"
                    style={{ color: 'var(--color-primary-600)' }}
                  >
                    {t('onboarding.cloud.localCard.price', 'Gratuit')}
                  </p>
                  <ul className="space-y-1.5">
                    {[
                      t('onboarding.cloud.localCard.bullet1', 'Aucun compte requis'),
                      t('onboarding.cloud.localCard.bullet2', 'Données sur votre machine'),
                      t('onboarding.cloud.localCard.bullet3', 'Toujours disponible'),
                    ].map((text, i) => (
                      <li
                        key={i}
                        className="flex items-center gap-2 text-xs"
                        style={{ color: 'var(--color-text-secondary)' }}
                      >
                        <svg
                          className="w-3.5 h-3.5 flex-shrink-0"
                          style={{ color: '#10b981' }}
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={2.5}
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M4.5 12.75l6 6 9-13.5"
                          />
                        </svg>
                        {text}
                      </li>
                    ))}
                  </ul>
                </button>

                {/* Cloud card */}
                <button
                  onClick={() => update({ mode: 'cloud', stepIndex: 2 })}
                  className="relative text-left p-5 rounded-xl border-2 transition-all hover:shadow-md"
                  style={{
                    borderColor: 'var(--color-primary-400)',
                    backgroundColor: 'var(--color-surface)',
                    cursor: 'pointer',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = 'var(--color-primary-600)';
                    e.currentTarget.style.backgroundColor = 'var(--color-primary-50)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = 'var(--color-primary-400)';
                    e.currentTarget.style.backgroundColor = 'var(--color-surface)';
                  }}
                >
                  {/* Badge */}
                  <span
                    className="absolute -top-2.5 right-3 text-xs font-semibold px-2.5 py-0.5 rounded-full"
                    style={{ backgroundColor: 'var(--color-primary-600)', color: '#fff' }}
                  >
                    {t('onboarding.cloud.cloudCard.badge', 'Recommandé')}
                  </span>

                  <div className="mb-3">
                    <svg
                      className="w-8 h-8"
                      style={{ color: 'var(--color-primary-600)' }}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={1.5}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M2.25 15a4.5 4.5 0 004.5 4.5H18a3.75 3.75 0 001.332-7.257 3 3 0 00-3.758-3.848 5.25 5.25 0 00-10.233 2.33A4.502 4.502 0 002.25 15z"
                      />
                    </svg>
                  </div>
                  <h3
                    className="text-base font-semibold mb-1"
                    style={{ color: 'var(--color-text-primary)' }}
                  >
                    {t('onboarding.cloud.cloudCard.title', 'Avec sync cloud')}
                  </h3>
                  <p
                    className="text-xs font-medium mb-3"
                    style={{ color: 'var(--color-primary-600)' }}
                  >
                    {t('onboarding.cloud.cloudCard.price', '4\u20AC/mois')}
                  </p>
                  <ul className="space-y-1.5">
                    {[
                      t('onboarding.cloud.cloudCard.bullet1', 'Sync entre appareils'),
                      t('onboarding.cloud.cloudCard.bullet2', 'Backup automatique'),
                      t('onboarding.cloud.cloudCard.bullet3', 'Acces multi-devices'),
                    ].map((text, i) => (
                      <li
                        key={i}
                        className="flex items-center gap-2 text-xs"
                        style={{ color: 'var(--color-text-secondary)' }}
                      >
                        <svg
                          className="w-3.5 h-3.5 flex-shrink-0"
                          style={{ color: '#10b981' }}
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={2.5}
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M4.5 12.75l6 6 9-13.5"
                          />
                        </svg>
                        {text}
                      </li>
                    ))}
                  </ul>
                </button>
              </div>
            </div>
          )}

          {/* ======== Cloud Step 1: Register ======== */}
          {currentStep === 'cloud-register' && (
            <CloudRegisterStep
              language={s.language}
              accountType={s.spaceType === 'enterprise' ? 'enterprise' : 'personal'}
              initialMode={s.authMode ?? 'register'}
              onSuccess={({ user, recoveryCodes, password }) => {
                update({
                  cloudRecoveryCodes: recoveryCodes,
                  cloudEmail: user.email,
                  cloudPassword: password,
                  stepIndex: s.stepIndex + 1,
                });
              }}
              onPasskeyLogin={async (user) => {
                /**
                 * UNE CLÉ D'ACCÈS OUVRE LE COMPTE, PAS LE COFFRE.
                 *
                 * Les jetons sont posés ; reste la clé qui déchiffre, dérivée du
                 * mot de passe et gardée sur l'appareil après la première fois.
                 * Cet appareil l'a déjà : on entre, et la clé d'accès a remplacé
                 * le mot de passe pour de bon. Il ne l'a pas : on le DIT et on
                 * laisse saisir le mot de passe une fois, plutôt que d'ouvrir un
                 * coffre vide que personne ne comprendrait.
                 */
                let hasLocalFEK = false;
                try {
                  hasLocalFEK = await window.electron.ipcRenderer.invoke('hybrid:hasKey');
                } catch {
                  /* pas de clé sur cet appareil */
                }
                if (!hasLocalFEK) return { needsPassword: true };
                update({
                  cloudEmail: user.email,
                  isSecondaryDevice: true,
                  stepIndex: CLOUD_PAIRING_STEPS.indexOf('ready'),
                });
                return { needsPassword: false };
              }}
              onLogin={async ({ user, password }) => {
                // Check if this account has synced profiles with data
                // (manifestVersion > 0 means Device A already synced)
                let hasSyncedData = false;
                try {
                  const syncResult =
                    await window.electron.ipcRenderer.invoke('sync:getCloudProfiles');
                  if (syncResult?.profiles?.length > 0) {
                    hasSyncedData = syncResult.profiles.some(
                      (p: { manifestVersion: number }) => p.manifestVersion > 0
                    );
                  }
                } catch {
                  // If endpoint fails, assume first device
                }

                // Check if this device already has a FEK (returning device, not new)
                let hasLocalFEK = false;
                try {
                  hasLocalFEK = await window.electron.ipcRenderer.invoke('hybrid:hasKey');
                } catch {
                  /* assume no */
                }

                // Check if the server holds a wrapped FEK for this account.
                // If yes, we can bootstrap the new device directly from cloud
                // without a physical pairing handshake — initHybridCrypto will
                // fetch + unwrap during the secondary-device branch below.
                let hasServerWrappedKey = false;
                try {
                  const serverKey = await window.electron.ipcRenderer.invoke(
                    'hybrid:fetchWrappedKeyFromCloud'
                  );
                  hasServerWrappedKey = !!serverKey;
                } catch {
                  /* assume no */
                }

                if (hasSyncedData && !hasLocalFEK && hasServerWrappedKey) {
                  // New device + cloud has data + server has the wrapped FEK
                  // → skip the 6-digit pairing flow entirely. The
                  // secondary-device branch in handleFinish() calls
                  // initHybridCrypto(password) which fetches + unwraps from
                  // the server copy.
                  update({
                    cloudEmail: user.email,
                    cloudPassword: password,
                    isSecondaryDevice: true,
                    stepIndex: CLOUD_PAIRING_STEPS.indexOf('ready'),
                  });
                } else if (hasSyncedData && !hasLocalFEK) {
                  // Legacy path: cloud has data but the server has no wrapped
                  // FEK copy (account created before the server-side wrapped
                  // key deploy). Falls back to device-to-device pairing.
                  update({
                    cloudEmail: user.email,
                    cloudPassword: password,
                    isSecondaryDevice: true,
                    stepIndex: CLOUD_PAIRING_STEPS.indexOf('cloud-pairing'),
                  });
                } else if (hasSyncedData && hasLocalFEK) {
                  // Returning device — already has FEK, just activate sync
                  update({
                    cloudEmail: user.email,
                    cloudPassword: password,
                    isSecondaryDevice: true,
                    stepIndex: CLOUD_PAIRING_STEPS.indexOf('ready'),
                  });
                } else {
                  // First device, LOGIN to an existing account → straight to
                  // profile setup. We never show the join/create org step on
                  // login: an existing enterprise account already carries its org
                  // membership (server truth), restored by initOrgContext. The
                  // org step is only for a freshly REGISTERED enterprise account
                  // (handled on the onSuccess/register path via ENTERPRISE_STEPS).
                  const targetIndex = steps.indexOf('profile');
                  update({
                    cloudEmail: user.email,
                    cloudPassword: password,
                    stepIndex: targetIndex >= 0 ? targetIndex : s.stepIndex + 3,
                  });
                }
              }}
            />
          )}

          {/* ======== Cloud Step 2: Recovery Codes ======== */}
          {currentStep === 'cloud-recovery' && s.cloudRecoveryCodes && (
            <CloudRecoveryStep
              recoveryCodes={s.cloudRecoveryCodes}
              language={s.language}
              accountType={s.spaceType === 'enterprise' ? 'enterprise' : 'personal'}
              onAcknowledged={() => {
                update({ cloudRecoveryAcknowledged: true });
              }}
            />
          )}

          {/* ======== Cloud Step 3: Email Verification ======== */}
          {currentStep === 'cloud-verify' &&
            (() => {
              const maskedEmail = (() => {
                const [local, domain] = s.cloudEmail.split('@');
                if (!domain) return s.cloudEmail;
                return local.slice(0, 3) + '***@' + domain;
              })();
              return (
                <CloudVerifyStep
                  email={s.cloudEmail}
                  maskedEmail={maskedEmail}
                  language={s.language}
                  onVerified={async () => {
                    // Auto-login after email verification to save tokens
                    try {
                      await authApi.login(s.cloudEmail, s.cloudPassword);
                    } catch {
                      // Non-fatal — user can login manually later
                    }
                    // Keep cloudRecoveryCodes in state: the finish handler wraps
                    // the FEK + keypair under them (the FEK only exists after
                    // initHybridCrypto runs there). They're discarded on unmount.
                    update({ stepIndex: s.stepIndex + 1 });
                  }}
                  onChangeEmail={() => {
                    const registerIndex = steps.indexOf('cloud-register');
                    update({
                      stepIndex: registerIndex >= 0 ? registerIndex : 1,
                      cloudEmail: '',
                      cloudPassword: '',
                      cloudPasswordConfirm: '',
                      cloudRecoveryCodes: null,
                      cloudRecoveryAcknowledged: false,
                      cloudRegisterError: null,
                    });
                  }}
                />
              );
            })()}

          {/* ======== Cloud Step: Device Pairing (secondary device) ======== */}
          {currentStep === 'cloud-pairing' && (
            <OnboardingPairingStep
              language={s.language}
              cloudPassword={s.cloudPassword}
              onComplete={() => {
                update({ stepIndex: s.stepIndex + 1 });
              }}
            />
          )}

          {/* ======== Enterprise Step: Organization (join / create) ======== */}
          {currentStep === 'ent-welcome' && (
            <div>
              <h2 className="text-xl font-bold mb-1" style={{ color: 'var(--color-text-primary)' }}>
                {t('onboarding.entWelcome.title', 'Bienvenue dans l’espace de votre organisation')}
              </h2>
              <p className="text-sm mb-5" style={{ color: 'var(--color-text-secondary)' }}>
                {t(
                  'onboarding.entWelcome.subtitle',
                  'Cet espace est séparé de vos comptes personnels — c’est ce qui garantit qu’aucune donnée privée n’entre dans le cadre professionnel. Vous aurez donc un compte distinct, même si vous utilisez déjà Filarr.'
                )}
              </p>

              {/* Deux portes NOMMÉES. Les confondre est exactement ce qui envoyait
                  créer un second compte à qui venait d'en créer un sur le site. */}
              <div className="space-y-3">
                <RadioCard
                  selected={s.authMode === 'login'}
                  onClick={() => update({ authMode: 'login' })}
                >
                  <h3
                    className="text-sm font-semibold"
                    style={{ color: 'var(--color-text-primary)' }}
                  >
                    {t('onboarding.entWelcome.haveTitle', 'J’ai déjà un compte d’organisation')}
                  </h3>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
                    {t(
                      'onboarding.entWelcome.haveDesc',
                      'Créé sur filarr.com, ou reçu par invitation de votre équipe.'
                    )}
                  </p>
                </RadioCard>

                <RadioCard
                  selected={s.authMode === 'register'}
                  onClick={() => update({ authMode: 'register' })}
                >
                  <h3
                    className="text-sm font-semibold"
                    style={{ color: 'var(--color-text-primary)' }}
                  >
                    {t('onboarding.entWelcome.newTitle', 'Je n’en ai pas encore')}
                  </h3>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
                    {t(
                      'onboarding.entWelcome.newDesc',
                      'On le crée maintenant, puis vous rejoignez ou fondez votre organisation.'
                    )}
                  </p>
                </RadioCard>
              </div>

              <p
                className="text-xs mt-5 pt-4"
                style={{
                  color: 'var(--color-text-tertiary)',
                  borderTop: '1px solid var(--color-border-light)',
                }}
              >
                {t(
                  'onboarding.entWelcome.foot',
                  'Vos profils personnels ne disparaissent pas : ils restent dans l’espace Personnel, que vous retrouvez à tout moment depuis le portail de lancement.'
                )}
              </p>
            </div>
          )}

          {currentStep === 'org' && (
            <div>
              <h2 className="text-xl font-bold mb-1" style={{ color: 'var(--color-text-primary)' }}>
                {t('onboarding.org.title', 'Votre organisation')}
              </h2>
              <p className="text-sm mb-5" style={{ color: 'var(--color-text-secondary)' }}>
                {t(
                  'onboarding.org.subtitle',
                  'Rejoignez une organisation existante ou créez la vôtre.'
                )}
              </p>

              <div className="space-y-3">
                <RadioCard
                  selected={s.orgAction === 'join'}
                  onClick={() => update({ orgAction: 'join', orgError: null })}
                >
                  <h3
                    className="text-sm font-semibold"
                    style={{ color: 'var(--color-text-primary)' }}
                  >
                    {t('onboarding.org.joinTitle', 'Rejoindre une organisation')}
                  </h3>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
                    {t('onboarding.org.joinDesc', 'Avec le code d’invitation reçu par email.')}
                  </p>
                  {s.orgAction === 'join' && (
                    <input
                      type="text"
                      value={s.orgInviteToken}
                      onChange={(e) => update({ orgInviteToken: e.target.value, orgError: null })}
                      placeholder={t('onboarding.org.tokenPlaceholder', 'Code d’invitation')}
                      autoFocus
                      onClick={(e) => e.stopPropagation()}
                      className="w-full mt-2 px-3 py-2 text-sm rounded-lg focus:outline-none focus:ring-2"
                      style={{
                        backgroundColor: 'var(--color-background)',
                        border: '1px solid var(--color-border)',
                        color: 'var(--color-text-primary)',
                      }}
                    />
                  )}
                </RadioCard>

                <RadioCard
                  selected={s.orgAction === 'create'}
                  onClick={() => update({ orgAction: 'create', orgError: null })}
                >
                  <h3
                    className="text-sm font-semibold"
                    style={{ color: 'var(--color-text-primary)' }}
                  >
                    {t('onboarding.org.createTitle', 'Créer une organisation')}
                  </h3>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
                    {t('onboarding.org.createDesc', 'Vous en devenez le propriétaire.')}
                  </p>
                  {s.orgAction === 'create' && (
                    <input
                      type="text"
                      value={s.orgName}
                      onChange={(e) => update({ orgName: e.target.value, orgError: null })}
                      placeholder={t('onboarding.org.namePlaceholder', "Nom de l'organisation")}
                      autoFocus
                      maxLength={100}
                      onClick={(e) => e.stopPropagation()}
                      className="w-full mt-2 px-3 py-2 text-sm rounded-lg focus:outline-none focus:ring-2"
                      style={{
                        backgroundColor: 'var(--color-background)',
                        border: '1px solid var(--color-border)',
                        color: 'var(--color-text-primary)',
                      }}
                    />
                  )}
                </RadioCard>
              </div>

              {s.orgError && (
                <p className="text-xs mt-3" style={{ color: '#ef4444' }}>
                  {s.orgError}
                </p>
              )}

              <div className="flex items-center justify-between mt-6">
                <button
                  type="button"
                  onClick={() => {
                    const profileIndex = steps.indexOf('profile');
                    update({
                      orgAction: null,
                      orgError: null,
                      joinedOrgId: null,
                      stepIndex: profileIndex >= 0 ? profileIndex : s.stepIndex + 1,
                    });
                  }}
                  className="text-sm"
                  style={{
                    color: 'var(--color-text-tertiary)',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    textDecoration: 'underline',
                  }}
                >
                  {t('onboarding.org.skip', "Passer pour l'instant")}
                </button>
                <button
                  type="button"
                  disabled={
                    s.orgWorking ||
                    (s.orgAction === 'join'
                      ? !s.orgInviteToken.trim()
                      : s.orgAction === 'create'
                        ? !s.orgName.trim()
                        : true)
                  }
                  onClick={async () => {
                    if (!s.orgAction) return;
                    update({ orgWorking: true, orgError: null });
                    const ipc = window.electron?.ipcRenderer;
                    const profileIndex = steps.indexOf('profile');
                    const nextIndex = profileIndex >= 0 ? profileIndex : s.stepIndex + 1;
                    try {
                      if (s.orgAction === 'join') {
                        const res = await ipc?.invoke(
                          'org:acceptInvitation',
                          s.orgInviteToken.trim()
                        );
                        if (!res?.success) throw new Error(res?.error || 'join_failed');
                        update({
                          joinedOrgId: res.data?.orgId ?? null,
                          orgWorking: false,
                          stepIndex: nextIndex,
                        });
                      } else {
                        const res = await ipc?.invoke('org:create', s.orgName.trim());
                        if (!res?.success) throw new Error(res?.error || 'create_failed');
                        update({
                          joinedOrgId: res.data?.org?.id ?? null,
                          orgWorking: false,
                          stepIndex: nextIndex,
                        });
                      }
                    } catch {
                      update({
                        orgWorking: false,
                        orgError: t(
                          'onboarding.org.error',
                          'Impossible de traiter la demande. Vérifiez le code ou le nom, puis réessayez.'
                        ),
                      });
                    }
                  }}
                  className="px-4 py-2 text-sm rounded-lg font-medium"
                  style={{
                    backgroundColor:
                      !s.orgWorking &&
                      ((s.orgAction === 'join' && s.orgInviteToken.trim()) ||
                        (s.orgAction === 'create' && s.orgName.trim()))
                        ? 'var(--color-primary-600)'
                        : 'var(--color-background-secondary)',
                    color:
                      !s.orgWorking &&
                      ((s.orgAction === 'join' && s.orgInviteToken.trim()) ||
                        (s.orgAction === 'create' && s.orgName.trim()))
                        ? '#fff'
                        : 'var(--color-text-tertiary)',
                    border: 'none',
                    cursor: s.orgWorking ? 'wait' : 'pointer',
                  }}
                >
                  {s.orgWorking
                    ? t('onboarding.org.working', 'Traitement...')
                    : t('onboarding.org.continue', 'Continuer')}
                </button>
              </div>
            </div>
          )}

          {/* ======== Step: Welcome (local flow) ======== */}
          {currentStep === 'welcome' && (
            <div className="text-center">
              <div className="mx-auto mb-6">
                <FilarrLogo size={80} />
              </div>
              <h1
                className="text-2xl font-bold mb-2"
                style={{ color: 'var(--color-text-primary)' }}
              >
                {t('onboarding.welcomeTitle', 'Bienvenue sur Filarr !')}
              </h1>
              <p className="mb-5" style={{ color: 'var(--color-text-secondary)' }}>
                {t(
                  'onboarding.welcomeSubtitle',
                  'Votre gestionnaire de fichiers securise et prive.'
                )}
              </p>
              <div className="space-y-2 text-left">
                <Bullet
                  icon={
                    <svg
                      className="w-5 h-5"
                      style={{ color: '#10b981' }}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z"
                      />
                    </svg>
                  }
                  text={t(
                    'onboarding.welcomeBullet1',
                    'Chiffrement AES-256 — vos fichiers sont proteges'
                  )}
                />
                <Bullet
                  icon={
                    <svg
                      className="w-5 h-5"
                      style={{ color: '#3b82f6' }}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M10.5 1.5H8.25A2.25 2.25 0 006 3.75v16.5a2.25 2.25 0 002.25 2.25h7.5A2.25 2.25 0 0018 20.25V3.75a2.25 2.25 0 00-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3"
                      />
                    </svg>
                  }
                  text={t(
                    'onboarding.welcomeBullet2',
                    '100% local — rien ne quitte votre appareil'
                  )}
                />
                <Bullet
                  icon={
                    <svg
                      className="w-5 h-5"
                      style={{ color: '#8b5cf6' }}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z"
                      />
                    </svg>
                  }
                  text={t(
                    'onboarding.welcomeBullet3',
                    'Multi-profils — chaque utilisateur a son espace'
                  )}
                />
              </div>

              {/* Language quick-switch on welcome page */}
              <div className="flex items-center justify-center gap-2 mt-4">
                <button
                  onClick={() => {
                    update({ language: 'fr' });
                    i18n.changeLanguage('fr');
                  }}
                  className="px-3 py-1 text-sm rounded-lg transition-all"
                  style={{
                    border: '1px solid var(--color-border)',
                    background: s.language === 'fr' ? 'var(--color-primary-50)' : 'transparent',
                    fontWeight: s.language === 'fr' ? 600 : 400,
                    color: 'var(--color-text-primary)',
                    cursor: 'pointer',
                  }}
                >
                  🇫🇷 Français
                </button>
                <button
                  onClick={() => {
                    update({ language: 'en' });
                    i18n.changeLanguage('en');
                  }}
                  className="px-3 py-1 text-sm rounded-lg transition-all"
                  style={{
                    border: '1px solid var(--color-border)',
                    background: s.language === 'en' ? 'var(--color-primary-50)' : 'transparent',
                    fontWeight: s.language === 'en' ? 600 : 400,
                    color: 'var(--color-text-primary)',
                    cursor: 'pointer',
                  }}
                >
                  🇬🇧 English
                </button>
              </div>
            </div>
          )}

          {/* ======== Step: Profile ======== */}
          {currentStep === 'profile' && (
            <div>
              <h2 className="text-xl font-bold mb-1" style={{ color: 'var(--color-text-primary)' }}>
                {t('onboarding.profileTitle', 'Configurez votre profil')}
              </h2>
              <p className="text-sm mb-5" style={{ color: 'var(--color-text-secondary)' }}>
                {isEnterpriseSpace
                  ? t('onboarding.profileSubtitleOrg')
                  : t(
                      'onboarding.profileSubtitle',
                      'Choisissez un nom et une couleur pour votre avatar.'
                    )}
              </p>

              {/* Name */}
              <div className="mb-4">
                <label
                  className="block text-sm font-medium mb-1.5"
                  style={{ color: 'var(--color-text-primary)' }}
                >
                  {t('onboarding.nameLabel', 'Votre nom')}
                </label>
                <input
                  type="text"
                  value={s.name}
                  onChange={(e) => update({ name: e.target.value })}
                  placeholder={t('onboarding.namePlaceholder', 'Entrez votre nom')}
                  className="w-full px-4 py-2.5 rounded-lg focus:outline-none focus:ring-2"
                  style={{
                    backgroundColor: 'var(--color-background)',
                    border: '1px solid var(--color-border)',
                    color: 'var(--color-text-primary)',
                  }}
                  autoFocus
                  maxLength={50}
                />
              </div>

              {/* Avatar color */}
              <div className="mb-4">
                <label
                  className="block text-sm font-medium mb-1.5"
                  style={{ color: 'var(--color-text-primary)' }}
                >
                  {t('onboarding.colorLabel', "Couleur de l'avatar")}
                </label>
                <div className="flex flex-wrap gap-2">
                  {AVATAR_COLORS.map((color) => (
                    <button
                      key={color}
                      onClick={() => update({ avatarColor: color })}
                      className="w-9 h-9 rounded-full border-2 transition-all flex items-center justify-center"
                      style={{
                        backgroundColor: color,
                        borderColor:
                          s.avatarColor === color ? 'var(--color-primary-600)' : 'transparent',
                        transform: s.avatarColor === color ? 'scale(1.15)' : 'scale(1)',
                      }}
                    >
                      {s.avatarColor === color && (
                        <svg
                          className="w-4 h-4 text-white"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={3}
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M4.5 12.75l6 6 9-13.5"
                          />
                        </svg>
                      )}
                    </button>
                  ))}
                </div>
                <div className="mt-3 flex items-center gap-3">
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold"
                    style={{ background: avatarGradient(s.avatarColor) }}
                  >
                    {(s.name.trim() || 'U').charAt(0).toUpperCase()}
                  </div>
                  <span
                    className="font-medium text-sm"
                    style={{ color: 'var(--color-text-primary)' }}
                  >
                    {s.name.trim() || 'User'}
                  </span>
                </div>
              </div>

              {/* PIN toggle */}
              <div
                className="rounded-lg p-3"
                style={{
                  backgroundColor: 'var(--color-background-secondary)',
                  border: '1px solid var(--color-border)',
                }}
              >
                <label className="flex items-center justify-between cursor-pointer">
                  <span
                    className="text-sm font-medium"
                    style={{ color: 'var(--color-text-primary)' }}
                  >
                    {t('onboarding.pinToggle', 'Proteger ce profil avec un PIN')}
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={s.pinEnabled}
                    onClick={() => update({ pinEnabled: !s.pinEnabled, pin: '', pinConfirm: '' })}
                    className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors ${s.pinEnabled ? 'bg-[var(--color-primary-500)]' : 'bg-[var(--color-neutral-300)]'}`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${s.pinEnabled ? 'translate-x-5' : 'translate-x-0'}`}
                    />
                  </button>
                </label>
                {s.pinEnabled && (
                  <div className="mt-3 space-y-2">
                    <input
                      type="password"
                      inputMode="numeric"
                      maxLength={6}
                      value={s.pin}
                      onChange={(e) => update({ pin: e.target.value.replace(/\D/g, '') })}
                      placeholder={t('onboarding.pinLabel', 'Code PIN (4-6 chiffres)')}
                      className="w-full px-3 py-2 text-sm rounded-lg focus:outline-none focus:ring-2"
                      style={{
                        backgroundColor: 'var(--color-background)',
                        border: '1px solid var(--color-border)',
                        color: 'var(--color-text-primary)',
                      }}
                    />
                    <input
                      type="password"
                      inputMode="numeric"
                      maxLength={6}
                      value={s.pinConfirm}
                      onChange={(e) => update({ pinConfirm: e.target.value.replace(/\D/g, '') })}
                      placeholder={t('onboarding.pinConfirmLabel', 'Confirmer le PIN')}
                      className="w-full px-3 py-2 text-sm rounded-lg focus:outline-none focus:ring-2"
                      style={{
                        backgroundColor: 'var(--color-background)',
                        border: '1px solid var(--color-border)',
                        color: 'var(--color-text-primary)',
                      }}
                    />
                    {s.pin.length >= 4 && s.pinConfirm.length >= 4 && s.pin !== s.pinConfirm && (
                      <p className="text-xs text-red-500">
                        {t('onboarding.pinMismatch', 'Les PINs ne correspondent pas')}
                      </p>
                    )}
                    <label className="flex items-center gap-2 mt-1">
                      <input
                        type="checkbox"
                        checked={s.allowPinReset}
                        onChange={(e) => update({ allowPinReset: e.target.checked })}
                        className="accent-[var(--color-primary-600)]"
                      />
                      <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                        {t('onboarding.pinResetToggle', 'Autoriser la reinitialisation du PIN')}
                      </span>
                    </label>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ======== Step 4: Appearance ======== */}
          {currentStep === 'appearance' && (
            <div>
              <h2 className="text-xl font-bold mb-1" style={{ color: 'var(--color-text-primary)' }}>
                {t('onboarding.appearanceTitle', "Personnalisez l'apparence")}
              </h2>
              <p className="text-sm mb-5" style={{ color: 'var(--color-text-secondary)' }}>
                {t('onboarding.appearanceSubtitle', "Choisissez un theme et une couleur d'accent.")}
              </p>

              {/*
                DEUX CRAINTES OPPOSÉES, ET IL FAUT RÉPONDRE AUX DEUX.
                Celui qui arrive par la porte entreprise se demande d'abord si
                son employeur voit ce qu'il range ici — non — puis s'étonnera,
                si l'organisation impose un thème, de voir son choix ignoré. La
                politique de poste de travail peut effectivement verrouiller le
                thème : autant l'annoncer pendant qu'on choisit plutôt que de
                laisser constater l'écrasement au premier démarrage.
              */}
              {isEnterpriseSpace && (
                <div
                  className="p-3 rounded-lg mb-5 text-xs"
                  style={{
                    backgroundColor: 'color-mix(in srgb, var(--color-info-500) 9%, transparent)',
                    border: '1px solid color-mix(in srgb, var(--color-info-500) 26%, transparent)',
                    color: 'var(--color-text-secondary)',
                    lineHeight: 'var(--line-height-relaxed)',
                  }}
                >
                  {t('onboarding.appearanceOrgNote')}
                </div>
              )}

              {/* Theme */}
              <div className="grid grid-cols-3 gap-2 mb-5">
                {[
                  {
                    id: 'light' as const,
                    label: t('onboarding.lightTheme', 'Clair'),
                    bg: '#FFFFFF',
                    sidebar: '#F8FAFC',
                    accent: '#E2E8F0',
                    text: '#334155',
                  },
                  {
                    id: 'dark' as const,
                    label: t('onboarding.darkTheme', 'Sombre'),
                    bg: '#0A0E1A',
                    sidebar: '#10141F',
                    accent: '#2A3142',
                    text: '#B8C5D6',
                  },
                  {
                    id: 'space' as const,
                    label: t('onboarding.spaceTheme', 'Espace'),
                    bg: '#0B0D1A',
                    sidebar: '#111425',
                    accent: '#2A2D4A',
                    text: '#A89FC0',
                  },
                  {
                    id: 'lofi' as const,
                    label: t('onboarding.lofiTheme', 'Lofi'),
                    bg: '#F5F0E8',
                    sidebar: '#EDE6D9',
                    accent: '#D4C9B8',
                    text: '#6B5D4F',
                  },
                  {
                    id: 'sky' as const,
                    label: t('onboarding.skyTheme', 'Ciel'),
                    bg: '#F0F7FF',
                    sidebar: '#E6F1FC',
                    accent: '#B8D4F0',
                    text: '#3E6890',
                  },
                  {
                    id: 'aurora' as const,
                    label: t('onboarding.auroraTheme', 'Aurora'),
                    bg: '#0B1120',
                    sidebar: '#111B2E',
                    accent: '#22D3A0',
                    text: '#94A3B8',
                  },
                  {
                    id: 'sakura' as const,
                    label: t('onboarding.sakuraTheme', 'Sakura'),
                    bg: '#FFF8F9',
                    sidebar: '#FFF0F3',
                    accent: '#F2C4CF',
                    text: '#7A4A60',
                  },
                  {
                    id: 'crepuscule' as const,
                    label: t('onboarding.crepusculeTheme', 'Crépuscule'),
                    bg: '#1A1018',
                    sidebar: '#221620',
                    accent: '#E8845C',
                    text: '#B89A98',
                  },
                  {
                    id: 'foret' as const,
                    label: t('onboarding.foretTheme', 'Forêt'),
                    bg: '#0F1D15',
                    sidebar: '#15271C',
                    accent: '#6BBE7D',
                    text: '#A0BCA4',
                  },
                  {
                    id: 'system' as const,
                    label: t('onboarding.systemTheme', 'Système'),
                    bg: '',
                    sidebar: '',
                    accent: '',
                    text: '',
                  },
                ].map((theme) => (
                  <button
                    key={theme.id}
                    onClick={() => {
                      update({ themeChoice: theme.id });
                      // Apply theme immediately so the user sees the change
                      const resolved = theme.id === 'system' ? detectSystemTheme() : theme.id;
                      document.documentElement.setAttribute('data-theme', resolved);
                    }}
                    className="flex flex-col items-center gap-1.5 p-2 rounded-xl border-2 transition-all"
                    style={{
                      borderColor:
                        s.themeChoice === theme.id
                          ? 'var(--color-primary-600)'
                          : 'var(--color-border-light, var(--color-border))',
                      backgroundColor:
                        s.themeChoice === theme.id ? 'var(--color-primary-50)' : 'transparent',
                      cursor: 'pointer',
                    }}
                  >
                    {/* Mini preview */}
                    <div
                      className="w-full rounded-lg overflow-hidden border"
                      style={{
                        height: 36,
                        display: 'flex',
                        borderColor: theme.id === 'system' ? '#CBD5E1' : theme.accent,
                      }}
                    >
                      {theme.id === 'system' ? (
                        <>
                          <div className="flex-1" style={{ background: '#FFFFFF', padding: 6 }}>
                            <div
                              style={{
                                height: 4,
                                width: 16,
                                background: '#E2E8F0',
                                borderRadius: 2,
                              }}
                            />
                          </div>
                          <div className="flex-1" style={{ background: '#0A0E1A', padding: 6 }}>
                            <div
                              style={{
                                height: 4,
                                width: 16,
                                background: '#2A3142',
                                borderRadius: 2,
                              }}
                            />
                          </div>
                        </>
                      ) : (
                        <div className="flex-1 flex" style={{ background: theme.bg }}>
                          <div
                            style={{
                              width: '30%',
                              background: theme.sidebar,
                              borderRight: `1px solid ${theme.accent}`,
                            }}
                          />
                          <div style={{ flex: 1, padding: 6 }}>
                            <div
                              style={{
                                height: 3,
                                width: '60%',
                                background: theme.text,
                                borderRadius: 2,
                                opacity: 0.3,
                                marginBottom: 3,
                              }}
                            />
                            <div
                              style={{
                                height: 3,
                                width: '40%',
                                background: theme.text,
                                borderRadius: 2,
                                opacity: 0.15,
                              }}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                    <span
                      className="text-xs font-medium"
                      style={{ color: 'var(--color-text-primary)' }}
                    >
                      {theme.label}
                    </span>
                  </button>
                ))}
              </div>

              {/* Accent color */}
              <label
                className="block text-sm font-medium mb-2"
                style={{ color: 'var(--color-text-primary)' }}
              >
                {t('onboarding.accentColorLabel', "Couleur d'accent")}
              </label>
              <div className="flex flex-wrap gap-2.5">
                {PRESET_ACCENT_COLORS.map((c) => (
                  <button
                    key={c.value}
                    onClick={() => {
                      update({ accentColor: c.value });
                      applyAccentColorPalette(c.value);
                    }}
                    className={`w-8 h-8 rounded-full transition-all hover:scale-110 ${s.accentColor === c.value ? 'ring-2 ring-offset-2 ring-[var(--color-text-primary)] scale-110' : ''}`}
                    style={{ backgroundColor: c.value }}
                    title={c.name}
                  >
                    {s.accentColor === c.value && (
                      <span className="flex items-center justify-center text-white">
                        <svg
                          width="12"
                          height="12"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={3}
                        >
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ======== Step 5: Use Case ======== */}
          {currentStep === 'usecase' && (
            <div>
              <h2 className="text-xl font-bold mb-1" style={{ color: 'var(--color-text-primary)' }}>
                {t('onboarding.useCaseTitle', 'Comment utiliserez-vous Filarr ?')}
              </h2>
              <p className="text-sm mb-5" style={{ color: 'var(--color-text-secondary)' }}>
                {t('onboarding.useCaseSubtitle', 'Nous creerons des dossiers et tags adaptes.')}
              </p>
              <div className="onboarding-usecase-grid">
                {USE_CASE_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    onClick={() => update({ useCase: opt.id })}
                    className={`onboarding-usecase-card ${s.useCase === opt.id ? 'is-selected' : ''}`}
                  >
                    <div className="onboarding-usecase-card__icon">{opt.icon}</div>
                    <p className="onboarding-usecase-card__title">{t(opt.titleKey)}</p>
                    <p className="onboarding-usecase-card__desc">{t(opt.descriptionKey)}</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ======== Step 6: Discovery ======== */}
          {currentStep === 'discovery' && (
            <div>
              <h2 className="text-xl font-bold mb-1" style={{ color: 'var(--color-text-primary)' }}>
                {t('onboarding.discoveryTitle', 'Decouvrez Filarr')}
              </h2>
              <p className="text-sm mb-5" style={{ color: 'var(--color-text-secondary)' }}>
                {t(
                  'onboarding.discoverySubtitle',
                  'Quatre espaces pour organiser votre vie numerique.'
                )}
              </p>
              <div className="grid grid-cols-2 gap-3">
                {DISCOVERY_AREAS.map((area, i) => (
                  <div
                    key={i}
                    className="p-4 rounded-xl"
                    style={{
                      backgroundColor: 'var(--color-background-secondary)',
                      border: '1px solid var(--color-border)',
                    }}
                  >
                    <span className="text-2xl block mb-2">{area.icon}</span>
                    <p
                      className="text-sm font-semibold mb-0.5"
                      style={{ color: 'var(--color-text-primary)' }}
                    >
                      {t(area.titleKey)}
                    </p>
                    <p
                      className="text-xs leading-relaxed"
                      style={{ color: 'var(--color-text-tertiary)' }}
                    >
                      {t(area.descriptionKey)}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ======== Step: Security ======== */}
          {currentStep === 'security' && (
            <div>
              {/* Cloud mode: extra vault warning */}
              {s.mode === 'cloud' && (
                <div
                  className="flex items-start gap-2 p-3 rounded-lg mb-4 text-sm"
                  style={{
                    backgroundColor: '#fef2f2',
                    border: '1px solid #fca5a5',
                    color: '#991b1b',
                  }}
                >
                  <span className="flex-shrink-0 text-base">&#9888;&#65039;</span>
                  <span>
                    {t(
                      'onboarding.cloud.vault.warning',
                      "Ce mot de passe chiffre vos fichiers localement. Il est différent de votre mot de passe de compte. S'il est perdu, vos fichiers sont définitivement inaccessibles — même nous ne pouvons pas les déchiffrer."
                    )}
                  </span>
                </div>
              )}
              <div className="flex items-center gap-3 mb-4">
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#ef4444"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
                  />
                </svg>
                <div>
                  <h2 className="text-lg font-bold" style={{ color: 'var(--color-text-primary)' }}>
                    {t('onboarding.securityTitle', 'Sécurité & chiffrement')}
                  </h2>
                  <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                    {t('onboarding.securitySubtitle', 'À lire attentivement avant de continuer.')}
                  </p>
                </div>
              </div>
              <div
                className="rounded-xl p-4 mb-4"
                style={{
                  backgroundColor: 'rgba(239,68,68,0.06)',
                  border: '1px solid rgba(239,68,68,0.2)',
                }}
              >
                <p className="text-sm font-semibold mb-1" style={{ color: '#ef4444' }}>
                  {t(
                    'onboarding.securityWarningTitle',
                    'Votre mot de passe est la clé de vos fichiers'
                  )}
                </p>
                <p
                  className="text-sm leading-relaxed mb-2"
                  style={{ color: 'var(--color-text-secondary)' }}
                >
                  {t('onboarding.securityWarningText')}
                </p>
                <ul className="m-0 pl-4" style={{ listStyleType: 'disc' }}>
                  <li className="text-sm mb-0.5" style={{ color: 'var(--color-text-secondary)' }}>
                    {t('onboarding.securityTip1')}
                  </li>
                  <li className="text-sm mb-0.5" style={{ color: 'var(--color-text-secondary)' }}>
                    {t('onboarding.securityTip2')}
                  </li>
                  <li className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                    {t('onboarding.securityTip3')}
                  </li>
                </ul>
              </div>
              {/* Master encryption password */}
              <div
                className="rounded-xl p-4 mb-4"
                style={{
                  backgroundColor: 'var(--color-background-secondary)',
                  border: '1px solid var(--color-border)',
                }}
              >
                <p
                  className="text-sm font-semibold mb-1"
                  style={{ color: 'var(--color-text-primary)' }}
                >
                  {t('onboarding.encryptionPasswordTitle', 'Mot de passe de chiffrement')}
                </p>
                <p className="text-sm mb-3" style={{ color: 'var(--color-text-secondary)' }}>
                  {t(
                    'onboarding.encryptionPasswordDesc',
                    'Ce mot de passe protege vos fichiers. 8 caracteres minimum. Il est different de votre PIN de profil.'
                  )}
                </p>
                <input
                  type="password"
                  value={s.encryptionPassword}
                  onChange={(e) => {
                    update({ encryptionPassword: e.target.value });
                    // Generate recovery phrase on first password entry
                    if (e.target.value.length >= 8 && !s.recoveryPhrase) {
                      update({ recoveryPhrase: generateRecoveryPhrase() });
                    }
                  }}
                  placeholder={t(
                    'onboarding.encryptionPasswordPlaceholder',
                    'Mot de passe (8+ caracteres)'
                  )}
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
                  value={s.encryptionPasswordConfirm}
                  onChange={(e) => update({ encryptionPasswordConfirm: e.target.value })}
                  placeholder={t(
                    'onboarding.encryptionPasswordConfirm',
                    'Confirmer le mot de passe'
                  )}
                  className="w-full px-3 py-2 rounded-lg text-sm"
                  style={{
                    backgroundColor: 'var(--color-background)',
                    border: `1px solid ${s.encryptionPasswordConfirm && s.encryptionPassword !== s.encryptionPasswordConfirm ? '#ef4444' : 'var(--color-border)'}`,
                    color: 'var(--color-text-primary)',
                    outline: 'none',
                  }}
                />
                {s.encryptionPasswordConfirm &&
                  s.encryptionPassword !== s.encryptionPasswordConfirm && (
                    <p className="text-xs mt-1" style={{ color: '#ef4444' }}>
                      {t('onboarding.passwordMismatch', 'Les mots de passe ne correspondent pas')}
                    </p>
                  )}
              </div>

              {/* Recovery phrase — local mode only (cloud uses BIP-39 codes from registration) */}
              {s.mode !== 'cloud' && s.recoveryPhrase && (
                <div
                  className="rounded-xl p-4 mb-4"
                  style={{
                    backgroundColor: 'rgba(251,191,36,0.06)',
                    border: '1px solid rgba(251,191,36,0.3)',
                  }}
                >
                  <p className="text-sm font-semibold mb-1" style={{ color: '#d97706' }}>
                    {t('onboarding.recoveryPhraseTitle', 'Phrase de récupération')}
                  </p>
                  <p className="text-sm mb-3" style={{ color: 'var(--color-text-secondary)' }}>
                    {t(
                      'onboarding.recoveryPhraseDesc',
                      'Notez ces 12 mots dans un endroit sûr. Ils permettent de récupérer vos données si vous oubliez votre mot de passe.'
                    )}
                  </p>
                  <div
                    className="grid grid-cols-4 gap-2 p-3 rounded-lg mb-3 font-mono text-sm"
                    style={{
                      backgroundColor: 'var(--color-background)',
                      border: '1px solid var(--color-border)',
                    }}
                  >
                    {s.recoveryPhrase.split(' ').map((word, i) => (
                      <span key={i} style={{ color: 'var(--color-text-primary)' }}>
                        <span style={{ color: 'var(--color-text-tertiary)', fontSize: '0.7em' }}>
                          {i + 1}.{' '}
                        </span>
                        {word}
                      </span>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg"
                      style={{
                        backgroundColor:
                          s.finishError === '__copied__'
                            ? 'var(--color-success-50, rgba(34,197,94,0.1))'
                            : 'var(--color-background)',
                        border:
                          s.finishError === '__copied__'
                            ? '1px solid var(--color-success-400, #4ade80)'
                            : '1px solid var(--color-border)',
                        color:
                          s.finishError === '__copied__'
                            ? 'var(--color-success-700, #15803d)'
                            : 'var(--color-text-primary)',
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                        whiteSpace: 'nowrap',
                        flexShrink: 0,
                      }}
                      onClick={() => {
                        navigator.clipboard.writeText(s.recoveryPhrase);
                        update({ finishError: '__copied__' });
                        setTimeout(() => update({ finishError: null }), 2000);
                      }}
                    >
                      {s.finishError === '__copied__' ? (
                        <>
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={2.5}
                          >
                            <polyline points="20,6 9,17 4,12" />
                          </svg>
                          {t('common.copied', 'Copié !')}
                        </>
                      ) : (
                        <>
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={2}
                          >
                            <rect x="9" y="9" width="13" height="13" rx="2" />
                            <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                          </svg>
                          {t('onboarding.copyPhrase', 'Copier')}
                        </>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => update({ recoveryPhraseSaved: !s.recoveryPhraseSaved })}
                      className="flex items-center gap-2 text-sm px-3 py-2 rounded-lg"
                      style={{
                        flex: 1,
                        backgroundColor: s.recoveryPhraseSaved
                          ? 'rgba(251,191,36,0.1)'
                          : 'var(--color-background)',
                        border: s.recoveryPhraseSaved
                          ? '1px solid #d97706'
                          : '1px solid var(--color-border)',
                        color: s.recoveryPhraseSaved ? '#92400e' : 'var(--color-text-primary)',
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                        fontWeight: 500,
                      }}
                    >
                      <div
                        style={{
                          width: 18,
                          height: 18,
                          borderRadius: 4,
                          border: s.recoveryPhraseSaved
                            ? 'none'
                            : '2px solid var(--color-text-tertiary)',
                          backgroundColor: s.recoveryPhraseSaved ? '#d97706' : 'transparent',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                          transition: 'all 0.2s',
                        }}
                      >
                        {s.recoveryPhraseSaved && (
                          <svg
                            width="12"
                            height="12"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="white"
                            strokeWidth={3}
                          >
                            <polyline points="20,6 9,17 4,12" />
                          </svg>
                        )}
                      </div>
                      {t('onboarding.recoveryPhraseSaved', "J'ai noté ma phrase de récupération")}
                    </button>
                  </div>
                </div>
              )}

              <button
                type="button"
                onClick={() => update({ securityAcknowledged: !s.securityAcknowledged })}
                className="onboarding-acknowledge-btn"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  width: '100%',
                  padding: '14px 16px',
                  borderRadius: 12,
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'all 0.2s',
                  border: s.securityAcknowledged
                    ? '2px solid var(--color-primary-500)'
                    : '2px dashed var(--color-text-tertiary, #94a3b8)',
                  backgroundColor: s.securityAcknowledged
                    ? 'var(--color-primary-50)'
                    : 'transparent',
                  animation: !s.securityAcknowledged
                    ? 'acknowledge-pulse 2s ease-in-out infinite'
                    : 'none',
                }}
              >
                <div
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 6,
                    border: s.securityAcknowledged
                      ? 'none'
                      : '2px solid var(--color-text-tertiary, #94a3b8)',
                    backgroundColor: s.securityAcknowledged
                      ? 'var(--color-primary-500, #4682b4)'
                      : 'transparent',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    transition: 'all 0.2s',
                  }}
                >
                  {s.securityAcknowledged && (
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="white"
                      strokeWidth={3}
                    >
                      <polyline points="20,6 9,17 4,12" />
                    </svg>
                  )}
                </div>
                <div style={{ flex: 1 }}>
                  <span
                    style={{
                      display: 'block',
                      fontSize: '0.875rem',
                      fontWeight: 600,
                      color: s.securityAcknowledged
                        ? 'var(--color-primary-700, #36648b)'
                        : 'var(--color-text-primary)',
                    }}
                  >
                    {t('onboarding.securityAcknowledge', "J'ai compris et j'accepte")}
                  </span>
                  <span
                    style={{
                      display: 'block',
                      fontSize: '0.6875rem',
                      color: 'var(--color-text-secondary)',
                      marginTop: 2,
                    }}
                  >
                    {t(
                      'onboarding.securityAcknowledgeDetail',
                      'En cas de perte de mon mot de passe, mes fichiers chiffrés seront irrécupérables.'
                    )}
                  </span>
                </div>
                {!s.securityAcknowledged && (
                  <span
                    style={{
                      fontSize: '0.6875rem',
                      color: 'var(--color-text-tertiary)',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {t('onboarding.clickToAccept', 'Cliquez pour accepter')}
                  </span>
                )}
              </button>
            </div>
          )}

          {/* ======== Step 8: Ready ======== */}
          {currentStep === 'ready' && (
            <div className="text-center">
              <div
                className="w-20 h-20 mx-auto mb-5 rounded-2xl flex items-center justify-center"
                style={{ backgroundColor: 'rgba(34,197,94,0.1)' }}
              >
                <svg
                  className="w-10 h-10"
                  style={{ color: '#22c55e' }}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              </div>
              <h2 className="text-xl font-bold mb-2" style={{ color: 'var(--color-text-primary)' }}>
                {s.spaceType === 'enterprise' && s.orgName
                  ? t('onboarding.entReady.title', '{{org}} est prêt', { org: s.orgName })
                  : t('onboarding.readyTitle', 'Tout est pret !')}
              </h2>
              <p className="text-sm mb-5" style={{ color: 'var(--color-text-secondary)' }}>
                {s.spaceType === 'enterprise'
                  ? t('onboarding.entReady.subtitle', 'Voici ce qui reste à faire, dans cet ordre.')
                  : s.isSecondaryDevice
                    ? t(
                        'onboarding.readyRecapLogin',
                        'Votre compte est reconnu. Vos profils vont etre restaures.'
                      )
                    : t('onboarding.readyRecap', 'Voici un resume de vos choix :')}
              </p>

              {/*
                LA FIN DU PARCOURS ENTREPRISE N'EST PAS UNE FÉLICITATION.
                C'est un ordre de marche, le même que celui du Guide de la
                console, avec la seule conséquence irréversible du produit posée
                à sa place : la clé d'organisation ne rattrape pas les coffres
                déjà scellés. Un « bienvenue » laisserait l'administrateur le
                découvrir trop tard, quand un membre aura perdu son mot de passe.
              */}
              {s.spaceType === 'enterprise' && (
                <div className="text-left mb-5 space-y-3">
                  {[
                    {
                      n: '1',
                      t: t('onboarding.entReady.s1', 'Souscrire l’abonnement'),
                      d: t(
                        'onboarding.entReady.s1d',
                        'Sans lui, ni invitations ni coffres d’équipe. Minimum trois sièges, les lecteurs sont gratuits.'
                      ),
                    },
                    {
                      n: '2',
                      t: t('onboarding.entReady.s2', 'Créer la clé de l’organisation'),
                      d: t(
                        'onboarding.entReady.s2d',
                        'Avant d’inviter : elle ne rattrape pas les coffres déjà scellés.'
                      ),
                    },
                    {
                      n: '3',
                      t: t('onboarding.entReady.s3', 'Inviter votre équipe'),
                      d: t(
                        'onboarding.entReady.s3d',
                        'Chaque invitation porte un rôle. Les lecteurs ne consomment pas de siège.'
                      ),
                    },
                  ].map((step) => (
                    <div key={step.n} className="flex gap-3 items-start">
                      <span
                        className="flex-shrink-0 w-7 h-7 rounded-full inline-flex items-center justify-center text-xs font-semibold"
                        style={{
                          border: '2px solid var(--color-border)',
                          color: 'var(--color-text-tertiary)',
                        }}
                      >
                        {step.n}
                      </span>
                      <div className="min-w-0">
                        <div
                          className="text-sm font-semibold"
                          style={{ color: 'var(--color-text-primary)' }}
                        >
                          {step.t}
                        </div>
                        <p
                          className="text-xs mt-0.5"
                          style={{ color: 'var(--color-text-secondary)' }}
                        >
                          {step.d}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/**
               * UNE CONNEXION N'A RIEN À RÉCAPITULER.
               *
               * Le parcours d'un compte déjà inscrit (`CLOUD_PAIRING_STEPS`) saute
               * délibérément « profil » et « apparence » : ces choix appartiennent au
               * compte, et `handleFinish` les rapatrie du nuage (`restoreCloudProfiles`
               * puis `landingForAccount`). Ce bloc les affichait quand même, en lisant
               * l'état initial que personne n'avait rempli : un profil « User » à
               * pastille bleue, un thème « Clair » et un accent que cette branche
               * n'applique même pas — elle rend la main avant, par son propre `return`.
               *
               * Trois lignes annoncées, trois promesses qu'on ne tient pas, dont un nom
               * de profil qui n'est pas celui qui va s'ouvrir. On montre donc le compte,
               * la seule chose que cette étape connaisse vraiment.
               */}
              <div className="text-left space-y-2 mb-4">
                {s.isSecondaryDevice ? (
                  s.cloudEmail ? (
                    <div
                      className="flex items-center justify-between px-3 py-2 rounded-lg text-sm"
                      style={{ backgroundColor: 'var(--color-background-secondary)' }}
                    >
                      <span style={{ color: 'var(--color-text-tertiary)' }}>
                        {t('onboarding.recapAccount', 'Compte')}
                      </span>
                      <span
                        className="truncate ml-3"
                        style={{ color: 'var(--color-text-primary)' }}
                      >
                        {s.cloudEmail}
                      </span>
                    </div>
                  ) : null
                ) : (
                  <>
                    <div
                      className="flex items-center justify-between px-3 py-2 rounded-lg text-sm"
                      style={{ backgroundColor: 'var(--color-background-secondary)' }}
                    >
                      <span style={{ color: 'var(--color-text-tertiary)' }}>
                        {t('onboarding.recapProfile', 'Profil')}
                      </span>
                      <div className="flex items-center gap-2">
                        <div
                          className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold"
                          style={{ background: avatarGradient(s.avatarColor) }}
                        >
                          {(s.name.trim() || 'U').charAt(0).toUpperCase()}
                        </div>
                        <span style={{ color: 'var(--color-text-primary)' }}>
                          {s.name.trim() || 'User'}
                        </span>
                      </div>
                    </div>
                    <div
                      className="flex items-center justify-between px-3 py-2 rounded-lg text-sm"
                      style={{ backgroundColor: 'var(--color-background-secondary)' }}
                    >
                      <span style={{ color: 'var(--color-text-tertiary)' }}>
                        {t('onboarding.recapTheme', 'Theme')}
                      </span>
                      <span style={{ color: 'var(--color-text-primary)' }}>
                        {s.themeChoice === 'light'
                          ? t('onboarding.lightTheme')
                          : s.themeChoice === 'dark'
                            ? t('onboarding.darkTheme')
                            : t('onboarding.systemTheme')}
                      </span>
                    </div>
                    <div
                      className="flex items-center justify-between px-3 py-2 rounded-lg text-sm"
                      style={{ backgroundColor: 'var(--color-background-secondary)' }}
                    >
                      <span style={{ color: 'var(--color-text-tertiary)' }}>
                        {t('onboarding.recapAccent', "Couleur d'accent")}
                      </span>
                      <div
                        className="w-5 h-5 rounded-full"
                        style={{ backgroundColor: s.accentColor }}
                      />
                    </div>
                    {s.useCase && (
                      <div
                        className="flex items-center justify-between px-3 py-2 rounded-lg text-sm"
                        style={{ backgroundColor: 'var(--color-background-secondary)' }}
                      >
                        <span style={{ color: 'var(--color-text-tertiary)' }}>
                          {t('onboarding.recapUseCase', 'Usage')}
                        </span>
                        <span style={{ color: 'var(--color-text-primary)' }}>
                          {USE_CASE_OPTIONS.find((o) => o.id === s.useCase)?.icon}{' '}
                          {t(USE_CASE_OPTIONS.find((o) => o.id === s.useCase)?.titleKey || '')}
                        </span>
                      </div>
                    )}
                    {s.pinEnabled && (
                      <div
                        className="flex items-center justify-between px-3 py-2 rounded-lg text-sm"
                        style={{ backgroundColor: 'var(--color-background-secondary)' }}
                      >
                        <span style={{ color: 'var(--color-text-tertiary)' }}>
                          {t('onboarding.recapPin', 'PIN active')}
                        </span>
                        <span style={{ color: '#10b981' }}>✓</span>
                      </div>
                    )}
                  </>
                )}
              </div>

              {s.finishError && (
                <div className="p-3 rounded-lg bg-red-50 border-l-4 border-red-500 text-sm text-red-700 mb-4 text-left">
                  {s.finishError}
                </div>
              )}
            </div>
          )}

          {/* ======== Navigation (hidden on the first 'space' step, the pairing
               step, and the 'org' step — each drives its own advancement; every
               other step, incl. 'choice', shows the footer so Back works). ==== */}
          {currentStep !== 'space' && currentStep !== 'cloud-pairing' && currentStep !== 'org' && (
            <div className="flex justify-between" style={{ marginTop: '1.5rem' }}>
              {s.stepIndex > ENTRY_INDEX ? (
                <button
                  onClick={handleBack}
                  disabled={s.isFinishing}
                  className="px-5 py-2.5 text-sm font-medium transition-colors rounded-lg"
                  style={{ color: 'var(--color-text-secondary)' }}
                >
                  {t('common.back', 'Retour')}
                </button>
              ) : (
                <div />
              )}

              {currentStep === 'ready' ? (
                <button
                  onClick={handleFinish}
                  disabled={s.isFinishing}
                  className="px-6 py-2.5 text-sm font-medium rounded-lg text-white transition-colors flex items-center gap-2"
                  style={{
                    backgroundColor: s.isFinishing
                      ? 'var(--color-neutral-400)'
                      : 'var(--color-primary-600)',
                  }}
                >
                  {s.isFinishing ? (
                    <>
                      <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                        <circle
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                          opacity="0.25"
                        />
                        <path
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                          opacity="0.75"
                        />
                      </svg>
                      {t('onboarding.finishing', 'Création en cours...')}
                    </>
                  ) : (
                    t('onboarding.getStarted', "C'est parti !")
                  )}
                </button>
              ) : (
                <button
                  onClick={handleNext}
                  disabled={!canNext()}
                  className="px-6 py-2.5 text-sm font-medium rounded-lg text-white transition-colors"
                  style={{
                    backgroundColor: canNext()
                      ? 'var(--color-primary-600)'
                      : 'var(--color-neutral-400)',
                    cursor: canNext() ? 'pointer' : 'not-allowed',
                    opacity: canNext() ? 1 : 0.5,
                  }}
                >
                  {t('common.next', 'Suivant')}
                </button>
              )}
            </div>
          )}

          {/* Sortie du mode « ajouter un compte ». Toujours visible, y compris
              sur les étapes qui masquent la navigation (appairage, org) : c'est
              précisément là qu'on peut vouloir renoncer. La session en attente
              est révoquée par l'appelant. */}
          {isAddAccount && onCancel && !s.isFinishing && (
            <div className="flex justify-center" style={{ marginTop: '1rem' }}>
              <button
                onClick={onCancel}
                className="text-sm transition-colors"
                style={{ color: 'var(--color-text-tertiary)' }}
              >
                {t('profiles.backToProfiles', 'Retour aux profils')}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Onboarding;
