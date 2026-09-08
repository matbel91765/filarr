#!/usr/bin/env node
/**
 * check-window-chrome — le garde-fou de la bande native de fenêtre.
 *
 * ── CE QU'IL EMPÊCHE ───────────────────────────────────────────────────────
 * La fenêtre est sans cadre : l'OS peint les boutons de fenêtre AU-DESSUS du
 * web, dans une bande haute qui n'appartient pas au DOM. Un contrôle dessiné
 * là est inatteignable, et le clic ferme l'application. Le défaut est
 * invisible à la relecture (le bouton est parfaitement visible, il ne répond
 * simplement pas) et il est revenu quatre fois : galerie, scrubber de
 * versions, éditeur de greffons, aperçu plein écran.
 *
 * Trois règles, et chacune répare une façon PRÉCISE dont la classe de bugs est
 * revenue :
 *
 *  1. MONOPOLE — la géométrie ne se devine pas. Les nombres 140/40 et l'API
 *     Window Controls Overlay n'ont le droit d'exister que dans chrome.css et
 *     electron/main.ts. Six copies indépendantes avaient divergé, dont trois
 *     fausses et aucune juste sur macOS.
 *
 *  2. MANIFESTE — toute surface collée au bord haut doit être CLASSÉE, en
 *     `aware` (elle réserve) ou en `free` (avec sa raison écrite). Scanne le
 *     CSS *et* le TSX : la moitié des overlays du produit sont déclarés en
 *     utilitaires Tailwind, et un garde-fou aveugle au TSX les validerait tous.
 *
 *  3. COLLISION — un `padding` RACCOURCI, ou un utilitaire Tailwind `p-*`, sur
 *     un élément portant une classe `chrome-safe-*` écrase la réserve EN
 *     SILENCE. C'est exactement ainsi que le correctif de l'aperçu plein écran
 *     est mort une première fois.
 *
 * Sortie 0 = rien à signaler. Sortie 1 = la liste, fichier:ligne.
 * Le scan porte TOUJOURS sur l'arbre entier : une surface peut être cassée
 * depuis un fichier voisin, donc les noms que lint-staged ajoute sont ignorés.
 */

const fs = require('fs');
const path = require('path');

// La racine du dépôt, déduite de l'emplacement du script : `node
// scripts/check-window-chrome.cjs` et `cd scripts && node check-...` doivent
// se comporter pareil. Un ENOENT selon le répertoire courant a déjà fait
// passer ce garde-fou pour cassé.
const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');

/** Les seuls fichiers autorisés à connaître la géométrie native. */
const GEOMETRY_OWNERS = new Set([
  'src/renderer/styles/chrome.css',
  'electron/main.ts',
  'scripts/check-window-chrome.cjs',
]);

/**
 * Les surfaces `position: fixed` collées au bord haut, classées.
 *
 * `aware` : la surface réserve la bande (classe chrome-safe-*, variable
 *           --chrome-inset-*, ou un décalage propre suffisant).
 * `free:…` : elle n'a rien à réserver, ET LA RAISON EST ÉCRITE.
 *
 * Une surface absente de ce manifeste fait échouer le garde-fou. C'est
 * volontaire : le classement est un geste de conception, pas une formalité.
 */
