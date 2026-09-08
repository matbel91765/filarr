/**
 * Reprise apres un chunk qui ne se charge plus — « une nouvelle version est en
 * ligne ».
 *
 * LE CAS REEL (app.filarr.com, 2026-09-01). Un onglet reste ouvert pendant un
 * deploiement continue de nommer les fichiers de SON build. Chaque build CRA
 * empreinte ses noms, et l'ancien jeu disparait du serveur : la premiere route
 * paresseuse ouverte apres coup (`/notes`) va chercher un chunk qui n'existe
 * plus. L'utilisateur tombait sur l'ecran d'erreur generique et devait
 * recharger a la main — alors que le rechargement est LA reponse, puisque
 * `index.html` est revalide et nomme les nouveaux fichiers.
 *
 * POURQUOI UN GARDE-FOU DE TEMPS. Recharger sur erreur de chargement est une
 * boucle en puissance : si le chunk manque vraiment (deploiement partiel), la
 * page rechargee echouerait de la meme facon, indefiniment. On ne tente donc
 * qu'UNE reprise par fenetre de temps ; passe ce delai, l'erreur s'affiche,
 * ce qui est la bonne reponse pour une panne qui n'est pas une mise a jour.
 *
 * L'horodatage vit dans `sessionStorage` : il doit survivre au rechargement
 * (une variable de module, non) et mourir avec l'onglet.
 */

const STAMP_KEY = 'filarr:chunk-recovery-at';

/** Une seule reprise par minute — au-dela, c'est une panne, pas un deploiement. */
export const RECOVERY_WINDOW_MS = 60_000;

const CHUNK_ERROR_PATTERNS = [
  /loading chunk \S+ failed/i,
  /loading css chunk \S+ failed/i,
  /failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /importing a module script failed/i,
];

/**
 * `name === 'ChunkLoadError'` est ce que pose webpack ; les messages couvrent
 * les moteurs qui n'ont pas ce nom (Safari) et les imports dynamiques natifs.
 */
export function isChunkLoadError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const { name, message } = error as { name?: unknown; message?: unknown };
  if (name === 'ChunkLoadError') return true;
  if (typeof message !== 'string') return false;
  return CHUNK_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

export interface RecoveryDeps {
  /** `sessionStorage` en vrai ; absent en navigation privee stricte. */
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
  reload: () => void;
  now?: () => number;
}

/**
 * Recharge une fois si l'erreur est un chunk manquant.
 *
 * @returns `true` si un rechargement a ete declenche — l'appelant affiche alors
 * un ecran d'attente plutot que l'erreur, qui n'appartient plus a personne.
 */
export function recoverFromChunkError(error: unknown, deps: RecoveryDeps): boolean {
  if (!isChunkLoadError(error)) return false;

  const now = deps.now ? deps.now() : Date.now();
  const storage = deps.storage ?? null;

  let previous: number | null = null;
  try {
    const raw = storage?.getItem(STAMP_KEY);
    const parsed = raw === null || raw === undefined ? NaN : Number(raw);
    previous = Number.isFinite(parsed) ? parsed : null;
  } catch {
    // Stockage refuse : on tente la reprise, sans memoire. Une boucle est
    // possible mais reste preferable a un ecran d'erreur sur chaque deploiement.
    previous = null;
  }

  if (previous !== null && now - previous < RECOVERY_WINDOW_MS) return false;

  try {
    storage?.setItem(STAMP_KEY, String(now));
  } catch {
    /* voir ci-dessus */
  }

  deps.reload();
  return true;
}

/**
 * LE MEME DEFAUT, HORS DU RENDU. `React.lazy` passe par l'ErrorBoundary, mais
 * l'application compte plus de deux cents `import()` dans des gestionnaires
 * d'evenements et des effets : quand le chunk manque, la promesse est rejetee
 * sans que rien ne la rattrape, et l'action de l'utilisateur echoue EN SILENCE.
 * On ecoute donc aussi les rejets non geres, avec le meme garde-fou d'une
 * tentative par fenetre — les deux chemins partagent la meme empreinte, donc
 * une reprise deja tentee par l'un n'est pas retentee par l'autre.
 */
export function installChunkRecovery(target: Window = window): () => void {
  const onRejection = (event: PromiseRejectionEvent): void => {
    const recovered = recoverFromChunkError(event.reason, {
      storage: typeof sessionStorage === 'undefined' ? null : sessionStorage,
      reload: () => target.location.reload(),
    });
    // Le rejet est traite : pas la peine de le porter en console comme une panne.
    if (recovered) event.preventDefault();
  };

  target.addEventListener('unhandledrejection', onRejection as EventListener);
  return () => target.removeEventListener('unhandledrejection', onRejection as EventListener);
}
