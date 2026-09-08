/**
 * L'éditeur de CODE — un textarea, et un calque coloré dessous.
 *
 * ── POURQUOI UN GREFFON À PART ─────────────────────────────────────────────
 * `text-editor` est le greffon de RÉFÉRENCE : il existe d'abord pour prouver
 * le contrat avec le plus petit éditeur réel possible, et son en-tête le dit.
 * Lui coller trente-cinq extensions et une coloration syntaxique lui ferait
 * perdre ce rôle. Celui-ci vit à côté, revendique les formats de code, et
 * emprunte exactement la même porte.
 *
 * ── POURQUOI PAS SEULEMENT « PLUS D'EXTENSIONS » ───────────────────────────
 * Un fichier de 3 000 lignes dans un `<textarea>` monospace sans coloration
 * est PIRE que pas d'éditeur du tout : on le rend modifiable sans le rendre
 * lisible, donc on invite à éditer à l'aveugle. La coloration n'est pas un
 * ornement, c'est ce qui rend l'ouverture défendable.
 *
 * ── LA TECHNIQUE, ET SES DEUX PIÈGES ───────────────────────────────────────
 * Le texte réel vit dans un `<textarea>` TRANSPARENT ; un `<pre>` identique,
 * posé dessous, porte les couleurs. C'est le motif classique, et il ne tient
 * qu'à deux conditions, toutes deux faciles à casser :
 *
 *  1. LES DEUX BOÎTES DOIVENT AVOIR EXACTEMENT LA MÊME MÉTRIQUE — même police,
 *     même taille, même interligne, même padding, même retour à la ligne.
 *     Un pixel d'écart et le curseur dérive d'une ligne à l'autre.
 *  2. LE CALQUE NE REÇOIT JAMAIS DE POINTEUR (`pointer-events: none`), sinon
 *     la sélection à la souris s'y accroche au lieu du texte.
 *
 * Et une règle de sûreté : le calque est du HTML injecté. Tout ce qui y entre
 * passe par `highlightToHtml`, qui échappe même son repli — un `.log`
 * contenant `<img onerror>` ne doit pas exécuter de script dans le renderer.
 */

import type {
  EditorHost,
  EditorInstance,
  EditorProvider,
  FilarrPlugin,
} from '../../../services/plugins/pluginTypes';
import { decodeText, encodeText, FORME_NEUTRE, type TextShape } from '../../../utils/textEncoding';
import { highlightToHtml } from '../../../utils/syntaxHighlight';

/**
 * Les formats de code que ce greffon ouvre.
 *
 * `md`, `markdown`, `txt`, `csv`, `json` et `log` restent au greffon texte :
 * ils y étaient déjà, et le registre accepte plusieurs candidats — les
 * déplacer changerait l'éditeur par défaut de fichiers que les gens ouvrent
 * tous les jours, pour un gain nul.
 *
 * `svg` en est ABSENT, et c'est un choix. C'est du XML, donc le colorer aurait
 * du sens — mais un éditeur enregistré passe AVANT la galerie
 * (`openItemContent`), si bien que le revendiquer ferait s'ouvrir en source un
 * fichier que le double-clic affichait en image. Changer ce qu'un geste fait
 * pour un format courant, sans que personne l'ait demandé, est exactement ce
 * que « Ouvrir avec… » existe pour éviter — et c'est par là qu'on éditera un
 * `.svg` le jour où l'aperçu saura basculer rendu/source.
 */
const EXTENSIONS = [
  'js',
  'jsx',
  'mjs',
  'cjs',
  'ts',
  'tsx',
  'py',
  'rb',
  'php',
  'java',
  'cs',
  'go',
  'rs',
  'c',
  'cc',
  'cpp',
  'h',
  'hpp',
  'css',
  'scss',
  'sass',
  'less',
  'xml',
  'yaml',
  'yml',
  'toml',
  'ini',
  'conf',
  'env',
  'sh',
  'bash',
  'zsh',
  'bat',
  'ps1',
  'sql',
  'diff',
  'patch',
  'gradle',
  'properties',
];

/**
 * Plus bas que le plafond du cœur (50 Mio), et c'est délibéré.
 *
 * Ici chaque frappe re-colore le document entier : le coût n'est pas celui de
 * l'ouverture, c'est celui de CHAQUE caractère tapé. Au-delà, l'éditeur
 * répondrait avec un retard perceptible — l'aperçu, qui ne colore qu'une fois,
 * reste la bonne réponse pour les gros fichiers.
 */
const MAX_BYTES = 2 * 1024 * 1024;

