/**
 * Yjs Document Manager — Filarr Notes
 *
 * Gestionnaire UNIQUE des Y.Doc de notes. Rien d'autre dans l'application ne
 * doit créer de Y.Doc pour une note : l'éditeur, la persistance IndexedDB et le
 * transport chiffré (src/services/collab) partagent tous celui-ci.
 *
 * Répartition des rôles :
 *   - Redux garde les métadonnées (titre, liens, étiquettes) ;
 *   - Yjs garde le CONTENU, dans le fragment XML `content` ;
 *   - y-indexeddb persiste localement (absent hors navigateur — tests, Node) ;
 *   - `Awareness` (y-protocols) porte la présence : nom, couleur, curseur.
 *
 * Sous drapeau : rien ne démarre tant que `setEnabled(true)` n'a pas été appelé
 * — voir `src/services/collab/collabFlag.ts`.
 */

import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import { Awareness } from 'y-protocols/awareness';
import {
  yXmlFragmentToNoteContent,
  yXmlFragmentToTiptapDoc,
  tiptapDocToPlainText,
  type TiptapDoc,
} from '../collab/yToTiptap';

// ==================== Types ====================

export interface ManagedDoc {
  yDoc: Y.Doc;
  /** `null` hors navigateur (Node, tests) — le document reste utilisable. */
  persistence: IndexeddbPersistence | null;
  fragment: Y.XmlFragment;
  awareness: Awareness;
  /** Résolue quand le contenu local a fini d'être rechargé depuis IndexedDB. */
  whenLoaded: Promise<void>;
  profileId: string | null;
}

export interface GetDocOptions {
  /**
   * Cloisonnement par profil : le nom de la base IndexedDB en dépend, sans quoi
   * deux profils du même appareil se partageraient le même document local.
   */
  profileId?: string | null;
  /**
   * Persistance locale IndexedDB. VRAI par défaut — c'est ce qui permet à une
   * note personnelle de survivre à un rechargement hors ligne.
   *
   * FAUX pour un ÉLÉMENT DE COFFRE, et ce n'est pas une optimisation : le
   * contenu d'un coffre partagé est chiffré de bout en bout avec le nuage pour
   * seule vérité, et son clair ne doit jamais atterrir dans un stockage local
   * persistant (c'est la même règle qui exclut `vaultsSlice` de redux-persist).
   * Le document vit alors en mémoire pour la durée de la session, et disparaît
   * avec elle.
   *
   * Ne s'applique qu'à la CRÉATION : un document déjà en mémoire est rendu tel
   * qu'il a été créé. Les deux régimes ayant des identités de document
   * disjointes (`vault:…` contre un UUID de note), ils ne peuvent pas se croiser.
   */
  persist?: boolean;
}

/**
 * Clé du registre. Le noteId SEUL ne suffit pas : après un changement de
 * profil, une note de même identifiant rendrait le document — et la persistance
 * IndexedDB — du profil précédent.
 */
export function docKey(noteId: string, profileId?: string | null): string {
  return `${profileId ?? ''}:${noteId}`;
}

interface DocEntry {
  managed: ManagedDoc;
  /**
   * Nombre de détenteurs. Une même note ouverte dans deux panneaux (mode
   * scindé) est acquise deux fois : le premier qui relâche ne doit rien
   * détruire, sinon le second panneau perdrait son document sous les pieds.
   */
  refs: number;
}

// ==================== Manager ====================

class YDocManager {
  private docs: Map<string, DocEntry> = new Map();
  private enabled = false;

  /**
   * Active/désactive le mode CRDT. Éteindre détruit tous les documents en
   * mémoire — les appelants doivent avoir refermé leurs sessions avant.
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.destroyAll();
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Récupère (ou crée) le Y.Doc d'une note, et COMPTE UNE RÉFÉRENCE de plus.
   * Chaque appel doit être soldé par un `releaseDoc` du même couple.
   */
  getDoc(noteId: string, options: GetDocOptions = {}): ManagedDoc {
    const profileId = options.profileId ?? null;
    const key = docKey(noteId, profileId);
    const existing = this.docs.get(key);
    if (existing) {
      existing.refs += 1;
      return existing.managed;
    }

    const yDoc = new Y.Doc();
    const fragment = yDoc.getXmlFragment('content');
    const awareness = new Awareness(yDoc);

    let persistence: IndexeddbPersistence | null = null;
    let whenLoaded: Promise<void> = Promise.resolve();
    if (options.persist !== false && typeof indexedDB !== 'undefined') {
      const dbName = profileId ? `filarr-ydoc-${profileId}-${noteId}` : `filarr-ydoc-${noteId}`;
      persistence = new IndexeddbPersistence(dbName, yDoc);
      whenLoaded = persistence.whenSynced.then(() => undefined).catch(() => undefined);
    }

    const managed: ManagedDoc = { yDoc, persistence, fragment, awareness, whenLoaded, profileId };
    this.docs.set(key, { managed, refs: 1 });

    return managed;
  }

