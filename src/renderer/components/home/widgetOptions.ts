/**
 * Accueil modulaire — LES RÉGLAGES D'UN BLOC.
 *
 * Ce module est délibérément SEUL dans son coin, sans le moindre import de
 * composant. Le registre importe les widgets, et les widgets ont besoin de lire
 * leurs réglages : si les lecteurs vivaient dans le registre, chaque widget
 * devrait le réimporter et l'on obtiendrait un cycle d'imports à l'exécution —
 * du genre qui ne se voit pas à la compilation et qui rend `undefined` au
 * premier rendu, une fois sur deux, selon l'ordre des modules.
 *
 * ── LES VALEURS SONT AUSSI FERMÉES QUE LE CODE ──────────────────────────────
 *
 * Le schéma est déclaratif et le repli fait foi : une disposition venue
 * d'ailleurs (gabarit installé, appareil plus récent, fichier trafiqué) peut
 * porter n'importe quoi dans `options`. Un widget ne doit jamais afficher un
 * `undefined` ni se comporter d'une façon que son schéma n'autorise pas.
 */

export type WidgetOptionField =
  | { kind: 'boolean'; key: string; labelKey: string; fallback: boolean }
  | {
      kind: 'enum';
      key: string;
      labelKey: string;
      fallback: string;
      choices: readonly { value: string; labelKey: string }[];
    }
  /**
   * DU TEXTE ÉCRIT PAR L'UTILISATEUR — le titre d'une section, l'intitulé d'un
   * raccourci, la date d'une échéance.
   *
   * ── POURQUOI CE TROISIÈME TYPE EXISTE ─────────────────────────────────────
   *
   * Un bloc « Titre de section » dont on ne peut pas écrire le titre n'est pas
   * un bloc, c'est une décoration. Les deux premiers types ne savent exprimer
   * qu'un choix parmi des valeurs écrites à la compilation ; il manquait la
   * seule chose qui rend une disposition PERSONNELLE.
   *
   * ── ET POURQUOI IL EST LE PLUS DANGEREUX DES TROIS ────────────────────────
   *
   * Un booléen et un choix sont bornés PAR LEUR SCHÉMA : une valeur inconnue
   * retombe sur le repli, et rien d'étranger n'atteint jamais le rendu. Du
   * texte libre, lui, TRAVERSE — et il traverse aussi la place de marché, donc
   * il peut venir d'un inconnu.
   *
   * Trois conséquences, toutes tenues par `readTextOption` :
   *   · il est ÉCRÊTÉ (`maxLength`) — un titre de section de cent mille
   *     caractères est un déni de service sur la mise en page ;
   *   · il est rendu en TEXTE, jamais en HTML — c'est le composant qui s'y
   *     engage, et le test le vérifie ;
   *   · une valeur qui n'est pas une chaîne retombe sur le repli, sans quoi un
   *     gabarit portant un objet ferait rendre « [object Object] ».
   */
  | {
      kind: 'text';
      key: string;
      labelKey: string;
      fallback: string;
      /** Le plafond, en caractères. Obligatoire : il n'y a pas de défaut sûr. */
      maxLength: number;
      /** Un champ de plusieurs lignes plutôt qu'une ligne unique. */
      multiline?: boolean;
      placeholderKey?: string;
    };

export type WidgetOptionSchema = readonly WidgetOptionField[];

function fieldOf(
  schema: WidgetOptionSchema | undefined,
  key: string
): WidgetOptionField | undefined {
  return schema?.find((f) => f.key === key);
}

/** Un réglage booléen. Valeur absente ou du mauvais type ⇒ le repli du schéma. */
export function readBoolOption(
  schema: WidgetOptionSchema | undefined,
  options: Record<string, unknown> | undefined,
  key: string
): boolean {
  const field = fieldOf(schema, key);
  const fallback = field?.kind === 'boolean' ? field.fallback : false;
  const value = options?.[key];
  return typeof value === 'boolean' ? value : fallback;
}

/**
 * Un réglage de texte libre.
 *
 * ⚠ L'ÉCRÊTAGE SE FAIT À LA LECTURE, PAS SEULEMENT À LA SAISIE.
 *
 * Borner le champ de saisie ne borne que ce qu'on tape SOI-MÊME. La valeur peut
 * aussi arriver par un gabarit installé, par la synchronisation, ou par un
 * fichier écrit à la main — trois chemins qui ne passent par aucun champ. Le
 * plafond doit donc vivre là où la valeur est LUE, c'est-à-dire ici.
 */
export function readTextOption(
  schema: WidgetOptionSchema | undefined,
  options: Record<string, unknown> | undefined,
  key: string
): string {
  const field = fieldOf(schema, key);
  if (field?.kind !== 'text') return '';
  const value = options?.[key];
  if (typeof value !== 'string') return field.fallback;
  return value.slice(0, field.maxLength);
}

/** Un réglage à choix. Une valeur hors des choix DÉCLARÉS retombe sur le repli. */
export function readEnumOption(
  schema: WidgetOptionSchema | undefined,
  options: Record<string, unknown> | undefined,
  key: string
): string {
  const field = fieldOf(schema, key);
  if (field?.kind !== 'enum') return '';
  const value = options?.[key];
  return typeof value === 'string' && field.choices.some((c) => c.value === value)
    ? value
    : field.fallback;
}

// ==================== Ce que reçoit un widget ====================

/**
 * Les props d'un widget — DÉLIBÉRÉMENT maigres.
 *
 * Tout ce qu'un widget affiche, il le lit lui-même (sélecteur mémoïsé) ; tout ce
 * qu'il déclenche, il le prend dans `HomeActionsContext`. Rien ne descend par
 * les props sauf ce qui vient de la DISPOSITION — c'est ce qui permet à
 * `React.memo` de tenir : ces valeurs ne changent que quand l'utilisateur
 * modifie réellement son accueil.
 */
export interface WidgetProps {
  /** Identité de l'emplacement dans la vue. Sert aux actions ciblées. */
  slotId: string;
  /** Réglages de CET emplacement (`LayoutSlot.options`). */
  options?: Record<string, unknown>;
  /** Attaches locales (`LayoutSlot.binding`) — dossier ou note désignés. */
  binding?: Record<string, string>;
  /** L'accueil est en cours de personnalisation. */
  editing: boolean;
}
