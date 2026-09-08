/**
 * Le greffon de RÉFÉRENCE : l'éditeur de texte collaboratif (txt, md).
 *
 * Deux raisons d'exister, dans cet ordre. D'abord PROUVER le contrat de
 * l'API des greffons avec le plus petit éditeur réel possible — chaque futur
 * greffon (l'éditeur de documents dans son propre dépôt, le tableur…) monte
 * exactement par cette porte, et une API qu'aucun code n'emprunte est une API
 * qu'on découvre fausse trop tard. Ensuite LIVRER quelque chose : un `.md` ou
 * un `.txt` déposé dans un coffre devient éditable, à plusieurs et en temps
 * réel quand la salle est ouverte — le transport chiffré, l'époque de clé et
 * l'élection de l'enregistreur sont fournis par l'hôte, ce greffon n'en sait
 * RIEN.
 *
 * La sémantique collaborative : notre Y.Text (NOM_TYPE_PARTAGE, un nom à nous
 * — voir sa note) est la vérité quand la salle est vivante ; les octets
 * initiaux ne SÈMENT le texte que si le document partagé est vide (même règle
 * que les notes de coffre — celui qui arrive dans une salle habitée adopte ce
 * qu'elle contient).
 */

import type {
  EditorHost,
  EditorInstance,
  EditorProvider,
  FilarrPlugin,
} from '../../../services/plugins/pluginTypes';
import { bindYTextToTextarea, type YTextareaBinding } from './yTextarea';
import { decodeText, encodeText, FORME_NEUTRE, type TextShape } from '../../../utils/textEncoding';

/**
 * LE FILET DU SEMIS. L'hôte désigne UN pair pour verser le texte dans une salle
 * vide (`host.collab.maySeed`) — deux pairs qui sèment, c'est le document en
 * double, puisque le CRDT ne perd rien. Mais si l'élu ne verse jamais rien (il
 * a pu monter hors salle de son côté), attendre indéfiniment afficherait un
 * document VIDE pour tout le monde. Passé ce délai, chacun sème, après avoir
 * revérifié que la salle est toujours vide. Même valeur que le filet du cœur
 * (COLLAB_SEED_TIMEOUT_MS).
 */
const SEED_FALLBACK_MS = 4000;

/**
 * LE NOM DE NOTRE TYPE DANS LE DOCUMENT PARTAGÉ — et pourquoi ce n'est PAS
 * `content`.
 *
 * Un Y.Doc n'a qu'un seul espace de noms pour ses types de premier niveau, et
 * Yjs refuse d'y voir deux constructeurs différents : il JETTE. Or le document
 * que l'hôte nous tend n'est pas vierge — `yDocManager.getDoc()` y réserve
 * `content` en Y.XmlFragment dès la CRÉATION, pour tout document sans
 * exception, parce que c'est la convention ProseMirror du cœur (les notes s'y
 * branchent, et le greffon `docs` aussi, délibérément). Demander `content` en
 * Y.Text tuait donc l'écran entier dès que la salle passait `live` :
 * « Type with the name content has already been defined with a different
 * constructor », levé SYNCHRONEMENT au montage, donc remonté jusqu'à
 * l'ErrorBoundary de la route.
 *
 * On prend donc un nom À NOUS, préfixé par notre identifiant de greffon — la
 * même discipline que les types de l'hôte (`filarr:room`, `filarr:comments`).
 * Rien n'est perdu au passage : la collision étant inconditionnelle, ce
 * Y.Text n'a JAMAIS pu être créé, donc aucune salle, aucun journal de relais
 * et aucun stockage local ne contient de texte sous `content` — un élément de
 * coffre n'est de toute façon jamais persisté ici (`persist: false`).
 *
 * Il doit rester STABLE : deux pairs qui ouvrent le même fichier se lient par
 * ce nom, et en changer ferait éditer chacun dans son coin sans le savoir.
 */
const NOM_TYPE_PARTAGE = 'plugin:plain-text';

/**
 * Ce qu'on affiche à la place d'un texte qu'on refuse de décoder.
 *
 * En dur, et en français : le contrat `EditorHost` ne passe AUCUNE fonction de
 * traduction (c'est délibéré — voir pluginTypes.ts), et un éditeur qui se tait
 * sur son refus laisse croire à un fichier vide.
 */
const MESSAGE_ILLISIBLE = [
  "Ce fichier n'est pas du texte UTF-8 : il est ouvert en lecture seule.",
  '',
  "Son contenu est laissé intact — l'afficher approximativement puis " +
    "l'enregistrer le détruirait.",
].join('\n');