const SURFACES = {
  // ── Surfaces qui RESERVENT la bande ────────────────────────────────────
  '.chrome-drag-band': 'aware',
  '.modal--full': 'aware',
  '.notification-container--top-right': 'aware',
  '.notification-container--top-left': 'aware',
  '.notification-container--top-center': 'aware',
  '.file-preview-panel--fullscreen': 'aware',
  '.image-preview--fullscreen': 'aware',
  '.video-preview--fullscreen': 'aware',
  '.plugin-editor-shell__bar': 'aware',
  '.scrubber': 'aware',
  // La visionneuse de captures du marche : plein ecran, SANS plafond ni
  // centrage, et un bouton a chaque bout de son en-tete colle au bord haut.
  // La reserve vit sur `.mkt-lightbox__head` (chrome-safe-inline), pas sur le
  // voile — d'ou le marqueur `chrome:aware` dans marketplace.css.
  '.mkt-lightbox': 'aware',
  '.layout__header-slot--side': 'aware',

  // ── Fenetres CENTREES ──────────────────────────────────────────────────
  // Hauteur plafonnee bien en deca du viewport et centrage vertical : meme
  // dans la fenetre la plus courte (minHeight 600, electron/main.ts) leur
  // bord haut depasse 40 px, et leur bouton de fermeture demarre plus bas.
  '.modal-backdrop': 'free: centree, plafonnee a 100vh-32px — la croix tombe a y>=40',
  '.scrapbook-backdrop': 'free: padding 32px + en-tete 14px — le bouton demarre a y=46',
  '.wiki-overlay': 'free: fenetre centree, hauteur plafonnee',
  '.qs-plus__overlay': 'free: fenetre centree, hauteur plafonnee',
  '.command-palette__backdrop': 'free: fenetre centree, hauteur plafonnee',
  '.flashcard-view__overlay': 'free: fenetre centree, hauteur plafonnee',
  '.export-dialog__overlay': 'free: fenetre centree, hauteur plafonnee',
  '.template-manager__overlay': 'free: fenetre centree, hauteur plafonnee',
  '.templater-overlay': 'free: fenetre centree, hauteur plafonnee',
  '.calendar-day-modal__overlay': 'free: fenetre centree, hauteur plafonnee',
  '.notes-view__modal-backdrop': 'free: fenetre centree, hauteur plafonnee',
  '.confirm-dialog-overlay': 'free: fenetre centree, hauteur plafonnee',
  '.keyboard-shortcuts-settings__confirm-overlay': 'free: fenetre centree, hauteur plafonnee',

  // ── Voiles de rejet ────────────────────────────────────────────────────
  // Surface uniforme dont TOUT point produit le meme effet (refermer) :
  // perdre le coin haut-droit n'enleve aucune fonction.
  '.page-cover__popover-backdrop': 'free: voile de rejet uniforme',
  '.table-actions-backdrop': 'free: voile de rejet uniforme',
  // Le voile de la fiche de ligne (RowPanel.tsx : `onMouseDown={onClose}` sur
  // toute la surface). La fiche elle-meme, `.inline-db__rp`, est centree et
  // plafonnee a min(72vh, 680px) : dans la fenetre la plus courte son bord
  // haut tombe a y=84, sa croix plus bas encore.
  '.inline-db__rp-veil': 'free: voile de rejet uniforme',

  // ── Decor de page ──────────────────────────────────────────────────────
  // `z-index: -1` ET `pointer-events: none` : ces couches vivent SOUS tout le
  // contenu et ne recoivent aucun clic — il n'y a rien a y perdre sous les
  // boutons natifs. Leur reserver la bande serait meme un defaut : le decor
  // doit couvrir l'ecran ENTIER, bande native comprise, sinon une bande morte
  // apparait en haut de la fenetre.
  '.filarr-backdrop': 'free: decor sous le contenu (z-index -1, pointer-events none)',
  '.filarr-living': 'free: decor sous le contenu (z-index -1, pointer-events none)',

  // ── Autre fenetre ──────────────────────────────────────────────────────
  '.mini-root': 'free: fenetre distincte (miniWindow.ts, frame:false SANS overlay natif)',
  '.mini-titlebar': 'free: meme fenetre distincte, aucun bouton natif dessine',
};

const problemes = [];
const signale = (fichier, ligne, message) =>
  problemes.push(`${path.relative(ROOT, fichier).replace(/\\/g, '/')}:${ligne}  ${message}`);

function fichiersSous(dir, exts) {
  const out = [];
  const marche = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === '__tests__') continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) marche(p);
      else if (exts.some((x) => e.name.endsWith(x))) out.push(p);
    }
  };
  marche(dir);
  return out;
}

const rel = (f) => path.relative(ROOT, f).replace(/\\/g, '/');

// ── Règle 1 : le monopole de la géométrie ───────────────────────────────────

