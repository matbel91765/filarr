/**
 * inviteLinkHygiene (F16) — ce qu'on fait, et ce qu'on ne fait jamais, d'un lien
 * d'invitation.
 *
 * CE QU'EST CE LIEN. Un capability token NOMINAL : `/join` refuse toute autre
 * adresse que celle visée, et le scellé qui l'accompagne ne s'ouvre qu'avec la
 * clé privée du destinataire. Il ne donne donc rien à un tiers qui le vole… sauf
 * à ce tiers d'être déjà connecté au bon compte. Ce n'est pas une clé, mais
 * c'est un porteur, et on le traite comme tel.
 *
 * QUATRE RÈGLES, DÉCIDÉES DANS LE PLAN (§7), DONT DEUX VIVENT ICI :
 *   1. jamais dans Redux — c'est l'affaire des composants (état local, effacé à
 *      la fermeture) et du thunk `inviteMember`, qui LAISSE TOMBER le lien ;
 *   2. jamais dans localStorage — même endroit, même règle ;
 *   3. hors des fils d'ariane Sentry — `scrubInviteLinks`, branché sur
 *      `beforeBreadcrumb` ET `beforeSend` (`services/platform/crashReporter`) ;
 *   4. effacé du presse-papiers après ~60 s — `copyInviteLinkOnce`, dont le
 *      minuteur vit DANS CE MODULE et survit donc à l'écran qui a copié (on
 *      copie pour aller coller ailleurs : le démontage est le geste normal).
 *
 * POURQUOI LE RÉDACTEUR NE SUPPRIME PAS LA LIGNE ENTIÈRE. Un fil d'ariane sert à
 * comprendre un plantage : effacer l'URL rendrait le rapport muet exactement là
 * où il devient intéressant. On coupe la VALEUR du jeton et on garde tout le
 * reste — la route, le coffre, l'espace, qui sont des identifiants opaques que
 * le serveur voit déjà passer.
 *
 * POURQUOI ON RELIT LE PRESSE-PAPIERS AVANT DE L'EFFACER. Écrire une chaîne vide
 * soixante secondes après la copie détruirait ce que la personne y a mis
 * entre-temps — un mot de passe collé depuis un gestionnaire, un paragraphe en
 * cours de déplacement. On n'efface donc QUE si le presse-papiers contient
 * encore, exactement, le lien qu'on y a mis ; et une lecture refusée (le
 * navigateur demande une permission pour `readText`) n'autorise rien du tout :
 * dans le doute, on ne touche pas.
 */

/** Les deux routes d'acceptation — celles que `email.ts` fabrique côté worker. */
const INVITE_PATHS = ['/vault-invite', '/invite'];

