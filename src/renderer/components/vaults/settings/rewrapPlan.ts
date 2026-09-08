/**
 * rewrapPlan — QUELS ÉLÉMENTS RE-SCELLER, LESQUELS SAUTER, EN COMBIEN DE LOTS.
 * Sans React, sans réseau, sans traduction.
 *
 * LE DÉFAUT QU'ON RÉPARE. Le re-key est PARESSEUX (`epochCoverage` le compte
 * déjà) : après une rotation, les éléments existants restent scellés sous leur
 * époque d'origine. Une personne ajoutée APRÈS ne reçoit que la clé de l'époque
 * courante — elle voit « N éléments n'ont pas pu être déchiffrés », et cet état
 * ne se lève jamais tout seul. Autrement dit : quiconque arrive après n'importe
 * quelle rotation reçoit un coffre amputé de son histoire, en silence.
 *
 * CE QUE COÛTE LA RÉPARATION, ET POURQUOI ELLE EST BON MARCHÉ. Le contenu et la
 * méta sont chiffrés sous K_item, et K_item est STABLE : seule l'ENVELOPPE de
 * K_item sous K_vault doit être refaite. Ouvrir avec l'ancienne K_vault, refermer
 * avec la nouvelle. Quelques centaines d'octets par élément, aucun octet de
 * contenu relu, aucun téléversement. Ce n'est PAS un re-chiffrement — la section
 * « Clé du coffre » disait le contraire tant que le geste n'existait pas.
 *
 * ── LA RÈGLE : ON NE DEVINE JAMAIS UNE CLÉ QU'ON N'A PAS ────────────────────
 *
 * Il faut DEUX clés par élément : celle de son époque (pour ouvrir) et celle de
 * l'époque courante (pour refermer). Un élément dont l'époque n'est pas ouvrable
 * sur CET appareil est donc SAUTÉ et COMPTÉ, avec son époque — jamais tenté. Le
 * tenter enverrait une enveloppe fabriquée à partir de rien : l'élément
 * deviendrait illisible pour TOUT LE MONDE, c'est-à-dire le défaut qu'on répare,
 * rendu irréversible. Et sauter n'est pas un échec : un autre membre, qui détient
 * cette époque-là, terminera le travail — le plan le dit pour que l'écran puisse
 * l'expliquer plutôt que d'afficher un compteur qui ne descend pas.
 *
 * SANS LA CLÉ COURANTE, LE PLAN EST BLOQUÉ, ET CE N'EST PAS « RIEN À FAIRE ».
 * On ne peut REFERMER aucune enveloppe : tout part dans les sautés, `blocked`
 * est vrai, et le plan ne se présente surtout pas comme un travail achevé.
 *
 * UNE ÉPOQUE EN AVANCE COMPTE COMME À JOUR, exactement comme dans
 * `memberEpochCoverage` : `currentKeyEpoch` vient du résumé en mémoire, qui peut
 * retarder d'une rotation faite ailleurs. Re-sceller cet élément-là l'enverrait
 * sous une clé PLUS ANCIENNE que la sienne — une régression fabriquée par notre
 * propre fraîcheur.
 */

/** Le strict nécessaire d'un élément du coffre pour ce plan. */
export interface RewrapCandidate {
  id: string;
  /** La version lue — le compare-and-set du serveur s'appuie dessus. */
  version: number;
  wrappedUnderEpoch: number;
}

export interface RewrapPlan {
  /**
   * A-t-on la liste des éléments ? `false` = ce coffre n'a jamais été ouvert
   * dans cette session, et AUCUN chiffre ne doit être affiché (même règle que
   * `itemEpochCoverage.known` : « 0 » y serait rassurant ET faux).
   */
  known: boolean;
  /** Ni à re-sceller, ni à sauter : il n'y a rien à proposer. */
  empty: boolean;
  /** La clé de l'époque COURANTE ne s'ouvre pas ici : on ne peut rien refermer. */
  blocked: boolean;
  /** Les lots à envoyer, dans l'ordre, bornés par le plafond du serveur. */
  batches: RewrapCandidate[][];
  /** Combien d'éléments les lots couvrent. */
  total: number;
  /** Sautés faute de détenir leur époque — comptés, jamais devinés. */
  skipped: RewrapCandidate[];
  /** Les époques concernées, uniques et croissantes : de quoi faire une phrase. */
  skippedEpochs: number[];
}

/**
 * Le plafond du serveur (`MAX_REWRAP_ITEMS` dans vaults.ts). Le même nombre des
 * deux côtés : un client qui découperait plus large se ferait refuser le lot
 * entier pour une raison que l'écran ne saurait pas expliquer.
 */
export const REWRAP_BATCH_SIZE = 200;

export function planRewrap(input: {
  /** `undefined` = coffre jamais ouvert ici — pas « aucun élément ». */
  items: readonly RewrapCandidate[] | undefined;
  currentKeyEpoch: number;
  /** Cette époque de K_vault est-elle réellement ouverte sur cet appareil ? */
  canOpenEpoch: (epoch: number) => boolean;
  batchSize?: number;
}): RewrapPlan {
  const { items, currentKeyEpoch, canOpenEpoch } = input;
  const taille = Math.max(1, input.batchSize ?? REWRAP_BATCH_SIZE);
  if (!items) {
    return {
      known: false,
      empty: true,
      blocked: false,
      batches: [],
      total: 0,
      skipped: [],
      skippedEpochs: [],
    };
  }

  // Sans la clé courante rien ne se referme : le plan est bloqué et TOUT ce qui
  // est en retard part dans les sautés, sans qu'aucun lot ne soit proposé.
  const peutRefermer = canOpenEpoch(currentKeyEpoch);

  const aFaire: RewrapCandidate[] = [];
  const skipped: RewrapCandidate[] = [];
  const epoques = new Set<number>();
  for (const it of items) {
    const e = it.wrappedUnderEpoch;
    // Une époque non finie n'est ni à jour ni en retard : elle vaut inconnu, et
    // on n'écrit pas sur une inconnue (même règle que `itemEpochCoverage`).
    if (!Number.isFinite(e) || e >= currentKeyEpoch) continue;
    if (peutRefermer && canOpenEpoch(e)) {
      aFaire.push(it);
    } else {
      skipped.push(it);
      epoques.add(e);
    }
  }

  const batches: RewrapCandidate[][] = [];
  for (let i = 0; i < aFaire.length; i += taille) batches.push(aFaire.slice(i, i + taille));

  return {
    known: true,
    empty: aFaire.length === 0 && skipped.length === 0,
    blocked: !peutRefermer && skipped.length > 0,
    batches,
    total: aFaire.length,
    skipped,
    skippedEpochs: [...epoques].sort((a, b) => a - b),
  };
}
