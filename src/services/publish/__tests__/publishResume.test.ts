/**
 * LA REPRISE APRÈS INTERRUPTION.
 *
 * Des semaines de données, c'est des heures de migration : batterie, veille,
 * réseau qui tombe, application tuée par le système. Une interruption DOIT
 * reprendre où elle en était, et surtout ne jamais produire un état mixte
 * illisible. Ces tests verrouillent le journal (temp + rename), le registre
 * (append-only, dernière ligne fait foi) et la conduite de reprise, état par
 * état.
 */

import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { createJournalStore, parseJournal } from '../../../../electron/publish/journalStoreCore';
import { parseLedger, resumeActionFor, tallyLedger } from '../../../../electron/publish/ledger';
import {
  createJournal,
  decideResume,
  isReceiptExpired,
  RECEIPT_TTL_MS,
} from '../../../../electron/publish/journalMachine';
import type { PublishJournal } from '../../../../electron/publish/types';
import { describe, it, expect } from 'vitest';

const CLEAR_SEALER = {
  seal: (plain: string): Buffer => Buffer.from(plain, 'utf-8'),
  unseal: (sealed: Buffer): string => sealed.toString('utf-8'),
};

function journal(state: PublishJournal['state'], patch: Partial<PublishJournal> = {}) {
  return {
    ...createJournal({
      migrationId: '11111111-2222-3333-4444-555555555555',
      accountUserId: 'user-1',
      accountKeyDigest: 'digest',
      wrappedDigest: 'wrapped',
      now: '2026-08-11T10:00:00.000Z',
    }),
    state,
    ...patch,
  };
}

async function tempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'filarr-publish-'));
}

// ── Le journal ──────────────────────────────────────────────────────────────