/** Le lien complet, tel qu'il apparaît dans un texte libre (fil d'ariane). */
const INVITE_LINK_RE = /(https?:\/\/[^\s"'<>]*\/(?:vault-invite|invite)\b[^\s"'<>]*)/gi;

/** La valeur d'un `token=…`, en query comme en fragment. */
const TOKEN_VALUE_RE = /([?&#]token=)[^&\s"'<>]+/gi;

/** Ce texte est-il (ou contient-il) un lien d'invitation portant un jeton ? */
export function isInviteLink(value: string | null | undefined): boolean {
  if (!value) return false;
  INVITE_LINK_RE.lastIndex = 0;
  if (!INVITE_LINK_RE.test(value)) return false;
  return /[?&#]token=/i.test(value);
}

/**
 * Le même texte, jetons coupés. Rendu tel quel quand il n'y a rien à couper :
 * un rédacteur qui réécrit tout finirait par abîmer des rapports pour rien.
 *
 * La signature accepte `null`/`undefined` parce que les champs d'un fil d'ariane
 * Sentry sont optionnels : un appelant qui devrait tester avant chaque appel
 * finirait par oublier un champ.
 */
export function scrubInviteLinks<T extends string | null | undefined>(value: T): T {
  if (typeof value !== 'string' || value.length === 0) return value;
  INVITE_LINK_RE.lastIndex = 0;
  return value.replace(INVITE_LINK_RE, (lien) => {
    TOKEN_VALUE_RE.lastIndex = 0;
    return lien.replace(TOKEN_VALUE_RE, '$1[redacted]');
  }) as T;
}

/**
 * LES DEUX CROCHETS SENTRY, ÉCRITS ICI ET NON DANS LE RAPPORTEUR DE PLANTAGES.
 *
 * POURQUOI ICI. Ce sont des règles d'hygiène du LIEN D'INVITATION, pas des
 * réglages de télémétrie : elles se lisent avec les trois autres, et elles se
 * VÉRIFIENT — un garde-fou branché dans `Sentry.init` n'est éprouvé par rien,
 * parce que personne n'écrit un test qui initialise Sentry. Déplacées ici, elles
 * deviennent deux fonctions à tester, et `crashReporter` n'a plus qu'à les
 * appeler.
 *
 * `unknown` EN ENTRÉE, ET C'EST DÉLIBÉRÉ. Les types de Sentry changent d'une
 * version majeure à l'autre (`message?: string | ParameterizedString`…) : les
 * contraindre structurellement ferait échouer la compilation à la prochaine
 * montée de version, sur un code qui n'a rien à se reprocher. On regarde donc à
 * l'exécution, et on ne touche qu'à ce qu'on reconnaît.
 *
 * MUTATION EN PLACE : c'est le contrat de Sentry (`beforeSend` rend l'objet
 * qu'on lui a donné), et fabriquer une copie perdrait tout ce qu'on ne connaît
 * pas de sa forme.
 */
const asRecord = (v: unknown): Record<string, unknown> | null =>
  typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : null;

/** Les champs d'un fil d'ariane qui portent une URL (`history`, `fetch`, `xhr`). */
const BREADCRUMB_URL_FIELDS = ['url', 'to', 'from'];

export function scrubBreadcrumbLinks(breadcrumb: unknown): void {
  const b = asRecord(breadcrumb);
  if (!b) return;
  if (typeof b.message === 'string') b.message = scrubInviteLinks(b.message);
  const data = asRecord(b.data);
  if (!data) return;
  for (const key of BREADCRUMB_URL_FIELDS) {
    if (typeof data[key] === 'string') data[key] = scrubInviteLinks(data[key] as string);
  }
}

/**
 * LES DEUX CHAMPS LIBRES D'UN ÉVÉNEMENT SENTRY (`extra`, `contexts`), PARCOURUS.
 *
 * Partout ailleurs on sait nommer le champ qui porte une URL — `message`,
 * `request.url`, la valeur d'une exception. Ces deux-là acceptent n'importe quel
 * JSON que l'appelant y met : un `captureException(e, { extra: { url } })`
 * ajouté un jour dans un coin ferait passer un porteur d'accès sans qu'aucune
 * relecture le voie. On les parcourt donc en aveugle, en ne touchant qu'aux
 * chaînes.
 *
 * LA PROFONDEUR EST BORNÉE, et c'est ce qui tient lieu de détection de cycles :
 * un objet qui se contient lui-même est une structure parfaitement légale (une
 * référence React, un nœud du DOM), et un rédacteur d'hygiène qui boucle sans
 * fin transformerait une garde en plantage. Cinq niveaux couvrent tout ce qu'on
 * met à la main dans un rapport ; au-delà, on renonce plutôt que de tourner.
 */
const SCRUB_MAX_DEPTH = 5;

function scrubDeep(value: unknown, depth: number): void {
  if (depth > SCRUB_MAX_DEPTH) return;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const item = value[i];
      if (typeof item === 'string') value[i] = scrubInviteLinks(item);
      else scrubDeep(item, depth + 1);
    }
    return;
  }
  const rec = asRecord(value);
  if (!rec) return;
  for (const key of Object.keys(rec)) {
    const item = rec[key];
    if (typeof item === 'string') rec[key] = scrubInviteLinks(item);
    else scrubDeep(item, depth + 1);
  }
}

/**
 * L'événement lui-même : l'URL de la page au moment du plantage, le message, la
 * valeur de chaque exception, et les deux champs libres. Le fil d'ariane est le
 * chemin le plus probable, mais un lien peut aussi arriver par ceux-là — et un
 * porteur d'accès n'a rien à faire dans un rapport, quel que soit le champ qui
 * le transporte.
 */
export function scrubEventLinks(event: unknown): void {
  const e = asRecord(event);
  if (!e) return;
  if (typeof e.message === 'string') e.message = scrubInviteLinks(e.message);
  const request = asRecord(e.request);
  if (request && typeof request.url === 'string') {
    request.url = scrubInviteLinks(request.url);
  }
  const exception = asRecord(e.exception);
  const values = exception?.values;
  if (Array.isArray(values)) {
    for (const raw of values) {
      const v = asRecord(raw);
      if (v && typeof v.value === 'string') v.value = scrubInviteLinks(v.value);
    }
  }
  scrubDeep(e.extra, 1);
  scrubDeep(e.contexts, 1);
}

/**
 * Combien de temps le lien reste dans le presse-papiers. Une minute : le temps
 * d'ouvrir une messagerie et de coller, pas celui d'oublier qu'on l'a copié.
 */
export const INVITE_CLIPBOARD_TTL_MS = 60_000;

/**
 * LE COMPTE À REBOURS EN VOL, AU NIVEAU DU MODULE — et c'est un choix.
 *
 * Il a d'abord vécu dans l'écran qui avait produit le lien, qui l'annulait en se
 * démontant. Ce démontage est POURTANT le geste normal : on copie, on ferme le
 * dialogue, on va coller dans sa messagerie. L'effacement promis n'avait donc
 * jamais lieu dans le chemin dominant, pendant que la ligne « Effacé du
 * presse-papiers dans une minute environ. » était affichée dès la copie — une
 * règle d'hygiène annoncée et non tenue vaut moins que pas de règle du tout.
 *
 * Et le danger qui justifiait l'annulation n'existe pas : la relecture ci-dessous
 * n'écrit `''` QUE si le presse-papiers contient encore, exactement, ce lien. Un
 * minuteur qui survit à son écran ne peut donc rien détruire de ce qu'on a copié
 * entre-temps.
 */
let pendingWipe: (() => void) | null = null;

/**
 * Annuler l'effacement en vol — POUR LE REMPLACER, et c'est son seul emploi :
 * `copyInviteLinkOnce` l'appelle avant d'armer le sien, parce que deux minuteurs
 * en vol effaceraient la seconde copie trente secondes après qu'on l'a faite.
 *
 * ELLE N'EST PAS LE GESTE DU VERROUILLAGE NI DE LA DÉCONNEXION, et le commentaire
 * qui le promettait ici a été retiré plutôt que branché : ANNULER l'effacement
 * laisserait le lien dans le presse-papiers pour toujours — l'exact contraire de
 * ce qu'on veut en quittant un compte. Ce geste-là demanderait un effacement
 * IMMÉDIAT (relire, comparer, écrire `''`), donc une autre fonction ; tant qu'il
 * n'existe pas, le compte à rebours d'une minute reste la seule promesse tenue,
 * et elle l'est dans tous les cas puisque le minuteur vit dans ce module.
 *
 * Jamais sur un démontage d'écran non plus : on copie POUR fermer et aller
 * coller (voir l'en-tête de `pendingWipe`).
 */
export function cancelPendingWipe(): void {
  const annuler = pendingWipe;
  pendingWipe = null;
  annuler?.();
}

/**
 * Copier le lien, et programmer son effacement.
 *
 * NE REND RIEN À ANNULER, délibérément : tant qu'une poignée existait, l'écran
 * la câblait à son démontage (voir ci-dessus). Une NOUVELLE copie remplace le
 * compte à rebours précédent — deux minuteurs en vol effaceraient la seconde
 * copie trente secondes après qu'on l'a faite.
 *
 * L'ABSENCE DE PRESSE-PAPIERS LÈVE. Faire semblant d'avoir copié est la pire des
 * réponses : la personne colle du vide dans sa messagerie et croit avoir envoyé
 * l'invitation.
 */
export async function copyInviteLinkOnce(
  url: string,
  ttlMs: number = INVITE_CLIPBOARD_TTL_MS
): Promise<void> {
  const clip = (globalThis.navigator as Navigator | undefined)?.clipboard;
  if (!clip?.writeText) throw new Error('clipboard_unavailable');
  await clip.writeText(url);

  // APRÈS l'écriture seulement : une copie qui échoue laisse le presse-papiers
  // — et donc le compte à rebours — tel qu'il était.
  cancelPendingWipe();

  const timer = setTimeout(() => {
    pendingWipe = null;
    void (async () => {
      try {
        // On ne relit que si on PEUT : `readText` demande une permission que
        // beaucoup de contextes refusent (un navigateur la refuse hors geste
        // utilisateur — voir `clipboardManual` côté écran). Refus = on ne touche
        // à rien.
        const actuel = await clip.readText?.();
        if (actuel === url) await clip.writeText('');
      } catch {
        /* presse-papiers illisible : ne jamais écrire à l'aveugle par-dessus */
      }
    })();
  }, ttlMs);

  pendingWipe = () => clearTimeout(timer);
}

/** Les routes reconnues — exportées pour que personne ne les recopie à la main. */
export const INVITE_LINK_PATHS = INVITE_PATHS;
