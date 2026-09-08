/**
 * docsExtensions — LA liste d'extensions, partagée éditeur/import.
 *
 * generateJSON(html, extensions) de l'import docx DOIT utiliser exactement
 * cette liste : une extension absente et les `<table>`/`<img>` produits par
 * mammoth sont silencieusement jetés au parsing — perte muette, le contraire
 * du contrat « pertes annoncées ».
 *
 * TABLES : TableKit SEUL (il enregistre Table+Row+Cell+Header) — ajouter en
 * plus un nœud table individuel enregistrerait deux fois le même nœud dans le
 * schéma ; une seule source, ici.
 */
import type { AwarenessLike } from './filarr-plugin-api';
import type { AnyExtension } from '@tiptap/core';
import type * as Y from 'yjs';
export declare function buildDocsExtensions(opts?: {
    collabDoc?: Y.Doc;
    awareness?: AwarenessLike;
    placeholder?: string;
}): AnyExtension[];
