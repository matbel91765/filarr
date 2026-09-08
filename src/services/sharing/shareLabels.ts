/**
 * NOMMER UN PARTAGE : le libellé et le client, scellés et synchronisés.
 *
 * ════════════════════════════════════════════════════════════════════════
 * POURQUOI UN NOM N'EST PAS UN CHAMP COMME UN AUTRE
 * ════════════════════════════════════════════════════════════════════════
 * Le chiffrement de bout en bout a une conséquence qu'on oublie vite : le
 * serveur ne sait pas ce qu'un partage contient. La liste n'a donc, par défaut,
 * RIEN à afficher qu'un identifiant tronqué — ce que « Mes partages » faisait
 * depuis toujours sur le bureau. Deux sources de nom existent :
 *
 *   · le nom de fichier du MANIFESTE, qui exige K_share (donc soit le cache
 *     local de l'appareil créateur, soit la clé de garde déverrouillée) ;
 *   · un LIBELLÉ posé à la main. C'est ce que gère ce module.
 *
 * Le libellé vit à DEUX endroits, et c'est délibéré :
 *
 *   1. EN LOCAL (`localStorage`) — cache d'affichage instantané, lisible même
 *      coffre verrouillé, et seule copie quand le compte n'a pas de clé.
 *   2. SUR LE SERVEUR (`wrappedLabel`), SCELLÉ vers la clé PUBLIQUE de garde.
 *      Sceller n'exige que la publique : un bureau VERROUILLÉ peut donc nommer
 *      un partage, même s'il ne saura relire le nom qu'au prochain
 *      déverrouillage. C'est ce qui fait converger les appareils.
 *
 * ════════════════════════════════════════════════════════════════════════
 * QUATRE RAISONS DE RESTER LOCAL — ET IL FAUT LES DIRE À L'ÉCRAN
 * ════════════════════════════════════════════════════════════════════════
 * Un libellé qui ne part pas n'est pas une erreur ; c'est un état, et le taire
 * ferait croire à une convergence qui n'aura pas lieu. Les quatre sont celles
 * du mobile, aux mêmes noms :
 *
 *   · `no-vault`    — aucune clé de garde publiée : rien vers quoi sceller.
 *   · `app-origin`  — partage d'origine APPLICATION face à un serveur d'hier.
 *                     Avant la migration 0090, `PATCH /account/sends/:id` ne
 *                     visait que `ephemeral_shares` et répondait 404 après un
 *                     scellement fait pour rien. Le drapeau évite la promesse ;
 *                     il ne remplace pas la gestion du 404 ci-dessous.
 *   · `not-found`   — le serveur ne connaît pas cet identifiant, OU sa colonne
 *                     n'est pas encore migrée. Un réessai ne changera rien.
 *   · `network`     — panne. Celle-là, et elle seule, mérite « on réessaiera ».
 *
 * Contrat serveur : `PATCH /account/{sends|requests}/:id`, champ `wrappedLabel`
 * (`null` ou `''` efface). Documenté dans
 * `infra/cloudflare-worker/docs/CHANGES-2026-09.md`, section 5.
 */

import { openJson, sealJson } from '../custody/custodyCrypto';
import { custodyPrivateKey, custodyPublicKeyForSealing } from '../custody/custodySession';
import { putShareLabel, type ShareKind } from '../custody/custodyApi';

const STORAGE_KEY = 'filarr-share-labels-v1';

/** Longueur maximale d'un champ — la même que le site et le mobile. */
export const MAX_LABEL_LENGTH = 120;

/**
 * Plafond d'entrées retenues. Sans lui, le magasin grandit indéfiniment : un
 * partage révoqué disparaît de la liste du serveur, mais son libellé resterait
 * ici pour toujours.
 */
export const MAX_LABEL_ENTRIES = 2000;

export interface ShareLabel {
  label?: string;
  client?: string;
}

export type ShareLabelMap = Record<string, ShareLabel>;

// ── Modèle PUR ──────────────────────────────────────────────────────────