  /** Le document existe-t-il déjà en mémoire ? */
  hasDoc(noteId: string, profileId?: string | null): boolean {
    return this.docs.has(docKey(noteId, profileId));
  }

  /** Accès sans création — pour les chemins qui ne doivent rien instancier. */
  peekDoc(noteId: string, profileId?: string | null): ManagedDoc | null {
    return this.docs.get(docKey(noteId, profileId))?.managed ?? null;
  }

  /** Détenteurs restants (diagnostic et tests). */
  refCount(noteId: string, profileId?: string | null): number {
    return this.docs.get(docKey(noteId, profileId))?.refs ?? 0;
  }

  /**
   * Rend une référence. Le document n'est détruit qu'au DERNIER relâchement —
   * c'est ce qui empêche à la fois la fuite (un document par note ouverte, avec
   * sa persistance IndexedDB, gardé pour toujours) et la destruction prématurée
   * quand la même note est ouverte deux fois.
   */
  releaseDoc(noteId: string, profileId?: string | null): void {
    const key = docKey(noteId, profileId);
    const entry = this.docs.get(key);
    if (!entry) return;
    entry.refs -= 1;
    if (entry.refs > 0) return;
    this._destroyEntry(key, entry);
  }

  /**
   * Détruit un document SANS égard pour les références (verrouillage du coffre,
   * changement de profil). `Awareness` d'abord : elle possède un intervalle
   * interne de 3 s qui, oublié, survivrait à la note.
   */
  destroyDoc(noteId: string, profileId?: string | null): void {
    const key = docKey(noteId, profileId);
    const entry = this.docs.get(key);
    if (!entry) return;
    this._destroyEntry(key, entry);
  }

  /** Détruit tous les documents, références en cours comprises. */
  destroyAll(): void {
    for (const [key, entry] of Array.from(this.docs.entries())) {
      this._destroyEntry(key, entry);
    }
  }

  private _destroyEntry(key: string, entry: DocEntry): void {
    this.docs.delete(key);
    try {
      entry.managed.awareness.destroy();
    } catch {
      /* déjà détruite */
    }
    try {
      entry.managed.persistence?.destroy();
    } catch {
      /* base déjà fermée */
    }
    entry.managed.yDoc.destroy();
  }

  // ---------- Retour au stockage ----------

  /**
   * Contenu courant au format JSON TipTap (objet). C'est ce que l'éditeur
   * réécrit, débouncé, dans le magasin de notes.
   */
  getContentDoc(noteId: string, profileId?: string | null): TiptapDoc | null {
    const entry = this.docs.get(docKey(noteId, profileId));
    if (!entry) return null;
    return yXmlFragmentToTiptapDoc(entry.managed.fragment);
  }

  /** Même chose, sérialisé — la forme attendue par `Note.content`. */
  getContentJSON(noteId: string, profileId?: string | null): string | null {
    const entry = this.docs.get(docKey(noteId, profileId));
    if (!entry) return null;
    return yXmlFragmentToNoteContent(entry.managed.fragment);
  }

  /**
   * Texte brut d'une note (indexation de recherche).
   */
  getPlainText(noteId: string, profileId?: string | null): string {
    const doc = this.getContentDoc(noteId, profileId);
    if (!doc) return '';
    return tiptapDocToPlainText(doc);
  }

  /** Nombre de mots. */
  getWordCount(noteId: string, profileId?: string | null): number {
    const text = this.getPlainText(noteId, profileId);
    return text.split(/\s+/).filter(Boolean).length;
  }

  /** Nombre de documents actifs. */
  get size(): number {
    return this.docs.size;
  }
}

// Singleton
const yDocManager = new YDocManager();
export default yDocManager;
