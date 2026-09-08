/**
 * scanStamp.ts — Tampon d'identité de fichier, PUR.
 *
 * Lot 2 du chantier synchronisation, et la moitié de la réponse au constat n° 2.
 *
 * ── LE PROBLÈME ──────────────────────────────────────────────────────────────
 * `scanLocalFiles` recalcule un SHA-256 COMPLET de `notes.enc`, `layout.enc` et
 * des deux fichiers de rappels à CHAQUE cycle — toutes les cinq minutes, 288
 * fois par jour. Sur un coffre sérieux, `notes.enc` pèse des dizaines de
 * mégaoctets : c'est une dizaine de gigaoctets de lecture disque par jour, pour
 * répondre à une question à laquelle une seule syscall répond.
 *
 * ── CE QUE FAIT LE TAMPON ────────────────────────────────────────────────────
 * On mémorise `(taille, mtimeMs, inode)`. Si les trois sont inchangés, le
 * contenu l'est aussi et on saute le hachage. C'est la technique de l'index de
 * git, et elle vaut ici pour la même raison.
 *
 * ── ET CE QU'IL NE FAIT PAS ──────────────────────────────────────────────────
 * Le tampon peut MENTIR. Une horloge qui recule, un système de fichiers réseau
 * à granularité grossière, une restauration qui repose les métadonnées : deux
 * contenus différents peuvent porter le même tampon.
 *
 * Il ne remplace donc jamais le hachage, il l'ÉVITE dans le cas courant. Le
 * filet reste : `isStale` force un rehachage périodique, et l'observateur de
 * fichiers (lot 1) signale ce que le tampon n'aurait pas vu. Trois défenses,
 * dont aucune n'est parfaite seule.
 *
 * ── ZÉRO IMPORT ──────────────────────────────────────────────────────────────
 * Aucun `fs` : l'appelant fournit les métadonnées. C'est ce qui rend ce module
 * testable sans toucher au disque, et transposable si le mobile en veut un jour.
 */

/** Ce qu'on retient d'un fichier pour décider s'il a bougé. */
export interface FileStamp {
  /** Taille en octets. */
  size: number;
  /** Date de modification en millisecondes. */
  mtimeMs: number;
  /**
   * Numéro d'inode, ou 0 quand la plateforme n'en expose pas.
   *
   * Sous Windows, `ino` vaut souvent 0 : le tampon perd alors une dimension et
   * devient (taille, mtime). C'est moins fort, jamais faux — un fichier
   * remplacé par un autre de même taille à la même milliseconde reste
   * théoriquement possible, et c'est exactement pourquoi le rehachage
   * périodique existe.
   */
  ino: number;
  /** Horodatage du dernier hachage complet, en millisecondes. */
  hashedAt: number;
}

/** Métadonnées minimales attendues d'un `fs.Stats`. */
export interface StatLike {
  size: number;
  mtimeMs: number;
  ino?: number;
}

/**
 * Intervalle au-delà duquel on rehache même si le tampon dit « inchangé ».
 *
 * Sept jours : assez rare pour que le gain reste entier en régime établi, assez
 * fréquent pour qu'une divergence due à un tampon menteur ne survive pas une
 * semaine sans être vue.
 */
export const REHASH_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

/** Construit le tampon d'un fichier qu'on vient de hacher. */
export function stampOf(stat: StatLike, now: number): FileStamp {
  return {
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    ino: typeof stat.ino === 'number' ? stat.ino : 0,
    hashedAt: now,
  };
}

/**
 * Le fichier a-t-il la même identité que celle mémorisée ?
 *
 * Ne dit PAS « le contenu est identique » — dit « rien dans les métadonnées ne
 * signale un changement ». La nuance est tout l'objet de l'en-tête ci-dessus.
 */
export function sameIdentity(stamp: FileStamp | undefined, stat: StatLike): boolean {
  if (!stamp) return false;
  if (stamp.size !== stat.size) return false;
  if (stamp.mtimeMs !== stat.mtimeMs) return false;
  const ino = typeof stat.ino === 'number' ? stat.ino : 0;
  // Un inode absent des DEUX côtés (Windows) ne disqualifie pas ; un inode
  // présent qui a changé, si — le fichier a été remplacé, pas modifié.
  if (stamp.ino !== 0 && ino !== 0 && stamp.ino !== ino) return false;
  return true;
}