function mountTextEditor(host: EditorHost): EditorInstance {
  /**
   * ON DÉCODE STRICTEMENT, OU PAS DU TOUT.
   *
   * `null` = ces octets ne sont pas du texte UTF-8 (ou sont binaires). On monte
   * alors en LECTURE SEULE et `getBytes()` rend les octets D'ORIGINE : même si
   * l'hôte enregistre, le fichier ressort intact. L'ancien décodeur, lui,
   * remplaçait chaque octet invalide par U+FFFD sans un mot, et la première
   * sauvegarde figeait la mutilation.
   */
  const lu = decodeText(host.initialBytes);
  const illisible = lu === null;
  const forme: TextShape = lu?.shape ?? FORME_NEUTRE;
  const texteInitial = lu?.text ?? '';

  const textarea = document.createElement('textarea');
  textarea.className = 'filarr-plugin-text-editor';
  textarea.readOnly = host.readOnly || illisible;
  textarea.spellcheck = false;
  textarea.setAttribute('aria-label', host.fileName);
  // Le style minimal vit ici : un greffon n'impose pas de feuille au cœur.
  Object.assign(textarea.style, {
    width: '100%',
    height: '100%',
    resize: 'none',
    border: 'none',
    outline: 'none',
    background: 'transparent',
    color: 'inherit',
    font: '14px/1.6 ui-monospace, Consolas, monospace',
    padding: '12px',
    boxSizing: 'border-box',
  } satisfies Partial<CSSStyleDeclaration>);
  host.container.appendChild(textarea);

  let binding: YTextareaBinding | null = null;
  let proprePendantMontage = true;
  let semisTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * UN FICHIER QU'ON REFUSE DE DÉCODER N'ENTRE PAS DANS UNE SALLE.
   *
   * La salle transporte du TEXTE. Un fichier illisible n'en a pas : on n'a
   * que ses octets, rendus tels quels par `getBytes`. Le brancher quand même
   * donnait le pire des deux mondes — la liaison écrasait la zone avec le
   * contenu de la salle (vide au départ), le semis renonçait faute de texte
   * à verser, et l'on obtenait une zone VIDE et muette sur un fichier qui a
   * du contenu. En salle habitée, pire encore : on affichait le texte du
   * voisin par-dessus un fichier qui ne le contient pas.
   *
   * Hors salle, il reste lisible en lecture seule avec son message, et ses
   * octets traversent intacts. C'est le comportement juste, et il vaut
   * aussi en coffre partagé.
   */
  if (host.collab && host.collab.phase === 'live' && !illisible) {
    const collab = host.collab;
    const ytext = collab.doc.getText(NOM_TYPE_PARTAGE);
    // Notre PROPRE semis n'est pas une saisie : il repasse par l'observateur
    // ci-dessous, et le compter comme une modification ferait réclamer un
    // enregistrement pour un texte identique à celui du coffre.
    let semisEnCours = false;
    // Semer SEULEMENT une salle vide : arriver dans une salle habitée, c'est
    // adopter son contenu, jamais l'écraser avec sa copie locale. La salle est
    // re-testée au moment de verser, jamais avant.
    const semer = (): void => {
      if (ytext.length > 0) return;
      if (texteInitial.length === 0) return;
      semisEnCours = true;
      try {
        ytext.insert(0, texteInitial);
      } finally {
        semisEnCours = false;
      }
    };
    binding = bindYTextToTextarea(ytext, textarea);
    ytext.observe(() => {
      if (!proprePendantMontage && !semisEnCours) host.onDirty(true);
    });
    // UN SEUL PAIR SÈME — l'hôte tranche (voir PluginCollabHandle.maySeed), et
    // un hôte qui ne le dit pas vaut « oui ».
    if (collab.maySeed && !collab.maySeed()) semisTimer = setTimeout(semer, SEED_FALLBACK_MS);
    else semer();
  } else {
    textarea.value = illisible ? MESSAGE_ILLISIBLE : texteInitial;
  }

  const surSaisie = () => host.onDirty(true);
  textarea.addEventListener('input', surSaisie);
  // Les évènements de montage ne comptent pas comme une saisie.
  queueMicrotask(() => {
    proprePendantMontage = false;
  });

  return {
    destroy() {
      // Le filet d'abord : un semis qui se déclencherait après le démontage
      // écrirait dans une salle que plus personne ne regarde.
      if (semisTimer) clearTimeout(semisTimer);
      binding?.destroy();
      textarea.removeEventListener('input', surSaisie);
      textarea.remove();
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
      // Illisible : on n'a jamais eu le texte, donc on ne fabrique rien. Rendre
      // les octets d'origine est la SEULE issue qui ne détruit pas le fichier.
      if (illisible) return host.initialBytes;
      // La forme du fichier est restituée ici — fins de ligne et BOM. Un
      // `<textarea>` ne rend QUE des LF (règle HTML sur l'« API value ») :
      // sans cette étape, rouvrir un fichier Windows et l'enregistrer sans y
      // toucher réécrivait chacune de ses lignes.
      return encodeText(textarea.value, forme);
    },
  };
}

const provider: EditorProvider = {
  contribution: {
    id: 'plain-text',
    // `mdx` et `tsv` s'apercevaient deja correctement (MarkdownPreview,
    // CsvPreview) et n'etaient hors de cette liste que par omission.
    extensions: ['txt', 'md', 'mdx', 'markdown', 'csv', 'tsv', 'json', 'log'],
    displayName: 'Éditer le texte',
    // Sans graine, et c'est correct ici : un fichier texte vide est un
    // fichier texte valide. Les six autres extensions revendiquées
    // (mdx, csv, tsv, json, log) ne sont PAS offertes à la création — on les
    // ouvre, on ne les invente pas.
    newDocument: [
      { ext: 'txt', label: 'Texte brut' },
      { ext: 'md', label: 'Markdown' },
    ],
  },
  mount: mountTextEditor,
};

export const textEditorPlugin: FilarrPlugin = {
  manifest: {
    id: 'text-editor',
    name: 'Éditeur de texte',
    version: '1.0.0',
    trust: 'builtin',
    provides: { editors: [provider.contribution] },
  },
  editors: [provider],
};
