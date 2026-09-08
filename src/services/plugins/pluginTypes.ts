/**
 * L'API DE GREFFONS DE FILARR — le contrat, et rien que le contrat.
 *
 * POURQUOI DES GREFFONS. L'édition bureautique (documents riches, tableurs) ne
 * doit pas grossir le cœur : elle a ses propres dépendances lourdes, son propre
 * rythme de versions, et — un jour — ses propres auteurs. Un greffon vit dans
 * SON dépôt, se construit seul, et se branche ici par un contrat étroit. Le
 * premier consommateur est l'éditeur de documents ; le contrat est pensé pour
 * que le deuxième (tableur, kanban, dessin…) n'exige aucun changement du cœur.
 *
 * LE MODÈLE DE CONFIANCE, DIT FRANCHEMENT. Un éditeur reçoit les octets
 * DÉCHIFFRÉS du document — c'est sa raison d'être. Un greffon d'édition est
 * donc, par construction, aussi privilégié que le cœur QUAND il tourne dans
 * l'hôte : registerPlugin n'accepte que des greffons EMBARQUÉS À LA
 * CONSTRUCTION (première partie, revus comme du code du cœur) — et ce refus
 * est PERMANENT pour du code en mémoire hôte.
 *
 * LE BAC À SABLE EXISTE désormais : registerSandboxedPlugin prend un bundle
 * sous forme de CHAÎNE (jamais exécutée dans l'hôte) et le monte dans une
 * iframe d'origine opaque, CSP sans réseau, pont postMessage typé
 * (services/plugins/sandbox/). Limites v1 assumées : PAS de collaboration
 * temps réel pour un greffon sandboxé (la salle ne s'ouvre pas — donner à du
 * code non revu un flux d'écriture CRDT vers des clients confiants est une
 * décision de sécurité, pas un champ à brancher).
 *
 * E2EE : tout se passe côté client. Un greffon ne reçoit JAMAIS de quoi parler
 * au serveur — pas de jeton, pas d'URL d'API. Il reçoit des octets, un moyen
 * d'en sauver, et optionnellement une poignée de collaboration (un Y.Doc dont
 * le transport est chiffré par le cœur, relais aveugle compris).
 */

import type * as Y from 'yjs';
import type { Awareness } from 'y-protocols/awareness';

// ── Le manifeste ─────────────────────────────────────────────────────────────

export interface FilarrPluginManifest {
  /** Identifiant stable, kebab-case, unique (`docs`, `sheets`). */
  id: string;
  /** Nom affiché dans les menus. */
  name: string;
  version: string;
  /**
   * Régime de confiance. `builtin` = embarqué à la construction, revu comme du
   * code du cœur (registerPlugin). `sandboxed` = bundle-chaîne exécuté dans
   * l'iframe bac à sable (registerSandboxedPlugin) — jamais dans l'hôte.
   */
  trust: 'builtin' | 'sandboxed';
  /** Points d'extension que ce greffon fournit. */
  provides: {
    editors?: EditorContribution[];
  };
}

/**
 * Un format que « Nouveau document » sait créer DE RIEN.
 *
 * Séparé des `extensions` à dessein : un éditeur en revendique souvent des
 * dizaines pour OUVRIR — celui de code en compte une quarantaine — dont aucune
 * n'a de sens dans un menu de création. Dériver le menu du registre revenait à
 * proposer « Nouveau .kt » à côté de « Nouveau .yaml ».
 */
export interface NewDocumentOffer {
  /** Extension du fichier créé, sans point (`txt`). */
  ext: string;
  /** Libellé du format dans le menu, déjà traduit par le greffon. */
  label: string;
  /**
   * Les octets du fichier neuf.
   *
   * ABSENT = zéro octet, et ce n'est légitime QUE là où le vide est un document
   * valide (un `.txt` vide est un fichier texte vide). Un format à structure
   * obligatoire — un calendrier, un classeur — DOIT en fournir : zéro octet n'y
   * est pas un document vide mais un fichier invalide, que celui qui l'ouvre
   * ensuite lira comme une perte de données.
   */
  seed?: () => Uint8Array | Promise<Uint8Array>;
}

