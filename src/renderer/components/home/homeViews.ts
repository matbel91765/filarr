/**
 * PLUSIEURS ACCUEILS, ET UN SEUL AFFICHÉ.
 *
 * ── LE PROBLÈME QUE ÇA RÉSOUT ───────────────────────────────────────────────
 *
 * Appliquer un modèle de mise en page reçu de quelqu'un d'autre, c'est un PARI
 * tant que le geste écrase l'accueil qu'on a construit. On regarde la carte du
 * modèle, on hésite, on ne clique pas — et la fonctionnalité n'existe pas.
 *
 * Appliquer CRÉE donc une mise en page NOMMÉE (« Accueil — Focus ») et bascule
 * dessus. L'ancienne est intacte, à un clic. L'essai cesse d'être un pari, et
 * le retour en arrière n'a plus besoin d'être expliqué.
 *
 * ── COMMENT SANS TOUCHER AU FORMAT ──────────────────────────────────────────
 *
 * Le conteneur de mise en page indexe ses vues par identifiant, et son en-tête
 * dit déjà que « le préfixe dit la famille » (`home`, `home:alt`,
 * `folder:<uuid>`). Une mise en page nommée est donc `home:<nom encodé>` : le
 * NOM vit dans la clé, pas dans un champ. Ce n'est pas une astuce gratuite —
 * `normalizeLayoutDocument` (côté principal) reconstruit chaque vue champ par
 * champ et effacerait un `name` ajouté à côté, silencieusement, au premier
 * aller-retour disque. La clé, elle, est la seule chose qu'il ne peut pas
 * perdre.
 *
 * ── L'ACCUEIL ACTIF EST UNE PRÉFÉRENCE D'APPAREIL ───────────────────────────
 *
 * Il est rangé dans `profileStorage`, donc local et par profil. Synchroniser
 * « quel accueil je regarde » demanderait un champ de plus dans un format figé,
 * pour imposer à un grand écran la mise en page choisie sur un portable. Le
 * jour où ce sera souhaité, ce module est le seul à changer.
 */

import { useCallback, useEffect, useState } from 'react';

import { getItem, removeItem, setItem } from '../../../services/core/profileStorage';
import type { LayoutSlot, LayoutView, LayoutViewId } from '../../../services/layout/layoutTypes';
import { HOME_VIEW_ID } from './homeLayout';

const STORAGE_KEY = 'filarr.home.activeView';

/** Toutes les vues de la famille « accueil » commencent par ceci. */
const HOME_PREFIX = `${HOME_VIEW_ID}:`;

/** Une mise en page nommée ne peut pas s'appeler n'importe quoi de long. */
const MAX_NAME = 60;

export function isHomeViewId(id: string): boolean {
  return id === HOME_VIEW_ID || id.startsWith(HOME_PREFIX);
}

/**
 * `Accueil — Focus` → `home:Accueil%20%E2%80%94%20Focus`.
 *
 * L'encodage n'est pas décoratif : un nom peut contenir `:`, et deux vues dont
 * les identifiants se chevauchent seraient deux mises en page qui s'écrasent.
 */
export function makeHomeViewId(name: string): LayoutViewId {
  const clean = name.trim().slice(0, MAX_NAME) || 'Sans nom';
  return `${HOME_PREFIX}${encodeURIComponent(clean)}`;
}

/**
 * « ENREGISTRER COMME… » — ce que le geste va faire, avant de le faire.
 *
 * Rendu comme un PLAN et non exécuté ici : l'écran doit pouvoir demander une
 * confirmation entre les deux. Sans cette étape, un nom déjà pris écraserait
 * une mise en page existante sans un mot, parce que `makeHomeViewId` est
 * DÉTERMINISTE — deux dispositions du même nom portent le même identifiant.
 *
 * `null` = il n'y a rien à faire (nom vide). Un nom fait uniquement d'espaces
 * en fait partie : le laisser passer créerait une mise en page « Sans nom »
 * que personne n'a demandée.
 */
export interface SaveAsPlan {
  viewId: LayoutViewId;
  /** Le nom, tel qu'il sera lu — coupé au plafond, comme l'identifiant. */
  name: string;
  /** ⚠ Écrire remplacerait une mise en page qui existe déjà. */
  replaces: boolean;
}

export function planSaveAs(
  rawName: string,
  views: Record<LayoutViewId, LayoutView>
): SaveAsPlan | null {
  const name = rawName.trim().slice(0, MAX_NAME);
  if (name === '') return null;
  const viewId = makeHomeViewId(name);
  return { viewId, name, replaces: views[viewId] !== undefined };
}

