/**
 * recentEdits — le SILLAGE des modifications distantes : un surlignage fondu
 * aux couleurs de l'auteur, TTL 3 minutes, par DÉCORATIONS ProseMirror.
 *
 * JAMAIS du contenu : un mark serait répliqué par Yjs chez tous les pairs,
 * sauvegardé dans le JSON par l'élu, et fossilisé dans chaque révision E3-12 —
 * pollution irréversible de l'historique de récupération. Une décoration ne
 * quitte jamais cet écran.
 *
 * L'AUTEUR est dérivé des STATE-VECTORS de la transaction Yjs
 * (doc.on('beforeObserverCalls') : tout client dont l'horloge a avancé a
 * inséré des structs) — jamais d'heuristique de curseur. Une suppression pure
 * distante n'a pas d'auteur dérivable (le deleteSet porte l'auteur des structs
 * SUPPRIMÉS, pas du supprimeur) : on ne surligne pas, assumé.
 *
 * GATE ANTI-REJEU : le rejeu du journal du relais arrive comme transactions
 * ProseMirror d'origine Yjs — sans `isReady` (branché sur le settle de la
 * surface), l'ouverture d'une note peindrait TOUT le document aux couleurs du
 * dernier écrivain.
 */

import { Extension, type AnyExtension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { isChangeOrigin } from '@tiptap/extension-collaboration';
import type * as Y from 'yjs';
import type { Awareness } from 'y-protocols/awareness';

export const RECENT_EDIT_TTL_MS = 180_000;
const PRUNE_INTERVAL_MS = 15_000;
const PRUNE_META = 'recent-edits-prune';

// ── Partie PURE (testable en env node, aucune dépendance DOM) ────────────────

/**
 * Les clients DISTANTS dont l'horloge a avancé dans cette transaction — chacun
 * a inséré des structs. Un client absent de beforeState compte (première
 * frappe) ; le client local est exclu même s'il avance.
 */
export function computeRemoteAuthors(
  beforeState: ReadonlyMap<number, number>,
  afterState: ReadonlyMap<number, number>,
  localClientId: number
): number[] {
  const authors: number[] = [];
  afterState.forEach((clock, clientId) => {
    if (clientId === localClientId) return;
    if (clock > (beforeState.get(clientId) ?? 0)) authors.push(clientId);
  });
  return authors;
}

/** Conserve les entrées non échues ; rend le MÊME tableau si rien n'expire. */
export function pruneExpired<T extends { expiresAt: number }>(
  entries: readonly T[],
  now: number
): T[] {
  const kept = entries.filter((e) => e.expiresAt > now);
  return kept.length === entries.length ? (entries as T[]) : kept;
}

// ── L'extension ──────────────────────────────────────────────────────────────

interface RecentEditEntry {
  from: number;
  to: number;
  clientId: number;
  expiresAt: number;
}

interface RecentEditsState {
  deco: DecorationSet;
  entries: RecentEditEntry[];
}

export interface RecentEditsInput {
  doc: Y.Doc;
  awareness: Awareness;
  /** Le verdict de settle de la surface — avant lui, tout est du rejeu. */
  isReady: () => boolean;
}

const recentEditsKey = new PluginKey<RecentEditsState>('filarr-recent-edits');

export function buildRecentEditsExtension(input: RecentEditsInput): AnyExtension {
  // Rempli par beforeObserverCalls (qui précède les observers du ySyncPlugin,
  // donc la transaction ProseMirror qui suit), consommé par apply().
  let pendingAuthors: number[] = [];
  const onBefore = (tr: Y.Transaction) => {
    pendingAuthors = computeRemoteAuthors(
      tr.beforeState as ReadonlyMap<number, number>,
      tr.afterState as ReadonlyMap<number, number>,
      input.doc.clientID
    );
  };

  return Extension.create({
    name: 'filarrRecentEdits',

    // L'abonnement vit dans onCreate, PAS à la construction : sous StrictMode
    // le corps du composant construit l'extension deux fois mais n'en monte
    // qu'une — un abonnement posé à la construction fuirait sur un Y.Doc qui
    // survit à la surface (il vit dans yDocManager).
    onCreate() {
      input.doc.on('beforeObserverCalls', onBefore);
    },
    onDestroy() {
      try {
        input.doc.off('beforeObserverCalls', onBefore);
      } catch {
        /* document déjà détruit */
      }
    },

    addProseMirrorPlugins() {
      return [
        new Plugin<RecentEditsState>({
          key: recentEditsKey,
          state: {
            init: () => ({ deco: DecorationSet.empty, entries: [] }),
            apply(tr, prev) {
              // Suivre le document : décorations et entrées mappées d'abord.
              let deco = prev.deco.map(tr.mapping, tr.doc);
              let entries = prev.entries.map((e) => ({
                ...e,
                from: tr.mapping.map(e.from, 1),
                to: tr.mapping.map(e.to, -1),
              }));

              if (tr.getMeta(PRUNE_META)) {
                const now = Date.now();
                const kept = pruneExpired(entries, now);
                if (kept.length !== entries.length) {
                  entries = kept;
                  deco = DecorationSet.create(
                    tr.doc,
                    kept.map((e) => makeDecoration(e, input.awareness))
                  );
                }
                return { deco, entries };
              }

              // UN seul auteur distant (le cas ~toujours vrai d'une transaction
              // du ySyncPlugin) ; plusieurs auteurs dans une même transaction
              // (fusion de bascule) : on renonce plutôt que d'attribuer faux.
              if (isChangeOrigin(tr) && input.isReady() && pendingAuthors.length === 1) {
                const clientId = pendingAuthors[0];
                const expiresAt = Date.now() + RECENT_EDIT_TTL_MS;
                const ranges: Array<[number, number]> = [];
                tr.mapping.maps.forEach((stepMap, i) => {
                  // Les coordonnées d'un step vivent dans le repère APRÈS ce
                  // step : les faire suivre les steps SUIVANTS avant de les
                  // retenir, sinon un collage multi-étapes surligne décalé.
                  const rest = tr.mapping.slice(i + 1);
                  stepMap.forEach((_oldFrom, _oldEnd, newFrom, newTo) => {
                    const from = rest.map(newFrom, 1);
                    const to = rest.map(newTo, -1);
                    if (to > from) ranges.push([from, to]);
                  });
                });
                if (ranges.length > 0) {
                  const fresh = ranges.map(([from, to]) => ({ from, to, clientId, expiresAt }));
                  entries = [...entries, ...fresh];
                  deco = deco.add(
                    tr.doc,
                    fresh.map((e) => makeDecoration(e, input.awareness))
                  );
                }
              }
              pendingAuthors = [];
              return { deco, entries };
            },
          },
          props: {
            decorations(state) {
              return recentEditsKey.getState(state)?.deco ?? DecorationSet.empty;
            },
          },
          view(view) {
            const timer = setInterval(() => {
              view.dispatch(view.state.tr.setMeta(PRUNE_META, true));
            }, PRUNE_INTERVAL_MS);
            return {
              destroy() {
                clearInterval(timer);
              },
            };
          },
        }),
      ];
    },
  });
}

function makeDecoration(entry: RecentEditEntry, awareness: Awareness): Decoration {
  const user = awareness.getStates().get(entry.clientId)?.user as
    | { color?: unknown; name?: unknown }
    | undefined;
  const color = typeof user?.color === 'string' ? user.color : '#888888';
  const name = typeof user?.name === 'string' ? user.name : '';
  return Decoration.inline(entry.from, entry.to, {
    class: 'collab-recent-edit',
    style: `--recent-edit-color:${color}`,
    ...(name ? { title: name } : {}),
  });
}