export interface EditorContribution {
  /** Identifiant de l'éditeur dans le greffon (`rich-doc`). */
  id: string;
  /** Extensions de fichier revendiquées, sans point, en minuscules (`fdoc`, `md`). */
  extensions: string[];
  /** Libellé du geste, déjà traduit par le greffon (`Éditer le document`). */
  displayName: string;
  /**
   * Extensions que cet éditeur sait IMPORTER (ouvrir puis enregistrer dans son
   * propre format) — un `.docx` ouvert par l'éditeur de documents, par exemple.
   */
  imports?: string[];
  /**
   * Taille maximale, en octets, a laquelle CET editeur accepte d'ouvrir un
   * fichier. Absent = le plafond du coeur (MAX_EDITOR_FILE_SIZE).
   *
   * Le declarer par greffon plutot qu'un chiffre global unique : un editeur de
   * texte brut tient bien plus qu'un editeur de documents qui construit un
   * arbre ProseMirror, et un futur greffon qui saurait fenetrer n'a pas a etre
   * bride par le plus fragile.
   */
  maxBytes?: number;
  /**
   * Ce que cet éditeur propose de CRÉER. Absent = il ouvre, il ne crée pas.
   *
   * L'opt-in est le point : le défaut sûr est de ne rien proposer. Le menu a
   * longtemps été dérivé de `extensions`, ce qui offrait de créer n'importe
   * lequel des formats ouvrables — et le fichier neuf sortait vide.
   */
  newDocument?: NewDocumentOffer[];
}

// ── Ce que l'hôte donne à un éditeur ─────────────────────────────────────────

/**
 * La poignée de collaboration : un document partagé DÉJÀ transporté et chiffré
 * par le cœur (salle par élément, époque de clé comprise). Le greffon y range
 * ses structures (Y.XmlFragment, Y.Map…) et n'a rien d'autre à savoir.
 */
export interface PluginCollabHandle {
  /**
   * CE DOCUMENT N'EST PAS VIERGE, et l'espace de noms de ses types de premier
   * niveau est PARTAGÉ. Yjs refuse d'y voir deux constructeurs sous le même
   * nom : il JETTE, au montage, et l'écran part avec.
   *
   * Trois noms sont donc PRIS, et un greffon ne les redéfinit pas :
   *
   *  · `content` — Y.XmlFragment. Réservé à la création par
   *    `yDocManager.getDoc()`, pour TOUT document sans exception : c'est la
   *    convention ProseMirror du cœur. Un éditeur riche s'y branche
   *    volontiers (le greffon `docs` le fait) ; un éditeur qui veut autre
   *    chose qu'un fragment doit prendre son propre nom.
   *  · `filarr:room` et `filarr:comments` — Y.Map de l'hôte (état de salle,
   *    fil de commentaires ; voir collabSession.ts).
   *
   * La règle qui évite d'avoir à tenir cette liste à jour : PRÉFIXER par son
   * identifiant de greffon (`plugin:plain-text`, `plugin:<id>:<structure>`).
   * Un nom nu est un pari sur ce que le cœur ne fera jamais.
   */
  doc: Y.Doc;
  awareness: Awareness;
  /**
   * 'live' = la salle est ouverte ET son rejeu est terminé ; sinon l'éditeur
   * travaille en local. L'hôte n'annonce jamais 'live' avant que le canal soit
   * stabilisé : un fragment vide doit prouver une salle vide, et non un relais
   * qui n'a pas encore parlé (voir PluginEditorModal).
   */
  phase: 'live' | 'off' | 'pending';
  /** Vrai quand CE client est l'élu qui enregistre pour la salle. */
  responsible: boolean;
  /**
   * SOMMES-NOUS L'ÉLU QUI SÈME une salle VIDE ? Un greffon qui trouve le
   * document partagé vide y verse ses octets initiaux ; si tous les pairs le
   * font en même temps, le CRDT — qui ne perd rien — garde toutes les copies et
   * le document apparaît en double. L'hôte tranche par un scrutin (le plus
   * petit `clientId`, rôle non compté : semer n'écrit rien dans le coffre).
   *
   * À lire AU MOMENT du semis, pas au montage : la composition de la salle
   * bouge. Optionnel — un hôte qui ne le fournit pas vaut « oui », c'est la
   * compatibilité avec les hôtes d'avant ce champ (et avec les hôtes de test).
   * Le greffon garde son propre filet de sécurité : si l'élu ne verse rien, il
   * doit finir par semer plutôt que d'afficher un document vide.
   */
  maySeed?: () => boolean;
}

