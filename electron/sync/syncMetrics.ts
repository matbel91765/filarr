/**
 * syncMetrics.ts — Instrumentation du cycle de synchronisation. PURE.
 *
 * Lot 93. Sans elle, toutes les optimisations de ce chantier sont des opinions :
 * on ne peut ni prouver que le decoupage par contenu a servi a quelque chose,
 * ni voir le jour ou une regression annule le gain.
 *
 * ── CE QU'ON MESURE, ET POURQUOI CHAQUE COMPTEUR EXISTE ──────────────────────
 *
 * `bytesUploaded` / `bytesDownloaded`
 *   Les octets reellement passes sur le reseau. La reference.
 *
 * `bytesAvoidedByDedup`
 *   Les octets qu'on aurait envoyes sans la deduplication de blocs. C'est LE
 *   chiffre qui dira si le passage au decoupage par contenu valait les trente
 *   jours de travail. A relever AVANT de basculer, sinon la comparaison est
 *   perdue pour toujours.
 *
 * `bytesAvoidedByCompression`
 *   Clair moins stocke, sur les blocs effectivement compresses. Separe du
 *   precedent : les deux gains se cumulent mais ne se pilotent pas pareil.
 *
 * `hashesSkipped` / `hashesComputed`
 *   Le tampon d'identite fait-il son travail ? En regime etabli le premier doit
 *   ecraser le second ; s'ils se rapprochent, un tampon ment quelque part.
 *
 * `bytesReadFromDisk`
 *   Le cout cache du constat n 2 — 14 Go par jour pour rehacher un blob de
 *   50 Mo toutes les cinq minutes. Le seul compteur qui rende ce gaspillage
 *   visible.
 *
 * ── LA LATENCE QUI COMPTE N'EST PAS LA DUREE DU TRANSFERT ────────────────────
 * `recordEndToEnd` mesure le temps entre l'enregistrement sur un appareil et
 * l'apparition sur un autre. C'est la seule metrique que l'utilisateur ressent,
 * et donc la seule qui merite un objectif chiffre (proposition 53).
 *
 * ── ZERO IMPORT, ZERO E/S ────────────────────────────────────────────────────
 * Rien n'est envoye nulle part. Les compteurs restent locaux et sont lus par
 * l'interface de diagnostic. Une instrumentation qui telephone a l'exterieur
 * serait une trahison du modele de menace du produit.
 */

/** Les phases d'un cycle, dans l'ordre ou elles s'enchainent. */
export type SyncPhase =
  | 'scan'
  | 'manifest'
  | 'diff'
  | 'upload'
  | 'download'
  | 'merge'
  | 'commit';

export const SYNC_PHASES: readonly SyncPhase[] = [
  'scan', 'manifest', 'diff', 'upload', 'download', 'merge', 'commit',
];

export interface PhaseStats {
  /** Nombre de fois que la phase a tourne. */
  runs: number;
  /** Duree cumulee, en millisecondes. */
  totalMs: number;
  /** Duree du passage le plus long — c'est lui qui fait rager l'utilisateur. */
  maxMs: number;
}

export interface MetricsSnapshot {
  cycles: number;
  bytesUploaded: number;
  bytesDownloaded: number;
  bytesAvoidedByDedup: number;
  bytesAvoidedByCompression: number;
  bytesReadFromDisk: number;
  hashesComputed: number;
  hashesSkipped: number;
  blocksUploaded: number;
  blocksReused: number;
  objectsBatched: number;
  requestsSaved: number;
  errors: number;
  phases: Record<SyncPhase, PhaseStats>;
  /** Latences bout en bout observees, en millisecondes. */
  endToEndMs: number[];
}

const ZERO_PHASE = (): PhaseStats => ({ runs: 0, totalMs: 0, maxMs: 0 });

/**
 * Nombre maximal de latences conservees.
 *
 * Borne volontaire : un compteur qui grandit sans fin dans un processus qui
 * tourne des semaines finit par etre le probleme qu'il servait a diagnostiquer.
 */
