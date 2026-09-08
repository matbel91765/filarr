/**
 * Texte d'INDEX des nœuds atomiques — Filarr Notes
 *
 * ProseMirror ne sait rien tirer d'un nœud `atom:` : `getText()` le survole,
 * et tout ce qui vit dans ses `attrs` (source d'un diagramme, formule, cellules
 * d'une base, évènements d'un calendrier) était donc INTROUVABLE par la
 * recherche locale, qui n'indexe que `note.title + note.plainText`.
 *
 * Chaque extension atomique déclare un `renderText` qui délègue ici. Ce module
 * est PUR — aucun React, aucun CSS, aucun accès au magasin — pour deux raisons :
 * il tourne à chaque frappe (getText() est appelé à chaque write-back) et il
 * doit rester éprouvable par une suite `node`.
 *
 * Ce qu'on produit est du texte d'INDEX, pas un export : on vise des JETONS
 * DISCRIMINANTS (libellés, noms de colonnes, mots de la formule), jamais la
 * fidélité de rendu. D'où trois règles :
 *
 *  1. PLAFOND PAR NŒUD (`NODE_INDEX_TEXT_MAX`). `plainText` est PERSISTÉ dans
 *     le coffre chiffré et remonte au nuage à chaque édition : une base de
 *     500 lignes qui produirait 500 lignes de texte ferait grossir la note
 *     d'un ordre de grandeur pour une valeur de recherche nulle (les 40
 *     premières lignes contiennent déjà tout le vocabulaire de la base).
 *  2. VALEURS, PAS STRUCTURE. On ne verse jamais le JSON brut d'un attribut :
 *     les accolades, les `"id"`, les identifiants de ligne polluent l'index et
 *     font remonter n'importe quelle note sur une recherche d'UUID.
 *  3. AUCUNE EXCEPTION. Un `renderText` qui jette casserait `getText()`, donc
 *     le write-back, donc la sauvegarde. Tout est défensif.
 */

// ==================== Plafonds ====================

/**
 * Plafond de caractères produits par un nœud atomique.
 *
 * 600 ≈ 90 mots : de quoi couvrir les libellés d'un diagramme entier, une
 * formule, ou une bonne douzaine de cellules — au-delà, un index n'apprend
 * plus rien de neuf sur le bloc, il ne fait que recopier son contenu.
 * Vingt blocs de ce genre dans une note ajoutent ~12 Ko à `plainText` : c'est
 * le budget qu'on accepte de chiffrer et de synchroniser.
 */
export const NODE_INDEX_TEXT_MAX = 600;

/**
 * Lignes de base de données parcourues au plus. Borne le TEMPS, pas seulement
 * la taille : sans elle, une base de 20 000 lignes serait relue en entier à
 * chaque frappe avant d'être coupée à 600 caractères.
 */
export const DB_INDEX_MAX_ROWS = 40;

/** Évènements de calendrier parcourus au plus — même raison. */
export const CALENDAR_INDEX_MAX_EVENTS = 60;

// ==================== Outils ====================

/**
 * Aplatit et coupe. La coupe cherche une frontière de mot : tronquer au milieu
 * d'un mot fabriquerait un faux jeton (« diagramm ») que la recherche par
 * préfixe ferait ensuite remonter à tort.
 */