const INTERDITS = [
  [/\bpr-\[140px\]/, 'largeur des boutons natifs codée en dur (utiliser chrome-safe-right)'],
  [/\bmt-10\b.*\bpr-\[/, 'bande native codée en dur (utiliser chrome-safe-top)'],
  [/right:\s*140\b/, 'largeur des boutons natifs codée en dur'],
  [/padding-top:\s*40px/, 'hauteur de bande codée en dur (utiliser var(--chrome-inset-top))'],
  [/titlebar-area-/, 'env(titlebar-area-*) hors de chrome.css'],
  [/windowControlsOverlay/, "l'API WCO hors de chrome.css / main.ts"],
];

for (const f of [
  ...fichiersSous(SRC, ['.ts', '.tsx', '.css']),
  path.join(ROOT, 'electron', 'main.ts'),
]) {
  if (GEOMETRY_OWNERS.has(rel(f))) continue;
  const lignes = fs.readFileSync(f, 'utf8').split('\n');
  lignes.forEach((ligne, i) => {
    // Un commentaire peut légitimement NOMMER la géométrie pour l'expliquer.
    const nu = ligne.trim();
    if (nu.startsWith('*') || nu.startsWith('//') || nu.startsWith('/*')) return;
    for (const [motif, quoi] of INTERDITS) {
      if (motif.test(ligne)) signale(f, i + 1, `[monopole] ${quoi}`);
    }
  });
}

// ── Règle 2 : le manifeste des surfaces collées au bord haut ────────────────

// CSS : une règle qui pose `position: fixed` ET un `top: 0` / `inset: 0`.
for (const f of fichiersSous(SRC, ['.css'])) {
  if (GEOMETRY_OWNERS.has(rel(f))) continue;
  const texte = fs.readFileSync(f, 'utf8');
  const lignes = texte.split('\n');
  const re = /^([^{}@\n][^{}\n]*)\{([^}]*)\}/gm;
  let m;
  while ((m = re.exec(texte)) !== null) {
    const corps = m[2];
    if (!/position:\s*fixed/.test(corps)) continue;
    if (!/(^|[;\s])(inset:\s*0|top:\s*0)/.test(corps)) continue;
    const selecteurs = m[1]
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const ligne = texte.slice(0, m.index).split('\n').length;
    for (const sel of selecteurs) {
      // Un pseudo-element ne recoit aucun clic : une decoration de theme posee
      // en `::after` sur la page n'a rien a reserver.
      if (/::(after|before)/.test(sel)) continue;
      const cle = Object.keys(SURFACES).find((k) => sel.includes(k));
      if (!cle) {
        signale(f, ligne, `[manifeste] surface non classée : ${sel} — ajouter à SURFACES`);
        continue;
      }
      if (SURFACES[cle] !== 'aware') continue;
      // Une surface « aware » reserve elle-meme (variable ou classe), OU porte
      // un marqueur `chrome:aware` qui dit OU vit la reserve. Le marqueur
      // existe parce que la reserve appartient souvent a un enfant : la poser
      // sur le conteneur decalerait aussi son fond et son contenu.
      const reserve = /--chrome-inset-|chrome-safe-|chrome-drag-band|chrome:aware/.test(corps);
      if (!reserve) {
        signale(f, ligne, `[manifeste] ${cle} est classee « aware » mais ne reserve rien`);
      }
    }
    void lignes;
  }
}

