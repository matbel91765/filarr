/**
 * L'éditeur de TABLEAU — une grille, là où il y avait une soupe de virgules.
 *
 * ── POURQUOI CE N'EST PAS LE DÉFAUT ────────────────────────────────────────
 * `.csv` et `.tsv` appartiennent déjà au greffon texte, et le registre accepte
 * plusieurs candidats depuis peu. Celui-ci s'enregistre donc APRÈS, en second :
 * le double-clic continue d'ouvrir ce qu'il ouvrait, et la grille se choisit
 * par « Ouvrir avec… ». Changer la destination d'un geste existant sans que
 * personne l'ait demandé est précisément ce qu'on s'interdit ici.
 *
 * ── LE VRAI TRAVAIL N'EST PAS LA GRILLE ────────────────────────────────────
 * Il est dans `csvFormat.ts` : réécrire un tableau sans le réécrire ENTIER.
 * Délimiteur, fins de ligne, marque d'ordre des octets, style de guillemets —
 * tout cela est retenu à la lecture et restitué à l'écriture, sans quoi
 * modifier une cellule produirait un diff de 100 % sur un fichier suivi en
 * git, puis un conflit au prochain `pull`.
 */

import type {
  EditorHost,
  EditorInstance,
  EditorProvider,
  FilarrPlugin,
} from '../../../services/plugins/pluginTypes';
import { parseCsv, serializeCsv, FORME_CSV_NEUTRE, type CsvShape } from './csvFormat';

/**
 * Bien plus bas que le plafond du cœur, et pour une raison mesurable : la
 * grille pose un champ de saisie PAR CELLULE. Un tableau de 512 Kio en fait
 * déjà plusieurs dizaines de milliers ; au-delà, le navigateur passe plus de
 * temps à construire le DOM qu'à afficher quoi que ce soit. L'aperçu, qui
 * virtualise, reste la bonne réponse pour les gros tableaux.
 */
const MAX_BYTES = 512 * 1024;

const MESSAGE_ILLISIBLE =
  "Ce fichier n'est pas du texte UTF-8 : il est ouvert en lecture seule. Son " +
  'contenu est laissé intact.';

function mountCsvEditor(host: EditorHost): EditorInstance {
  const extension = host.fileName.split('.').pop() ?? 'csv';
  const document_ = parseCsv(host.initialBytes, extension);
  const illisible = document_ === null;
  const forme: CsvShape = document_?.shape ?? FORME_CSV_NEUTRE;
  const rows: string[][] = document_?.rows ?? [];

  const racine = document.createElement('div');
  Object.assign(racine.style, {
    width: '100%',
    height: '100%',
    overflow: 'auto',
    font: '13px/1.4 system-ui, sans-serif',
  } satisfies Partial<CSSStyleDeclaration>);

  if (illisible) {
    const message = document.createElement('p');
    message.textContent = MESSAGE_ILLISIBLE;
    message.style.padding = '16px';
    racine.appendChild(message);
    host.container.appendChild(racine);
    return {
      destroy: () => racine.remove(),
      // On n'a jamais eu le tableau : rendre les octets d'origine est la seule
      // issue qui ne détruit pas le fichier.
      getBytes: () => host.initialBytes,
    };
  }

  const table = document.createElement('table');
  Object.assign(table.style, {
    borderCollapse: 'collapse',
    width: 'max-content',
    minWidth: '100%',
  } satisfies Partial<CSSStyleDeclaration>);

  const colonnes = rows.reduce((max, r) => Math.max(max, r.length), 0);

  /**
   * LA PREMIÈRE LIGNE N'EST PAS DÉCLARÉE COMME UN EN-TÊTE.
   *
   * Un `.csv` ne dit nulle part s'il en a un — le supposer ferait disparaître
   * une ligne de données dans un fichier qui n'en a pas. On la met simplement
   * en évidence, et elle reste modifiable comme les autres.
   */
  rows.forEach((ligne, y) => {
    const tr = document.createElement('tr');
    // Le numéro de ligne : sans lui, on ne sait plus où on est passé la
    // vingtième rangée.
    const num = document.createElement('td');
    num.textContent = String(y + 1);
    Object.assign(num.style, {
      padding: '2px 8px',
      textAlign: 'right',
      opacity: '0.5',
      userSelect: 'none',
      borderRight: '1px solid rgba(128,128,128,.3)',
      position: 'sticky',
      left: '0',
      background: 'inherit',
    } satisfies Partial<CSSStyleDeclaration>);
    tr.appendChild(num);

    for (let x = 0; x < colonnes; x += 1) {
      const td = document.createElement('td');
      td.style.border = '1px solid rgba(128,128,128,.25)';
      td.style.padding = '0';

      const champ = document.createElement('input');
      champ.type = 'text';
      champ.value = ligne[x] ?? '';
      champ.readOnly = host.readOnly;
      champ.setAttribute('aria-label', `Ligne ${y + 1}, colonne ${x + 1}`);
      Object.assign(champ.style, {
        border: 'none',
        outline: 'none',
        background: 'transparent',
        color: 'inherit',
        font: 'inherit',
        padding: '4px 8px',
        minWidth: '90px',
        width: '100%',
        fontWeight: y === 0 ? '600' : '400',
        boxSizing: 'border-box',
      } satisfies Partial<CSSStyleDeclaration>);

      champ.addEventListener('input', () => {
        // La grille EST le modèle : on écrit dans `rows`, et `getBytes` le
        // sérialise. Relire le DOM au moment d'enregistrer marcherait aussi,
        // mais laisserait une seconde source de vérité.
        while (rows[y].length <= x) rows[y].push('');
        rows[y][x] = champ.value;
        host.onDirty(true);
      });

      td.appendChild(champ);
      tr.appendChild(td);
    }
    table.appendChild(tr);
  });

  racine.appendChild(table);
  host.container.appendChild(racine);

  return {
    destroy() {
      racine.remove();
    },
    getBytes() {
      return serializeCsv(rows, forme);
    },
  };
}

/**
 * Le contenu d'un tableau NEUF.
 *
 * Le séparateur est la virgule et les fins de ligne sont en LF : c'est ce que
 * `parseCsv` relira, et la forme du fichier sera ensuite conservée telle
 * quelle par le tour de lecture-écriture.
 */
const GRAINE_CSV = new TextEncoder().encode(
  ['Colonne 1,Colonne 2,Colonne 3', ',,', ',,', ''].join('\n')
);

const provider: EditorProvider = {
  contribution: {
    id: 'csv-grid',
    extensions: ['csv', 'tsv'],
    // La grille n'a pas de geste « ajouter une colonne » : un fichier vide y
    // serait un tableau sans case où écrire. La graine donne trois colonnes
    // et deux lignes — de quoi commencer, assez peu pour être effacé.
    newDocument: [{ ext: 'csv', label: 'Tableau CSV', seed: () => GRAINE_CSV }],
    displayName: 'Éditer le tableau',
    maxBytes: MAX_BYTES,
  },
  mount: mountCsvEditor,
};

export const csvEditorPlugin: FilarrPlugin = {
  manifest: {
    id: 'csv-editor',
    name: 'Éditeur de tableau',
    version: '1.0.0',
    trust: 'builtin',
    provides: { editors: [provider.contribution] },
  },
  editors: [provider],
};