export function clampIndexText(raw: string, max: number = NODE_INDEX_TEXT_MAX): string {
  const flat = String(raw ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  // On ne recule que si la frontière reste proche du plafond : sinon un bloc
  // sans espace (une formule dense) perdrait presque tout son contenu.
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trim();
}

/**
 * Un nœud INLINE est concaténé sans séparateur au texte qui l'entoure
 * (`getTextBetween` n'insère `\n\n` que pour les blocs). Sans marge, une note
 * de bas de page souderait deux mots — « voir » + « précisions » deviendrait
 * un jeton unique, et « voir » ne serait plus trouvable.
 */
function padInline(text: string): string {
  return text ? ` ${text} ` : '';
}

/** Concatène en ignorant le vide, sans doublons de séparateurs. */
function joinParts(parts: (string | null | undefined)[], sep = ' '): string {
  return parts
    .map((p) => (p == null ? '' : String(p).trim()))
    .filter((p) => p.length > 0)
    .join(sep);
}

/** Lecture d'attribut tolérante : un attribut absent n'est pas une erreur. */
function attrString(attrs: unknown, key: string): string {
  if (!attrs || typeof attrs !== 'object') return '';
  const v = (attrs as Record<string, unknown>)[key];
  if (typeof v === 'string') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return '';
}

/** JSON d'attribut : jamais de throw, un contenu illisible vaut « rien ». */
function safeParse(raw: unknown): unknown {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// ==================== Blocs à attribut unique ====================

/** `mermaidBlock.code` — la SOURCE du diagramme (les libellés y sont). */
export function mermaidIndexText(attrs: unknown): string {
  return clampIndexText(attrString(attrs, 'code'));
}

/** `mathBlock.latex` / `mathInline.latex` — la formule telle que saisie. */
export function mathIndexText(attrs: unknown): string {
  return clampIndexText(attrString(attrs, 'latex'));
}

/** Variante inline : marges obligatoires (cf. `padInline`). */
export function mathInlineIndexText(attrs: unknown): string {
  return padInline(mathIndexText(attrs));
}

/** `dataviewBlock.query` — la requête est le seul texte écrit par l'humain. */
export function dataviewIndexText(attrs: unknown): string {
  return clampIndexText(attrString(attrs, 'query'));
}

/** `footnote.content` — inline, donc marges. */
export function footnoteIndexText(attrs: unknown): string {
  return padInline(clampIndexText(attrString(attrs, 'content')));
}

/**
 * `fileEmbed.fileName` — seul champ écrit par un humain. `fileType`
 * (`application/pdf`) et `src` (data-URI de plusieurs Mo !) sont exclus :
 * l'un est du bruit, l'autre noierait l'index en base64.
 */
export function fileEmbedIndexText(attrs: unknown): string {
  return clampIndexText(attrString(attrs, 'fileName'));
}

/** `subPage.title` — le `noteId` est un identifiant, jamais un jeton utile. */
export function subPageIndexText(attrs: unknown): string {
  return clampIndexText(attrString(attrs, 'title'));
}

/** `embedUrl` : titre + URL (on cherche « youtube », on cherche un domaine). */
export function embedIndexText(attrs: unknown): string {
  return clampIndexText(joinParts([attrString(attrs, 'title'), attrString(attrs, 'url')]));
}

/**
 * `bookmark` : la carte affiche titre, description, domaine — c'est ce que
 * l'utilisateur a sous les yeux quand il se souvient du lien. `image` et
 * `favicon` sont des URLs d'illustration, sans valeur de recherche.
 */
export function bookmarkIndexText(attrs: unknown): string {
  return clampIndexText(
    joinParts([
      attrString(attrs, 'title'),
      attrString(attrs, 'description'),
      attrString(attrs, 'domain'),
      attrString(attrs, 'url'),
    ])
  );
}

/**
 * `tableOfContents` : VOLONTAIREMENT vide. Le sommaire n'est qu'un reflet des
 * titres, déjà indexés à leur place ; l'indexer doublerait le poids de chaque
 * titre dans le score et ferait remonter la note deux fois. Le `renderText`
 * existe quand même pour que la décision soit écrite, pas subie.
 */
export function tocIndexText(): string {
  return '';
}

/**
 * `inlineDate` : la date TELLE QU'ELLE EST STOCKÉE (`YYYY-MM-DD`).
 *
 * C'est le jeton que les gens tapent réellement dans une recherche, et c'est
 * aussi ce que l'export .docx retient déjà (`noteExportService`, case
 * `inlineDate`) — deux surfaces qui se contredisaient jusqu'ici. On n'indexe
 * PAS une date reformatée par la locale : le nœud n'en porte pas, et en
 * fabriquer une ferait dépendre le contenu persisté de la langue de l'écran.
 *
 * Nœud INLINE, donc marges (cf. `padInline`).
 */
export function inlineDateIndexText(attrs: unknown): string {
  return padInline(clampIndexText(attrString(attrs, 'date')));
}

/** `mention` : « @label », jamais l’identifiant — c’est le nom qu’on cherche. */
export function mentionIndexText(attrs: unknown): string {
  const label = attrString(attrs, 'label');
  return padInline(clampIndexText(label ? `@${label}` : ''));
}

/**
 * `transclusion` : la RÉFÉRENCE, jamais l'aperçu.
 *
 * Ce qu'on indexe, c'est ce que l'utilisateur a écrit ici : le titre visé, son
 * alias éventuel, et l'ancre (`#section` / `^blocId`) — de quoi retrouver « la
 * note qui cite le compte rendu du 12 ».
 *
 * `preview` est EXCLU, pour la même raison que `tableOfContents` : c'est une
 * copie du texte d'une AUTRE note, déjà indexé chez elle. L'indexer ici ferait
 * remonter cette note-ci sur du contenu qu'elle ne possède pas, ferait compter
 * deux fois le même texte dans le score, et grossirait `plainText` (donc le
 * coffre chiffré, donc la remontée nuage) d'une copie à chaque transclusion.
 */
export function transclusionIndexText(attrs: unknown): string {
  const section = attrString(attrs, 'section');
  const blockId = attrString(attrs, 'blockId');
  return clampIndexText(
    joinParts([
      attrString(attrs, 'noteTitle'),
      attrString(attrs, 'alias'),
      section ? `#${section}` : '',
      blockId ? `^${blockId}` : '',
    ])
  );
}

// ==================== Calendrier ====================

/**
 * `calendarBlock` : titre du bloc + `date texte` de chaque évènement.
 * La date est gardée telle quelle (`YYYY-MM-DD`) : c'est un jeton que les gens
 * tapent réellement. Les `id` et `color` sont ignorés.
 */
export function calendarIndexText(attrs: unknown): string {
  const parts: string[] = [];
  const title = attrString(attrs, 'title');
  if (title) parts.push(title);

  const events = safeParse((attrs as Record<string, unknown> | null)?.['events']);
  if (Array.isArray(events)) {
    for (const ev of events.slice(0, CALENDAR_INDEX_MAX_EVENTS)) {
      if (!ev || typeof ev !== 'object') continue;
      const e = ev as Record<string, unknown>;
      const text = typeof e.text === 'string' ? e.text : '';
      const date = typeof e.date === 'string' ? e.date : '';
      const line = joinParts([date, text]);
      if (!line) continue;
      parts.push(line);
      // Sortie anticipée : inutile de formater 60 évènements pour en couper 55.
      if (parts.join(' ').length > NODE_INDEX_TEXT_MAX) break;
    }
  }
  return clampIndexText(parts.join(' '));
}

// ==================== Base de données inline ====================

/**
 * Formes MINIMALES lues ici. On ne réutilise pas `inlineDatabase/types.ts` à
 * l'exécution : ce module y importerait i18n et le stockage de profil, alors
 * qu'il doit rester pur et bon marché (il tourne à chaque frappe).
 */
interface IndexDbOption {
  id?: unknown;
  label?: unknown;
}
interface IndexDbProperty {
  id?: unknown;
  name?: unknown;
  type?: unknown;
  options?: IndexDbOption[];
}
interface IndexDbRow {
  cells?: Record<string, unknown>;
}

/**
 * Types de propriété dont la CELLULE ne contient pas de texte lisible :
 * identifiants (`note`, `relation`), booléens (`checkbox`), nombres nus
 * (`rating`, `progress`) et horodatages techniques. Les indexer ferait
 * remonter des notes sur « 3 » ou sur un UUID.
 */
const DB_OPAQUE_TYPES = new Set([
  'checkbox',
  'note',
  'relation',
  'rollup',
  'rating',
  'progress',
  'createdTime',
  'updatedTime',
]);

/** Résout un id d'option en son libellé — sans libellé, l'id ne vaut rien. */
function optionLabel(prop: IndexDbProperty, id: unknown): string {
  if (typeof id !== 'string' || !id) return '';
  const options = Array.isArray(prop.options) ? prop.options : [];
  for (const opt of options) {
    if (opt && typeof opt === 'object' && opt.id === id) {
      return typeof opt.label === 'string' ? opt.label : '';
    }
  }
  return '';
}

/** Valeur LISIBLE d'une cellule, selon le type déclaré de sa colonne. */
function cellIndexText(prop: IndexDbProperty, value: unknown): string {
  const type = typeof prop.type === 'string' ? prop.type : 'text';
  if (DB_OPAQUE_TYPES.has(type)) return '';

  if (type === 'select') return optionLabel(prop, value);
  if (type === 'multiSelect') {
    if (!Array.isArray(value)) return '';
    return joinParts(value.map((id) => optionLabel(prop, id)));
  }
  if (type === 'number') {
    return typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
  }
  // text / url / email / phone / date : la cellule EST déjà du texte.
  return typeof value === 'string' ? value : '';
}

/**
 * `inlineDatabase` : titre du bloc, NOMS DE COLONNES (une fois), puis les
 * valeurs de cellules ligne à ligne. Jamais le JSON brut de `data` — il
 * contient des identifiants de ligne, de propriété et d'option, tous inutiles
 * à la recherche et tous coûteux à stocker chiffrés.
 */
export function inlineDatabaseIndexText(attrs: unknown): string {
  const parts: string[] = [];
  const title = attrString(attrs, 'title');
  if (title) parts.push(title);

  const data = safeParse((attrs as Record<string, unknown> | null)?.['data']);
  if (!data || typeof data !== 'object') return clampIndexText(parts.join(' '));

  const props = (data as { properties?: unknown }).properties;
  const properties: IndexDbProperty[] = Array.isArray(props)
    ? (props.filter((p) => p && typeof p === 'object') as IndexDbProperty[])
    : [];

  // Les noms de colonnes forment le vocabulaire de la base (« Statut »,
  // « Budget ») : versés UNE fois, pas répétés à chaque ligne.
  const header = joinParts(properties.map((p) => (typeof p.name === 'string' ? p.name : '')));
  if (header) parts.push(header);

  const rowsRaw = (data as { rows?: unknown }).rows;
  const rows: IndexDbRow[] = Array.isArray(rowsRaw)
    ? (rowsRaw.filter((r) => r && typeof r === 'object') as IndexDbRow[])
    : [];

  for (const row of rows.slice(0, DB_INDEX_MAX_ROWS)) {
    const cells = row.cells && typeof row.cells === 'object' ? row.cells : {};
    const line = joinParts(
      properties.map((p) => {
        const key = typeof p.id === 'string' ? p.id : '';
        return key ? cellIndexText(p, (cells as Record<string, unknown>)[key]) : '';
      })
    );
    if (!line) continue;
    parts.push(line);
    if (parts.join(' ').length > NODE_INDEX_TEXT_MAX) break;
  }

  return clampIndexText(parts.join(' '));
}
