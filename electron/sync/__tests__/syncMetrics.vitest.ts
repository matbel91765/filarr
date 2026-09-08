/**
 * syncMetrics.vitest.ts — Instrumentation du cycle de synchronisation.
 *
 * Ce qui est defendu :
 *  1. LES CHIFFRES NE FLATTENT PAS. Un bloc qui a grossi n est pas compte comme
 *     un gain, et la deduplication est mesuree sur la taille STOCKEE.
 *  2. UNE PHASE QUI ECHOUE EST QUAND MEME CHRONOMETREE. C est souvent celle-la
 *     qu on cherche.
 *  3. LES COMPTEURS SONT BORNES. Un compteur qui grandit sans fin dans un
 *     processus qui tourne des semaines devient le probleme qu il diagnostique.
 *  4. UN INSTANTANE EST UNE COPIE. Un appelant ne doit jamais muter l etat.
 */

import { describe, it, expect } from 'vitest';
import {
  MAX_LATENCY_SAMPLES,
  SYNC_PHASES,
  SyncMetrics,
  formatSnapshot,
  hashSkipRatio,
  latencyPercentile,
  savingsRatio,
} from '../syncMetrics';

describe('compteurs de transfert', () => {
  it('separe montant et descendant', () => {
    const m = new SyncMetrics();
    m.transferred('up', 1000);
    m.transferred('down', 2500);
    const s = m.snapshot();
    expect(s.bytesUploaded).toBe(1000);
    expect(s.bytesDownloaded).toBe(2500);
  });

  it('ignore les valeurs absurdes plutot que de polluer la mesure', () => {
    const m = new SyncMetrics();
    m.transferred('up', -5);
    m.transferred('up', Number.NaN);
    m.transferred('up', Number.POSITIVE_INFINITY);
    expect(m.snapshot().bytesUploaded).toBe(0);
  });
});

describe('deduplication et compression — les chiffres ne flattent pas', () => {
  it('la deduplication se mesure sur la taille STOCKEE, pas sur le clair', () => {
    // Compter le clair surestimerait le gain sur les blocs compresses, et un
    // chiffre flatteur ne sert a personne.
    const m = new SyncMetrics();
    m.blockReused(300);
    m.blockReused(128);
    const s = m.snapshot();
    expect(s.blocksReused).toBe(2);
    expect(s.bytesAvoidedByDedup).toBe(428);
  });

  it('un bloc qui aurait GROSSI n est pas compte comme un gain', () => {
    // La regle d utilite interdit qu un bloc grossisse. Si ca arrivait quand
    // meme, l enregistrer comme un gain negatif le masquerait dans une
    // moyenne — on prefere que le bogue reste visible ailleurs.
    const m = new SyncMetrics();
    m.blockCompressed(1000, 1200);
    expect(m.snapshot().bytesAvoidedByCompression).toBe(0);
  });

  it('compte le gain reel d un bloc compresse', () => {
    const m = new SyncMetrics();
    m.blockCompressed(1000, 300);
    expect(m.snapshot().bytesAvoidedByCompression).toBe(700);
  });

  it('un bloc televerse compte dans les octets envoyes', () => {
    const m = new SyncMetrics();
    m.blockUploaded(500);
    const s = m.snapshot();
    expect(s.blocksUploaded).toBe(1);
    expect(s.bytesUploaded).toBe(500);
  });

  it('la part evitee se calcule sur ce qu on AURAIT envoye', () => {
    // Denominateur = envoye + evite. Prendre les seuls octets envoyes rendrait
    // un ratio superieur a 1, qui ne veut rien dire.
    const m = new SyncMetrics();
    m.blockUploaded(400);
    m.blockReused(600);
    expect(savingsRatio(m.snapshot())).toBeCloseTo(0.6, 5);
  });

  it('la part evitee vaut 0 quand rien n a circule', () => {
    expect(savingsRatio(SyncMetrics.empty())).toBe(0);
  });
});

describe('tampon d identite', () => {
  it('compte les hachages evites et ceux payes', () => {
    const m = new SyncMetrics();
    for (let i = 0; i < 9; i++) m.hashSkipped();
    m.hashComputed(50_000_000);
    const s = m.snapshot();
    expect(s.hashesSkipped).toBe(9);
    expect(s.hashesComputed).toBe(1);
    expect(s.bytesReadFromDisk).toBe(50_000_000);
    expect(hashSkipRatio(s)).toBeCloseTo(0.9, 5);
  });

  it('rend le cout du constat n 2 visible', () => {
    // 288 cycles par jour x un blob de 50 Mo = 14,4 Go de lecture pour rien.
    // Sans ce compteur, ce gaspillage n apparait nulle part.
    const m = new SyncMetrics();
    for (let i = 0; i < 288; i++) m.hashComputed(50_000_000);
    expect(m.snapshot().bytesReadFromDisk).toBe(14_400_000_000);
  });
});

