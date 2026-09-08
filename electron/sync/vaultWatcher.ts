/**
 * vaultWatcher.ts — Observateur du coffre local.
 *
 * Lot 1 du chantier synchronisation, et la reponse au CONSTAT N° 1, qui n'est
 * pas un probleme de performance mais un trou de correction.
 *
 * ── CE QUI NE MARCHE PAS AUJOURD'HUI ─────────────────────────────────────────
 * Dans `scanLocalFiles`, un fichier deja synchronise est saute sans meme etre
 * `stat`e :
 *
 *     if (existing && existing.checksum && existing.status === 'synced') continue;
 *
 * Le balayage ne decouvre donc que les fichiers NOUVEAUX. Toute la detection de
 * modification repose sur `notifyFileChanged`, appele par l'application au
 * moment ou elle ecrit. Ce qui contourne ce chemin est INVISIBLE :
 *   - une modification faite hors application ;
 *   - un plantage entre l'ecriture et la notification ;
 *   - une restauration de sauvegarde ;
 *   - un autre outil qui touche au coffre.
 *
 * La donnee est alors sur le disque et ne partira JAMAIS, pendant que
 * l'interface affiche « synchronise ».
 *
 * ── CE QUE FAIT CE MODULE ────────────────────────────────────────────────────
 * Il regarde le coffre et marque SALE ce qui bouge. Le drapeau est une PORTE
 * OUVERTE : un fichier sale est toujours rehache, un fichier non sale peut
 * quand meme l'etre (tampon, rehachage periodique). Consequence voulue : si
 * l'observateur rate un evenement, on retombe sur le comportement d'avant, on
 * ne fait jamais pire.
 *
 * `chokidar` est deja une dependance du projet — `hotFoldersService` et
 * `downloadsWatcherService` s'en servent. Le coffre lui-meme, non. C'est cette
 * asymetrie que ce module corrige.
 *
 * ── POURQUOI L'INJECTION DE DEPENDANCE ───────────────────────────────────────
 * La fabrique d'observateur est injectable pour que les suites exercent la
 * logique — classement des chemins, anti-rebond, cycle de vie — sans monter un
 * vrai observateur ni toucher au disque. Un test qui depend du systeme de
 * fichiers reel est un test qui echouera un jour pour une raison etrangere a ce
 * qu'il verifie.
 */

/** Ce qu'un chemin observe designe, une fois classe. */
export type VaultTarget =
  | { kind: 'meta'; key: string }
  | { kind: 'file'; folderId: string; fileName: string }
  | null;

/**
 * Blobs a la racine du profil, chacun avec sa cle de manifeste.
 *
 * Ces quatre-la sont exactement ceux que `scanLocalFiles` rehache
 * integralement a chaque cycle, et donc ceux ou le tampon rapporte le plus.
 */
export const META_BLOBS: ReadonlyMap<string, string> = new Map([
  ['notes.enc', 'meta:notes'],
  ['layout.enc', 'meta:layout'],
]);

/**
 * Fragments de nom qui designent un fichier EN COURS D'ECRITURE.
 *
 * Les laisser entrer ferait marquer sale un fichier qui n'existe pas encore
 * vraiment, et pire, ferait entrer un temporaire dans le manifeste. Les memes
 * marqueurs sont deja filtres par `scanLocalFiles` — ils sont repris ici pour
 * que les deux chemins voient la meme chose.
 */
export const IGNORED_FRAGMENTS: readonly string[] = [
  '.v3tmp',
  '.migrating',
  '.syncdl',
  '.tmp',
];

/** Fichiers de metadonnees de dossier : suivis, mais jamais comme du contenu. */
export const FOLDER_METADATA = 'metadata.json';

function isIgnored(name: string): boolean {
  return IGNORED_FRAGMENTS.some((frag) => name.includes(frag));
}

/**
 * Classe un chemin RELATIF a la racine du profil.
 *
 * Rend `null` pour tout ce qui ne doit pas declencher de synchronisation :
 * temporaires, fichiers a la racine autres que les blobs connus, chemins trop
 * profonds. Refuser par defaut est deliberé — un chemin inattendu ne doit pas
 * se retrouver dans le manifeste parce que personne n'y avait pense.
 */
