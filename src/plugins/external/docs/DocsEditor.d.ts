/**
 * L'éditeur de documents — tiptap monté dans le contrat EditorHost de Filarr.
 *
 * DEUX RÉGIMES, UN SEUL MONTAGE :
 *
 *   · SEUL — le `.fdoc` est chargé depuis les octets de l'hôte, la sauvegarde
 *     repasse par `host.saveBytes` (re-chiffrement + verrou de version, la
 *     propriété du cœur).
 *   · EN SALLE — `host.collab` est présent : le document VIT dans le
 *     Y.XmlFragment 'content', transporté chiffré par le relais aveugle du
 *     cœur. Les octets initiaux ne sèment la salle que si elle est VIDE —
 *     celui qui arrive dans une salle habitée adopte ce qu'elle contient,
 *     jamais l'inverse. La présence (curseurs nommés) vient d'Awareness, déjà
 *     chiffrée par le pipeline.
 *
 * La mise en page « page » (largeur lisible, marges, ombre feuille) est du CSS
 * local au plugin : Filarr n'impose ni ne reçoit aucune feuille de style.
 */
import type { EditorHost, EditorInstance } from './filarr-plugin-api';
export declare function mountDocsEditor(host: EditorHost): EditorInstance;
