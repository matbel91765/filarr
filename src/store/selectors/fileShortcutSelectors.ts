/**
 * fileShortcutSelectors — l'ÉTAT d'un raccourci vers un coffre partagé.
 *
 * Un fichier de l'espace personnel qui porte `vaultRef` est un RACCOURCI : ses
 * octets sont partis dans un coffre, seule la fiche (nom, type, dates, tags)
 * reste ici. La carte doit dire honnêtement où en est ce coffre AVANT qu'on
 * clique — un clic dans le vide n'apprend rien à personne — et cette vérité
 * ne peut venir que de `VaultsState`, que `FileCard` n'a pas le droit de lire
 * (contrat du composant : tout arrive par les props).
 *
 * Deux couches :
 *   - `shortcutState` / `shortcutLabel` : logique PURE sur un extrait minimal
 *     de l'état des coffres (`VaultsLite`), éprouvée sous vitest-node ;
 *   - les sélecteurs, MÉMOÏSÉS : `selectShortcutCardProps` rend la même Map
 *     tant que ni la liste affichée ni l'état des coffres n'ont bougé, pour que
 *     les cartes `React.memo` ne se re-rendent pas à chaque action du store.
 *
 * RÈGLE : jamais d'auto-suppression de la fiche. Un état 'gone' ou 'missing'
 * est une information affichée, pas un verdict exécuté — « terminal ≠ jetable ».
 */

import { createSelector } from '@reduxjs/toolkit';

/** La référence portée par un fichier-raccourci (voir `FileItem.vaultRef`). */
export interface VaultShortcutRef {
  vaultId: string;
  itemId: string;
  /** ISO 8601 — la date du déplacement des octets vers le coffre. */
  movedAt: string;
}

/**
 *   live    — coffre connu, déverrouillé, élément présent : le clic ouvre.
 *   locked  — coffre connu mais verrouillé, éléments pas encore chargés, ou
 *             chargés avec des éléments indéchiffrables (le nôtre en est
 *             peut-être) : on ne sait pas encore, on n'affirme rien.
 *   missing — coffre connu, éléments chargés et lisibles, le nôtre n'y est pas.
 *   gone    — la liste des coffres est chargée et ce coffre n'y figure plus.
 *   unknown — la liste des coffres n'est pas encore chargée (ou n'est pas
 *             fiable : chargée sans paire de clés).
 */
export type ShortcutState = 'live' | 'locked' | 'missing' | 'gone' | 'unknown';

/** Ce que la carte reçoit : un libellé déjà résolu et l'état ci-dessus. */
export interface ShortcutCardProps {
  label: string;
  state: ShortcutState;
}

/**
 * Lit `vaultRef` sur n'importe quel élément SANS dépendre du type `FileItem` :
 * la lecture est structurelle et validée champ par champ. Une fiche venue d'une
 * synchro avec un `vaultRef` incomplet n'est PAS un raccourci — mieux vaut la
 * traiter en fichier ordinaire (qui échouera à s'ouvrir proprement) qu'en
 * raccourci vers nulle part.
 */
export function vaultRefOf(item: unknown): VaultShortcutRef | undefined {
  if (!item || typeof item !== 'object') return undefined;
  const ref = (item as { vaultRef?: unknown }).vaultRef;
  if (!ref || typeof ref !== 'object') return undefined;
  const { vaultId, itemId, movedAt } = ref as Record<string, unknown>;
  if (typeof vaultId !== 'string' || !vaultId) return undefined;
  if (typeof itemId !== 'string' || !itemId) return undefined;
  return { vaultId, itemId, movedAt: typeof movedAt === 'string' ? movedAt : '' };
}

/**
 * L'extrait de `VaultsState` dont la logique a besoin — et rien d'autre, pour
 * que les tests le fabriquent à la main et que le sélecteur ne se réveille
 * que sur ces cinq champs.
 */
export interface VaultsLite {
  /** Une demande de liste a abouti (ou échoué) : l'absence d'un coffre est une information. */
  vaultsLoaded: boolean;
  /** Le dernier chargement disposait de la paire de clés : la liste fait foi. */
  vaultsAuthoritative: boolean;
  vaults: Readonly<Record<string, { name: string } | undefined>>;
  unlockedVaultIds: readonly string[];
  /** `undefined` pour un coffre dont les éléments n'ont jamais été chargés. */
  itemsByVault: Readonly<Record<string, readonly { id: string }[] | undefined>>;
  decryptStatusByVault: Readonly<Record<string, { undecryptable: number } | undefined>>;
}

