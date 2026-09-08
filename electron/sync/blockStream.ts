/**
 * blockStream.ts — Adaptateur entre blocs delta et tronçons V3. PUR.
 *
 * ── LE PROBLEME QUE CE MODULE RESOUT, ET QUI BLOQUAIT TOUT ───────────────────
 * Le rassemblage d'un fichier delta est pilote par `encryptStreamToFileV3`, qui
 * reclame le clair par tronçons V3 de 8 Mio :
 *
 *     async (index, plainLen) => { ... }   // index = tronçon V3
 *
 * Le chemin v4 s'en sortait par une coincidence : la frontiere delta valait
 * EXACTEMENT la taille d'un tronçon V3, donc un bloc = un tronçon, et le code
 * pouvait ecrire `if (entry.s !== plainLen) throw`.
 *
 * Le decoupage par contenu detruit cette coincidence. Un bloc `cdc-v1` mesure
 * entre 256 Kio et 4 Mio, decide par le CONTENU : plusieurs blocs remplissent
 * un tronçon, et un bloc peut chevaucher deux tronçons. Sans adaptateur, le
 * manifeste v5 est illisible — c'est le vrai obstacle de la bascule, et il
 * n'apparait nulle part dans le dossier d'origine.
 *
 * ── CE QUE FAIT L'ADAPTATEUR ─────────────────────────────────────────────────
 * Il transforme une suite ordonnee de blocs en un FLUX D'OCTETS dans lequel on
 * lit des longueurs arbitraires. Les frontieres de blocs et celles des tronçons
 * deviennent independantes, ce qui est exactement ce qu'on veut : les premieres
 * servent la deduplication, les secondes le chiffrement au repos, et rien
 * n'oblige les deux a coincider.
 *
 * ── MEMOIRE ──────────────────────────────────────────────────────────────────
 * Au plus un bloc entier reside a la fois, plus la lecture en cours. Le
 * recuperateur reste libre de precharger — c'est lui qui tient la fenetre, pas
 * ce module.
 *
 * ── ZERO IMPORT ──────────────────────────────────────────────────────────────
 * Ni `fs`, ni `node:crypto`, ni Electron : le lot 8 impose que la lecture soit
 * portable, et ce module est sur le chemin de lecture.
 */

/** Ce que le lecteur sait d'un bloc avant de le chercher. */
export interface StreamBlockRef {
  /** SHA-256 hexadecimal du clair — l'adresse de contenu. */
  hash: string;
  /** Taille du clair de ce bloc. */
  size: number;
}

/**
 * Recupere et dechiffre UN bloc, rendu en clair.
 *
 * L'appelant est libre de mettre en cache, de precharger et de deduire : ce
 * module ne fait qu'appeler dans l'ordre.
 */
export type BlockFetcher = (ref: StreamBlockRef, index: number) => Promise<Uint8Array>;

export const ERR_STREAM_SHORT = 'Flux de blocs delta trop court';
export const ERR_STREAM_SIZE = 'Taille de bloc delta incoherente avec le manifeste';

/**
 * Lit un flux d'octets a travers une suite ordonnee de blocs.
 *
 * NON REENTRANT : `read` doit etre attendu avant le suivant. Le rassemblage V3
 * appelle sequentiellement, et rendre ce module concurrent demanderait une file
 * dont personne n'a besoin — mieux vaut l'interdire clairement que le supporter
 * a moitie.
 */
export class BlockStreamReader {
  private readonly refs: readonly StreamBlockRef[];
  private readonly fetch: BlockFetcher;
  /** Bloc courant, deja dechiffre. */
  private current: Uint8Array | null = null;
  /** Position de lecture dans le bloc courant. */
  private offset = 0;
  /** Index du prochain bloc a chercher. */
  private next = 0;
  /** Octets deja rendus, pour les diagnostics et la borne totale. */
  private produced = 0;

  constructor(refs: readonly StreamBlockRef[], fetch: BlockFetcher) {
    this.refs = refs;
    this.fetch = fetch;
  }

  /** Somme des tailles annoncees par le manifeste. */
  get totalSize(): number {
    let n = 0;
    for (const r of this.refs) n += r.size;
    return n;
  }

  get bytesProduced(): number {
    return this.produced;
  }

  /**
   * Rend EXACTEMENT `length` octets, ou leve.
   *
   * Rendre moins que demande serait le pire comportement possible : le
   * rassemblage V3 ecrirait un tronçon court sans le savoir, et le fichier
   * final serait tronque en silence. On leve.
   */
  async read(length: number): Promise<Uint8Array> {
    if (!Number.isInteger(length) || length < 0) throw new Error(ERR_STREAM_SIZE);
    if (length === 0) return new Uint8Array(0);

    const out = new Uint8Array(length);
    let written = 0;

    while (written < length) {
      if (this.current === null || this.offset >= this.current.length) {
        const loaded = await this.loadNext();
        if (!loaded) throw new Error(ERR_STREAM_SHORT);
      }
      const block = this.current as Uint8Array;
      const take = Math.min(length - written, block.length - this.offset);
      out.set(block.subarray(this.offset, this.offset + take), written);
      this.offset += take;
      written += take;
    }
    this.produced += written;
    return out;
  }

  /**
   * Charge le bloc suivant. Rend `false` quand il n'y en a plus.
   *
   * VERIFIE que la taille rendue est celle que le manifeste annonce. Le
   * manifeste est authentifie par la FEK ; un bloc d'une autre taille signale
   * une incoherence reelle, et l'accepter ferait glisser tout le reste du
   * fichier d'autant d'octets.
   */
  private async loadNext(): Promise<boolean> {
    if (this.next >= this.refs.length) return false;
    const index = this.next;
    const ref = this.refs[index];
    this.next += 1;
    const plain = await this.fetch(ref, index);
    if (plain.length !== ref.size) throw new Error(ERR_STREAM_SIZE);
    this.current = plain;
    this.offset = 0;
    // Un bloc de taille nulle est licite dans le manifeste mais ne fait pas
    // avancer la lecture : on enchaine, sinon `read` boucle.
    if (plain.length === 0) return this.loadNext();
    return true;
  }

  /**
   * Le flux est-il entierement consomme ?
   *
   * A verifier APRES le rassemblage : des octets restants signifient que le
   * manifeste decrit plus de contenu que le conteneur n'en a reclame, donc que
   * l'un des deux ment.
   */
  get exhausted(): boolean {
    const resteDansBloc = this.current !== null && this.offset < this.current.length;
    return !resteDansBloc && this.next >= this.refs.length;
  }
}

/**
 * Decoupe une longueur totale en tronçons de `chunkSize`, le dernier plus court.
 *
 * Sert a piloter le rassemblage sans dependre de la forme des blocs : c'est la
 * traduction, en une fonction, du fait que les deux decoupages sont desormais
 * independants.
 */
export function chunkLengths(totalSize: number, chunkSize: number): number[] {
  if (!Number.isInteger(totalSize) || totalSize < 0) throw new Error(ERR_STREAM_SIZE);
  if (!Number.isInteger(chunkSize) || chunkSize <= 0) throw new Error(ERR_STREAM_SIZE);
  const out: number[] = [];
  let reste = totalSize;
  while (reste > 0) {
    const n = Math.min(chunkSize, reste);
    out.push(n);
    reste -= n;
  }
  return out;
}
