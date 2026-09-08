/**
 * InlineDatabaseNodeView — Filarr Notes
 *
 * Conteneur du bloc base de données : header (titre, source, nouvelle ligne),
 * barre des vues enregistrées, puis délégation à la vue active.
 * UN SEUL point de mutation des données : commit().
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NodeViewWrapper } from '@tiptap/react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { useBlockResize } from '../useBlockResize';
import type { DbCatalogEntry, DbView, InlineDbData } from './types';
import {
  CONNECTOR_SOURCE_LABELS,
  makeDefaultView,
  newId,
  newRow,
  parseDbData,
  readActiveViewPref,
  resolveDbId,
  serializeDbData,
  viewPrefKey,
  writeActiveViewPref,
} from './types';
import {
  applyView,
  ensureViews,
  legacyAttrsFor,
  prefillCellsForView,
  resolveActiveView,
  sanitizeSchema,
  sanitizeViews,
} from './viewEngine';
import type { DbLinkContext } from './relations';
import { makeLinkContext } from './relations';
import { selectInlineDbIndex } from '../../../../../store/slices/notesSlice';
import { DatabaseTableView } from './DatabaseTableView';
import { DatabaseBoardView } from './DatabaseBoardView';
import { DatabaseCalendarView } from './DatabaseCalendarView';
import { DatabaseGalleryView } from './DatabaseGalleryView';
import { ViewBar } from './ViewBar';
import {
  isSelectableConnectorSourceId,
  listConnectorSources,
} from '../../../../../platform/connectors/connectorSources';
import './inlineDatabase.css';

interface InlineDatabaseNodeViewProps {
  node: {
    attrs: {
      title: string;
      view: 'table' | 'board';
      groupBy: string;
      source: string;
      /** Identité de la base ('' sur les bases d'avant les relations → dérivée) */
      dbId?: string;
      data: string;
      /** Largeur en pixels réglée à la poignée ; `null` = largeur d'office. */
      blockWidthPx?: number | null;
      /** Hauteur bornée en pixels ; `null` = aussi haut qu'il faut. */
      blockHeightPx?: number | null;
    };
  };
  updateAttributes: (attrs: Record<string, unknown>) => void;
  selected: boolean;
  deleteNode: () => void;
  editor?: { isEditable: boolean };
}

