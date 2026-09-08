/**
 * Le REGISTRE — la progression, élément par élément.
 *
 * POURQUOI PAS LE JOURNAL. Réécrire le journal après chaque élément serait
 * O(n²) : sur 12 000 éléments, c'est une réécriture de plusieurs mégaoctets
 * douze mille fois, et autant de fenêtres pendant lesquelles une mort de
 * l'application laisserait un fichier d'état à moitié écrit. Le registre est
 * donc un NDJSON strictement append-only : une ligne par transition, la
 * dernière ligne d'une clé fait foi.
 *
 * SÛRETÉ PAR CONSTRUCTION. Une dernière ligne tronquée (l'application est morte
 * au milieu d'un `write`) est abandonnée SANS erreur. C'est ce qui rend le
 * format sûr : le pire que puisse coûter une coupure, c'est la dernière
 * transition — jamais l'historique, jamais un état inventé.
 *
 * Module PUR : il parse et compose des chaînes. L'écriture disque vit dans
 * `journalStore.ts`.
 */

import type { LedgerItemState, LedgerLine, LedgerState } from './types';

/** Les états terminaux : jamais retentés à l'intérieur d'une même migration. */
const TERMINAL: ReadonlySet<LedgerState> = new Set<LedgerState>(['damaged', 'oversize']);

export function isTerminalLedgerState(state: LedgerItemState): boolean {
  return TERMINAL.has(state as LedgerState);
}

/** Sérialise une transition. Une ligne = un `JSON.stringify` + `\n`, rien d'autre. */
export function serializeLedgerLine(line: LedgerLine): string {
  return `${JSON.stringify(line)}\n`;
}

function isLedgerState(v: unknown): v is LedgerState {
  return v === 'uploaded' || v === 'done' || v === 'damaged' || v === 'oversize';
}

/**
 * Relit un registre entier et rend l'état de chaque clé.
 *
 * Règles, dans cet ordre :
 *  - une ligne vide est ignorée (fin de fichier normale) ;
 *  - une ligne au JSON invalide est ignorée SANS erreur — c'est la troncature
 *    attendue, et lever ici transformerait une coupure banale en migration
 *    perdue ;
 *  - une ligne sans `k` ou sans `s` reconnaissable est ignorée de même ;
 *  - à clé égale, LA DERNIÈRE gagne. La reprise ne doit jamais ressusciter un
 *    état ancien : un élément passé `uploaded` puis `done` est `done`.
 */
export function parseLedger(raw: string): Map<string, LedgerLine> {
  const out = new Map<string, LedgerLine>();
  if (!raw) return out;

  for (const rawLine of raw.split('\n')) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      // Troncature (mort de l'application en cours d'écriture) ou octet abîmé :
      // on abandonne CETTE ligne, jamais les précédentes.
      continue;
    }
    if (!parsed || typeof parsed !== 'object') continue;
    const line = parsed as Partial<LedgerLine>;
    if (typeof line.k !== 'string' || !line.k) continue;
    if (!isLedgerState(line.s)) continue;
    out.set(line.k, line as LedgerLine);
  }

  return out;
}

/** L'état d'une clé. Absente du registre ⇒ `pending`, implicitement. */
export function ledgerStateOf(
  folded: ReadonlyMap<string, LedgerLine>,
  key: string
): LedgerItemState {
  return folded.get(key)?.s ?? 'pending';
}

export interface LedgerTally {
  done: number;
  uploaded: number;
  damaged: number;
  oversize: number;
  /** Octets des éléments `done` (le `n` de la ligne, donc du CHIFFRÉ monté). */
  doneBytes: number;
}

/**
 * Compte le registre pour alimenter `journal.counters`. Volontairement
 * séparé de l'écriture : les compteurs sont rafraîchis toutes les 25 lignes ou
 * toutes les 5 s, jamais à chaque élément (voir `publishEngine`).
 */
export function tallyLedger(folded: ReadonlyMap<string, LedgerLine>): LedgerTally {
  const tally: LedgerTally = { done: 0, uploaded: 0, damaged: 0, oversize: 0, doneBytes: 0 };
  for (const line of folded.values()) {
    switch (line.s) {
      case 'done':
        tally.done += 1;
        tally.doneBytes += line.n ?? 0;
        break;
      case 'uploaded':
        tally.uploaded += 1;
        break;
      case 'damaged':
        tally.damaged += 1;
        break;
      case 'oversize':
        tally.oversize += 1;
        break;
    }
  }
  return tally;
}

/**
 * Où reprendre un élément donné.
 *
 *  - `skip`     : terminal (`damaged`/`oversize`) ou déjà `done`.
 *  - `finalize` : ligne `uploaded` HÉRITÉE d'une version antérieure — le
 *                 transfert est CONFIRMÉ côté compte et, sous C1, il ne restait
 *                 rien de local derrière : on conclut sans repayer l'envoi.
 *                 (Le nom précédent, `reseal`, décrivait un geste qui n'existe
 *                 plus : la migration ne rescelle plus rien localement.)
 *  - `full`     : rien de connu, ou l'empreinte du clair a bougé depuis la
 *                 dernière tentative (le fichier a été modifié entre deux
 *                 reprises) : on repart de zéro, car mélanger deux versions
 *                 d'un fichier est le seul résultat qu'on n'accepte jamais.
 */
export function resumeActionFor(
  folded: ReadonlyMap<string, LedgerLine>,
  key: string,
  currentPlaintextSha256?: string
): 'skip' | 'finalize' | 'full' {
  const line = folded.get(key);
  if (!line) return 'full';
  if (line.s === 'done' || TERMINAL.has(line.s)) return 'skip';
  // `uploaded` : le chiffré est en place côté compte. Il ne vaut que pour le
  // clair qui l'a produit — si le fichier a changé depuis, l'objet monté ne
  // décrit plus le contenu local et tout doit être refait.
  if (
    currentPlaintextSha256 !== undefined &&
    line.c !== undefined &&
    line.c !== currentPlaintextSha256
  ) {
    return 'full';
  }
  return 'finalize';
}