describe('phases', () => {
  it('cumule duree et retient le maximum', () => {
    const m = new SyncMetrics();
    m.recordPhase('upload', 100);
    m.recordPhase('upload', 400);
    m.recordPhase('upload', 250);
    const p = m.snapshot().phases.upload;
    expect(p.runs).toBe(3);
    expect(p.totalMs).toBe(750);
    expect(p.maxMs).toBe(400);
  });

  it('ignore une duree absurde', () => {
    const m = new SyncMetrics();
    m.recordPhase('scan', -1);
    m.recordPhase('scan', Number.NaN);
    expect(m.snapshot().phases.scan.runs).toBe(0);
  });

  it('chronometre une phase qui REUSSIT', async () => {
    const m = new SyncMetrics();
    let t = 1000;
    const now = () => t;
    const r = await m.time('merge', async () => { t += 42; return 'ok'; }, now);
    expect(r).toBe('ok');
    expect(m.snapshot().phases.merge.totalMs).toBe(42);
  });

  it('chronometre une phase qui ECHOUE — c est souvent celle-la qu on cherche', async () => {
    const m = new SyncMetrics();
    let t = 1000;
    const now = () => t;
    await expect(
      m.time('upload', async () => { t += 77; throw new Error('reseau'); }, now)
    ).rejects.toThrow('reseau');
    expect(m.snapshot().phases.upload.totalMs).toBe(77);
    expect(m.snapshot().phases.upload.runs).toBe(1);
  });

  it('connait toutes les phases du cycle', () => {
    const s = SyncMetrics.empty();
    for (const p of SYNC_PHASES) expect(s.phases[p]).toEqual({ runs: 0, totalMs: 0, maxMs: 0 });
  });
});

describe('latence bout en bout', () => {
  it('rend les centiles', () => {
    const m = new SyncMetrics();
    for (const v of [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]) m.recordEndToEnd(v);
    const s = m.snapshot();
    expect(latencyPercentile(s, 0.5)).toBe(50);
    expect(latencyPercentile(s, 0.95)).toBe(90);
    expect(latencyPercentile(s, 1)).toBe(100);
    expect(latencyPercentile(s, 0)).toBe(10);
  });

  it('rend 0 sans echantillon', () => {
    expect(latencyPercentile(SyncMetrics.empty(), 0.95)).toBe(0);
  });

  it('BORNE le nombre d echantillons conserves', () => {
    // Un compteur qui grandit sans fin dans un processus qui tourne des
    // semaines finit par etre le probleme qu il servait a diagnostiquer.
    const m = new SyncMetrics();
    for (let i = 0; i < MAX_LATENCY_SAMPLES + 50; i++) m.recordEndToEnd(i);
    const s = m.snapshot();
    expect(s.endToEndMs.length).toBe(MAX_LATENCY_SAMPLES);
    // Ce sont les PLUS RECENTS qu on garde : une latence d il y a trois jours
    // ne dit rien de l etat actuel.
    expect(s.endToEndMs[s.endToEndMs.length - 1]).toBe(MAX_LATENCY_SAMPLES + 49);
  });
});

describe('regroupement (lot 47)', () => {
  it('compte les requetes economisees', () => {
    const m = new SyncMetrics();
    m.batched(1000);
    const s = m.snapshot();
    expect(s.objectsBatched).toBe(1000);
    expect(s.requestsSaved).toBe(999);
  });

  it('un lot d un seul objet n economise rien', () => {
    const m = new SyncMetrics();
    m.batched(1);
    expect(m.snapshot().requestsSaved).toBe(0);
  });

  it('ignore un compte absurde', () => {
    const m = new SyncMetrics();
    m.batched(0);
    m.batched(-3);
    m.batched(1.5);
    expect(m.snapshot().objectsBatched).toBe(0);
  });
});

describe('instantane', () => {
  it('est une COPIE — un appelant ne mute jamais l etat', () => {
    const m = new SyncMetrics();
    m.transferred('up', 100);
    const s = m.snapshot();
    s.bytesUploaded = 999_999;
    s.phases.upload.runs = 42;
    s.endToEndMs.push(1);
    const encore = m.snapshot();
    expect(encore.bytesUploaded).toBe(100);
    expect(encore.phases.upload.runs).toBe(0);
    expect(encore.endToEndMs).toEqual([]);
  });

  it('se remet a zero', () => {
    const m = new SyncMetrics();
    m.cycleStarted();
    m.transferred('up', 100);
    m.errored();
    m.reset();
    const s = m.snapshot();
    expect(s.cycles).toBe(0);
    expect(s.bytesUploaded).toBe(0);
    expect(s.errors).toBe(0);
  });
});

describe('resume lisible', () => {
  it('rend un texte qui porte les chiffres qui comptent', () => {
    const m = new SyncMetrics();
    m.cycleStarted();
    m.blockUploaded(1_000_000);
    m.blockReused(3_000_000);
    m.blockCompressed(2_000_000, 500_000);
    m.recordPhase('upload', 1200);
    m.recordEndToEnd(4200);
    const texte = formatSnapshot(m.snapshot());
    expect(texte).toContain('cycles');
    expect(texte).toContain('part evitee');
    expect(texte).toContain('latence p50 / p95');
    expect(texte).toContain('upload');
    // Une phase jamais executee ne doit pas encombrer le resume.
    expect(texte).not.toContain('commit ');
  });
});
