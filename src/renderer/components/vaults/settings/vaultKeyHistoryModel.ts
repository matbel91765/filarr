/**
 * vaultKeyHistoryModel (F10) — la frise des clés du coffre, faite de deux
 * sources qui ne se recouvrent pas. Sans React, sans réseau, sans traduction.
 *
 * CE QUE CHACUNE SAIT :
 *   · `GET /:id/key-wraps` dit quelles époques le serveur me garde SCELLÉES,
 *     donc lesquelles cet appareil peut ouvrir. Il ne dit ni quand ni par qui
 *     une rotation a eu lieu — ce sont des wraps, pas une histoire.
 *   · le fil d'activité (`vault.rotate`) dit QUAND et PAR QUI, avec la nouvelle
 *     époque en métadonnée. Il est borné à une page, il peut être structurellement
 *     coupé (espace personnel, offre sans journal), et il ne sait rien de mes
 *     scellés.
 *
 * LES FONDRE, C'EST ACCEPTER LES TROUS ET LES DIRE. Une ligne peut valoir « je
 * détiens cette clé, j'ignore quand elle est née » : c'est la vérité, et une
 * frise qui n'afficherait que les époques datées raconterait une histoire à
 * trous en la faisant passer pour complète. L'inverse — inventer une date, ou
 * pire, une rotation — serait pire encore : sur cet écran, une date fausse
 * accuse quelqu'un.
 *
 * LA FRISE EST BORNÉE, ET LE SERVEUR EST LA RAISON. Son plafond ne vient pas
 * de nous : `currentKeyEpoch` est recopié tel quel du DTO, et les époques de
 * `/key-wraps` arrivent d'une route que le worker ne borne ni ne pagine. C'est
 * la boucle de ce lot pilotée par un entier du courtier — que le modèle de
 * menace du produit traite explicitement comme un adversaire. Un `1e9` corrompu
 * ou hostile faisait un milliard de tours, puis un `<li>` par tour : le renderer
 * gelait. On borne donc l'énumération, et — règle de tout le lot — on ANNONCE
 * ce qu'on n'énumère pas plutôt que de le taire.
 *
 * ET LE TABLEAU DE SCELLÉS EST HOSTILE À SON TOUR, par sa TAILLE (l'étaler en
 * arguments de `Math.max` lève `RangeError` au-delà d'environ cent mille, ici
 * pendant le rendu) comme par ses VALEURS : un seul scellé d'époque aberrante
 * emportait le plafond, et la frise d'un coffre jamais tourné annonçait
 * « 999 999 800 époques plus anciennes » sans jamais montrer l'époque 1, la
 * seule réelle. On ne retient donc que les époques crédibles — jusqu'à
 * `MAX_TIMELINE_EPOCHS` au-delà de l'annonce, ce qui laisse passer le scellé
 * d'une rotation faite ailleurs et arrête le nombre inventé.
 *
 * L'ÉPOQUE 1 N'EST PAS UNE ROTATION, c'est la création du coffre. Lui chercher
 * un `vault.rotate` afficherait « rotation à une date inconnue » sur un coffre
 * qui n'a jamais tourné, c'est-à-dire une inquiétude fabriquée à partir d'un
 * fait parfaitement normal.
 */

import type { VaultActivityEventDTO } from '../../../../services/vault/vaultApi';

/** L'événement du fil qui crée une époque. */
export const ROTATE_EVENT_TYPE = 'vault.rotate';

export interface KeyEpochEntry {
  epoch: number;
  /** Le serveur me garde un scellé pour cette époque : je PEUX l'ouvrir. */
  mine: boolean;
  /** L'époque courante du coffre. */
  current: boolean;
  /** D'où vient cette époque : la création du coffre, ou une rotation. */
  origin: 'creation' | 'rotation';
  /** L'instant de la rotation, `null` quand le fil ne l'a pas. */
  atMs: number | null;
  /** Qui l'a faite, `null` quand on ne le sait pas. */
  actorUserId: string | null;
  /** Combien de personnes ce geste a retirées — `null` si on l'ignore. */
  removed: number | null;
}

/**
 * Combien d'époques la frise ÉNUMÈRE au plus, de la plus récente vers la
 * première. Deux cents lignes sont déjà plus que personne ne lit ; au-delà, ce
 * qui informe est le COMPTE, et il est dit.
 */
export const MAX_TIMELINE_EPOCHS = 200;

export interface BuildKeyTimelineInput {
  /** Les époques que le serveur me garde scellées (`/key-wraps`). */
  wraps: readonly number[];
  /** Le fil, filtré ou non : seuls les `vault.rotate` sont lus. */
  events: readonly VaultActivityEventDTO[];
  /** L'époque courante telle que le résumé en mémoire la connaît. */
  currentKeyEpoch: number;
}

export interface KeyTimeline {
  /** Les lignes, de la plus récente à la plus ancienne ÉNUMÉRÉE. */
  entries: KeyEpochEntry[];
  /** Combien d'époques la borne laisse derrière — `0` = la frise est entière. */
  truncatedBefore: number;
}

