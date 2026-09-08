/**
 * mySecurityModel (F15) — les verdicts de la carte « Vous », sans React ni
 * réseau.
 *
 * POURQUOI CETTE CARTE EXISTE. La vérification hors bande est SYMÉTRIQUE : la
 * cérémonie du numéro de sécurité (`KeyVerification`) montre à l'hôte
 * l'empreinte de son invité, et lui demande de la comparer « par un autre
 * canal ». Encore faut-il que l'invité puisse LIRE la sienne. Jusqu'ici, aucun
 * écran ne la donnait : la moitié de la cérémonie était impossible à exécuter,
 * ce qui revient à demander une comparaison qui ne peut que se conclure par un
 * « oui » de politesse.
 *
 * ET UNE SECONDE CHOSE, QUE PERSONNE NE REGARDAIT. Le serveur courtier publie
 * les clés publiques ; rien ne vérifiait que celle qu'il publie SOUS MON NOM est
 * bien la mienne. Une substitution ne se voyait que chez le PAIR (qui verrait
 * « la clé a changé » sans savoir pourquoi), jamais chez la victime. La
 * comparaison est ici, et elle est le pire verdict après une chaîne falsifiée.
 *
 * AUCUNE ABSENCE N'EST RASSURANTE. Journal illisible, clé publiée introuvable,
 * paire pas chargée sur cet appareil : trois états distincts, et aucun ne
 * retombe sur « tout va bien ».
 */

// ─────────────────────────────────────────────────────────────────────────────
// Ma clé, telle que le serveur la publie
// ─────────────────────────────────────────────────────────────────────────────

export type MyKeyVerdict =
  | 'ok' // le serveur publie MA clé, et c'est la dernière du journal
  | 'not_mine' // il en publie une AUTRE sous mon nom — substitution
  | 'served_not_latest' // la clé publiée n'est pas la dernière entrée du journal
  | 'tampered_log' // la chaîne ne se recalcule pas : l'histoire a été réécrite
  | 'no_log' // aucun journal (compte d'avant la transparence)
  | 'no_local_key' // rien à comparer sur cet appareil (session verrouillée)
  | 'unavailable'; // on n'a pas su lire — jamais confondu avec « ok »

export interface PublishedKey {
  encPublicKey: string;
  fingerprint: string;
}

export interface MyKeyInput {
  /** L'empreinte calculée depuis la paire chargée ICI — `null` si absente. */
  localFingerprint: string | null;
  /** Ce que `GET /account/public-key/:me` a rendu — `null` sur échec. */
  served: PublishedKey | null;
  /** Le résultat de `verifyKeyLogChain` — `null` sur échec de lecture. */
  chain: { valid: boolean; latest: PublishedKey | null } | null;
}

/**
 * L'ordre des verdicts est un ordre de GRAVITÉ, et il est délibéré :
 *
 *  1. une chaîne qui ne se recalcule pas invalide tout le reste — comparer une
 *     clé à un journal réécrit ne prouve rien ;
 *  2. « ce n'est pas ma clé » vient ensuite : c'est le seul cas où quelqu'un
 *     d'autre peut se faire sceller ce qui m'était destiné ;
 *  3. puis les états du journal (vide, en retard) ;
 *  4. et seulement à la fin, « je n'ai rien à comparer », qui n'accuse personne.
 */
export function myKeyVerdict(input: MyKeyInput): MyKeyVerdict {
  const { localFingerprint, served, chain } = input;
  if (!served || !chain) return 'unavailable';
  if (!chain.valid) return 'tampered_log';
  if (localFingerprint !== null && localFingerprint !== served.fingerprint) return 'not_mine';
  if (!chain.latest) return 'no_log';
  if (
    chain.latest.fingerprint !== served.fingerprint ||
    chain.latest.encPublicKey !== served.encPublicKey
  ) {
    return 'served_not_latest';
  }
  if (localFingerprint === null) return 'no_local_key';
  return 'ok';
}

/**
 * L'empreinte à AFFICHER, et d'où elle vient.
 *
 * Celle de cet appareil d'abord : c'est la clé avec laquelle je déchiffre, donc
 * celle qu'un tiers doit retrouver au bout du fil. Lire à voix haute une
 * empreinte téléchargée du serveur sans l'avoir confrontée à la sienne
 * reviendrait à faire valider le courtier par la cérémonie censée le
 * contourner ; on retombe donc sur celle du serveur SEULEMENT à défaut, et la
 * source est dite.
 */