// TSX : `fixed inset-0` / `fixed top-0` en utilitaires Tailwind.
const TSX_OVERLAY = /\bfixed\s+(inset-0|top-0|inset-y-0)\b/;
for (const f of fichiersSous(SRC, ['.tsx'])) {
  const lignes = fs.readFileSync(f, 'utf8').split('\n');
  lignes.forEach((ligne, i) => {
    if (!TSX_OVERLAY.test(ligne)) return;
    // Réserve présente, ou surface sans contrôle en haut : on demande une
    // marque explicite plutôt qu'une déduction fragile.
    if (/chrome-safe-|chrome-drag-band|chrome:free/.test(ligne)) return;
    // La marque peut vivre sur les lignes SUIVANTES (un `className` multiligne
    // pose souvent `fixed inset-0` avant `chrome-safe-top`), ou dans le bloc
    // de commentaire ATTACHÉ juste au-dessus de l'élément.
    //
    // Ce bloc se remonte EN ENTIER, et non sur trois lignes fixes : le
    // garde-fou demande une raison écrite, et une raison honnête dépasse
    // souvent trois lignes. La fenêtre fixe punissait exactement la
    // justification la mieux rédigée — elle repoussait le mot `chrome:free`
    // hors de portée (cas ProfilePicker : six lignes de raison, marque à la
    // première). On remonte donc les commentaires contigus et les lignes
    // d'ouverture qui les séparent de l'élément (`<div`, `return (`), et on
    // s'arrête au premier VRAI code — un `chrome:free` posé ailleurs, ou
    // détaché par une ligne vide, ne couvre toujours rien.
    let debut = i;
    while (debut > 0) {
      const prec = lignes[debut - 1].trim();
      const commentaire =
        prec.startsWith('//') || prec.startsWith('*') || prec.startsWith('/*') || prec === '{/*';
      const ouverture = /^<[A-Za-z]/.test(prec) || /^return\s*\(?$/.test(prec);
      if (!commentaire && !ouverture) break;
      debut -= 1;
    }
    const voisinage = lignes.slice(debut, i + 4).join('\n');
    if (/chrome-safe-|chrome:free/.test(voisinage)) return;
    signale(
      f,
      i + 1,
      '[manifeste] overlay plein écran non classé — poser chrome-safe-top, ou justifier par un commentaire « chrome:free — <raison> »'
    );
  });
}

// ── Règle 3 : la collision qui tue la réserve en silence ────────────────────

const CHROME_CLASSE = /chrome-safe-(bar|inline|left|right|top)/;
// `p-4`, `px-4`, `py-3`, `pt-2`, `pr-[140px]`… tout ce qui touche le padding.
const TAILWIND_PAD = /\b(p|px|py|pl|pr|pt)-(\d|\[)/;

for (const f of fichiersSous(SRC, ['.tsx'])) {
  const lignes = fs.readFileSync(f, 'utf8').split('\n');
  lignes.forEach((ligne, i) => {
    if (!CHROME_CLASSE.test(ligne)) return;
    if (!TAILWIND_PAD.test(ligne)) return;
    signale(
      f,
      i + 1,
      '[collision] un utilitaire de padding Tailwind sur le même élément qu’une classe chrome-safe-* : passer par --chrome-bar-pad'
    );
  });
}

// CSS : un `padding` raccourci sur une règle qui déclare --chrome-bar-pad.
for (const f of fichiersSous(SRC, ['.css'])) {
  if (GEOMETRY_OWNERS.has(rel(f))) continue;
  const texte = fs.readFileSync(f, 'utf8');
  const re = /^([^{}@\n][^{}\n]*)\{([^}]*)\}/gm;
  let m;
  while ((m = re.exec(texte)) !== null) {
    const corps = m[2];
    if (!/--chrome-bar-pad/.test(corps)) continue;
    if (!/(^|[;\s])padding:\s/.test(corps)) continue;
    const ligne = texte.slice(0, m.index).split('\n').length;
    signale(
      f,
      ligne,
      '[collision] `padding` RACCOURCI sur une règle qui pose --chrome-bar-pad : il réinitialise padding-left/right et efface la réserve. Utiliser les longhands.'
    );
  }
}

// ── Règle 4 : le monopole du padding de `.layout` ───────────────────────────
//
// La racine du layout porte DEUX réserves qui s'additionnent : celle de
// l'écran (encoche/barre système, web mobile) et celle du mode d'affichage des
// barres (rail à gauche, bande native en mode « aucune barre »). Déclarées
// dans deux fichiers, elles se sont écrasées : `[data-platform='web'] .layout`
// pèse (0,2,0) et a effacé le `padding-left` du rail, posé à (0,1,0) — sur le
// client web le rail (position:fixed) se posait SUR la page, sans un mot.
//
// Le padding de `.layout` ne se déclare donc QUE dans Layout.css, où les modes
// se voient les uns les autres. Ailleurs, on passe par `--layout-safe-*`.

const LAYOUT_CSS = 'src/renderer/components/layout/Layout/Layout.css';
// Vise la RACINE : `.layout`, `.layout--header-side`, `[x] .layout`. Pas les
// enfants (`.layout__body`), ni les homonymes (`.layout-transfer__lead`).
const LAYOUT_ROOT = /(?:^|[^\w-])\.layout(?:--[a-z0-9-]+)?$/;
const PADDING_DECL = /(?:^|[;\s])padding(?:-(?:top|right|bottom|left))?\s*:/;

for (const f of fichiersSous(SRC, ['.css'])) {
  if (rel(f) === LAYOUT_CSS) continue;
  const texte = fs.readFileSync(f, 'utf8');
  const re = /^([^{}@\n][^{}\n]*)\{([^}]*)\}/gm;
  let m;
  while ((m = re.exec(texte)) !== null) {
    if (!PADDING_DECL.test(m[2])) continue;
    const cible = m[1]
      .split(',')
      .map((s) => s.trim().replace(/:[a-z-]+(\([^)]*\))?/g, ''))
      .find((s) => LAYOUT_ROOT.test(s));
    if (!cible) continue;
    const ligne = texte.slice(0, m.index).split('\n').length;
    signale(
      f,
      ligne,
      `[monopole] padding sur la racine du layout (${cible}) hors de Layout.css : il écrase la réserve du mode de barres. Poser une variable --layout-safe-* et la laisser additionner par Layout.css.`
    );
  }
}

// ── Verdict ─────────────────────────────────────────────────────────────────

if (problemes.length > 0) {
  console.error('\nchrome de fenetre — %d probleme(s) :\n', problemes.length);
  for (const p of problemes) console.error('  ' + p);
  console.error(
    '\nVoir src/renderer/styles/chrome.css : la geometrie se MESURE, elle ne se devine pas.\n'
  );
  process.exit(1);
}

console.log(
  `OK chrome de fenetre : ${Object.keys(SURFACES).length} surfaces classees, primitive respectee.`
);