/** Une métadonnée d'événement lue sans confiance : elle vient du réseau. */
function nombre(raw: unknown): number | null {
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

/**
 * La frise, de l'époque la plus récente à la première.
 *
 * LE PLAFOND EST LE PLUS GRAND DES DEUX, et pas `currentKeyEpoch` seul : un
 * wrap plus récent que l'époque connue de l'écran signifie qu'une rotation
 * vient d'avoir lieu et que le résumé en mémoire est en retard. Ignorer cette
 * ligne ferait disparaître une clé réellement détenue — le même raisonnement
 * que `epochCoverage` de la carte « Vous ». « Plus récent » s'arrête toutefois
 * à `MAX_TIMELINE_EPOCHS` d'avance : au-delà, ce n'est plus une rotation qu'on
 * n'a pas encore vue, c'est un nombre que rien ne recoupe.
 *
 * À DEUX ÉVÉNEMENTS POUR LA MÊME ÉPOQUE, on garde le plus ANCIEN : une époque
 * ne naît qu'une fois, un doublon ne peut venir que du journal, et c'est la
 * première ligne qui l'a créée.
 */
export function buildKeyTimeline(input: BuildKeyTimelineInput): KeyTimeline {
  // `Number.isFinite` d'abord : un `currentKeyEpoch` à `Infinity` ou `NaN`
  // rendrait le plancher inatteignable, et la borne ne bornerait plus rien.
  const annonce = Number.isFinite(input.currentKeyEpoch) ? Math.max(0, input.currentKeyEpoch) : 0;
  const credible = annonce + MAX_TIMELINE_EPOCHS;
  const scelles = new Set(input.wraps.filter((e) => Number.isFinite(e) && e > 0 && e <= credible));
  // PAS DE `Math.max(annonce, ...scelles)` : `/key-wraps` sert une ligne par
  // époque, sans limite ni curseur, et étaler plus de cent mille valeurs en
  // arguments lève `RangeError: Maximum call stack size exceeded` — dans un
  // `useMemo`, donc pendant le rendu, donc écran blanc. Une boucle ne touche
  // pas la pile.
  let plafond = annonce;
  for (const e of scelles) if (e > plafond) plafond = e;
  if (plafond > Number.MAX_SAFE_INTEGER) plafond = Number.MAX_SAFE_INTEGER;
  if (plafond < 1) return { entries: [], truncatedBefore: 0 };
  const plancher = Math.max(1, plafond - MAX_TIMELINE_EPOCHS + 1);

  /** époque → l'événement qui l'a créée (le plus ancien vu). */
  const parEpoque = new Map<number, VaultActivityEventDTO>();
  for (const e of input.events) {
    if (e.eventType !== ROTATE_EVENT_TYPE) continue;
    const epoch = nombre(e.metadata?.new_epoch);
    if (epoch === null || epoch < 1) continue;
    const deja = parEpoque.get(epoch);
    if (!deja || e.occurredAt < deja.occurredAt) parEpoque.set(epoch, e);
  }

  const entries: KeyEpochEntry[] = [];
  for (let epoch = plafond; epoch >= plancher; epoch--) {
    const evt = parEpoque.get(epoch);
    entries.push({
      epoch,
      mine: scelles.has(epoch),
      current: epoch === input.currentKeyEpoch,
      origin: epoch === 1 ? 'creation' : 'rotation',
      // L'époque 1 n'a pas de rotation : même si un événement portait ce
      // numéro, il ne dirait rien de sa naissance.
      atMs: epoch === 1 ? null : (evt?.occurredAt ?? null),
      actorUserId: epoch === 1 ? null : (evt?.actorUserId ?? null),
      removed: epoch === 1 ? null : evt ? nombre(evt.metadata?.removed) : null,
    });
  }
  return { entries, truncatedBefore: plancher > 1 ? plancher - 1 : 0 };
}

/**
 * La dernière rotation DATÉE — celle qu'on affiche en tête de la section.
 *
 * `null` a deux sens que l'écran distingue lui-même : le coffre n'a jamais
 * tourné (époque 1), ou le fil ne porte pas la ligne (page bornée, journal
 * coupé). Dans le second cas l'écran dit « inconnue », jamais « jamais » : une
 * absence d'information n'est pas un fait.
 *
 * On retombe sur la dernière époque DATÉE plutôt que sur la plus récente : dire
 * « dernière rotation : inconnue » alors qu'on connaît celle d'avant, c'est
 * jeter une information qu'on a.
 */
export function lastRotation(entries: readonly KeyEpochEntry[]): KeyEpochEntry | null {
  for (const e of entries) {
    if (e.origin === 'rotation' && e.atMs !== null) return e;
  }
  return null;
}

/** Les époques de la frise que cet appareil ne détient PAS. */
export function missingEpochs(entries: readonly KeyEpochEntry[]): number[] {
  return entries.filter((e) => !e.mine).map((e) => e.epoch);
}
