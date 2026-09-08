/**
 * Disponibilité de la surface Organisation.
 *
 * ── POURQUOI CE FICHIER A CHANGÉ DE FORME ────────────────────────────────────
 *
 * Il portait un seul booléen, `ENTERPRISE_ACCESSIBLE = false`, et ce booléen
 * fermait TOUT d'un bloc : la carte « Entreprise » du portail de lancement, la
 * console d'organisation, la facturation, les politiques, l'escrow — et, par un
 * ricochet que personne n'avait voulu, l'AFFICHAGE DES COFFRES DE L'ÉQUIPE
 * (`selectSharedVaultOrgIds` ne retenait que les espaces personnels). Une
 * organisation pouvait donc payer un plan Teams sans qu'aucun de ses membres ne
 * voie jamais le moindre coffre d'équipe dans l'application.
 *
 * La raison d'origine du verrou était juste, et elle est conservée ici : derrière
 * cette porte cohabitent des chantiers finis (membres, rôles, facturation, audit,
 * politiques, escrow, coffres d'équipe) et des chantiers qui ne le sont pas (SSO,
 * SCIM, résidence des données). Livrer la moitié d'un SSO est pire que de n'en
 * livrer aucun : le client configure, croit avoir fini, et se retrouve avec une
 * connexion cassée.
 *
 * Ce que ce fichier change, c'est la GRANULARITÉ du verrou, jamais son principe.
 * Un drapeau par fonction remplace le drapeau unique : ce qui est fini s'ouvre,
 * ce qui ne l'est pas garde son étiquette « bientôt » À SA PROPRE PLACE, dans la
 * console, là où l'administrateur la lit au moment où il la cherche — au lieu de
 * faire disparaître neuf fonctions terminées pour en cacher trois.
 *
 * ── L'INTERRUPTEUR MAÎTRE ────────────────────────────────────────────────────
 *
 * `ORG_SURFACE_ENABLED` reste au-dessus de tout : à `false`, la surface entière
 * redevient invisible, exactement comme avant, quels que soient les drapeaux par
 * fonction. C'est le retour arrière d'un seul caractère si une diffusion publique
 * doit précéder la validation.
 */

/**
 * L'interrupteur maître de la surface Organisation.
 *
 * À `false` : le portail de lancement affiche « Prochainement » sur la carte
 * Entreprise, la console est injoignable et aucune fonction d'organisation ne
 * rend — l'état d'avant.
 */
export const ORG_SURFACE_ENABLED = true;

/**
 * Ce qui est RÉELLEMENT livré, fonction par fonction.
 *
 * `true` = écrit, testé côté worker ET côté client, joignable. `false` = le code
 * existe peut-être en partie, mais la fonction n'est pas tenable devant un client :
 * elle rend une pastille « bientôt » plutôt que son écran.
 *
 * Un drapeau ne passe à `true` qu'une fois la fonction éprouvée de bout en bout.
 * C'est la seule règle de ce fichier.
 */
export const ENTERPRISE_FEATURES = {
  /** Vue d'ensemble : cartes de suivi, occupation, activité récente. */
  overview: true,
  /** Membres actifs, changement de rôle, retrait. */
  members: true,
  /** Invitations : émission, relance, révocation. */
  invitations: true,
  /** Coffres d'équipe partagés, chiffrés de bout en bout. */
  teamVaults: true,
  /** Journal d'audit infalsifiable + export CSV + vérification de chaîne. */
  audit: true,
  /** Diffusion SIEM (sinks) + file d'attente d'échecs. */
  sinks: true,
  /** Politiques de gouvernance : session, plages IP, rétention, partage. */
  governance: true,
  /** Politiques du poste de travail : marketplace, extensions, apparence. */
  workspacePolicy: true,
  /** Facturation par siège, essai, portail Stripe. */
  billing: true,
  /** Clés d'organisation, escrow, récupération Shamir. */
  escrow: true,
  /** Marque de l'organisation, renommage, zone de danger. */
  settings: true,

  // ── Pas encore tenable devant un client ────────────────────────────────────
  /**
   * OIDC + PKCE, domaines vérifiés par DNS, session rendue à l'application par
   * boucle locale, coffre ouvert par clé d'appareil (E5-4) ou mot de passe.
   * Ce qui manquait n'était pas côté serveur : c'était le DÉPART du flux dans
   * l'application (`electron/ssoLogin.ts`) et la résolution de l'organisation
   * depuis l'adresse (`/auth/sso/resolve`). Bureau seulement — le web ne peut
   * pas tenir une boucle locale, et l'écran ne l'y propose pas. SAML : non.
   */
  sso: true,
  /** SCIM 2.0 users/groups : 5 fiches sur 11. */
  scim: false,
  /** Résidence des données EU / self-host / BYOK. Annoncé « roadmap » au tarif. */
  dataResidency: false,
} as const;

export type EnterpriseFeature = keyof typeof ENTERPRISE_FEATURES;

/** Cette fonction est-elle joignable ? L'interrupteur maître prime toujours. */
export function isEnterpriseFeatureAvailable(feature: EnterpriseFeature): boolean {
  return ORG_SURFACE_ENABLED && ENTERPRISE_FEATURES[feature];
}

/**
 * Compatibilité ascendante — la surface Organisation est-elle ouverte du tout ?
 *
 * Une vingtaine d'appelants posaient cette question sous ce nom ; ils continuent
 * de la poser. Ce qui change est ce à quoi ils obtiennent droit une fois entrés :
 * les écrans non finis se gouvernent maintenant par `isEnterpriseFeatureAvailable`,
 * pas par ce booléen-ci.
 */
export const ENTERPRISE_ACCESSIBLE = ORG_SURFACE_ENABLED;

const HIDE_ENTERPRISE_KEY = 'filarr.hide-enterprise-space';

/**
 * User preference (global, not per-profile): hide the enterprise space entirely
 * from the launch chooser. Read synchronously at launch (before a profile is
 * picked), so it lives in localStorage with a durable disk-flag mirror.
 */
export function isEnterpriseHidden(): boolean {
  try {
    return localStorage.getItem(HIDE_ENTERPRISE_KEY) === '1';
  } catch {
    return false;
  }
}

export function setEnterpriseHidden(hidden: boolean): void {
  try {
    localStorage.setItem(HIDE_ENTERPRISE_KEY, hidden ? '1' : '0');
  } catch {
    /* ignore */
  }
  // Durable mirror so the preference survives a localStorage reset (like theme).
  window.electron?.ipcRenderer
    ?.invoke('flag:set', 'hide-enterprise-space', hidden ? '1' : '0')
    .catch(() => {});
}

/** Restore the localStorage cache from the durable disk flag (best-effort, at boot). */
export async function hydrateEnterpriseHidden(): Promise<void> {
  try {
    if (localStorage.getItem(HIDE_ENTERPRISE_KEY) !== null) return; // already cached
    const v = await window.electron?.ipcRenderer?.invoke('flag:get', 'hide-enterprise-space');
    if (v === '1' || v === '0') localStorage.setItem(HIDE_ENTERPRISE_KEY, v);
  } catch {
    /* ignore */
  }
}
