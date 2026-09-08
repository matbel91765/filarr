/**
 * vaultNameEnvelope (F14) — l'apparence d'un coffre voyage DANS son nom chiffré.
 *
 * POURQUOI DANS `name_encrypted` ET PAS AILLEURS. Un emoji, une couleur, une
 * icône disent quelque chose du coffre : « Photos de famille », « Clients ».
 * Ce sont donc des données de l'utilisateur, pas de la décoration technique, et
 * les laisser en clair côté serveur reviendrait à publier une table des
 * matières du coffre à côté d'un contenu chiffré. `name_encrypted` est la seule
 * colonne scellée sous K_vault que TOUT membre sait déjà ouvrir : elle a la
 * bonne portée (le coffre entier), le bon lecteur (chaque membre), et elle est
 * déjà rescellée à chaque rotation (P1). Une seconde colonne aurait demandé une
 * migration, une seconde époque à suivre, et un second endroit où oublier de
 * resceller.
 *
 * LA CONTRAINTE QUI DICTE TOUT LE RESTE. Ce qui a déjà été écrit dans cette
 * colonne — tous les coffres existants — est un nom NU, et le restera pour tous
 * les clients d'avant cette fiche. Le décodage est donc TOLÉRANT par
 * construction : il ne lève jamais, et tout ce qu'il ne reconnaît pas
 * formellement comme une enveloppe vaut comme un nom, EN ENTIER. Un décodeur
 * qui lèverait afficherait « Verrouillé » sur un coffre parfaitement lisible —
 * c'est-à-dire exactement l'accident de P1, pris par l'autre bout.
 *
 * ET L'ENCODAGE EST SYMÉTRIQUE : sans apparence, on réécrit le NOM NU. Une
 * enveloppe JSON systématique ferait afficher `{"v":1,"n":"Contrats"}` comme
 * nom de coffre chez tout membre resté sur une version d'avant. Le seul cas où
 * l'on force l'enveloppe pour un nom sans apparence est celui du nom qui
 * RESSEMBLE déjà à une enveloppe : quelqu'un a parfaitement le droit d'appeler
 * son coffre `{"v":1,"n":"x"}`, et l'écrire nu le ferait relire de travers.
 *
 * CE QUE CETTE SYMÉTRIE NE RATTRAPE PAS, ET QUI DOIT ALLER DANS LES NOTES DE
 * VERSION. Elle protège le cas « personne n'a rien posé » ; elle ne protège pas
 * l'autre. Dès qu'un administrateur choisit une apparence, `name_encrypted`
 * devient une enveloppe pour DE BON, et un membre resté sur un client d'avant
 * cette fiche lira `{"v":1,"n":"Contrats","emoji":"📁"}` comme nom de coffre —
 * partout : cartes, onglets, fil d'Ariane. Rien ici ne peut l'empêcher (le
 * serveur ne voit qu'un chiffré, et l'ancien client ne sait pas décoder) : la
 * seule parade est humaine, c'est de le DIRE aux équipes mixtes.
 *
 * LES VALEURS SONT BORNÉES AVANT LE CHIFFREMENT, et c'est une règle de sûreté,
 * pas de goût : le serveur ne voit rien de ce bloc, donc personne ne validera à
 * notre place. Une couleur libre serait du CSS écrit par un autre membre du
 * coffre et rendu dans notre fenêtre ; un « emoji » libre serait un paragraphe
 * entier dans un bandeau. D'où trois énumérations : la palette du design system
 * (`ui/ColorPickerModal`), une liste d'icônes connues, et un emoji d'UN seul
 * signe.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Les énumérations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * La palette du design system, à l'identique de `ui/ColorPickerModal` et
 * `ui/FolderStyleModal` — un coffre se personnalise comme un dossier, avec les
 * mêmes couleurs. La copie est délibérée : ces deux modales exportent leur
 * palette en constante privée, et importer un composant React depuis un module
 * de service (chargé par le store, donc par les tests purs) tirerait tout
 * l'arbre de rendu derrière lui.
 */
export const VAULT_APPEARANCE_COLORS = [
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
  '#ef4444',
  '#f97316',
  '#f59e0b',
  '#eab308',
  '#84cc16',
  '#22c55e',
  '#10b981',
  '#14b8a6',
  '#06b6d4',
  '#0ea5e9',
  '#6366f1',
  '#a855f7',
  '#d946ef',
  '#f43f5e',
  '#64748b',
] as const;

export type VaultAppearanceColor = (typeof VAULT_APPEARANCE_COLORS)[number];