export const MAX_LATENCY_SAMPLES = 200;

export class SyncMetrics {
  private snap: MetricsSnapshot = SyncMetrics.empty();

  static empty(): MetricsSnapshot {
    const phases = {} as Record<SyncPhase, PhaseStats>;
    for (const p of SYNC_PHASES) phases[p] = ZERO_PHASE();
    return {
      cycles: 0,
      bytesUploaded: 0,
      bytesDownloaded: 0,
      bytesAvoidedByDedup: 0,
      bytesAvoidedByCompression: 0,
      bytesReadFromDisk: 0,
      hashesComputed: 0,
      hashesSkipped: 0,
      blocksUploaded: 0,
      blocksReused: 0,
      objectsBatched: 0,
      requestsSaved: 0,
      errors: 0,
      phases,
      endToEndMs: [],
    };
  }

  /** Rend une COPIE : un appelant ne doit jamais pouvoir muter les compteurs. */
  snapshot(): MetricsSnapshot {
    const phases = {} as Record<SyncPhase, PhaseStats>;
    for (const p of SYNC_PHASES) phases[p] = { ...this.snap.phases[p] };
    return { ...this.snap, phases, endToEndMs: [...this.snap.endToEndMs] };
  }

  reset(): void {
    this.snap = SyncMetrics.empty();
  }

  cycleStarted(): void {
    this.snap.cycles++;
  }

  errored(): void {
    this.snap.errors++;
  }

  /** Duree d'une phase. Les valeurs non finies ou negatives sont ignorees. */
  recordPhase(phase: SyncPhase, ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) return;
    const p = this.snap.phases[phase];
    if (!p) return;
    p.runs++;
    p.totalMs += ms;
    if (ms > p.maxMs) p.maxMs = ms;
  }

  /** Chronometre une phase et rend ce que le travail a rendu. */
  async time<T>(phase: SyncPhase, fn: () => Promise<T>, now: () => number = Date.now): Promise<T> {
    const start = now();
    try {
      return await fn();
    } finally {
      // `finally` et non apres le `return` : une phase qui echoue a quand meme
      // coute du temps, et c'est souvent celle-la qu'on cherche.
      this.recordPhase(phase, now() - start);
    }
  }

  transferred(direction: 'up' | 'down', bytes: number): void {
    if (!Number.isFinite(bytes) || bytes < 0) return;
    if (direction === 'up') this.snap.bytesUploaded += bytes;
    else this.snap.bytesDownloaded += bytes;
  }

  /**
   * Un bloc a ete reutilise au lieu d'etre renvoye.
   *
   * `storedBytes` est ce qu'on AURAIT envoye : c'est la taille stockee, pas
   * celle du clair. Compter le clair surestimerait le gain sur les blocs
   * compresses, et un chiffre flatteur ne sert a personne.
   */
  blockReused(storedBytes: number): void {
    if (!Number.isFinite(storedBytes) || storedBytes < 0) return;
    this.snap.blocksReused++;
    this.snap.bytesAvoidedByDedup += storedBytes;
  }

  blockUploaded(storedBytes: number): void {
    if (!Number.isFinite(storedBytes) || storedBytes < 0) return;
    this.snap.blocksUploaded++;
    this.snap.bytesUploaded += storedBytes;
  }

  /** Un bloc a ete compresse : `plainBytes` en clair, `storedBytes` stockes. */
  blockCompressed(plainBytes: number, storedBytes: number): void {
    if (!Number.isFinite(plainBytes) || !Number.isFinite(storedBytes)) return;
    const gain = plainBytes - storedBytes;
    // Un gain negatif signalerait un bloc qui a grossi — interdit par la regle
    // d'utilite. On ne l'enregistre pas comme un gain, on ne le soustrait pas
    // non plus : ce serait masquer un bogue derriere une moyenne.
    if (gain > 0) this.snap.bytesAvoidedByCompression += gain;
  }

  hashComputed(bytesRead: number): void {
    this.snap.hashesComputed++;
    if (Number.isFinite(bytesRead) && bytesRead > 0) this.snap.bytesReadFromDisk += bytesRead;
  }

  hashSkipped(): void {
    this.snap.hashesSkipped++;
  }

  /** Un lot a remplace `count` requetes par une seule (lot 47). */
  batched(count: number): void {
    if (!Number.isInteger(count) || count < 1) return;
    this.snap.objectsBatched += count;
    this.snap.requestsSaved += Math.max(0, count - 1);
  }

  /** Temps entre l'enregistrement sur un appareil et l'apparition sur un autre. */
  recordEndToEnd(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) return;
    this.snap.endToEndMs.push(ms);
    if (this.snap.endToEndMs.length > MAX_LATENCY_SAMPLES) this.snap.endToEndMs.shift();
  }
}