export function classifyVaultPath(relPath: string): VaultTarget {
  const normalized = relPath.replace(/\\/g, '/').replace(/^\.\//, '');
  if (!normalized || normalized.startsWith('/')) return null;
  const parts = normalized.split('/').filter(Boolean);
  if (parts.some(isIgnored)) return null;

  if (parts.length === 1) {
    const key = META_BLOBS.get(parts[0]);
    return key ? { kind: 'meta', key } : null;
  }
  if (parts.length === 2) {
    const [folderId, fileName] = parts;
    if (fileName === FOLDER_METADATA) return { kind: 'file', folderId, fileName };
    return { kind: 'file', folderId, fileName };
  }
  // Plus de deux niveaux : hors du modele « dossier/fichier ». On ignore
  // plutot que de deviner.
  return null;
}

// ── Observateur ──────────────────────────────────────────────────────────────

/** Le sous-ensemble de chokidar dont ce module a besoin. */
export interface WatcherLike {
  on(event: string, handler: (path: string) => void): WatcherLike;
  close(): Promise<void>;
}

export interface VaultWatcherOptions {
  /** Racine du profil a observer. */
  baseDir: string;
  /** Appele avec le chemin RELATIF de ce qui a bouge. */
  onDirty: (relPath: string, target: Exclude<VaultTarget, null>) => void;
  /** Appele quand un lot d'evenements s'est calme. */
  onSettled?: () => void;
  /** Fabrique d'observateur. Injectable pour les suites. */
  createWatcher: (baseDir: string) => WatcherLike;
  /**
   * Silence a observer avant de considerer un lot termine.
   *
   * Enregistrer dix fichiers en dix secondes ne doit produire qu'un cycle. La
   * valeur reprend l'anti-rebond deja utilise par le demon de synchronisation
   * (`DEBOUNCE_DELAY`), pour que les deux horloges ne se contredisent pas.
   */
  settleMs?: number;
  /** Horloge injectable — les suites ne doivent pas attendre en temps reel. */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export const DEFAULT_SETTLE_MS = 10_000;

/**
 * Observe un coffre et signale ce qui bouge.
 *
 * Ne synchronise rien lui-meme : il marque, et laisse le demon decider. Cette
 * separation est ce qui rend l'observateur sans danger — au pire il provoque un
 * cycle de trop, jamais une ecriture inattendue.
 */
export class VaultWatcher {
  private watcher: WatcherLike | null = null;
  private timer: unknown = null;
  private readonly opts: Required<Pick<VaultWatcherOptions, 'settleMs' | 'setTimer' | 'clearTimer'>> &
    VaultWatcherOptions;
  /** Chemins vus depuis le dernier apaisement — utile au diagnostic. */
  private readonly pending = new Set<string>();

  constructor(options: VaultWatcherOptions) {
    this.opts = {
      settleMs: options.settleMs ?? DEFAULT_SETTLE_MS,
      setTimer: options.setTimer ?? ((fn, ms) => setTimeout(fn, ms)),
      clearTimer: options.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>)),
      ...options,
    };
  }

  start(): void {
    if (this.watcher) return;
    const w = this.opts.createWatcher(this.opts.baseDir);
    // `add` compte autant que `change` : un fichier restaure depuis une
    // sauvegarde arrive comme un ajout, et c'est precisement le cas que le
    // balayage actuel ne voit jamais.
    w.on('add', (p) => this.handle(p));
    w.on('change', (p) => this.handle(p));
    w.on('unlink', (p) => this.handle(p));
    this.watcher = w;
  }

  async stop(): Promise<void> {
    if (this.timer !== null) {
      this.opts.clearTimer(this.timer);
      this.timer = null;
    }
    this.pending.clear();
    const w = this.watcher;
    this.watcher = null;
    if (w) await w.close();
  }

  get running(): boolean {
    return this.watcher !== null;
  }

  get pendingCount(): number {
    return this.pending.size;
  }

  /**
   * Traite un evenement.
   *
   * Le chemin recu peut etre absolu (chokidar) ou relatif (suites) : on
   * normalise en retirant la racine, sans quoi le classement echouerait sur
   * tous les evenements reels.
   */
  handle(rawPath: string): void {
    const rel = this.toRelative(rawPath);
    const target = classifyVaultPath(rel);
    if (!target) return;
    this.pending.add(rel);
    this.opts.onDirty(rel, target);
    this.schedule();
  }

  private toRelative(rawPath: string): string {
    const p = rawPath.replace(/\\/g, '/');
    const base = this.opts.baseDir.replace(/\\/g, '/').replace(/\/$/, '');
    if (base && p.startsWith(`${base}/`)) return p.slice(base.length + 1);
    return p;
  }

  private schedule(): void {
    if (!this.opts.onSettled) return;
    if (this.timer !== null) this.opts.clearTimer(this.timer);
    this.timer = this.opts.setTimer(() => {
      this.timer = null;
      this.pending.clear();
      this.opts.onSettled?.();
    }, this.opts.settleMs);
  }
}