/**
 * Les icônes connues. Une ICÔNE plutôt qu'un emoji quand on veut le trait du
 * produit (monochrome, teinté par la couleur choisie) ; l'emoji reste offert
 * pour tout le reste. La liste est fermée parce qu'elle nomme des dessins que
 * cette application sait rendre : un nom inconnu ne dessinerait rien, et un
 * trou à la place du glyphe se lit comme un coffre cassé.
 */
export const VAULT_APPEARANCE_ICONS = [
  'lock',
  'folder',
  'briefcase',
  'star',
  'shield',
  'heart',
  'archive',
  'document',
] as const;

export type VaultAppearanceIcon = (typeof VAULT_APPEARANCE_ICONS)[number];

export interface VaultAppearance {
  /** UN signe — un emoji, jamais une phrase. */
  emoji?: string;
  /** Une couleur DE LA PALETTE, en minuscules. */
  color?: VaultAppearanceColor;
  /** Une icône de la liste connue. */
  icon?: VaultAppearanceIcon;
}

/** Ce qu'un `name_encrypted` déchiffré contient, une fois relu. */
export interface VaultNameEnvelope {
  /** Le nom lisible. Vide = le déchiffrement a échoué, jamais « sans nom ». */
  name: string;
  /** L'apparence partagée, quand il y en a une de valide. */
  appearance?: VaultAppearance;
}

/** La seule version d'enveloppe que ce client sait lire. */
export const VAULT_ENVELOPE_VERSION = 1;

// ─────────────────────────────────────────────────────────────────────────────
// Les bornes
// ─────────────────────────────────────────────────────────────────────────────

const COULEURS = new Set<string>(VAULT_APPEARANCE_COLORS);
const ICONES = new Set<string>(VAULT_APPEARANCE_ICONS);

/**
 * Un emoji est-il UN seul signe à l'écran ?
 *
 * `Intl.Segmenter` compte les graphèmes, ce qui est la seule bonne unité :
 * `'👩‍👩‍👧'` est UN signe fait de cinq points de code, et le compter en points de
 * code refuserait une famille parfaitement légitime. Il n'existe pas partout
 * (vieux moteurs, contextes exotiques) : le repli borne alors le nombre de
 * points de code, ce qui laisse passer les séquences ZWJ raisonnables et refuse
 * toujours un paragraphe. Un repli plus strict serait pire qu'approximatif — il
 * refuserait des emojis valides sans rien protéger de plus.
 */
const MAX_EMOJI_CODE_POINTS = 12;

function estUnSigne(raw: string): boolean {
  if (raw.length === 0 || raw.trim() === '') return false;
  // Un espace, une tabulation, un retour à la ligne au milieu : ce n'est pas un
  // emoji, c'est du texte — et ça se vérifie sans Segmenter.
  if (/\s/.test(raw)) return false;
  const Segmenter = (
    Intl as unknown as {
      Segmenter?: new (
        locale?: string,
        opts?: { granularity: 'grapheme' }
      ) => { segment: (s: string) => Iterable<unknown> };
    }
  ).Segmenter;
  if (Segmenter) {
    const seg = new Segmenter(undefined, { granularity: 'grapheme' });
    let n = 0;
    for (const _ of seg.segment(raw)) {
      n++;
      if (n > 1) return false;
    }
    return n === 1;
  }
  return Array.from(raw).length <= MAX_EMOJI_CODE_POINTS;
}

/**
 * L'apparence, ramenée à ce que ce client accepte de porter — ou `undefined`.
 *
 * CHAMP PAR CHAMP, ET JAMAIS TOUT OU RIEN. Une couleur hors palette ne doit pas
 * emporter l'emoji avec elle : ce qui arrive ici vient soit d'un écran de cette
 * version (donc déjà borné), soit d'une version FUTURE ou d'un autre client qui
 * aura ajouté un champ ou une valeur. Garder ce qu'on comprend et taire le reste
 * est le seul comportement qui ne perde rien à l'affichage.
 *
 * ELLE EST AUSSI LA SOURCE DU RESCELLEMENT, ET IL FAUT LE SAVOIR. `toVaultSummary`
 * ne range QUE `enveloppe.appearance` — donc le résultat de cette fonction — et
 * `renameVault`, `setVaultAppearance` et `rotateVaultKey` réencodent tous depuis
 * ce résumé. Un champ qu'un client PLUS RÉCENT aurait ajouté dans une enveloppe
 * v1 n'est donc pas seulement tu à l'affichage : il disparaît de la colonne au
 * premier renommage ou à la première rotation faite depuis cette version. C'est
 * le prix assumé de ne réécrire que ce qu'on sait relire — garder l'enveloppe
 * brute pour la rechiffrer telle quelle reviendrait à resceller sous K_vault des
 * octets que ce client n'a jamais validés. Le jour où une v2 arrive, c'est ce
 * choix-là qu'il faudra rouvrir, en portant l'enveloppe lue jusqu'au résumé.
 */
