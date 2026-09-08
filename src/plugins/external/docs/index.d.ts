/**
 * @filarr/plugin-docs — l’éditeur de documents de Filarr.
 *
 * Le bundle exporte UN objet : le `FilarrPlugin`. Une build du cœur qui
 * l'embarque l'ajoute à sa liste blanche (`registerBuiltinPlugins`) — voir le
 * README pour le circuit de build. Le régime `builtin` est assumé : ce code
 * touche des octets déchiffrés et se fait relire comme du code du cœur.
 */
import type { FilarrPlugin } from './filarr-plugin-api';
export declare const docsPlugin: FilarrPlugin;
export default docsPlugin;