/**
 * Faut-il rehacher ce fichier ?
 *
 * `true` si le tampon manque, si l'identité a changé, si le fichier a été
 * marqué sale par l'observateur, ou si le dernier hachage est trop ancien.
 */
export function needsRehash(
  stamp: FileStamp | undefined,
  stat: StatLike,
  now: number,
  dirty = false,
  interval = REHASH_INTERVAL_MS
): boolean {
  if (dirty) return true;
  if (!sameIdentity(stamp, stat)) return true;
  // `stamp` est forcément défini ici : `sameIdentity` rend false sans tampon.
  return now - (stamp as FileStamp).hashedAt >= interval;
}

/**
 * Le tampon est-il périmé au point qu'il faille le reconstruire ?
 *
 * Distinct de `needsRehash` : celui-ci répond « faut-il relire le fichier »,
 * celui-là « ce tampon est-il encore digne de foi ». Un tampon dont
 * `hashedAt` est dans le FUTUR est suspect — horloge reculée, fichier copié
 * depuis une machine en avance — et on préfère le jeter que le croire.
 */
export function isStale(stamp: FileStamp | undefined, now: number, interval = REHASH_INTERVAL_MS): boolean {
  if (!stamp) return true;
  if (stamp.hashedAt > now) return true;
  return now - stamp.hashedAt >= interval;
}

// ── Registre ─────────────────────────────────────────────────────────────────

/**
 * Les tampons d'un profil, plus l'ensemble des fichiers que l'observateur a
 * signalés comme modifiés depuis le dernier balayage.
 *
 * Le drapeau « sale » est une PORTE OUVERTE, jamais une porte fermée : un
 * fichier sale est toujours rehaché, un fichier non sale peut quand même
 * l'être. C'est ce qui rend l'observateur inoffensif s'il rate un événement —
 * il accélère la détection, il n'en est jamais l'unique source.
 */
export class StampRegistry {
  private readonly stamps = new Map<string, FileStamp>();
  private readonly dirty = new Set<string>();

  get(key: string): FileStamp | undefined {
    return this.stamps.get(key);
  }

  /** Enregistre le tampon d'un fichier qu'on vient de hacher, et le lave. */
  record(key: string, stat: StatLike, now: number): FileStamp {
    const stamp = stampOf(stat, now);
    this.stamps.set(key, stamp);
    this.dirty.delete(key);
    return stamp;
  }

  /** Signalé par l'observateur : ce fichier a bougé, quel que soit son tampon. */
  markDirty(key: string): void {
    this.dirty.add(key);
  }

  isDirty(key: string): boolean {
    return this.dirty.has(key);
  }

  /** Décide, pour ce fichier, s'il faut payer un hachage complet. */
  shouldHash(key: string, stat: StatLike, now: number, interval = REHASH_INTERVAL_MS): boolean {
    return needsRehash(this.stamps.get(key), stat, now, this.dirty.has(key), interval);
  }

  /** Oublie un fichier — suppression, ou sortie du périmètre de synchro. */
  forget(key: string): void {
    this.stamps.delete(key);
    this.dirty.delete(key);
  }

  /** Vide tout. Un changement de profil ne doit rien laisser derrière lui. */
  clear(): void {
    this.stamps.clear();
    this.dirty.clear();
  }

  get size(): number {
    return this.stamps.size;
  }

  get dirtyCount(): number {
    return this.dirty.size;
  }

  /** Sérialisation pour persistance entre deux lancements. */
  toJSON(): Record<string, FileStamp> {
    return Object.fromEntries(this.stamps);
  }

  /**
   * Recharge des tampons persistés.
   *
   * Les entrées mal formées sont IGNORÉES et non fatales : un fichier de
   * tampons abîmé doit coûter un balayage complet, jamais empêcher la
   * synchronisation de démarrer.
   */
  static fromJSON(raw: unknown): StampRegistry {
    const reg = new StampRegistry();
    if (typeof raw !== 'object' || raw === null) return reg;
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof value !== 'object' || value === null) continue;
      const v = value as Record<string, unknown>;
      if (
        typeof v.size !== 'number' ||
        typeof v.mtimeMs !== 'number' ||
        typeof v.ino !== 'number' ||
        typeof v.hashedAt !== 'number'
      ) {
        continue;
      }
      reg.stamps.set(key, { size: v.size, mtimeMs: v.mtimeMs, ino: v.ino, hashedAt: v.hashedAt });
    }
    return reg;
  }
}