export function normalizeVaultAppearance(raw: unknown): VaultAppearance | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const src = raw as Record<string, unknown>;
  const out: VaultAppearance = {};

  if (typeof src.emoji === 'string' && estUnSigne(src.emoji)) out.emoji = src.emoji;

  if (typeof src.color === 'string') {
    const c = src.color.toLowerCase();
    if (COULEURS.has(c)) out.color = c as VaultAppearanceColor;
  }

  if (typeof src.icon === 'string' && ICONES.has(src.icon)) {
    out.icon = src.icon as VaultAppearanceIcon;
  }

  return Object.keys(out).length > 0 ? out : undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Encoder / décoder
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Le texte clair à sceller sous K_vault.
 *
 * Sans apparence : le NOM NU, pour qu'un client d'avant cette fiche continue de
 * l'afficher (voir l'en-tête). Sauf si ce nom-là se relirait comme une
 * enveloppe — alors on l'enveloppe, précisément pour qu'il se relise tel qu'il
 * a été tapé.
 */
export function encodeVaultName(env: VaultNameEnvelope): string {
  const appearance = normalizeVaultAppearance(env.appearance);
  if (!appearance) {
    return lireEnveloppe(env.name) ? enveloppeJson(env.name, undefined) : env.name;
  }
  return enveloppeJson(env.name, appearance);
}

function enveloppeJson(name: string, appearance: VaultAppearance | undefined): string {
  return JSON.stringify({
    v: VAULT_ENVELOPE_VERSION,
    n: name,
    ...(appearance?.emoji ? { emoji: appearance.emoji } : {}),
    ...(appearance?.color ? { color: appearance.color } : {}),
    ...(appearance?.icon ? { icon: appearance.icon } : {}),
  });
}

/** L'enveloppe reconnue, ou `null` — sans jamais lever. */
function lireEnveloppe(plaintext: string): { n: string; brut: Record<string, unknown> } | null {
  // Un test bon marché avant `JSON.parse` : l'immense majorité des noms ne
  // commencent pas par une accolade, et le parseur n'a rien à faire là.
  if (plaintext.charCodeAt(0) !== 0x7b /* { */) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;
  if (obj.v !== VAULT_ENVELOPE_VERSION) return null;
  if (typeof obj.n !== 'string') return null;
  return { n: obj.n, brut: obj };
}

/**
 * Le texte déchiffré → nom + apparence. NE LÈVE JAMAIS, quoi qu'on lui donne.
 *
 * Trois refus rendent le texte ENTIER comme nom, et c'est le bon repli dans les
 * trois cas : ce n'est pas du JSON (un nom ordinaire), ce n'est pas un objet
 * versionné 1 (un nom qui commence par une accolade, ou une enveloppe d'une
 * version future qu'on ne sait pas lire), ou son `n` n'est pas une chaîne
 * (structure inattendue). Inventer un nom vide ferait dire « Verrouillé » à un
 * coffre dont on vient pourtant d'ouvrir le nom.
 */
export function decodeVaultName(plaintext: string): VaultNameEnvelope {
  const env = lireEnveloppe(plaintext);
  if (!env) return { name: plaintext };
  const appearance = normalizeVaultAppearance(env.brut);
  return appearance ? { name: env.n, appearance } : { name: env.n };
}

/**
 * LES DEUX PORTÉES, fondues champ par champ (F14).
 *
 * « Pour tout le monde » vit dans l'enveloppe chiffrée ; « pour moi » vit en
 * localStorage, sur cet appareil seulement. Le local l'emporte CHAMP PAR CHAMP
 * plutôt qu'en bloc : quelqu'un qui ne change que la couleur garde l'emoji
 * choisi par l'équipe, ce qui est ce qu'il a demandé — un remplacement en bloc
 * lui ferait perdre l'emoji sans qu'il y ait touché.
 */
export function resolveVaultAppearance(
  shared: VaultAppearance | undefined,
  local: VaultAppearance | undefined
): VaultAppearance | undefined {
  if (!shared && !local) return undefined;
  const out: VaultAppearance = { ...(shared ?? {}), ...(local ?? {}) };
  return Object.keys(out).length > 0 ? out : undefined;
}