export const InlineDatabaseNodeView: React.FC<InlineDatabaseNodeViewProps> = ({
  node,
  updateAttributes,
  selected,
  editor,
}) => {
  const { t } = useTranslation();
  const { title, view, groupBy, source, dbId: dbIdAttr, data: dataJson } = node.attrs;
  const readOnly = editor ? !editor.isEditable : false;
  const resize = useBlockResize(
    node.attrs.blockWidthPx,
    node.attrs.blockHeightPx,
    updateAttributes,
    {
      disabled: readOnly,
    }
  );

  // Valeur inconnue, ou source interne hors sélecteur : retombe sur « aucune »
  const sourceId = isSelectableConnectorSourceId(source) ? source : '';
  const sourceOptions = useMemo(() => listConnectorSources(), []);

  /** Données BRUTES : la migration ci-dessous en dérive les vues, sans rien écrire */
  const parsed = useMemo(() => parseDbData(dataJson), [dataJson]);

  /**
   * Lecture + MIGRATION : une base d'avant les vues n'en porte aucune, on en
   * fabrique une depuis les attrs `view`/`groupBy` du nœud. Purement dérivé :
   * rien n'est écrit tant que l'utilisateur n'a pas agi (un simple aperçu ne
   * salit aucune note).
   */
  const data = useMemo<InlineDbData>(
    () => ensureViews(parsed, { view, groupBy }),
    [parsed, view, groupBy]
  );

  /**
   * IDENTITÉ de cette base. Dérivée des données BRUTES (jamais des vues
   * fabriquées au vol, dont l'id changerait à chaque rendu), donc identique à
   * celle que l'index calcule de son côté à partir du contenu de la note.
   */
  const dbId = useMemo(() => resolveDbId(dbIdAttr, parsed), [dbIdAttr, parsed]);

  /**
   * Index des bases du coffre : c'est par lui qu'une relation atteint une base
   * qui vit dans une autre note. Tout est LOCAL et déjà déchiffré (état Redux),
   * aucune requête n'est faite ici.
   */
  const dbIndex = useSelector(selectInlineDbIndex);

  /**
   * Résolution d'une cible. La base COURANTE se résout sur ses données vivantes
   * plutôt que sur l'index : celui-ci suit le contenu enregistré de la note,
   * qui retarde d'une sauvegarde — une relation vers soi-même verrait sinon des
   * lignes périmées.
   *
   * `makeLinkContext` mémoïse au passage la table `id de ligne → ligne` de
   * chaque base visée : ce contexte-ci est déjà mémoïsé, le cache meurt donc
   * exactement avec les données dont il est tiré.
   */
  const linkCtx = useMemo<DbLinkContext>(
    () =>
      makeLinkContext((id: string) => {
        // La note qui PORTE la base visée voyage avec elle : c'est ce qui
        // permet d'ouvrir une ligne liée, et de nommer la base dans le
        // sélecteur. Même pour la base courante, dont l'index connaît la note.
        const entry = dbIndex.get(id);
        const host = entry
          ? { noteId: entry.noteId, noteTitle: entry.noteTitle, label: entry.title }
          : {};
        if (id !== '' && id === dbId) {
          // Titre VIVANT du bloc : l'index suit le contenu enregistré, qui
          // retarde d'une sauvegarde sur ce qu'on vient de taper
          const live = title.trim();
          return {
            properties: data.properties,
            rows: data.rows,
            ...host,
            ...(live !== '' ? { label: live } : {}),
          };
        }
        return entry ? { properties: entry.properties, rows: entry.rows, ...host } : undefined;
      }, dbId),
    [dbIndex, dbId, title, data.properties, data.rows]
  );

  /** Bases proposées comme cible d'une relation (celle-ci comprise, même jamais enregistrée) */
  const dbCatalog = useMemo<DbCatalogEntry[]>(() => {
    const out: DbCatalogEntry[] = [];
    const selfLabel = title.trim();
    if (dbId !== '') {
      const selfEntry = dbIndex.get(dbId);
      out.push({
        dbId,
        label: selfLabel !== '' ? selfLabel : t('notes.inlineDb.thisDatabase', 'This database'),
        properties: data.properties,
        self: true,
        ...(selfEntry ? { noteId: selfEntry.noteId, noteTitle: selfEntry.noteTitle } : {}),
      });
    }
    for (const entry of dbIndex.values()) {
      if (entry.dbId === dbId) continue;
      out.push({
        dbId: entry.dbId,
        label: entry.title,
        properties: entry.properties,
        noteId: entry.noteId,
        noteTitle: entry.noteTitle,
      });
    }
    return out;
  }, [dbIndex, dbId, title, data.properties, t]);

  /**
   * ONGLET REGARDÉ : état LOCAL, pas contenu du document.
   *
   * Choisir un onglet est un geste de NAVIGATION. Le faire passer par
   * `updateAttributes` posait une vraie transaction ProseMirror : Ctrl+Z
   * « défaisait » un changement d'onglet, la note était marquée modifiée et
   * remontait au nuage pour une simple consultation. Le choix vit donc ici,
   * retenu sur cet appareil (comme un pli de fenêtre) ; le document ne
   * l'enregistre qu'au passage d'une écriture qui a lieu de toute façon
   * (cf. `commit`), ce qui garde le miroir hérité `view`/`groupBy` d'accord
   * avec ce que l'utilisateur regarde sans jamais écrire pour lui seul.
   *
   * L'alternative — garder l'écriture mais l'exclure de l'historique — laissait
   * la note salie et la remontée nuage : elle ne fermait qu'un tiers du défaut.
   */
  const prefKey = viewPrefKey(data.views);
  const [localViewId, setLocalViewId] = useState<string | null>(() => readActiveViewPref(prefKey));
  const localViewIdRef = useRef(localViewId);
  localViewIdRef.current = localViewId;

  const activeView = useMemo(() => resolveActiveView(data, localViewId), [data, localViewId]);
  const views = data.views ?? [activeView];

  /**
   * Recherche rapide : etat LOCAL, jamais ecrit dans le document.
   *
   * Chercher est un geste, pas un reglage : l'inscrire dans la note ferait
   * remonter une modification a chaque frappe dans le champ, et deux personnes
   * sur la meme note se voleraient leur recherche.
   */
  const [search, setSearch] = useState('');

  const visibleRows = useMemo(
    () => applyView(data, activeView, linkCtx, search),
    [data, activeView, linkCtx, search]
  );
  const rowDefaults = useMemo(
    () => prefillCellsForView(activeView, data.properties),
    [activeView, data.properties]
  );

  /**
   * Deux mutations enchaînées dans le même geste (supprimer une propriété =
   * commit puis groupBy) liraient sinon le `data` du rendu précédent et
   * annuleraient la première : la ref porte toujours la version la plus fraîche.
   */
  const dataRef = useRef(data);
  dataRef.current = data;

  // Titre édité localement, commité au blur ; Escape annule (pattern DraftInput)
  const [titleDraft, setTitleDraft] = useState(title);
  const cancelTitleRef = useRef(false);
  useEffect(() => {
    setTitleDraft(title);
  }, [title]);

  const commit = useCallback(
    (next: InlineDbData) => {
      // Assainissement au point unique : les vues ne gardent jamais un filtre,
      // un tri ou un groupBy que le schéma ne porte plus, et un agrégat ne suit
      // jamais une relation disparue. L'onglet regardé est glissé ici, et NULLE
      // PART ailleurs : une écriture a déjà lieu, elle ne coûte rien de plus.
      const sane = sanitizeViews(
        sanitizeSchema({
          ...next,
          activeViewId: resolveActiveView(next, localViewIdRef.current).id,
        })
      );
      dataRef.current = sane;
      const attrs: Record<string, unknown> = { data: serializeDbData(sane) };
      // Identité frappée au premier VRAI commit — jamais à la simple lecture.
      // La valeur écrite est celle qui était déjà dérivée, donc une relation
      // créée avant ce commit continue de viser cette base. Sans graine (base
      // encore vide), on en frappe une neuve : personne ne pouvait la viser.
      if ((dbIdAttr ?? '') === '') attrs.dbId = dbId !== '' ? dbId : newId();
      // Miroir des attrs hérités : un client d'avant les vues reste utilisable
      // (il lit `view`/`groupBy` de la vue active et ignore le reste)
      const legacy = legacyAttrsFor(sane);
      if (legacy.view !== view) attrs.view = legacy.view;
      if (legacy.groupBy !== groupBy) attrs.groupBy = legacy.groupBy;
      updateAttributes(attrs);
    },
    [updateAttributes, view, groupBy, dbIdAttr, dbId]
  );

  const commitTitle = useCallback(() => {
    if (titleDraft !== title) updateAttributes({ title: titleDraft });
  }, [titleDraft, title, updateAttributes]);

  const setSource = useCallback(
    (nextSource: string) => {
      if (nextSource !== sourceId) updateAttributes({ source: nextSource });
    },
    [sourceId, updateAttributes]
  );

  /* ---- Vues enregistrées ---- */
  const patchViews = useCallback(
    (fn: (views: DbView[]) => DbView[]) => {
      const cur = dataRef.current;
      commit({ ...cur, views: fn(cur.views ?? []) });
    },
    [commit]
  );

  /**
   * Le seul chemin qui change d'onglet. La ref est posée AVANT l'état parce que
   * `commit` la relit dans le même geste (créer une vue la rend active), et que
   * l'état de React n'aurait pas encore bougé.
   */
  const onSelectView = useCallback(
    (viewId: string) => {
      localViewIdRef.current = viewId;
      setLocalViewId(viewId);
      writeActiveViewPref(prefKey, viewId);
    },
    [prefKey]
  );

  const onAddView = useCallback(() => {
    const cur = dataRef.current;
    const created: DbView = {
      ...makeDefaultView('table'),
      name: t('notes.inlineDb.newViewName', 'View {{n}}', { n: (cur.views ?? []).length + 1 }),
    };
    onSelectView(created.id);
    patchViews((list) => [...list, created]);
  }, [onSelectView, patchViews, t]);

  const onPatchView = useCallback(
    (viewId: string, patch: Partial<DbView>) => {
      patchViews((list) => list.map((v) => (v.id === viewId ? { ...v, ...patch } : v)));
    },
    [patchViews]
  );

  const onDuplicateView = useCallback(
    (viewId: string) => {
      const cur = dataRef.current;
      const src = (cur.views ?? []).find((v) => v.id === viewId);
      if (!src) return;
      const copy: DbView = {
        ...src,
        id: newId(),
        name: t('notes.inlineDb.viewCopyName', '{{name}} (copy)', { name: src.name }),
        // Copies profondes : renommer un filtre de la copie ne touche pas l'original
        filters: src.filters.map((f) => ({ ...f, id: newId() })),
        sorts: src.sorts.map((s) => ({ ...s })),
      };
      const index = (cur.views ?? []).findIndex((v) => v.id === viewId);
      onSelectView(copy.id);
      patchViews((list) => [...list.slice(0, index + 1), copy, ...list.slice(index + 1)]);
    },
    [onSelectView, patchViews, t]
  );

  const onDeleteView = useCallback(
    (viewId: string) => {
      const cur = dataRef.current;
      const list = cur.views ?? [];
      // Une base garde au moins une vue (sinon plus rien ne s'affiche)
      if (list.length <= 1) return;
      const rest = list.filter((v) => v.id !== viewId);
      // Supprimer l'onglet regardé fait glisser la lecture sur le premier restant
      if (resolveActiveView(cur, localViewIdRef.current).id === viewId) onSelectView(rest[0].id);
      patchViews(() => rest);
    },
    [onSelectView, patchViews]
  );

  const onGroupByChange = useCallback(
    (propertyId: string) => {
      const cur = dataRef.current;
      const active = resolveActiveView(cur, localViewIdRef.current);
      // Rien à écrire si la vue groupe déjà là-dessus : supprimer la propriété
      // de groupement enchaîne un commit qui l'a DÉJÀ retirée (sanitizeViews)
      if ((active.groupBy ?? '') === propertyId) return;
      commit({
        ...cur,
        views: (cur.views ?? []).map((v) =>
          v.id === active.id ? { ...v, groupBy: propertyId || undefined } : v
        ),
      });
    },
    [commit]
  );

  const addRow = useCallback(() => {
    const cur = dataRef.current;
    // Cellules pré-remplies par les filtres : la ligne créée est visible ICI
    commit({ ...cur, rows: [...cur.rows, newRow(cur.properties, rowDefaults)] });
  }, [commit, rowDefaults]);

  return (
    <NodeViewWrapper
      ref={resize.ref}
      className={`inline-db ${resize.className} ${selected ? 'inline-db--selected' : ''} ${
        readOnly ? 'inline-db--readonly' : ''
      }`}
      style={resize.style}
      data-inline-database=""
      contentEditable={false}
      // Ferme le trou clavier en lecture seule (aperçu de versions) — le CSS
      // pointer-events reste en ceinture. React 18 : '' pose l'attribut, un
      // booléen serait ignoré sur cet attribut inconnu du renderer DOM.
      inert={readOnly ? '' : undefined}
    >
      {resize.grip}

      <div className="inline-db__header">
        <input
          className="inline-db__title"
          value={titleDraft}
          aria-label={t('notes.inlineDb.titlePlaceholder', 'Untitled database')}
          onChange={(e) => setTitleDraft(e.target.value)}
          onBlur={() => {
            if (cancelTitleRef.current) {
              cancelTitleRef.current = false;
              setTitleDraft(title);
              return;
            }
            commitTitle();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              (e.target as HTMLInputElement).blur();
            } else if (e.key === 'Escape') {
              e.stopPropagation();
              cancelTitleRef.current = true;
              (e.target as HTMLInputElement).blur();
            }
          }}
          placeholder={t('notes.inlineDb.titlePlaceholder', 'Untitled database')}
        />
        <div className="inline-db__header-actions">
          <label className="inline-db__source">
            <span className="inline-db__source-label">{t('notes.inlineDb.source', 'Source')}</span>
            <select
              className="inline-db__source-select"
              value={sourceId}
              aria-label={t('notes.inlineDb.sourceAria', 'Data source used by the ⚡ button')}
              title={t('notes.inlineDb.sourceAria', 'Data source used by the ⚡ button')}
              onChange={(e) => setSource(e.target.value)}
            >
              <option value="">{t('notes.inlineDb.sourceNone', 'None')}</option>
              {sourceOptions.map((s) => {
                const label = CONNECTOR_SOURCE_LABELS[s.id];
                return (
                  <option key={s.id} value={s.id}>
                    {label ? t(label.key, label.fallback) : s.label}
                  </option>
                );
              })}
            </select>
          </label>
          <button type="button" className="inline-db__new-row-btn" onClick={addRow}>
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            {t('notes.inlineDb.newRow', 'New row')}
          </button>
        </div>
      </div>

      <ViewBar
        views={views}
        activeView={activeView}
        search={search}
        onSearchChange={setSearch}
        properties={data.properties}
        hiddenCount={Math.max(0, data.rows.length - visibleRows.length)}
        onSelectView={onSelectView}
        onAddView={onAddView}
        onPatchView={onPatchView}
        onDuplicateView={onDuplicateView}
        onDeleteView={onDeleteView}
      />

      {activeView.type === 'gallery' ? (
        <DatabaseGalleryView
          data={data}
          visibleRows={visibleRows}
          groupBy={activeView.groupBy ?? ''}
          rowDefaults={rowDefaults}
          linkCtx={linkCtx}
          activeView={activeView}
          onChange={commit}
          onGroupByChange={onGroupByChange}
        />
      ) : activeView.type === 'calendar' ? (
        <DatabaseCalendarView
          data={data}
          visibleRows={visibleRows}
          groupBy={activeView.groupBy ?? ''}
          rowDefaults={rowDefaults}
          linkCtx={linkCtx}
          activeView={activeView}
          onChange={commit}
          onGroupByChange={onGroupByChange}
        />
      ) : activeView.type === 'board' ? (
        <DatabaseBoardView
          data={data}
          visibleRows={visibleRows}
          groupBy={activeView.groupBy ?? ''}
          rowDefaults={rowDefaults}
          linkCtx={linkCtx}
          activeView={activeView}
          onChange={commit}
          onGroupByChange={onGroupByChange}
        />
      ) : (
        <DatabaseTableView
          data={data}
          visibleRows={visibleRows}
          groupBy={activeView.groupBy ?? ''}
          rowDefaults={rowDefaults}
          source={sourceId}
          linkCtx={linkCtx}
          dbCatalog={dbCatalog}
          // Vue REGARDÉE (l'onglet local prime) : c'est elle que la table
          // corrige pour ranger ses largeurs de colonnes
          activeView={activeView}
          onChange={commit}
          onGroupByChange={onGroupByChange}
        />
      )}
    </NodeViewWrapper>
  );
};