/**
 * Recopie des blocs pour une NOUVELLE mise en page.
 *
 * ── DES IDENTIFIANTS FRAIS, ET DES ATTACHES CONSERVÉES ────────────────────
 *
 * Les identifiants sont refaits, comme le fait `instantiate` en posant un
 * modèle : deux vues qui partageraient les identifiants de leurs blocs
 * seraient deux jeux que la fusion pourrait confondre.
 *
 * Les `binding` locaux, en revanche, SURVIVENT — et c'est la différence avec un
 * export. Ici on duplique MA disposition sur MON appareil : il n'y a rien à
 * assainir, et vider les attaches produirait une copie qu'il faudrait
 * rebrancher bloc par bloc, c'est-à-dire une copie que personne n'utiliserait.
 */
export function duplicateSlotsForView(
  slots: readonly LayoutSlot[],
  newSlotId: () => string
): LayoutSlot[] {
  return slots.map((slot) => ({ ...slot, id: newSlotId() }));
}

/** Le nom lisible d'un identifiant de vue. `home` n'en a pas : c'est le défaut. */
export function homeViewName(id: LayoutViewId, defaultName: string): string {
  if (id === HOME_VIEW_ID) return defaultName;
  if (!id.startsWith(HOME_PREFIX)) return id;
  const raw = id.slice(HOME_PREFIX.length);
  try {
    return decodeURIComponent(raw) || defaultName;
  } catch {
    // Un pourcentage isolé fait lever `decodeURIComponent` : on montre le brut
    // plutôt que de faire tomber l'écran qui liste les mises en page.
    return raw;
  }
}

export interface HomeViewEntry {
  id: LayoutViewId;
  name: string;
  /** Nombre de blocs — de quoi distinguer deux mises en page du même nom. */
  slots: number;
}

/**
 * Les accueils du document, le défaut TOUJOURS en tête (même s'il n'a pas
 * encore d'entrée : c'est le retour en arrière, il ne peut pas manquer).
 */
export function listHomeViews(
  views: Record<LayoutViewId, LayoutView>,
  defaultName: string
): HomeViewEntry[] {
  const named = Object.keys(views)
    .filter((id) => id.startsWith(HOME_PREFIX))
    .sort((a, b) => homeViewName(a, defaultName).localeCompare(homeViewName(b, defaultName)))
    .map((id) => ({
      id,
      name: homeViewName(id, defaultName),
      slots: views[id]?.slots.length ?? 0,
    }));
  return [
    { id: HOME_VIEW_ID, name: defaultName, slots: views[HOME_VIEW_ID]?.slots.length ?? 0 },
    ...named,
  ];
}

// ==================== L'accueil actif ====================

type Listener = (id: LayoutViewId) => void;
const listeners = new Set<Listener>();

export function readActiveHomeViewId(): LayoutViewId {
  try {
    const stored = getItem(STORAGE_KEY);
    return stored && isHomeViewId(stored) ? stored : HOME_VIEW_ID;
  } catch {
    return HOME_VIEW_ID;
  }
}

export function writeActiveHomeViewId(id: LayoutViewId): void {
  try {
    if (id === HOME_VIEW_ID) removeItem(STORAGE_KEY);
    else setItem(STORAGE_KEY, id);
  } catch {
    // Stockage refusé : la bascule vaut pour la session, ce qui est déjà
    // l'essentiel — on ne renonce pas à changer d'accueil pour autant.
  }
  for (const listener of listeners) listener(id);
}

/**
 * L'accueil actif, et de quoi en changer.
 *
 * `available` protège du cas qui ferait le plus mal : au changement de profil,
 * le document est vide et provisoire. Sans ce garde-fou, une mise en page
 * nommée absente du NOUVEAU profil ferait retomber sur le défaut — et la
 * préférence serait effacée avant même que le document du profil ne soit
 * descendu.
 */
export function useActiveHomeView(
  views: Record<LayoutViewId, LayoutView>,
  ready: boolean
): [LayoutViewId, (id: LayoutViewId) => void] {
  const [active, setActive] = useState<LayoutViewId>(() => readActiveHomeViewId());

  useEffect(() => {
    const listener: Listener = (id) => setActive(id);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    if (active === HOME_VIEW_ID) return;
    if (views[active]) return;
    // La mise en page nommée a disparu (supprimée ici, ou jamais arrivée sur
    // cet appareil). On revient au défaut plutôt que d'afficher un accueil vide
    // que rien n'expliquerait.
    writeActiveHomeViewId(HOME_VIEW_ID);
  }, [ready, active, views]);

  const select = useCallback((id: LayoutViewId) => writeActiveHomeViewId(id), []);

  return [active, select];
}