export function fingerprintToShow(input: {
  localFingerprint: string | null;
  served: PublishedKey | null;
}): { value: string; source: 'local' | 'served' } | null {
  if (input.localFingerprint) return { value: input.localFingerprint, source: 'local' };
  if (input.served) return { value: input.served.fingerprint, source: 'served' };
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Les époques de CE coffre que cet appareil sait ouvrir
// ─────────────────────────────────────────────────────────────────────────────

export interface EpochRow {
  epoch: number;
  /** Le serveur me garde un scellé pour cette époque : je PEUX l'ouvrir. */
  sealed: boolean;
  /** Elle est déjà ouverte dans cette session (cache mémoire). */
  unlocked: boolean;
}

/**
 * Combien d'époques manquantes on NOMME avant de compter le reste. Cinq
 * nombres se lisent ; deux cents (un coffre longuement tourné dont cet appareil
 * n'a que le dernier scellé) noient la phrase qui les porte, et c'est elle qui
 * dit ce que ça coûte — « les éléments chiffrés avec elles vous restent
 * fermés ».
 */
export const MISSING_EPOCHS_SHOWN = 5;

/**
 * Combien d'époques `rows` ÉNUMÈRE au plus, de la plus ancienne visible à la
 * plus récente. Le plafond de cette liste ne vient pas de nous : il est le plus
 * grand de `currentKeyEpoch` (recopié tel quel du DTO) et des époques de
 * `/key-wraps` que l'annonce rend crédibles. Un `1e9` corrompu ou hostile
 * faisait un milliard de tours de boucle, puis une ligne rendue par tour : le
 * renderer gelait. On borne donc ce qu'on ÉNUMÈRE — jamais ce qu'on COMPTE, qui
 * reste exact parce qu'il se calcule.
 *
 * LA MÊME CONSTANTE SERT DE FENÊTRE DE CRÉDIBILITÉ pour les scellés : au-delà de
 * `currentKeyEpoch + MAX_EPOCH_ROWS`, une époque servie ne désigne plus une clé.
 * Deux cents rotations d'avance sur ce que le coffre annonce de lui-même, ce
 * n'est plus « le résumé est en retard », c'est un nombre inventé.
 */
export const MAX_EPOCH_ROWS = 200;

export interface EpochCoverage {
  /** Les lignes ÉNUMÉRÉES, croissantes — bornées par `MAX_EPOCH_ROWS`. */
  rows: EpochRow[];
  /** Combien d'époques du coffre en tout — `rows` peut n'en montrer que la fin. */
  totalEpochs: number;
  /** Combien d'époques `rows` laisse derrière — `0` = la liste est entière. */
  truncatedBefore: number;
  sealedCount: number;
  unlockedCount: number;
  /** Les époques ÉNUMÉRÉES dont je n'ai aucun scellé (bornée comme `rows`). */
  missing: number[];
  /** Le compte EXACT des époques sans scellé, borne ou pas. */
  missingCount: number;
  /** Ai-je le scellé de l'époque courante ? (sinon : « on ne m'a pas rescellé ») */
  hasCurrent: boolean;
}

/**
 * SCELLÉ N'EST PAS OUVERT, et les deux méritent d'être distingués à l'écran.
 * Un wrap gardé par le serveur est ouvrable à volonté avec ma clé privée ; une
 * époque déjà déverrouillée l'est SANS le réseau. Une époque dont je n'ai aucun
 * wrap, en revanche, ne s'ouvrira jamais : les éléments chiffrés sous cette
 * clé-là me sont définitivement fermés, et le taire ferait croire à un coffre
 * entièrement lisible.
 *
 * Un wrap un peu AU-DELÀ de l'époque annoncée n'est pas jeté : le résumé en
 * mémoire peut être en retard sur le serveur (une rotation vient d'avoir lieu),
 * et l'oublier ferait disparaître une ligne parfaitement réelle. « Un peu » a
 * une mesure, et elle est plus bas.
 *
 * ON BORNE L'ÉNUMÉRATION, JAMAIS LE COMPTE. Les deux nombres que l'écran
 * affiche (« n clés scellées pour vous sur N », « il vous manque m clés ») se
 * CALCULENT : `sealedCount` est la taille de l'ensemble des wraps servis,
 * `totalEpochs` est le plafond, et ce qui manque est leur différence. Aucun des
 * trois n'a besoin d'une ligne par époque — c'est pour cela qu'un plafond
 * hostile ne coûte plus rien, et que la phrase reste vraie quand la liste, elle,
 * s'arrête. Un scellé PLUS ANCIEN que la fenêtre compte donc toujours comme
 * détenu : le taire ferait dire « aucune époque scellée » à quelqu'un qui en
 * détient une.
 *
 * MAIS UN SCELLÉ TRÈS EN AVANCE SUR L'ANNONCE N'EST PAS UNE CLÉ, C'EST UN
 * NOMBRE. Le plafond servait à deux choses à la fois : dire jusqu'où énumérer,
 * et dire COMBIEN d'époques le coffre a. La première est bornée depuis le tour
 * précédent ; la seconde ne l'était pas, et un seul wrap aberrant (`1e9`) servi
 * pour un coffre à l'époque 1 faisait afficher « 1 scellé sur 1 000 000 000 » et
 * « 999 999 999 époques manquantes » — des nombres exacts au sens du modèle, et
 * une phrase absurde et alarmante pour qui la lit. On ne retient donc que les
 * époques CRÉDIBLES : jusqu'à `MAX_EPOCH_ROWS` au-delà de l'annonce, ce qui
 * laisse passer le cas réel (le résumé en mémoire est en retard d'une rotation
 * faite ailleurs) et arrête le cas fabriqué, qui ne désigne aucune clé — aucun
 * élément n'est chiffré sous une époque qui n'existe pas.
 */
export function epochCoverage(input: {
  wraps: readonly number[];
  currentKeyEpoch: number;
  unlocked: (epoch: number) => boolean;
}): EpochCoverage {
  // `Number.isFinite` d'abord : un `currentKeyEpoch` à `Infinity` ou `NaN`
  // rendrait le plancher inatteignable, et la borne ne bornerait plus rien.
  const annonce = Number.isFinite(input.currentKeyEpoch) ? Math.max(0, input.currentKeyEpoch) : 0;
  const credible = annonce + MAX_EPOCH_ROWS;
  const scelles = new Set(input.wraps.filter((e) => Number.isFinite(e) && e > 0 && e <= credible));
  // PAS DE `Math.max(annonce, ...scelles)` : la TAILLE de cet ensemble vient du
  // serveur elle aussi (`/key-wraps` sert une ligne par époque, sans limite ni
  // curseur), et étaler plus de cent mille valeurs en arguments lève
  // `RangeError: Maximum call stack size exceeded`. Ce calcul vit dans un
  // `useMemo` : la levée se produirait PENDANT le rendu, donc l'écran ne
  // s'afficherait pas du tout. Une boucle ne touche pas la pile.
  let plafond = annonce;
  for (const e of scelles) if (e > plafond) plafond = e;
  if (plafond > Number.MAX_SAFE_INTEGER) plafond = Number.MAX_SAFE_INTEGER;
  const plancher = Math.max(1, plafond - MAX_EPOCH_ROWS + 1);

  const rows: EpochRow[] = [];
  for (let epoch = plancher; epoch <= plafond; epoch++) {
    const sealed = scelles.has(epoch);
    rows.push({ epoch, sealed, unlocked: sealed && input.unlocked(epoch) });
  }

  // Les comptes portent sur TOUS les wraps, y compris hors fenêtre : la boucle
  // est linéaire en ce que le serveur a réellement servi, pas en un entier.
  let unlockedCount = 0;
  for (const epoch of scelles) {
    if (input.unlocked(epoch)) unlockedCount++;
  }

  return {
    rows,
    totalEpochs: plafond,
    truncatedBefore: plancher > 1 ? plancher - 1 : 0,
    sealedCount: scelles.size,
    unlockedCount,
    missing: rows.filter((r) => !r.sealed).map((r) => r.epoch),
    missingCount: Math.max(0, plafond - scelles.size),
    hasCurrent: input.currentKeyEpoch > 0 && scelles.has(input.currentKeyEpoch),
  };
}

/**
 * L'énumération bornée des époques manquantes — et son RESTE, jamais tu.
 *
 * Le compte exact reste dans la phrase (`epochsMissing` l'interpole) : ce qui
 * est borné ici, c'est la liste des numéros, pas le fait. Élider sans annoncer
 * combien manque serait la même faute en plus discret.
 */
export function summarizeMissingEpochs(
  missing: readonly number[],
  max: number = MISSING_EPOCHS_SHOWN,
  /**
   * Le compte EXACT, quand la liste reçue est elle-même déjà bornée
   * (`epochCoverage.missingCount`). Sans lui, le reste annoncé serait celui de
   * la fenêtre et non celui du coffre — une élision qui mentirait sur sa
   * propre taille.
   */
  total: number = missing.length
): { shown: number[]; rest: number } {
  const borne = Math.max(0, max);
  const shown = missing.slice(0, borne);
  return { shown, rest: Math.max(0, total - shown.length) };
}

// ─────────────────────────────────────────────────────────────────────────────
// La custody du compte
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `configured` / `absent` / `unknown` — et `unknown` ne s'affiche PAS.
 *
 * La clé de custody est ce qui rend un partage récupérable depuis un autre
 * appareil ; son absence est un fait utile (« ce compte n'en a pas encore »).
 * Un échec de lecture, lui, n'est le fait de rien : afficher « absente » sur une
 * panne réseau enverrait quelqu'un configurer ce qui existe déjà.
 */
export type CustodyState = 'configured' | 'absent' | 'unknown';

export function custodyState(
  res: { success?: boolean; data?: string | null } | null | undefined
): CustodyState {
  if (!res || res.success !== true) return 'unknown';
  return typeof res.data === 'string' && res.data.length > 0 ? 'configured' : 'absent';
}
