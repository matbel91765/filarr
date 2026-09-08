/**
 * LE PORTAGE DU NOYAU DE MISE EN PAGE VERS LE WORKER — et sa seule règle.
 *
 * ── POURQUOI UNE COPIE, ENCORE ──────────────────────────────────────────────
 *
 * `infra/cloudflare-worker/tsconfig.json` a pour racine ce répertoire : importer
 * un module de `src/` déplacerait toute l'arborescence émise et casserait le
 * paquet déployé. C'est exactement la contrainte qui fait déjà coexister
 * `electron/sync/layoutMergeCore.ts` et `src/platform/web/sync/notesMerge.ts`.
 * La duplication est donc SUBIE, pas choisie.
 *
 * ── CE QUI CHANGE, PAR RAPPORT AUX TROIS DUPLICATIONS PRÉCÉDENTES ───────────
 *
 * Les autres sont recopiées à la main et tenues par la discipline. Celle-ci est
 * GÉNÉRÉE, et un test (`layoutCorePort.vitest.ts`) refait le calcul pour vérifier
 * que le fichier posé dans le worker est exactement ce que la source produit.
 *
 * La divergence qu'on cherche à empêcher n'est pas théorique : deux validateurs
 * qui s'écartent d'un seul plafond, c'est un fichier ACCEPTÉ à la publication et
 * REFUSÉ à l'installation — un utilisateur qui publie un modèle que personne ne
 * peut poser, sans qu'aucun message ne dise pourquoi.
 *
 * ── LA RÈGLE ────────────────────────────────────────────────────────────────
 *
 * On ne modifie JAMAIS un fichier `*Core.ts` du worker à la main. On modifie la
 * source dans `src/services/layouts/`, puis :
 *
 *     node scripts/layout-core-port.cjs
 *
 * Les seules transformations autorisées sont des RÉÉCRITURES DE CHEMIN
 * D'IMPORT, listées dans `REWRITES`. Toute autre différence est un défaut, et le
 * test la fait échouer.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'src', 'services', 'layouts');
const OUT_DIR = path.join(ROOT, 'infra', 'cloudflare-worker', 'src');

/**
 * La ligne qui sépare l'en-tête généré du corps recopié. Le test coupe dessus :
 * tout ce qui suit doit être la source, aux réécritures près.
 */
const SENTINEL = '// ─────────── COPIE CONFORME — ne rien modifier sous cette ligne ───────────';

/**
 * Les modules portés, dans l'ordre de leurs dépendances.
 *
 * `layoutMarketSigning.ts` n'y est PAS et ne peut pas y être : il dépend de
 * `userKeypair` (la clé privée de l'appareil). Le worker ne signe rien — il
 * VÉRIFIE, avec sa propre implémentation Ed25519, et partage seulement la
 * lecture de l'enveloppe.
 */
const PORTS = [
  { source: 'layoutFormat.ts', target: 'layoutFormatCore.ts' },
  { source: 'layoutValidator.ts', target: 'layoutValidatorCore.ts' },
  { source: 'layoutMarketTypes.ts', target: 'layoutMarketTypesCore.ts' },
];

/** Les réécritures de chemin, et rien d'autre. */
const REWRITES = [
  [`from './layoutFormat'`, `from './layoutFormatCore'`],
  [`from './layoutValidator'`, `from './layoutValidatorCore'`],
  [`from './layoutMarketTypes'`, `from './layoutMarketTypesCore'`],
];

/** Le corps porté : la source, aux seules réécritures de chemin près. */
function portedBody(sourceText) {
  return REWRITES.reduce(
    (text, [from, to]) => text.split(from).join(to),
    sourceText.replace(/\r\n/g, '\n')
  );
}

function header(sourceName) {
  return [
    '/**',
    ` * ⚠ FICHIER GÉNÉRÉ — copie conforme de \`src/services/layouts/${sourceName}\`.`,
    ' *',
    ' * Ne le modifiez pas ici : votre correction serait effacée au prochain portage,',
    ' * et le test de conformité échouerait entre-temps sans dire laquelle des deux',
    ' * copies a raison. Modifiez la source, puis :',
    ' *',
    ' *     node scripts/layout-core-port.cjs',
    ' *',
    " * Pourquoi cette copie existe : voir l'en-tête de ce script.",
    ' */',
    '',
    SENTINEL,
    '',
  ].join('\n');
}

/** Le contenu ATTENDU d'un fichier porté. Le test appelle exactement ceci. */
function portedContent(sourceText, sourceName) {
  return header(sourceName) + portedBody(sourceText);
}

function run() {
  for (const { source, target } of PORTS) {
    const sourceText = fs.readFileSync(path.join(SRC_DIR, source), 'utf8');
    fs.writeFileSync(path.join(OUT_DIR, target), portedContent(sourceText, source), 'utf8');
    process.stdout.write(`porté  ${source} → infra/cloudflare-worker/src/${target}\n`);
  }
}

module.exports = { PORTS, REWRITES, SENTINEL, portedBody, portedContent, SRC_DIR, OUT_DIR };

if (require.main === module) run();