/** La métrique PARTAGÉE par le textarea et son calque. Un seul endroit. */
const METRIQUE: Partial<CSSStyleDeclaration> = {
  margin: '0',
  padding: '12px',
  border: 'none',
  font: '13px/1.55 ui-monospace, "Cascadia Mono", Consolas, monospace',
  letterSpacing: 'normal',
  tabSize: '2',
  whiteSpace: 'pre',
  overflowWrap: 'normal',
  boxSizing: 'border-box',
};

const MESSAGE_ILLISIBLE = [
  "Ce fichier n'est pas du texte UTF-8 : il est ouvert en lecture seule.",
  '',
  "Son contenu est laissé intact — l'afficher approximativement puis " +
    "l'enregistrer le détruirait.",
].join('\n');

function mountCodeEditor(host: EditorHost): EditorInstance {
  const lu = decodeText(host.initialBytes);
  const illisible = lu === null;
  const forme: TextShape = lu?.shape ?? FORME_NEUTRE;

  const racine = document.createElement('div');
  Object.assign(racine.style, {
    position: 'relative',
    width: '100%',
    height: '100%',
    overflow: 'hidden',
    background: 'transparent',
  } satisfies Partial<CSSStyleDeclaration>);

  const calque = document.createElement('pre');
  calque.setAttribute('aria-hidden', 'true');
  Object.assign(calque.style, {
    ...METRIQUE,
    position: 'absolute',
    inset: '0',
    overflow: 'auto',
    // Le calque ne doit JAMAIS intercepter la souris : la sélection s'y
    // accrocherait au lieu de se faire dans le texte réel.
    pointerEvents: 'none',
    color: 'inherit',
  } satisfies Partial<CSSStyleDeclaration>);

  const textarea = document.createElement('textarea');
  textarea.className = 'filarr-plugin-code-editor';
  textarea.readOnly = host.readOnly || illisible;
  textarea.spellcheck = false;
  textarea.setAttribute('aria-label', host.fileName);
  Object.assign(textarea.style, {
    ...METRIQUE,
    position: 'absolute',
    inset: '0',
    width: '100%',
    height: '100%',
    resize: 'none',
    outline: 'none',
    overflow: 'auto',
    background: 'transparent',
    // Le texte est INVISIBLE — seul le calque en dessous porte les couleurs —
    // mais le CURSEUR, lui, doit rester visible : `caret-color` le rattrape.
    color: 'transparent',
    caretColor: 'currentColor',
  } satisfies Partial<CSSStyleDeclaration>);

  textarea.value = illisible ? MESSAGE_ILLISIBLE : (lu?.text ?? '');

  racine.appendChild(calque);
  racine.appendChild(textarea);
  host.container.appendChild(racine);

  const recolorer = (): void => {
    // Une ligne vide finale n'a pas de hauteur dans un `<pre>` : sans ce
    // caractère, le calque est plus court que le textarea et la dernière ligne
    // se colore une ligne trop haut.
    calque.innerHTML = highlightToHtml(`${textarea.value}\n`, host.fileName);
  };

  const synchroniser = (): void => {
    calque.scrollTop = textarea.scrollTop;
    calque.scrollLeft = textarea.scrollLeft;
  };

  const surSaisie = (): void => {
    recolorer();
    synchroniser();
    host.onDirty(true);
  };

  recolorer();
  textarea.addEventListener('input', surSaisie);
  textarea.addEventListener('scroll', synchroniser);

  return {
    destroy() {
      textarea.removeEventListener('input', surSaisie);
      textarea.removeEventListener('scroll', synchroniser);
      racine.remove();
    },
    isEmpty() {
      /**
       * Un fichier ILLISIBLE n'est jamais « vide » : ses octets d'origine
       * sont intacts et seront rendus tels quels. Le dire vide inviterait
       * l'hôte à croire qu'on vient de l'effacer.
       */
      if (illisible) return false;
      return textarea.value.length === 0;
    },
    getBytes() {
      // Illisible : on n'a jamais eu le texte, donc on ne fabrique rien.
      if (illisible) return host.initialBytes;
      // La forme du fichier est restituée ici — fins de ligne et BOM. Sans
      // cela, rouvrir un fichier Windows et l'enregistrer sans y toucher
      // réécrirait chacune de ses lignes.
      return encodeText(textarea.value, forme);
    },
  };
}

const provider: EditorProvider = {
  contribution: {
    id: 'code',
    extensions: EXTENSIONS,
    displayName: 'Éditer le code',
    maxBytes: MAX_BYTES,
  },
  mount: mountCodeEditor,
};

export const codeEditorPlugin: FilarrPlugin = {
  manifest: {
    id: 'code-editor',
    name: 'Éditeur de code',
    version: '1.0.0',
    trust: 'builtin',
    provides: { editors: [provider.contribution] },
  },
  editors: [provider],
};
