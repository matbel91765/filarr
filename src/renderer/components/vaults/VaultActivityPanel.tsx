/**
 * VaultActivityPanel — le fil du coffre : qui a fait quoi, dans ma langue.
 *
 * TOUTE la résolution de noms est ICI, côté client : le serveur ne livre que
 * des identifiants opaques (metadata-only). Trois niveaux pour nommer un
 * élément : (1) la liste vivante du store, (2) la corbeille (encore nommable,
 * un appel), (3) « un élément supprimé » + id tronqué — un élément PURGÉ n'a
 * plus de méta nulle part, et c'est une propriété du produit, pas une panne.
 *
 * Les acteurs se résolvent d'abord par l'adresse que porte chaque ligne du
 * trombinoscope DU COFFRE (P2, lisible par tout membre), puis par l'annuaire
 * de l'espace quand on gère le coffre, et seulement à défaut par un
 * identifiant tronqué. Auparavant seule la lecture d'ORG les nommait, et elle
 * était refusée à tout invité : le fil entier retombait sur des identifiants.
 *
 * TROIS VIDES, ET CE SONT TROIS FAITS DIFFÉRENTS (F05). Le panneau les
 * distinguait déjà — « non journalisé sur ce plan », « aucune activité encore »,
 * « impossible de lire » — mais aucun des trois ne portait de geste : celui qui
 * apprenait que son offre ne journalise rien n'avait nulle part où aller, et
 * celui dont la lecture venait d'échouer devait rouvrir l'écran pour réessayer.
 * Le verdict vient maintenant d'un modèle pur (`vaultSettingsEmptyStates`) et
 * chaque vide porte le geste qui lui correspond — ou aucun, quand il n'y en a
 * honnêtement pas.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { Button } from '../ui';
import type { AppDispatch, RootState } from '../../../store';
import {
  loadVaultItems,
  selectVaultById,
  selectVaultItems,
} from '../../../store/slices/vaultsSlice';
import {
  apiGetVaultActivity,
  apiListVaultMembers,
  apiListDeletedVaultItems,
  type VaultActivityPage,
  type VaultActivityEventDTO,
} from '../../../services/vault/vaultApi';
import { useSpaceDirectory } from './spaceDirectory';
import { isVaultAdminRole } from './vaultExplorerModel';
import { decryptItemName } from '../../../services/vault/itemNameResolver';
import { resolveActivityRow } from './vaultActivityModel';
import { RelativeTime } from '../settings/enterprise/AdminPrimitives';
import { activityEmptyState } from './settings/vaultSettingsEmptyStates';
import { activityFamily, type ActivityFamilyId } from './settings/vaultActivityExport';

/**
 * Ce que l'hôte peut demander au fil (F12). TOUT est optionnel : le volet de
 * l'explorateur et la modale du clic droit n'en passent aucun et voient
 * exactement ce qu'ils voyaient — un filtre par défaut serait un filtre invisible.
 */
export interface VaultActivityFilter {
  /** Les types demandés, ou `null`/absent : le fil entier (voir `activityQueryTypes`). */
  types?: readonly string[] | null;
  /** Un identifiant opaque d'acteur — jamais une adresse (anti-énumération). */
  actor?: string | null;
  /** Bornes INCLUSIVES en millisecondes. */
  since?: number | null;
  until?: number | null;
}

interface Props {
  vaultId: string;
  /** La page déjà chargée par l'onglet (badge) — évite un double fetch. */
  initialPage?: VaultActivityPage | null;
  /** Les filtres de l'onglet Activité (F12) — voir `VaultActivityFilter`. */
  filter?: VaultActivityFilter;
  /**
   * `inviteId → adresse invitée`, pour que le fil dise QUI a été invité.
   *
   * PASSÉ, JAMAIS CHARGÉ ICI. La route des invitations est réservée aux admins,
   * et ce panneau est rendu par quatre écrans dont deux n'y ont pas droit : la
   * demander lui-même vaudrait un 403 par ouverture de volet. L'onglet
   * Activité, lui, tient déjà la liste — il la prête.
   *
   * ABSENT ⇒ AUCUNE LIGNE N'EST NOMMÉE, et c'est le bon comportement : la
   * formule « a invité quelqu'un » reste vraie, là où un identifiant d'invitation
   * affiché ne dirait rien à personne.
   */
  emailByInviteId?: ReadonlyMap<string, string>;
  /**
   * Ce que le fil vient de charger — le compteur de l'onglet, et la matière de
   * son état vide. Le panneau ne compte RIEN pour son hôte : il rapporte ce
   * qu'il a, et l'hôte en fait une phrase. DOIT être stable (`useCallback`) :
   * une fonction recréée à chaque rendu relancerait l'effet en boucle.
   */
  onPage?: (info: { count: number; recorded: boolean; hasMore: boolean }) => void;
}

