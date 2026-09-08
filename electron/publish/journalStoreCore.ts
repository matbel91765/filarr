/**
 * Le JOURNAL et le REGISTRE sur le disque — sans `electron`.
 *
 * POURQUOI CE DÉCOUPAGE. Le journal décide, au démarrage, s'il faut reprendre
 * une migration — et la reprise décide de la CLÉ. C'est donc le code le plus
 * sensible du parcours, celui qui doit être testable avec un vrai système de
 * fichiers et sans process principal. Ce module ne connaît donc que : un
 * répertoire de base, et deux fonctions pour sceller/desceller un tampon.
 * `journalStore.ts` y branche `safeStorage` et `app.getPath('userData')`.
 *
 * DEUX ENGAGEMENTS D'ÉCRITURE :
 *  - le journal s'écrit en TEMP + RENAME. Une coupure entre les deux laisse
 *    l'ANCIEN journal entier et valide ; il n'existe aucun instant où le
 *    fichier est à moitié écrit. Un journal à moitié écrit, c'est un état de
 *    bascule inventé.
 *  - le registre est strictement APPEND-ONLY, jamais réécrit ni compacté en
 *    cours de migration. Une réécriture serait une fenêtre pendant laquelle
 *    l'historique n'existe nulle part.
 */

import fs from 'fs/promises';
import path from 'path';
import { parseLedger } from './ledger';
import type { LedgerLine, PublishJournal } from './types';

export const JOURNAL_FILE = 'publish-journal.json';
export const PUBLISH_DIR = 'publish';

export interface JournalSealer {
  /** Scelle un JSON (safeStorage en production). */
  seal(plain: string): Buffer;
  unseal(sealed: Buffer): string;
}

/**
 * Valide la forme d'un journal relu.
 *
 * UN JOURNAL ILLISIBLE OU DÉFORMÉ EST TRAITÉ COMME ABSENT — jamais comme une
 * erreur bloquante, et surtout jamais comme une instruction. C'est la règle
 * qui garantit qu'un fichier abîmé ne déclenche pas une bascule : sans journal,
 * la clé active ne bouge pas, et l'application démarre normalement.
 */
export function parseJournal(raw: string): PublishJournal | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const j = parsed as Partial<PublishJournal>;
  if (j.schema !== 1) return null;
  if (typeof j.migrationId !== 'string' || !j.migrationId) return null;
  if (typeof j.state !== 'string') return null;
  if (!j.counters || typeof j.counters.totalItems !== 'number') return null;
  if (!j.switch || typeof j.switch.staged !== 'boolean') return null;
  if (!Array.isArray(j.targetProfiles)) return null;
  if (!Array.isArray(j.blockers)) return null;
  if (!j.verify || !Array.isArray(j.verify.plan) || !Array.isArray(j.verify.failed)) return null;
  return j as PublishJournal;
}

export interface JournalStore {
  journalPath: string;
  read(): Promise<PublishJournal | null>;
  write(journal: PublishJournal): Promise<void>;
  remove(): Promise<void>;
  ledgerPath(migrationId: string, localProfileId: string): string;
  appendLedger(migrationId: string, localProfileId: string, line: LedgerLine): Promise<void>;
  readLedger(migrationId: string, localProfileId: string): Promise<Map<string, LedgerLine>>;
  purgeMigration(migrationId: string): Promise<void>;
}

export function createJournalStore(baseDir: string, sealer: JournalSealer): JournalStore {
  const journalPath = path.join(baseDir, JOURNAL_FILE);

  const migrationDir = (migrationId: string): string =>
    // Les identifiants viennent de `crypto.randomUUID`, mais un journal relu
    // vient du disque : on filtre quand même, un `..` ici écrirait n'importe où.
    path.join(baseDir, PUBLISH_DIR, migrationId.replace(/[^a-zA-Z0-9-]/g, ''));

  const ledgerPath = (migrationId: string, localProfileId: string): string =>
    path.join(migrationDir(migrationId), `${localProfileId.replace(/[^a-zA-Z0-9-]/g, '')}.ledger`);

  return {
    journalPath,

    async read(): Promise<PublishJournal | null> {
      let sealed: Buffer;
      try {
        sealed = await fs.readFile(journalPath);
      } catch {
        return null;
      }
      try {
        return parseJournal(sealer.unseal(sealed));
      } catch {
        // Sceau illisible (autre session OS, trousseau réinitialisé) : traité
        // comme absent. Voir plus haut — un journal abîmé ne bascule rien.
        return null;
      }
    },

    async write(journal: PublishJournal): Promise<void> {
      await fs.mkdir(baseDir, { recursive: true });
      const payload = sealer.seal(JSON.stringify({ ...journal, updatedAt: new Date().toISOString() }));
      // Le temporaire est VOISIN du journal : `rename` n'est atomique que dans
      // un même système de fichiers, et un `os.tmpdir()` peut être ailleurs.
      const tmp = `${journalPath}.${Date.now().toString(36)}.tmp`;
      const handle = await fs.open(tmp, 'w', 0o600);
      try {
        await handle.writeFile(payload);
        // fsync avant le rename : sans lui, une coupure d'alimentation peut
        // publier un nom qui pointe sur des octets jamais descendus au disque.
        await handle.sync().catch(() => undefined);
      } finally {
        await handle.close().catch(() => undefined);
      }
      await fs.rename(tmp, journalPath);
    },

    async remove(): Promise<void> {
      await fs.unlink(journalPath).catch(() => undefined);
    },

    ledgerPath,

    async appendLedger(migrationId, localProfileId, line): Promise<void> {
      const filePath = ledgerPath(migrationId, localProfileId);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      // `appendFile` en O_APPEND : chaque ligne est un ajout, jamais un
      // remplacement. Une ligne tronquée par une coupure est ignorée à la
      // relecture (voir `parseLedger`), ce qui borne le coût d'une mort de
      // l'application à la DERNIÈRE transition.
      await fs.appendFile(filePath, `${JSON.stringify(line)}\n`, { mode: 0o600 });
    },

    async readLedger(migrationId, localProfileId): Promise<Map<string, LedgerLine>> {
      try {
        const raw = await fs.readFile(ledgerPath(migrationId, localProfileId), 'utf-8');
        return parseLedger(raw);
      } catch {
        return new Map();
      }
    },

    async purgeMigration(migrationId): Promise<void> {
      await fs.rm(migrationDir(migrationId), { recursive: true, force: true }).catch(() => undefined);
    },
  };
}
