/**
 * Export docx — LA FRONTIÈRE DE SORTIE, fidèle EN SORTIE.
 *
 * Projection du document ProseMirror vers la bibliothèque `docx` :
 * paragraphes, titres, listes, citations, tables, images data-URL, alignement,
 * souligné/barré, couleur, surlignage, LIENS (ExternalHyperlink), BLOCS DE
 * CODE (paragraphe mono ombré), CODE EN LIGNE (run mono) et SÉPARATEURS
 * (paragraphe à bordure basse). « Fidèle en sortie » et pas
 * « symétrique » : mammoth ne réimporte ni alignement ni couleur ni surlignage
 * — un aller-retour ne conserve que la structure (titres/listes/tables/gras/
 * souligné/barré/images). L'export est une PHOTO pour l'échange — le document
 * de travail reste le fdoc.
 */
import { Paragraph, Table } from 'docx';
type DocxChild = Paragraph | Table;
/** Exporté pour les tests : la projection sans l'emballage Packer. */
export declare function buildDocxChildren(pmDoc: Record<string, unknown>): DocxChild[];
export declare function exportDocx(pmDoc: Record<string, unknown>): Promise<Uint8Array>;
export {};
