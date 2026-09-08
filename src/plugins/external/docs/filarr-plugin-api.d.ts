/**
 * LE CONTRAT DE L'API DE GREFFONS FILARR — copie conforme, en attendant le paquet.
 *
 * Ce fichier MIROIRE `src/services/plugins/pluginTypes.ts` du cœur. Tant que
 * l'API n'est pas publiée comme paquet (`@filarr/plugin-api`), chaque dépôt de
 * plugin en vendorise une copie et la garde de charge de preuve : au moindre
 * écart, l'enregistrement dans le cœur échoue au typage — c'est voulu, une
 * dérive silencieuse serait pire. Dès que le paquet existe, ce fichier devient
 * `export * from '@filarr/plugin-api'` et disparaît.
 */
import type * as Y from 'yjs';
export interface AwarenessLike {
    clientID: number;
    getStates(): Map<number, Record<string, unknown>>;
    setLocalStateField(field: string, value: unknown): void;
    /**
     * Awareness est un Observable de y-protocols. Le plugin n'a besoin que de
     * savoir QUAND la salle change de composition — pour réévaluer ce que les
     * pairs présents savent porter (voir schemaGuard.ts). Ce n'est pas un
     * élargissement du contrat : c'est le même objet, décrit un cran plus
     * complètement.
     */
    on(event: 'change', handler: () => void): void;
    off(event: 'change', handler: () => void): void;
}
export interface FilarrPluginManifest {
    id: string;
    name: string;
    version: string;
    trust: 'builtin' | 'sandboxed';
    provides: {
        editors?: EditorContribution[];
    };
}
/** Un format que « Nouveau document » sait créer de rien. */
export interface NewDocumentOffer {
    ext: string;
    label: string;
    /**
     * Les octets du fichier neuf. Absent = zéro octet, ce qui ne vaut que
     * là où le vide est un document valide. Un format à structure obligatoire
     * DOIT en fournir : un fichier neuf vide se lit comme un fichier corrompu.
     */
    seed?: () => Uint8Array | Promise<Uint8Array>;
}
export interface EditorContribution {
    id: string;
    extensions: string[];
    displayName: string;
    imports?: string[];
    newDocument?: NewDocumentOffer[];
}
export interface PluginCollabHandle {
    /**
     * Document NON VIERGE : `content` (Y.XmlFragment), `filarr:room` et
     * `filarr:comments` (Y.Map) sont déjà pris par le cœur, et Yjs jette sur
     * un nom repris avec un autre constructeur. Préfixer les siens par son
     * identifiant de greffon (`plugin:<id>`).
     */
    doc: Y.Doc;
    awareness: AwarenessLike;
    /** 'live' = salle ouverte ET rejeu terminé (l'hôte ne l'annonce pas avant). */
    phase: 'live' | 'off' | 'pending';
    responsible: boolean;
    /**
     * Sommes-nous l'élu qui SÈME une salle vide ? À lire au moment du semis.
     * Absent (hôte plus ancien, hôte de test) = oui.
     */
    maySeed?: () => boolean;
}
export interface EditorHost {
    container: HTMLElement;
    fileName: string;
    readOnly: boolean;
    initialBytes: Uint8Array;
    saveBytes(bytes: Uint8Array): Promise<void>;
    onDirty(dirty: boolean): void;
    collab?: PluginCollabHandle;
}
export interface EditorInstance {
    destroy(): void;
    getBytes(): Uint8Array;
    /**
     * Le document est-il VIDE au sens de celui qui le lit ?
     *
     * L'hôte ne peut pas le déduire des octets : un .fdoc vide pèse 114 octets
     * de structure, et rien dans sa taille ne le distingue d'un document
     * plein. Il s'en sert pour refuser d'écraser en silence un document qui
     * avait du contenu à l'ouverture par un document devenu vide.
     */
    isEmpty?(): boolean;
}
export interface EditorProvider {
    contribution: EditorContribution;
    mount(host: EditorHost): EditorInstance | Promise<EditorInstance>;
}
export interface FilarrPlugin {
    manifest: FilarrPluginManifest;
    editors?: EditorProvider[];
}