/**
 * Nettoie un libellé saisi. Rend `null` quand il ne reste RIEN — c'est ce qui
 * distingue « effacer » de « enregistrer une chaîne vide », et le serveur
 * attend précisément `null` pour effacer.
 */
export function normalizeShareLabel(value: ShareLabel): ShareLabel | null {
  const label = value.label?.trim().slice(0, MAX_LABEL_LENGTH);
  const client = value.client?.trim().slice(0, MAX_LABEL_LENGTH);
  if (!label && !client) return null;
  return { ...(label ? { label } : {}), ...(client ? { client } : {}) };
}

/** Vrai quand la valeur lue a la forme d'un libellé. */
export function isShareLabel(value: unknown): value is ShareLabel {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as ShareLabel;
  return (
    (v.label === undefined || typeof v.label === 'string') &&
    (v.client === undefined || typeof v.client === 'string')
  );
}

/** Pose (ou retire) une entrée, en bornant la croissance du magasin. */
export function applyLabel(
  map: ShareLabelMap,
  id: string,
  value: ShareLabel | null
): ShareLabelMap {
  const next: ShareLabelMap = { ...map };
  if (!value) delete next[id];
  else next[id] = value;
  const ids = Object.keys(next);
  if (ids.length > MAX_LABEL_ENTRIES) {
    // Les plus anciennement insérées partent : l'ordre d'insertion des clés
    // d'un objet JavaScript est stable pour des clés non numériques.
    for (const stale of ids.slice(0, ids.length - MAX_LABEL_ENTRIES)) delete next[stale];
  }
  return next;
}

/**
 * Oublie les libellés dont le partage a disparu de la liste.
 *
 * `liveIds` doit contenir AUSSI les révoqués encore listés : un partage révoqué
 * reste affiché quelques jours, et lui retirer son nom au moment précis où
 * l'utilisateur cherche à comprendre ce qu'il vient de couper serait le pire
 * instant possible.
 */
export function pruneLabels(map: ShareLabelMap, liveIds: ReadonlySet<string>): ShareLabelMap {
  return Object.fromEntries(Object.entries(map).filter(([id]) => liveIds.has(id)));
}

/**
 * Ce qu'une ligne de la liste AFFICHE comme nom.
 *
 * L'ordre n'est pas cosmétique : le libellé posé à la main l'emporte sur le nom
 * de fichier, parce que c'est le nom que l'utilisateur a CHOISI. Quand aucun
 * des deux n'existe, on rend `null` — à l'écran de décider s'il montre
 * l'identifiant tronqué ou « déverrouillez pour lire les noms », ce qui n'est
 * pas la même phrase et ne se décide pas ici.
 */
export function displayNameFor(
  label: ShareLabel | undefined,
  fallbackFileName?: string | null
): string | null {
  const chosen = label?.label?.trim();
  if (chosen) return chosen;
  const file = fallbackFileName?.trim();
  return file || null;
}

// ── Mémoire locale ──────────────────────────────────────────────────────

export function readLabels(): ShareLabelMap {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: ShareLabelMap = {};
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (isShareLabel(value)) out[id] = value;
    }
    return out;
  } catch {
    return {};
  }
}

export function writeLabels(map: ShareLabelMap): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Quota, mode privé : un libellé est un confort d'affichage, jamais une
    // donnée dont la perte doit interrompre un geste.
  }
}

/** Efface tous les libellés — déconnexion, changement de compte. */
export function clearLabels(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Sans conséquence : les libellés d'un autre compte ne correspondront à
    // aucun identifiant listé, et `pruneLabels` les emportera.
  }
}

// ── Synchronisation serveur ─────────────────────────────────────────────

export type LabelSyncReason = 'no-vault' | 'app-origin' | 'not-found' | 'network';

export type LabelSyncOutcome =
  /** Scellé et posé sur le serveur : tous les appareils le verront. */
  | { status: 'synced' }
  /** Enregistré sur cet appareil seulement — la raison est dite. */
  | { status: 'local'; reason: LabelSyncReason };