/** La matrice du CONTRAT, dans l'ordre où les questions se posent. */
export function shortcutState(ref: VaultShortcutRef, lite: VaultsLite): ShortcutState {
  if (!lite.vaultsLoaded) return 'unknown';
  const vault = lite.vaults[ref.vaultId];
  if (!vault) {
    // Une liste chargée SANS paire de clés peut être incomplète : l'absence n'y
    // vaut pas disparition. On attend plutôt que de condamner.
    return lite.vaultsAuthoritative ? 'gone' : 'unknown';
  }
  if (!lite.unlockedVaultIds.includes(ref.vaultId)) return 'locked';
  const items = lite.itemsByVault[ref.vaultId];
  if (!items) return 'locked';
  if (items.some((it) => it.id === ref.itemId)) return 'live';
  // Chargés, mais certains n'ont pas pu être déchiffrés : le nôtre en fait
  // peut-être partie. « Introuvable » serait une affirmation qu'on n'a pas.
  const status = lite.decryptStatusByVault[ref.vaultId];
  if (status && status.undecryptable > 0) return 'locked';
  return 'missing';
}

/**
 * Le nom du coffre, ou le repli fourni par l'appelant (« Coffre partagé ») :
 * un coffre verrouillé n'a pas de nom déchiffré, un coffre disparu n'en a
 * plus. Le repli est PASSÉ, pas traduit ici — un sélecteur n'a pas de `t`.
 */
export function shortcutLabel(ref: VaultShortcutRef, lite: VaultsLite, fallback: string): string {
  const name = lite.vaults[ref.vaultId]?.name;
  return name && name.trim() ? name : fallback;
}

/**
 * Calcule la Map des cartes pour une liste d'éléments : seuls ceux qui portent
 * un `vaultRef` valide y figurent. Pure — le sélecteur ci-dessous ne fait que
 * la mémoïser.
 */
export function buildShortcutCardProps(
  items: readonly unknown[],
  lite: VaultsLite,
  fallbackLabel: string
): ReadonlyMap<string, ShortcutCardProps> {
  const out = new Map<string, ShortcutCardProps>();
  for (const item of items) {
    const ref = vaultRefOf(item);
    if (!ref) continue;
    const id = (item as { id?: unknown }).id;
    if (typeof id !== 'string') continue;
    out.set(id, {
      label: shortcutLabel(ref, lite, fallbackLabel),
      state: shortcutState(ref, lite),
    });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sélecteurs
// ─────────────────────────────────────────────────────────────────────────────

/** Typage STRUCTUREL (pas `RootState` entier) : testable avec un store réduit. */
export interface WithVaultsLite {
  vaults: {
    vaults: VaultsLite['vaults'];
    unlockedVaultIds: readonly string[];
    itemsByVault: VaultsLite['itemsByVault'];
    decryptStatusByVault: VaultsLite['decryptStatusByVault'];
    initialLoadRequested: boolean;
    lastLoadHadKeypair: boolean;
    loading: boolean;
  };
}

/**
 * L'extrait mémoïsé : même référence tant qu'aucun des sept champs n'a bougé.
 * C'est lui qui rend `selectShortcutCardProps` stable entre deux actions du
 * store qui ne touchent pas aux coffres.
 */
export const selectVaultsLite = createSelector(
  [
    (s: WithVaultsLite) => s.vaults.vaults,
    (s: WithVaultsLite) => s.vaults.unlockedVaultIds,
    (s: WithVaultsLite) => s.vaults.itemsByVault,
    (s: WithVaultsLite) => s.vaults.decryptStatusByVault,
    (s: WithVaultsLite) => s.vaults.initialLoadRequested,
    (s: WithVaultsLite) => s.vaults.lastLoadHadKeypair,
    (s: WithVaultsLite) => s.vaults.loading,
  ],
  (
    vaults,
    unlockedVaultIds,
    itemsByVault,
    decryptStatusByVault,
    initialLoadRequested,
    lastLoadHadKeypair,
    loading
  ): VaultsLite => ({
    // « Chargé » = une demande a été faite ET elle est retombée. Avant cela,
    // l'absence d'un coffre n'est pas une information (terminal ≠ jetable).
    vaultsLoaded: initialLoadRequested && !loading,
    vaultsAuthoritative: lastLoadHadKeypair,
    vaults,
    unlockedVaultIds,
    itemsByVault,
    decryptStatusByVault,
  })
);

/** L'état d'UN raccourci. */
export const selectFileShortcutState = (s: WithVaultsLite, ref: VaultShortcutRef): ShortcutState =>
  shortcutState(ref, selectVaultsLite(s));

/**
 * La Map `fileId → { label, state }` pour les fichiers AFFICHÉS. Mémoïsée sur
 * (extrait des coffres, liste, repli) : l'hôte passe la même liste tant que
 * le dossier ne change pas, donc la Map garde son identité — et chaque valeur
 * aussi, ce qui est ce que `FileCard` (`React.memo`) attend de sa prop.
 */
export const selectShortcutCardProps = createSelector(
  [
    (s: WithVaultsLite) => selectVaultsLite(s),
    (_s: WithVaultsLite, files: readonly unknown[]) => files,
    (_s: WithVaultsLite, _files: readonly unknown[], fallbackLabel: string) => fallbackLabel,
  ],
  (lite, files, fallbackLabel) => buildShortcutCardProps(files, lite, fallbackLabel)
);