// ── Lecture ──────────────────────────────────────────────────────────────────

/**
 * Part des octets evitee, entre 0 et 1.
 *
 * Denominateur = ce qu'on aurait envoye SANS le chantier : les octets envoyes
 * plus ceux evites. Prendre les seuls octets envoyes rendrait un ratio superieur
 * a 1 et ne voudrait rien dire.
 */
export function savingsRatio(s: MetricsSnapshot): number {
  const avoided = s.bytesAvoidedByDedup + s.bytesAvoidedByCompression;
  const would = s.bytesUploaded + avoided;
  return would === 0 ? 0 : avoided / would;
}

/** Part des hachages evites par le tampon d'identite, entre 0 et 1. */
export function hashSkipRatio(s: MetricsSnapshot): number {
  const total = s.hashesComputed + s.hashesSkipped;
  return total === 0 ? 0 : s.hashesSkipped / total;
}

/**
 * Centile des latences bout en bout.
 *
 * La mediane ment sur une distribution a longue traine ; c'est le 95e qui dit
 * ce que vit l'utilisateur mecontent.
 */
export function latencyPercentile(s: MetricsSnapshot, p: number): number {
  if (s.endToEndMs.length === 0) return 0;
  const sorted = [...s.endToEndMs].sort((a, b) => a - b);
  const clamped = Math.min(1, Math.max(0, p));
  const idx = Math.min(sorted.length - 1, Math.floor(clamped * (sorted.length - 1)));
  return sorted[idx];
}

/** Resume lisible, pour l'ecran de diagnostic. */
export function formatSnapshot(s: MetricsSnapshot): string {
  const mo = (n: number) => `${(n / 1_000_000).toFixed(2)} Mo`;
  const pct = (n: number) => `${(n * 100).toFixed(1)} %`;
  const lignes = [
    `cycles                  ${s.cycles}`,
    `envoye                  ${mo(s.bytesUploaded)}`,
    `recu                    ${mo(s.bytesDownloaded)}`,
    `evite (deduplication)   ${mo(s.bytesAvoidedByDedup)}`,
    `evite (compression)     ${mo(s.bytesAvoidedByCompression)}`,
    `part evitee             ${pct(savingsRatio(s))}`,
    `hachages evites         ${s.hashesSkipped} / ${s.hashesComputed + s.hashesSkipped} (${pct(hashSkipRatio(s))})`,
    `lu sur disque           ${mo(s.bytesReadFromDisk)}`,
    `blocs reutilises        ${s.blocksReused} / ${s.blocksReused + s.blocksUploaded}`,
    `requetes economisees    ${s.requestsSaved}`,
    `latence p50 / p95       ${latencyPercentile(s, 0.5)} ms / ${latencyPercentile(s, 0.95)} ms`,
    `erreurs                 ${s.errors}`,
  ];
  for (const p of SYNC_PHASES) {
    const st = s.phases[p];
    if (st.runs > 0) {
      lignes.push(`  ${p.padEnd(10)} ${st.runs}x, cumul ${st.totalMs} ms, max ${st.maxMs} ms`);
    }
  }
  return lignes.join('\n');
}