export interface LabelSyncOptions {
  /** Vrai pour un partage créé depuis l'APPLICATION (table `shares`). */
  appOrigin?: boolean;
  /** Vrai quand le listing du compte a rendu le champ `wrapped_label`. */
  serverKnowsAppLabels?: boolean;
}

/**
 * Scelle un libellé vers la clé publique de garde et le pose sur le serveur.
 * N'exige PAS le coffre déverrouillé — seul le RELIRE l'exige.
 *
 * Ne LÈVE jamais : l'appelant a déjà écrit la copie locale, et une panne réseau
 * ne doit pas défaire une saisie. La raison de l'absence de synchronisation
 * remonte pour que l'écran dise « visible sur cet appareil » plutôt que de
 * laisser croire à une convergence.
 */
export async function syncLabelToServer(
  kind: ShareKind,
  id: string,
  value: ShareLabel | null,
  options: LabelSyncOptions = {}
): Promise<LabelSyncOutcome> {
  // L'ABSTENTION NE VAUT PLUS QUE FACE À UN SERVEUR D'HIER : depuis la
  // migration 0090, le PATCH se replie sur la table `shares`.
  if (kind === 'send' && options.appOrigin && !options.serverKnowsAppLabels) {
    return { status: 'local', reason: 'app-origin' };
  }
  const publicKey = custodyPublicKeyForSealing();
  if (!publicKey) return { status: 'local', reason: 'no-vault' };
  try {
    const wrappedLabel = value ? await sealJson(value, publicKey) : null;
    const outcome = await putShareLabel(kind, id, wrappedLabel);
    return outcome === 'not-found'
      ? { status: 'local', reason: 'not-found' }
      : { status: 'synced' };
  } catch {
    return { status: 'local', reason: 'network' };
  }
}

/**
 * Ouvre un libellé scellé venu du serveur. Rend `null` quand le coffre est
 * verrouillé ou quand le sceau est illisible — typiquement un libellé posé
 * sous une clé de garde ANTÉRIEURE, après recréation du coffre. On garde alors
 * ce que cet appareil a en local plutôt que d'effacer un nom que plus personne
 * ne pourra reconstituer.
 */
export async function openWrappedLabel(wrappedLabel: string): Promise<ShareLabel | null> {
  const priv = custodyPrivateKey();
  if (!priv) return null;
  const parsed = await openJson<unknown>(wrappedLabel, priv);
  if (!isShareLabel(parsed)) return null;
  return normalizeShareLabel(parsed);
}

/**
 * Fusionne les libellés scellés du serveur dans la carte locale.
 *
 * LE SERVEUR GAGNE quand il a quelque chose : sa copie est celle que TOUS les
 * appareils voient, et laisser gagner le local ferait diverger silencieusement
 * deux machines du même compte. Une ligne SANS sceau ne touche à rien —
 * l'absence n'est pas un effacement.
 *
 * Rend aussi `toPush` : les identifiants dont CETTE machine a un libellé que le
 * serveur ignore. C'est la moitié montante de la convergence, à jouer une fois
 * par déverrouillage.
 *
 * `openers` est injecté pour que le modèle reste testable sans clé de garde en
 * mémoire — c'est le seul endroit du module qui touche à la crypto.
 */
export async function mergeServerLabels(
  local: ShareLabelMap,
  rows: readonly { id: string; wrappedLabel: string | null }[],
  open: (wrapped: string) => Promise<ShareLabel | null> = openWrappedLabel
): Promise<{ merged: ShareLabelMap; toPush: string[] }> {
  const merged: ShareLabelMap = { ...local };
  const toPush: string[] = [];
  for (const row of rows) {
    if (row.wrappedLabel) {
      const opened = await open(row.wrappedLabel);
      if (opened) merged[row.id] = opened;
      continue;
    }
    const mine = local[row.id];
    if (mine && (mine.label || mine.client)) toPush.push(row.id);
  }
  return { merged, toPush };
}