export interface EditorHost {
  /** Où monter l'éditeur. L'hôte possède ce nœud et le démonte lui-même. */
  container: HTMLElement;
  fileName: string;
  readOnly: boolean;
  /** Les octets déchiffrés du document — la seule source au montage. */
  initialBytes: Uint8Array;
  /**
   * Enregistrer : l'hôte re-chiffre et pousse sous verrou de version, puis
   * résout.
   *
   * UN REJET PORTE UN CODE STABLE, PAS UNE PHRASE. Un greffon a sa PROPRE
   * i18n (il vit dans son dépôt, il connaît la langue de son utilisateur) :
   * lui tendre le texte traduit de l'hôte l'obligerait à afficher une phrase
   * qu'il ne peut ni traduire ni classer. `error.message` vaut donc l'un de :
   *
   *  · `item_version_conflict` — quelqu'un a enregistré entre-temps. L'hôte
   *    N'ADOPTE PAS la version serveur : toute sauvegarde suivante rejette le
   *    MÊME code tant que l'utilisateur n'a pas confirmé l'écrasement dans
   *    l'hôte. Un greffon ne doit donc pas réessayer en boucle — il annonce.
   *  · `read_only` — l'hôte refuse toute écriture (droit de lecture seule).
   *    Le drapeau `readOnly` est une OBLIGATION VÉRIFIÉE, pas un conseil.
   *  · `save_in_flight` — une sauvegarde est déjà en vol ; réessayer au
   *    prochain débounce (les sauvegardes sont sérialisées, jamais empilées).
   *  · sinon la CLÉ i18n de l'hôte pour le refus serveur (par ex.
   *    `teamVaults.errors.storageFull`) — identifiant stable, à mapper ou à
   *    afficher tel quel en dernier recours.
   *
   * COÛT RÉEL : un saveBytes re-chiffre et remonte TOUT le document. Ne pas
   * descendre sous ~2 s de débounce pour une autosave.
   */
  saveBytes(bytes: Uint8Array): Promise<void>;
  /** Signaler une saisie non enregistrée (l'hôte gère « quitter sans perdre »). */
  onDirty(dirty: boolean): void;
  /**
   * Panne IRRÉCUPÉRABLE côté hôte (pont bac à sable coupé, iframe morte,
   * protocole violé) — l'hôte AFFICHE ce message, il ne l'avale pas. Optionnel
   * pour rester rétro-compatible avec les hôtes de test.
   */
  onFatal?(message: string): void;
  /** Présente quand l'élément vit dans un coffre et que la salle est possible. */
  collab?: PluginCollabHandle;
}

export interface EditorInstance {
  /** Démontage : libérer TOUT — écouteurs, minuteurs, vues. */
  destroy(): void;
  /**
   * Les octets courants du document, pour la sauvegarde pilotée par l'hôte.
   * Une Promise pour le pont bac à sable (aller-retour de port) ; les builtins
   * restent synchrones — la copie vendorisée du greffon docs
   * (src/plugins/external/docs/filarr-plugin-api.d.ts) reste assignable.
   */
  getBytes(): Uint8Array | Promise<Uint8Array>;
  /**
   * Le document est-il VIDE au sens de celui qui le lit ?
   *
   * L'hôte ne peut pas le déduire des octets : un `.fdoc` vide pèse 114
   * octets de structure, un `.ics` vide en pèse une centaine, et rien dans
   * leur taille ne les distingue d'un document plein. Seul le greffon sait.
   *
   * À quoi ça sert : l'hôte refuse d'écraser en silence un document qui avait
   * du contenu à l'ouverture par un document devenu vide. Sans ce signal, une
   * fenêtre de chargement, un import raté ou un Ctrl+A malheureux écrivent le
   * vide par-dessus le fichier, et rien ne le dit avant la relecture.
   *
   * FACULTATIF : un greffon qui ne l'implémente pas n'est pas gardé — l'hôte
   * n'invente pas de réponse à sa place.
   */
  isEmpty?(): boolean;
}

export interface EditorProvider {
  contribution: EditorContribution;
  mount(host: EditorHost): EditorInstance | Promise<EditorInstance>;
}

// ── Le greffon assemblé ──────────────────────────────────────────────────────

export interface FilarrPlugin {
  manifest: FilarrPluginManifest;
  editors?: EditorProvider[];
}

/** Un greffon BAC À SABLE : le manifeste + le bundle, simple CHAÎNE côté hôte. */
export interface SandboxedPluginSource {
  manifest: FilarrPluginManifest;
  /**
   * Bundle IIFE qui affecte `globalThis.filarrSandboxedPlugin = { editors:
   * [{ id, mount(host) }] }`. Ne s'exécute QUE dans l'iframe bac à sable —
   * jamais dans l'hôte.
   */
  code: string;
}
