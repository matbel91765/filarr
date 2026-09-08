import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';

import yDocManager from '../../../../services/notes/yDocManager';
import { textEditorPlugin } from '../index';
import type { EditorHost, EditorInstance } from '../../../../services/plugins/pluginTypes';

/**
 * LE NOM D'UN TYPE DE PREMIER NIVEAU EST UN ESPACE PARTAGÉ — et Yjs le fait
 * respecter en JETANT.
 *
 * Le plantage réel : ouvrir un `.md` d'un coffre partagé une fois la salle
 * vivante tuait l'écran entier avec
 * « Type with the name content has already been defined with a different
 * constructor ». Deux liaisons du MÊME nom sur le MÊME Y.Doc, avec deux
 * constructeurs différents :
 *
 *   · `yDocManager.getDoc()` réserve `content` en Y.XmlFragment à la CRÉATION
 *     de tout document — note personnelle comme élément de coffre ; c'est la
 *     convention ProseMirror du cœur, et le greffon `docs` s'y branche ;
 *   · le greffon texte demandait `content` en Y.Text.
 *
 * Ce que ce fichier garde, et pourquoi il tape sur l'AUTORITÉ plutôt que sur
 * une copie : un `new Y.Doc()` fabriqué à la main dans un test n'a JAMAIS le
 * fragment réservé, donc il ne collisionne jamais — c'est très exactement le
 * trou par lequel le défaut est passé (`yTextarea.vitest.ts` monte sa propre
 * `getText('content')` et reste vert). Le seul document qui prouve quelque
 * chose est celui que le gestionnaire fabrique vraiment.
 */

// ── Le strict nécessaire de DOM ──────────────────────────────────────────────
// Ce dépôt n'a aucun lanceur de tests avec DOM (pas de jsdom) : on fournit la
// dépendance plutôt que d'en installer un pour un `<textarea>`.
class FauxTextarea {
  value = '';
  className = '';
  readOnly = false;
  spellcheck = true;
  selectionStart = 0;
  selectionEnd = 0;
  style: Record<string, string> = {};
  attributs = new Map<string, string>();
  private listeners = new Map<string, Array<() => void>>();
  setAttribute(name: string, value: string) {
    this.attributs.set(name, value);
  }
  addEventListener(type: string, fn: () => void) {
    const l = this.listeners.get(type) ?? [];
    l.push(fn);
    this.listeners.set(type, l);
  }
  removeEventListener(type: string, fn: () => void) {
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter((f) => f !== fn)
    );
  }
  setSelectionRange(start: number, end: number) {
    this.selectionStart = start;
    this.selectionEnd = end;
  }
  remove() {
    /* détaché : rien à faire ici */
  }
}

class FauxConteneur {
  enfants: FauxTextarea[] = [];
  appendChild(node: FauxTextarea) {
    this.enfants.push(node);
    return node;
  }
}

let documentOriginal: unknown;

beforeEach(() => {
  documentOriginal = (globalThis as { document?: unknown }).document;
  (globalThis as { document?: unknown }).document = {
    createElement: () => new FauxTextarea(),
  };
  yDocManager.setEnabled(true);
});

afterEach(() => {
  yDocManager.destroyAll();
  (globalThis as { document?: unknown }).document = documentOriginal;
});

/** Le document tel que la session de coffre le fabrique : sans persistance. */
function docDeCoffre(itemId: string) {
  return yDocManager.getDoc(`vault:${itemId}`, { profileId: 'p1', persist: false });
}

function hote(doc: Y.Doc, octets: Uint8Array, extra: Partial<EditorHost> = {}): EditorHost {
  return {
    container: new FauxConteneur() as unknown as HTMLElement,
    fileName: 'notes.md',
    readOnly: false,
    initialBytes: octets,
    saveBytes: async () => undefined,
    onDirty: () => undefined,
    collab: {
      doc,
      awareness: { setLocalStateField: () => undefined } as never,
      phase: 'live',
      responsible: true,
    },
    ...extra,
  };
}

/**
 * On passe par le provider ENREGISTRÉ, pas par une fonction interne : c'est
 * exactement ce que `PluginEditorModal` appelle. `mount` a le droit de rendre
 * une promesse (pont bac à sable) — on l'attend donc, comme l'hôte.
 */
const provider = textEditorPlugin.editors?.[0];
async function monter(host: EditorHost): Promise<EditorInstance> {
  if (!provider) throw new Error('greffon texte non enregistré');
  return provider.mount(host);
}

describe('le Y.Doc que l’hôte tend à un greffon', () => {
  it('réserve DÉJÀ « content » en Y.XmlFragment — c’est l’autorité, pas une convention écrite', () => {
    const managed = docDeCoffre('a1');
    // On lit le registre du document, pas une liste recopiée à côté : si le
    // gestionnaire change de nom un jour, c'est CE test qui doit bouger.
    const reserves = Array.from(managed.yDoc.share.keys());
    expect(reserves).toContain('content');
    expect(managed.yDoc.get('content')).toBeInstanceOf(Y.XmlFragment);
  });

  it('monte le greffon texte en salle vivante sans jeter', async () => {
    const managed = docDeCoffre('a2');
    const octets = new TextEncoder().encode('bonjour');

    // AVANT LE CORRECTIF : jette « Type with the name content has already been
    // defined with a different constructor », et comme `mount` est appelé
    // SYNCHRONEMENT dans l'effet de montage, l'exception traverse React.
    const instance = await monter(hote(managed.yDoc, octets));

    expect(instance).toBeTruthy();
    instance.destroy();
  });

  it('sème son texte dans un type À LUI, en laissant « content » au fragment', async () => {
    const managed = docDeCoffre('a3');
    const octets = new TextEncoder().encode('bonjour');

    const instance = await monter(hote(managed.yDoc, octets));

    // Le fragment ProseMirror — celui du greffon `docs` et des notes — est
    // toujours là, et toujours un fragment.
    expect(managed.yDoc.get('content')).toBeInstanceOf(Y.XmlFragment);
    // Et le texte du greffon a bien été semé quelque part d'autre.
    const texte = Array.from(managed.yDoc.share.keys())
      .filter((nom) => nom !== 'content')
      .map((nom) => managed.yDoc.get(nom))
      .filter((t): t is Y.Text => t instanceof Y.Text)
      .map((t) => t.toString());
    expect(texte).toContain('bonjour');

    instance.destroy();
  });

  it('deux greffons dans la même salle se retrouvent sur le même texte', async () => {
    // Le nom doit être STABLE : deux pairs qui ouvrent le même `.md` doivent
    // se lier au même type, sinon chacun édite dans son coin sans le savoir.
    const a = docDeCoffre('a4');
    const b = new Y.Doc();
    b.getXmlFragment('content'); // le pair distant a le même document réservé

    const ia = await monter(hote(a.yDoc, new TextEncoder().encode('bonjour')));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a.yDoc));
    const ib = await monter(
      hote(b, new Uint8Array(), {
        // Salle habitée : ce pair-ci n'a rien à semer, il adopte.
        collab: { doc: b, awareness: {} as never, phase: 'live', responsible: false },
      })
    );

    expect(await ib.getBytes()).toEqual(new TextEncoder().encode('bonjour'));

    ia.destroy();
    ib.destroy();
  });
});
