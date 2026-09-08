/**
 * LA FICHE BINAIRE, SANS JSX — ce qu'on sait d'un fichier qu'on n'ouvrira pas.
 *
 * Le composant se contentait d'une table `extension → libellé FRANÇAIS EN DUR`
 * (« Exécutable Windows », « Paquet Debian / Ubuntu », et la phrase de
 * réassurance) : un utilisateur en anglais voyait la moitié de la carte en
 * français, sans que rien ne le signale. Les libellés sont donc devenus des
 * CLÉS, résolues par i18next comme partout ailleurs.
 *
 * La nomenclature vient du téléphone (`filarr-mobile`,
 * `src/i18n/locales/fr.json` → `binaryInfo.kind.*`) : mêmes suffixes, même
 * repli `unknown`, pour que les deux plates-formes nomment la même chose
 * pareil et qu'une traduction ajoutée d'un côté se retrouve de l'autre.
 *
 * La PLATE-FORME (« Windows », « macOS », « Linux », « Android ») n'est PAS
 * traduite et n'a pas de clé : ce sont des noms propres, identiques dans les
 * deux langues. La traduire inventerait des variantes là où il n'y en a pas.
 */

/** Le suffixe de clé i18n d'un genre de binaire, sous `preview.binaryInfo.kind`. */
export type BinaryKindKey =
  | 'exe'
  | 'msi'
  | 'dll'
  | 'dmg'
  | 'pkg'
  | 'app'
  | 'dylib'
  | 'deb'
  | 'rpm'
  | 'appimage'
  | 'so'
  | 'apk'
  | 'iso'
  | 'img'
  | 'bin'
  | 'unknown';

/**
 * Les genres reconnus, et la plate-forme qu'ils annoncent.
 *
 * Les SCRIPTS (.bat/.cmd/.sh) sont volontairement absents : ce sont des
 * fichiers texte, et `TextPreview` les affiche pour de vrai.
 */
const PLATFORMS: Readonly<Record<string, string>> = {
  exe: 'Windows',
  msi: 'Windows',
  dll: 'Windows',
  dmg: 'macOS',
  pkg: 'macOS',
  app: 'macOS',
  dylib: 'macOS',
  deb: 'Linux',
  rpm: 'Linux',
  appimage: 'Linux',
  so: 'Linux',
  apk: 'Android',
  iso: '',
  img: '',
  bin: '',
};

/** Ce que la carte affiche, une fois l'extension lue. */
export interface BinaryKindDescriptor {
  /** Suffixe de clé — à concaténer à `preview.binaryInfo.kind.`. */
  key: BinaryKindKey;
  /** Nom propre, jamais traduit. Chaîne vide = rien à afficher. */
  platform: string;
  /** L'extension normalisée, sans point ; `bin` à défaut de toute extension. */
  extension: string;
  /** La pastille en haut à gauche : l'extension en capitales. */
  badge: string;
}

/**
 * L'extension effective : celle qu'on nous donne, sinon celle du NOM.
 *
 * Les deux sont ramenées en minuscules — `SETUP.EXE` et `setup.exe` sont le
 * même genre, et une table indexée par minuscules ne trouverait pas la
 * première.
 */
export function normalizeBinaryExtension(fileName: string, extension?: string): string {
  const given = (extension ?? '').trim();
  if (given !== '') return given.replace(/^\./, '').trim().toLowerCase();
  // Le point doit être APRÈS le premier caractère. Sans ce garde, `LICENSE`
  // (aucun point) devenait l'extension « license », et la carte annonçait une
  // pastille « LICENSE » et une puce « .license » — un genre inventé de toutes
  // pièces. `.gitignore` (point de tête) n'a pas davantage d'extension.
  const dot = fileName.lastIndexOf('.');
  if (dot <= 0 || dot === fileName.length - 1) return '';
  return fileName
    .slice(dot + 1)
    .trim()
    .toLowerCase();
}

/**
 * Tout ce que la carte doit savoir, depuis le nom et l'extension.
 *
 * Une extension inconnue retombe sur `unknown` — la MÊME clé que le mobile,
 * qui rend le même texte que `bin` mais reste distincte : le jour où l'on
 * voudra dire « on ne sait pas » autrement que « fichier binaire », il n'y aura
 * qu'une valeur à changer.
 */
export function describeBinaryKind(fileName: string, extension?: string): BinaryKindDescriptor {
  const ext = normalizeBinaryExtension(fileName, extension);
  const known = Object.prototype.hasOwnProperty.call(PLATFORMS, ext);
  return {
    key: (known ? ext : 'unknown') as BinaryKindKey,
    platform: known ? PLATFORMS[ext] : '',
    extension: ext || 'bin',
    badge: ext ? ext.toUpperCase() : 'BIN',
  };
}

/** La clé i18n complète du libellé de genre. */
export function binaryKindLabelKey(key: BinaryKindKey): string {
  return `preview.binaryInfo.kind.${key}`;
}