/**
 * La pastille de famille — le MÊME découpage que le filtre de l'onglet, qui fait
 * autorité (`vaultActivityExport.activityFamily`). Deux partitions parallèles
 * finiraient par diverger, et un menu « éléments » qui ne rendrait pas les
 * lignes 📄 serait un mensonge que rien ne signale.
 */
const FAMILY_GLYPH: Record<ActivityFamilyId, string> = {
  items: '📄',
  keys: '🔐',
  members: '👤',
};

export const VaultActivityPanel: React.FC<Props> = ({
  vaultId,
  initialPage,
  filter,
  onPage,
  emailByInviteId,
}) => {
  const { t } = useTranslation();
  const dispatch = useDispatch<AppDispatch>();
  const navigate = useNavigate();

  const items = useSelector((s: RootState) => selectVaultItems(s, vaultId));
  // Mon rôle DANS CE COFFRE : il décide si l'annuaire de l'espace m'est ouvert.
  const myVaultRole = useSelector((s: RootState) => selectVaultById(s, vaultId)?.role ?? 'viewer');
  const directory = useSpaceDirectory(vaultId, isVaultAdminRole(myVaultRole));

  const [page, setPage] = useState<VaultActivityPage | null>(initialPage ?? null);
  const [events, setEvents] = useState<VaultActivityEventDTO[]>(initialPage?.events ?? []);
  const [loading, setLoading] = useState(!initialPage);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [emailByUserId, setEmailByUserId] = useState<Map<string, string>>(new Map());
  const [trashNames, setTrashNames] = useState<Map<string, string>>(new Map());
  /**
   * Le compteur de RELANCES. Sans lui, l'effet de chargement ne dépendait que du
   * coffre : après un échec, il n'existait aucun moyen de redemander la page
   * sans quitter l'écran et y revenir — le message d'erreur était un cul-de-sac.
   */
  const [retryTick, setRetryTick] = useState(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /**
   * LES FILTRES, RÉDUITS À UNE VALEUR STABLE.
   *
   * L'hôte reconstruit son objet de filtres à chaque rendu (il vient de quatre
   * `useState`) : le prendre en dépendance relancerait la lecture à chaque
   * frappe, et le fil clignoterait sans fin. On le réduit donc à une CHAÎNE, qui
   * ne change que quand la sélection change vraiment, puis on relit l'objet
   * depuis elle — un aller-retour JSON sur quatre valeurs primitives, contre une
   * boucle de requêtes.
   */
  const filterSig = useMemo(
    () =>
      JSON.stringify({
        types: filter?.types ?? null,
        actor: filter?.actor ?? null,
        since: filter?.since ?? null,
        until: filter?.until ?? null,
      }),
    [filter]
  );
  const query = useMemo(
    () =>
      JSON.parse(filterSig) as {
        types: string[] | null;
        actor: string | null;
        since: number | null;
        until: number | null;
      },
    [filterSig]
  );

  // ── Le fil lui-même ────────────────────────────────────────────────────────
  useEffect(() => {
    // La page déjà chargée par l'hôte ne vaut qu'à la PREMIÈRE passe : une
    // relance demandée après un échec doit vraiment repartir vers le serveur.
    // Elle ne vaut pas non plus SOUS FILTRE : elle a été lue sans, et l'afficher
    // sous un filtre montrerait des lignes que la sélection prétend exclure.
    // `until` compte AUSSI, même si aucun appelant ne le pose aujourd'hui
    // (`periodRange` n'ancre que `since`) : oublier une borne ici ferait
    // afficher la page NON filtrée sous un filtre, c'est-à-dire des lignes que
    // la sélection prétend exclure.
    const filtre =
      query.types !== null || query.actor !== null || query.since !== null || query.until !== null;
    if (initialPage && retryTick === 0 && !filtre) {
      setPage(initialPage);
      setEvents(initialPage.events);
      setLoading(false);
      return;
    }
    let vivant = true;
    setLoading(true);
    setLoadError(null);
    apiGetVaultActivity(vaultId, {
      limit: 50,
      ...(query.types ? { types: query.types } : {}),
      ...(query.actor ? { actor: query.actor } : {}),
      ...(query.since !== null ? { since: query.since } : {}),
      ...(query.until !== null ? { until: query.until } : {}),
    })
      .then((p) => {
        if (!vivant) return;
        setPage(p);
        setEvents(p.events);
      })
      .catch((e) => {
        if (vivant) setLoadError((e as Error)?.message || 'activity_load_failed');
      })
      .finally(() => {
        if (vivant) setLoading(false);
      });
    return () => {
      vivant = false;
    };
  }, [vaultId, initialPage, retryTick, query]);

  /**
   * Ce qu'on vient de charger, rapporté à l'hôte — pour SON compteur, jamais
   * pour le nôtre. Le panneau ne sait pas ce que l'onglet veut en dire.
   *
   * UNE LECTURE QUI ÉCHOUE NE LAISSE RIEN DE CHARGÉ, et le compteur doit le
   * dire. L'échec ne vide ni `events` ni `page` — garder la page précédente est
   * ce qui permet de réessayer sans repartir de rien — mais l'en-tête de
   * l'onglet annonçait alors « 50 événements chargés » à trente pixels d'un
   * panneau qui dit « impossible de lire ». On rapporte donc zéro, et aucune
   * suite, tant que `loadError` est posé : les deux phrases racontent la même
   * chose.
   *
   * `recorded` NE SUIT PAS LA MÊME RÈGLE, et c'est délibéré : il répond « ce
   * plan journalise-t-il », un verdict REÇU du serveur qu'une panne de réseau ne
   * périme pas. Le forcer ici ferait réapparaître, sur un simple échec, les
   * menus et l'export qu'une réponse avait retirés.
   */
  useEffect(() => {
    onPage?.({
      count: loadError ? 0 : events.length,
      recorded: page ? page.recorded : true,
      hasMore: !loadError && !!page?.nextCursor,
    });
    // Un cleanup rendu DANS TOUS LES CAS : sinon TS7030.
    return undefined;
  }, [events.length, page, onPage, loadError]);

  const loadMore = async () => {
    if (!page?.nextCursor) return;
    setLoadingMore(true);
    try {
      // Le curseur keyset ne vaut QUE pour la même sélection : les mêmes filtres
      // repartent avec lui, sinon la page suivante ne serait pas la suite.
      const next = await apiGetVaultActivity(vaultId, {
        limit: 50,
        cursor: page.nextCursor,
        ...(query.types ? { types: query.types } : {}),
        ...(query.actor ? { actor: query.actor } : {}),
        ...(query.since !== null ? { since: query.since } : {}),
        ...(query.until !== null ? { until: query.until } : {}),
      });
      if (!mountedRef.current) return;
      setPage(next);
      setEvents((prev) => [...prev, ...next.events]);
    } catch (e) {
      if (mountedRef.current) setLoadError((e as Error)?.message || 'activity_load_failed');
    } finally {
      if (mountedRef.current) setLoadingMore(false);
    }
  };

  /**
   * Résolution des ACTEURS — accessoire : son échec ne vide jamais le fil.
   *
   * TROIS NIVEAUX, dans cet ordre (P2) :
   *   1. le trombinoscope DU COFFRE, dont chaque ligne porte maintenant
   *      l'adresse — il couvre l'écrasante majorité des acteurs (on n'agit dans
   *      un coffre qu'en en étant membre) et il est lisible par TOUS ;
   *   2. l'annuaire de l'espace, quand je gère ce coffre — il rattrape les
   *      acteurs qui n'y sont plus (départ, retrait) mais restent dans l'espace ;
   *   3. l'identifiant tronqué, comme avant, pour tout le reste.
   *
   * Avant, seul le niveau 2 existait, servi par une route refusée aux invités :
   * un fil entier de « 7f3a1c2b… a remplacé rapport.pdf ».
   */
  useEffect(() => {
    let vivant = true;
    void (async () => {
      const map = new Map<string, string>();
      try {
        const vm = await apiListVaultMembers(vaultId);
        for (const m of vm) if (m.email) map.set(m.userId, m.email);
      } catch {
        /* le fil se lit sans les noms — jamais l'inverse */
      }
      for (const m of directory.entries) if (!map.has(m.userId)) map.set(m.userId, m.email);
      if (vivant) setEmailByUserId(map);
    })();
    return () => {
      vivant = false;
    };
  }, [vaultId, directory.entries]);

  // ── Résolution des ÉLÉMENTS : store vivant, puis corbeille, puis fallback ──
  useEffect(() => {
    if (items.length === 0) void dispatch(loadVaultItems({ vaultId }));
    // volontairement une seule fois par coffre : le fil n'est pas du temps réel
  }, [vaultId, dispatch]);

  const liveNames = useMemo(() => {
    const m = new Map<string, string>();
    for (const i of items) {
      // Un SIDECAR de fil (meta.threadFor) n'a pas de titre : sans libelle
      // dedie, chaque commentaire de fichier apparaitrait comme l'edition
      // d'une note sans nom.
      if (i.meta.threadFor) {
        const cible = items.find((x) => x.id === i.meta.threadFor);
        const nomCible = cible ? cible.meta.fileName || cible.meta.title : null;
        m.set(
          i.id,
          nomCible
            ? t('teamVaults.comments.thread.activityLabelFor', { name: nomCible })
            : t('teamVaults.comments.thread.activityLabel')
        );
        continue;
      }
      const nom = i.meta.fileName || i.meta.title;
      if (nom) m.set(i.id, nom);
    }
    return m;
  }, [items, t]);

  useEffect(() => {
    // Les item_id que ni le store ni la corbeille déjà lue ne savent nommer.
    const unresolved = new Set<string>();
    for (const e of events) {
      const itemId =
        typeof e.metadata?.item_id === 'string' ? (e.metadata.item_id as string) : null;
      if (itemId && !liveNames.has(itemId) && !trashNames.has(itemId)) unresolved.add(itemId);
    }
    if (unresolved.size === 0) return;
    let vivant = true;
    void (async () => {
      try {
        // UN appel : la corbeille entière, nommée au mieux (échec par élément toléré).
        const dtos = await apiListDeletedVaultItems(vaultId);
        const named = new Map(trashNames);
        await Promise.all(
          dtos
            .filter((d) => unresolved.has(d.id))
            .map(async (d) => {
              const nom = await decryptItemName(d, vaultId);
              if (nom) named.set(d.id, nom);
            })
        );
        if (vivant) setTrashNames(named);
      } catch {
        /* purgés ou illisibles : le fallback du rendu s'en charge */
      }
    })();
    return () => {
      vivant = false;
    };
    // trashNames volontairement hors deps : il n'est étendu que par cet effet.
  }, [events, liveNames, vaultId]);

  const nameByItemId = useMemo(() => {
    const m = new Map(liveNames);
    for (const [id, nom] of trashNames) if (!m.has(id)) m.set(id, nom);
    return m;
  }, [liveNames, trashNames]);

  const ctx = useMemo(
    () => ({ emailByUserId, nameByItemId, emailByInviteId }),
    [emailByUserId, nameByItemId, emailByInviteId]
  );

  // ── Rendu ──────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-[var(--color-text-tertiary)]">
        {t('common.loading')}
      </div>
    );
  }

  /**
   * QUEL VIDE, ET QUEL GESTE. Le verdict vient du modèle pur — « non journalisé
   * sur ce plan » n'est ni une panne ni une absence d'événement, et les trois ne
   * se répondent pas de la même façon. `recorded` n'est lu que lorsqu'une page
   * est arrivée : sans page, on ne sait pas, et `null` n'est pas « non ».
   */
  const vide = activityEmptyState({
    loading,
    error: loadError,
    recorded: page ? page.recorded : null,
    events: events.length,
  });

  /**
   * UN FILTRE QUI NE REND RIEN N'EST PAS UN COFFRE QUI N'A RIEN VÉCU (F12).
   * `activityEmptyState` dirait « aucune activité pour l'instant » — une phrase
   * vraie sans filtre et fausse avec, et c'est précisément le genre de silence
   * que cette page existe pour supprimer. Aucun geste ici : les menus sont à
   * trente pixels au-dessus, et un second bouton « effacer les filtres »
   * deviendrait une seconde implémentation du même geste.
   *
   * « NON JOURNALISÉ SUR CE PLAN » RESTE INTACT, et c'est la moitié importante
   * de la règle : ce vide-là n'est pas causé par le filtre, il porte son propre
   * geste (monter d'offre), et le recouvrir d'un « rien ne correspond »
   * enverrait l'hôte trafiquer des menus qui n'y peuvent rien.
   *
   * LES QUATRE BORNES COMPTENT, `until` compris — la MÊME liste que l'effet de
   * chargement plus haut. Personne ne pose aujourd'hui de borne haute seule
   * (`periodRange` n'ancre que `since`), mais le jour où quelqu'un le fera, un
   * filtre sans résultat se lirait « aucune activité pour l'instant » : le
   * mensonge que ce bloc existe pour empêcher.
   */
  const filtre =
    query.types !== null || query.actor !== null || query.since !== null || query.until !== null;
  if (vide.kind === 'empty' && vide.action !== 'upgrade' && filtre) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 p-6 text-center">
        <p className="text-sm text-[var(--color-text-secondary)] m-0 max-w-md">
          {t('teamVaults.activity.noMatch')}
        </p>
      </div>
    );
  }

  if (vide.kind !== 'content') {
    return (
      <div
        {...(vide.kind === 'error' ? { role: 'alert' as const } : {})}
        className="flex flex-col items-center justify-center h-full gap-3 p-6 text-center"
      >
        <p className="text-sm text-[var(--color-text-secondary)] m-0 max-w-md">
          {t(vide.key ?? 'teamVaults.activity.empty')}
        </p>
        {/* Le fil est COUPÉ par l'offre : la seule réponse est de monter, et
            l'écran ne menait jusqu'ici nulle part. */}
        {vide.action === 'upgrade' && (
          <Button variant="secondary" size="sm" onClick={() => navigate('/settings?cat=compte')}>
            {t('teamVaults.upgrade.cta')}
          </Button>
        )}
        {vide.action === 'retry' && (
          <Button variant="secondary" size="sm" onClick={() => setRetryTick((n) => n + 1)}>
            {t('teamVaults.retry')}
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-3">
      <ul className="list-none m-0 p-0 flex flex-col gap-1">
        {events.map((e) => {
          const row = resolveActivityRow(e, ctx);
          const params = { ...row.params };
          if (row.unresolvedItemId) {
            params.item = `${t('teamVaults.activity.deletedItem')} (${row.unresolvedItemId.slice(0, 8)})`;
          }
          if (!params.actor) params.actor = t('teamVaults.activity.someone');
          return (
            <li
              key={e.id}
              className="flex items-start gap-2.5 px-3 py-2 rounded-lg hover:bg-[var(--color-hover-overlay)]"
            >
              <span aria-hidden="true" className="text-sm leading-6 shrink-0">
                {FAMILY_GLYPH[activityFamily(e.eventType)]}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-[var(--color-text-primary)] m-0">
                  {t(row.i18nKey, params)}
                </p>
                <p className="text-xs text-[var(--color-text-tertiary)] m-0">
                  <RelativeTime ms={e.occurredAt} />
                </p>
              </div>
            </li>
          );
        })}
      </ul>
      {page?.nextCursor && (
        <div className="flex justify-center py-3">
          <Button
            size="sm"
            variant="secondary"
            loading={loadingMore}
            onClick={() => void loadMore()}
          >
            {t('teamVaults.activity.loadMore')}
          </Button>
        </div>
      )}
    </div>
  );
};

export default VaultActivityPanel;