describe('journal — écriture et relecture', () => {
  it('B2 — temp + rename : aucun instant où le fichier est à moitié écrit', async () => {
    const dir = await tempDir();
    const store = createJournalStore(dir, CLEAR_SEALER);

    await store.write(journal('PREPARING'));
    const first = await store.read();
    expect(first?.state).toBe('PREPARING');

    await store.write(journal('PUBLISHING'));
    const second = await store.read();
    expect(second?.state).toBe('PUBLISHING');

    // Le fichier définitif est seul en place : les temporaires ont TOUS été
    // consommés par le rename. Un `.tmp` résiduel signifierait une écriture
    // dont on ne sait pas si elle a abouti.
    const left = await fs.readdir(dir);
    expect(left.filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('B2 — un temporaire abandonné ne remplace JAMAIS le journal en place', async () => {
    const dir = await tempDir();
    const store = createJournalStore(dir, CLEAR_SEALER);
    await store.write(journal('READY'));

    // Simule une coupure entre l'écriture du temporaire et le rename.
    await fs.writeFile(
      path.join(dir, 'publish-journal.json.zzz.tmp'),
      JSON.stringify(journal('SWITCHING'))
    );

    expect((await store.read())?.state).toBe('READY');
  });

  it('B3 — un journal corrompu est traité comme ABSENT (jamais comme une instruction)', async () => {
    const dir = await tempDir();
    const store = createJournalStore(dir, CLEAR_SEALER);
    await fs.writeFile(path.join(dir, 'publish-journal.json'), '{ ceci n est pas du JSON');
    expect(await store.read()).toBeNull();

    expect(parseJournal('{}')).toBeNull();
    expect(parseJournal(JSON.stringify({ schema: 2, migrationId: 'x' }))).toBeNull();
  });
});

// ── Le registre ─────────────────────────────────────────────────────────────

describe('registre — append-only', () => {
  it('C1 — la dernière ligne TRONQUÉE est abandonnée, les précédentes restent intactes', () => {
    const raw =
      '{"k":"a","s":"uploaded","c":"c1","r":"r1","n":10,"ch":1,"t":"t"}\n' +
      '{"k":"b","s":"done","t":"t"}\n' +
      '{"k":"c","s":"upl'; // mort de l'application en cours d'écriture
    const folded = parseLedger(raw);
    expect([...folded.keys()]).toEqual(['a', 'b']);
  });

  it('C2 — plusieurs lignes pour une clé : la DERNIÈRE fait foi', () => {
    const raw =
      '{"k":"a","s":"uploaded","r":"r1","n":10,"ch":1,"t":"t1"}\n' +
      '{"k":"a","s":"done","t":"t2"}\n';
    expect(parseLedger(raw).get('a')?.s).toBe('done');
  });

  it('C3 — une ligne `uploaded` HÉRITÉE se conclut, elle ne se réenvoie pas', () => {
    // Sous C1 plus rien n'est re-scellé localement : entre « envoyé » et
    // « terminé » il ne reste aucun geste. Une ligne `uploaded` écrite par une
    // version antérieure atteste donc un transfert confirmé dont il ne manque
    // que la conclusion — la repayer serait un gaspillage, pas une sûreté.
    const folded = parseLedger('{"k":"a","s":"uploaded","c":"deadbeef","n":10,"ch":1,"t":"t"}\n');
    expect(resumeActionFor(folded, 'a', 'deadbeef')).toBe('finalize');
  });

  it('F12 — un clair qui a CHANGÉ entre deux reprises repart de zéro', () => {
    const folded = parseLedger('{"k":"a","s":"uploaded","c":"deadbeef","n":10,"ch":1,"t":"t"}\n');
    // On ne mélange jamais deux versions d'un même fichier.
    expect(resumeActionFor(folded, 'a', 'cafe')).toBe('full');
  });

  it('C4 — `damaged` et `oversize` sont terminaux : jamais retentés', () => {
    const folded = parseLedger(
      '{"k":"a","s":"damaged","why":"corrupt","t":"t"}\n{"k":"b","s":"oversize","n":9,"t":"t"}\n'
    );
    expect(resumeActionFor(folded, 'a')).toBe('skip');
    expect(resumeActionFor(folded, 'b')).toBe('skip');
  });

  it('C6 — le registre est en AJOUT SEUL : une écriture n en réécrit aucune autre', async () => {
    // La reprenabilité repose entièrement là-dessus. Une implémentation qui
    // relirait tout le fichier et le RÉÉCRIRAIT intégralement à chaque ligne
    // ouvrirait, à chaque élément, une fenêtre pendant laquelle l'historique
    // n'existe nulle part — et le coût serait quadratique. Ce test échoue si
    // quiconque revient à une réécriture.
    const dir = await tempDir();
    const store = createJournalStore(dir, CLEAR_SEALER);
    const mid = '11111111-2222-3333-4444-555555555555';

    await store.appendLedger(mid, 'p1', { k: 'a', s: 'uploaded', n: 1, ch: 1, t: 't1' });
    const afterFirst = await fs.readFile(store.ledgerPath(mid, 'p1'), 'utf-8');
    await store.appendLedger(mid, 'p1', { k: 'a', s: 'done', t: 't2' });
    const afterSecond = await fs.readFile(store.ledgerPath(mid, 'p1'), 'utf-8');
    await store.appendLedger(mid, 'p1', { k: 'b', s: 'damaged', why: 'corrupt', t: 't3' });
    const afterThird = await fs.readFile(store.ledgerPath(mid, 'p1'), 'utf-8');

    // Chaque état est un PRÉFIXE strict du suivant : les octets déjà écrits ne
    // bougent plus jamais.
    expect(afterSecond.startsWith(afterFirst)).toBe(true);
    expect(afterThird.startsWith(afterSecond)).toBe(true);
    expect(afterThird.length).toBeGreaterThan(afterSecond.length);
    const folded = await store.readLedger(mid, 'p1');
    expect(tallyLedger(folded)).toEqual({
      done: 1,
      uploaded: 0,
      damaged: 1,
      oversize: 0,
      doneBytes: 0,
    });
  });
});

// ── La conduite de reprise ──────────────────────────────────────────────────

describe('decideResume — état par état', () => {
  const NOW = Date.parse('2026-08-11T12:00:00.000Z');

  it('journal absent ⇒ rien : parcours normal', () => {
    expect(decideResume(null, 'user-1', NOW)).toEqual({ action: 'none' });
  });

  it('B5 — PREPARING et READY reconstruisent l inventaire, jamais ne le rechargent', () => {
    expect(decideResume(journal('PREPARING'), 'user-1', NOW)).toEqual({
      action: 'rebuild-inventory',
      nextState: 'PREPARING',
    });
    expect(decideResume(journal('READY'), 'user-1', NOW)).toEqual({
      action: 'rebuild-inventory',
      nextState: 'PREPARING',
    });
  });

  it('PUBLISHING reprend au premier élément non traité', () => {
    expect(decideResume(journal('PUBLISHING'), 'user-1', NOW).action).toBe('resume-publish');
  });

  it('B6 — VERIFYING recommence la preuve depuis zéro (elle est rejouable à l identique)', () => {
    expect(decideResume(journal('VERIFYING'), 'user-1', NOW).action).toBe('restart-verify');
  });

  it('SWITCHING passe par la décision du pivot', () => {
    expect(decideResume(journal('SWITCHING'), 'user-1', NOW).action).toBe('resume-switch');
  });

  it('B4 — une migration ouverte pour un AUTRE compte est abandonnée sans discussion', () => {
    expect(decideResume(journal('PUBLISHING'), 'user-2', NOW)).toEqual({
      action: 'abandon-foreign-account',
      nextState: 'ABANDONED',
    });
  });

  it('B7 — le reçu vit 7 jours, puis disparaît de lui-même', () => {
    const done = journal('DONE', { doneAt: '2026-08-11T10:00:00.000Z' });
    expect(decideResume(done, 'user-1', NOW).action).toBe('keep-receipt');
    expect(isReceiptExpired(done, NOW)).toBe(false);

    const late = Date.parse('2026-08-11T10:00:00.000Z') + RECEIPT_TTL_MS + 1;
    expect(decideResume(done, 'user-1', late).action).toBe('purge-receipt');
    expect(isReceiptExpired(done, late)).toBe(true);
  });

  it('ABANDONED reprend le ménage — qui est lui-même reprenable', () => {
    expect(decideResume(journal('ABANDONED'), 'user-1', NOW).action).toBe('resume-cleanup');
  });
});
