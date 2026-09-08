/**
 * L'enregistrement des greffons EMBARQUÉS — appelé une fois au démarrage.
 *
 * C'est la liste blanche : tout ce qui touche des octets déchiffrés passe par
 * ici, revu comme du code du cœur. Le chargement de greffons externes (dépôts
 * séparés) suit le même contrat : leur bundle exporte un `FilarrPlugin`, et
 * une build du cœur qui les embarque les ajoute à cette liste — voir le dépôt
 * `filarr-plugin-docs` pour le premier d'entre eux.
 */

import { registerPlugin, registerSandboxedPlugin } from '../services/plugins/pluginRegistry';
import type { FilarrPlugin } from '../services/plugins/pluginTypes';
import { textEditorPlugin } from './builtin/textEditor';
import { codeEditorPlugin } from './builtin/codeEditor';
import { csvEditorPlugin } from './builtin/csvEditor';
import { icsEditorPlugin } from './builtin/icsEditor';
// Le bundle du dépôt filarr-plugin-docs, déposé par son `npm run deploy:local`.
// Externe par son dépôt, builtin par son régime : embarqué à la construction,
// relu comme du code du cœur — le seul régime que le registre serve.
import { docsPlugin } from './external/docs';
import { isPluginSandboxDemoEnabled } from '../config/pluginSandbox';
import { demoNotepadPlugin } from './sandboxed/demoNotepad';

let fait = false;

export function registerBuiltinPlugins(): void {
  if (fait) return;
  registerPlugin(textEditorPlugin);
  // L'editeur de CODE : ~40 extensions, coloration syntaxique. A part du
  // greffon texte, qui reste l'editeur de REFERENCE minimal.
  registerPlugin(codeEditorPlugin);
  // La grille CSV s'enregistre APRES le greffon texte, qui revendique deja
  // .csv/.tsv : elle devient donc le SECOND candidat, joignable par « Ouvrir
  // avec… ». Le double-clic continue d'ouvrir ce qu'il ouvrait.
  registerPlugin(csvEditorPlugin);
  // Le calendrier : `.ics` n'etait revendique par personne, donc le
  // double-clic partait vers l'application systeme. Il devient le PREMIER
  // candidat de son extension — aucun defaut existant ne change.
  registerPlugin(icsEditorPlugin);
  // Le greffon vendorise une copie du contrat (même forme, module distinct) :
  // le pont de types est structurel, et le registre reste le juge du régime.
  registerPlugin(docsPlugin as unknown as FilarrPlugin);
  // La DÉMO du bac à sable — derrière drapeau local (par appareil). Son code
  // est une chaîne : il ne s'exécute que dans l'iframe d'origine opaque.
  if (isPluginSandboxDemoEnabled()) registerSandboxedPlugin(demoNotepadPlugin);
  // LE DRAPEAU SE POSE À LA FIN, pas au début.
  //
  // Posé d'abord, il transformait un enregistrement qui jette en une liste
  // blanche DÉFINITIVEMENT vide : cette fonction est appelée dans le corps de
  // rendu de l'explorateur (FolderView), donc l'exception faisait tomber le
  // rendu, et le re-rendu suivant sortait aussitôt sur `if (fait) return` —
  // plus aucun éditeur, jusqu'au redémarrage, sans qu'aucun message ne le
  // dise. À la fin, un échec laisse le prochain rendu réessayer.
  fait = true;
}
