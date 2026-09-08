/**
 * RouteContent Component
 *
 * Mappe une route string vers le composant de vue correspondant.
 * Permet d'afficher deux routes differentes simultanement dans un split-view,
 * sans dependre de React Router (qui ne gere qu'une seule location).
 */

import React, { useCallback, useEffect, useMemo, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { useDispatch, useSelector } from 'react-redux';
import { useLocation, useNavigate } from 'react-router-dom';
import type { AppDispatch, RootState } from '../../../../store';
import {
  selectIsEnterpriseSpace,
  selectIsOrgSpaceEntered,
  selectCanUseTeamVaults,
} from '../../../../store/selectors/authSelectors';
import { setNotesViewMode } from '../../../../store/slices/notesSlice';
import { ensureVaultsLoaded, selectVaultById } from '../../../../store/slices/vaultsSlice';
import {
  normalizeRoute,
  notesVaultNoteFromRoute,
  vaultFolderRoute,
  vaultTargetFromRoute,
} from './routeCompat';
import { StickyNotesView } from '../../notes/StickyNotesView';
import { Home } from '../../views/Home';
import { FolderView } from '../../views/FolderView';
import { Settings } from '../../views/Settings';
import TrashView from '../../views/TrashView/TrashView';
import { CollectionsPanel } from '../../collections';
import { Timeline } from '../../views/Timeline/Timeline';
import { Profile } from '../../views/Profile';
import { AutomationRulesPanel } from '../../automation';
import { SharesView } from '../../views/Shares';
import { RemindersView } from '../../views/Reminders';
import OrgDashboard from '../../settings/OrgDashboard';
import OrgNoOrgState from '../../settings/OrgNoOrgState';
import { ErrorBoundary } from '../../ui/ErrorBoundary';

// Lazy-loaded heavy components (TipTap + ProseMirror + lowlight are ~400KB)
const LazyNotesView = React.lazy(() =>
  import('../../notes/NotesView').then((m) => ({ default: m.NotesView }))
);

const LazyMarketplaceView = React.lazy(() =>
  import('../../marketplace').then((m) => ({ default: m.MarketplaceView }))
);
const LazyVaultKeypairGate = React.lazy(() =>
  import('../../vaults').then((m) => ({ default: m.VaultKeypairGate }))
);
// Lot A (C3) : l'explorateur d'UN coffre, à sa propre adresse `/vault-folder/<id>`
// — le même que l'ancienne branche `/vaults/<id>`. La coque `TeamVaultsView` et la
// page « Partagé avec moi » ont été démontées (C6) : leurs anciennes routes
// n'arrivent plus ici que normalisées (routeCompat), jamais rendues.
const LazyVaultFolderView = React.lazy(() =>
  import('../../vaults').then((m) => ({ default: m.VaultFolderView }))
);
// La page « Gérer le coffre » (F01) — la MÊME adresse que l'explorateur, avec
// `?view=settings` : elle n'a pas de segment à elle (voir routeCompat).
const LazyVaultSettingsView = React.lazy(() =>
  import('../../vaults').then((m) => ({ default: m.VaultSettingsView }))
);

interface RouteContentProps {
  route: string;
  panelId: string;
}

/** Suspense loading spinner for lazy-loaded views */
const LazyLoadingFallback: React.FC = () => (
  <div className="flex items-center justify-center h-full">
    <div
      style={{
        width: 32,
        height: 32,
        border: '3px solid var(--color-border-light, #e2e8f0)',
        borderTopColor: 'var(--color-primary-500, #4682b4)',
        borderRadius: '50%',
        animation: 'spin 0.6s linear infinite',
      }}
    />
    <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
  </div>
);

/**
 * Shown when a `/folder/<id>` tab survives a profile switch and the id
 * belongs to a different profile. Prevents the cross-profile leak where
 * FolderView would mount with a foreign folder's metadata.
 */
const OrphanFolderFallback: React.FC = () => (
  <div className="flex flex-col items-center justify-center h-full p-8 text-center">
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
      width="48"
      height="48"
      style={{ margin: '0 auto 16px', color: 'var(--color-text-tertiary)' }}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z"
      />
    </svg>
    <h2 className="text-lg font-semibold mb-2" style={{ color: 'var(--color-text-primary)' }}>
      Dossier introuvable
    </h2>
    <p className="max-w-md text-sm" style={{ color: 'var(--color-text-secondary)' }}>
      Ce dossier n&apos;appartient pas au profil actif. Il provient probablement d&apos;un onglet
      ouvert avec un autre profil.
    </p>
  </div>
);

/**
 * Miroir d'`OrphanFolderFallback` pour `/vault-folder/<id>` : le coffre n'est
 * pas dans la liste une fois celle-ci chargée (quitté, supprimé, retiré par
 * l'hôte, ou onglet d'un autre compte). On le DIT, sans naviguer à la place de
 * l'utilisateur : un onglet qui se téléporte tout seul vers l'accueil est plus
 * déroutant qu'un écran qui explique.
 */
const OrphanVaultFallback: React.FC = () => {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center justify-center h-full p-8 text-center">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={1.5}
        stroke="currentColor"
        width="48"
        height="48"
        style={{ margin: '0 auto 16px', color: 'var(--color-text-tertiary)' }}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 0h10.5a1.5 1.5 0 0 1 1.5 1.5v6a1.5 1.5 0 0 1-1.5 1.5H6.75a1.5 1.5 0 0 1-1.5-1.5v-6a1.5 1.5 0 0 1 1.5-1.5Z"
        />
      </svg>
      <h2 className="text-lg font-semibold mb-2" style={{ color: 'var(--color-text-primary)' }}>
        {t('teamVaults.orphan.title', 'Coffre introuvable')}
      </h2>
      <p className="max-w-md text-sm" style={{ color: 'var(--color-text-secondary)' }}>
        {t('teamVaults.orphan.hint')}
      </p>
    </div>
  );
};

/** Fallback component for critical feature errors */
const FeatureErrorFallback: React.FC<{ featureName: string }> = ({ featureName }) => (
  <div className="flex flex-col items-center justify-center h-full p-8 text-center">
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
      width="48"
      height="48"
      style={{ margin: '0 auto 16px', color: 'var(--color-warning-500, #f59e0b)' }}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
      />
    </svg>
    <h2 className="text-xl font-semibold mb-2" style={{ color: 'var(--color-text-primary)' }}>
      Erreur dans {featureName}
    </h2>
    <p className="max-w-md" style={{ color: 'var(--color-text-secondary)' }}>
      Une erreur inattendue s'est produite. Essayez de naviguer vers une autre page.
    </p>
  </div>
);

/**
 * Rendered when an enterprise-only route (/organization) is reached while the
 * profile is in personal space — e.g. a deep-link or a tab restored from a
 * previous enterprise session. Keeps the enterprise UI from mounting.
 */
const PersonalSpaceFallback: React.FC = () => (
  <div className="flex flex-col items-center justify-center h-full px-8 text-center">
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
      width="48"
      height="48"
      style={{ margin: '0 auto 16px', color: 'var(--color-text-tertiary)' }}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 4.5v15m7.5-7.5h-15"
        transform="rotate(45 12 12)"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21"
      />
    </svg>
    <h2 className="text-xl font-semibold mb-2" style={{ color: 'var(--color-text-primary)' }}>
      Espace entreprise requis
    </h2>
    <p className="max-w-md" style={{ color: 'var(--color-text-secondary)' }}>
      Cette section n'est disponible que dans l'espace entreprise. Basculez d'espace depuis votre
      profil pour y accéder.
    </p>
  </div>
);

/**
 * Rendered when a shared-vault route (`/vault-folder/<id>`) is reached without the entitlement — a
 * deep link, a restored tab, or a plan that lapsed. Says what unlocks it instead
 * of pretending the route doesn't exist.
 */
const VaultEntitlementFallback: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <div className="flex flex-col items-center justify-center h-full px-8 text-center">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={1.5}
        stroke="currentColor"
        width="48"
        height="48"
        style={{ margin: '0 auto 16px', color: 'var(--color-text-tertiary)' }}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 0h10.5a1.5 1.5 0 0 1 1.5 1.5v6a1.5 1.5 0 0 1-1.5 1.5H6.75a1.5 1.5 0 0 1-1.5-1.5v-6a1.5 1.5 0 0 1 1.5-1.5Z"
        />
      </svg>
      <h2 className="text-xl font-semibold mb-2" style={{ color: 'var(--color-text-primary)' }}>
        {t('teamVaults.upgrade.title', 'Shared vaults are a paid feature')}
      </h2>
      <p className="max-w-md" style={{ color: 'var(--color-text-secondary)' }}>
        {t(
          'teamVaults.upgrade.hint',
          'Upgrade your plan to create shared vaults and invite people to them.'
        )}
      </p>
      {/* L'écran nommait la solution sans jamais y mener : aucun bouton, aucun lien.
          C'est pourtant l'écran où atterrit un propriétaire dont l'abonnement s'est
          arrêté — celui qui a le plus besoin du chemin de retour. Les Réglages
          portent le parcours d'achat ; on l'ouvre à la bonne catégorie. */}
      <button
        onClick={() => navigate('/settings?cat=compte')}
        className="mt-5 px-4 py-2 text-sm font-medium rounded-lg text-white transition-colors"
        style={{ backgroundColor: 'var(--color-primary-600)' }}
      >
        {t('teamVaults.upgrade.cta', 'See the plans')}
      </button>
    </div>
  );
};

/**
 * LE TABLEAU (`/board`) — le canevas libre en DESTINATION, plus en mode.
 *
 * Deux différences avec la même vue rendue dans la section Notes :
 *  - `source="all"` : le tableau ignore les filtres de la liste. Un filtre de
 *    carnet posé une heure plus tôt dans un autre écran ne doit pas décider de
 *    ce qu'on voit ici.
 *  - ouvrir une note QUITTE le tableau par une vraie route (`/notes/<id>`) au
 *    lieu de basculer le mode de vue sur place. Le tableau reste donc une
 *    adresse : le retour arrière y ramène, l'entrée « Tableau » de la barre
 *    latérale aussi, et le point de vue (zoom + panoramique) est réenregistré.
 *
 * Le passage en mode liste est DÉLIBÉRÉ : `NotesView` monté avec un
 * `initialNoteId` prend son mode de vue dans la préférence globale. Si celle-ci
 * valait encore « sticky », ouvrir une note depuis le tableau afficherait…
 * un second canevas, filtré cette fois. On ne fait rien de plus que ce que fait
 * déjà `NotesView` quand on ouvre une note depuis une de ses sous-vues.
 */
const NotesBoardRoute: React.FC = () => {
  const dispatch = useDispatch<AppDispatch>();
  const navigate = useNavigate();
  const handleOpenNote = useCallback(
    (noteId: string) => {
      dispatch(setNotesViewMode('list'));
      navigate(`/notes/${noteId}`);
    },
    [dispatch, navigate]
  );
  return <StickyNotesView source="all" onOpenNote={handleOpenNote} />;
};

/**
 * L'EXPLORATEUR D'UN COFFRE (`/vault-folder/<id>`) — lot A, C3.
 *
 * Sur le patron de `NotesBoardRoute` : un composant-route, pour que les
 * sélecteurs propres à cette adresse ne réveillent pas le `useMemo` de toutes
 * les autres. Trois états, et rien d'autre :
 *  - le coffre est connu → `VaultKeypairGate` (la paire de clés est requise
 *    pour déchiffrer) puis `VaultFolderView`, remonté par `key` à chaque
 *    changement d'identifiant (un chemin n'a de sens que dans SON coffre) ;
 *  - la liste n'a pas encore fini de se charger → l'attente, pas un verdict ;
 *  - la liste est chargée et le coffre n'y est pas → `OrphanVaultFallback`,
 *    qui explique sans naviguer.
 *
 * `ensureVaultsLoaded` est le premier chargement GARDÉ (une seule demande par
 * session, cf. vaultsSlice) : `VaultsBootstrapHost` le fait déjà au démarrage,
 * mais un lien profond qui arrive avant lui ne doit pas attendre que l'accueil
 * ait été visité. Doublon sans effet, par construction.
 *
 * « Remonter » depuis la racine du coffre mène à l'accueil : c'est là que
 * vivent les cartes de coffre, il n'y a plus de section à part.
 *
 * LA PAGE DE GESTION (`?view=settings`) partage cette route et cette porte : le
 * même `VaultKeypairGate`, parce qu'elle déchiffre le nom du coffre et scelle
 * des clés, et le même `ensureVaultsLoaded`. Elle passe DEVANT l'explorateur —
 * une adresse ne montre qu'un écran.
 *
 * LIMITE ASSUMÉE, la même que celle de `?item=` : `useTabNavigation` n'enregistre
 * que le `pathname` dans l'onglet (`updateTabRoute`), si bien que `?view` et
 * `?tab` ne survivent pas à un aller-retour entre onglets ni à la persistance —
 * on revient alors à l'explorateur du coffre, jamais ailleurs. Pour la même
 * raison, un panneau scindé NON focalisé ne reçoit que le pathname : il affiche
 * l'explorateur, et la requête n'est lue que si elle parle DE CE coffre.
 */
const VaultFolderRoute: React.FC<{
  vaultId: string;
  focusItemId?: string;
  /** L'intention `?open=1` : ouvrir la cible, pas seulement la montrer. */
  openFocusedItem?: boolean;
}> = ({ vaultId, focusItemId, openFocusedItem }) => {
  const dispatch = useDispatch<AppDispatch>();
  const navigate = useNavigate();
  const location = useLocation();
  /**
   * LA CIBLE (`?item=<id>`, celle d'un raccourci de l'espace personnel) arrive
   * par deux chemins : la route de l'onglet quand elle la porte, sinon l'URL
   * réelle — `useTabNavigation` n'enregistre que le `pathname` dans l'onglet,
   * la requête ne vit que dans l'adresse. On ne lit l'adresse que si elle
   * parle DE CE coffre : un panneau scindé qui affiche un autre coffre ne doit
   * pas hériter d'une cible étrangère.
   */
  const urlTarget = vaultTargetFromRoute(`${location.pathname}${location.search}`);
  const urlSpeaksOfThisVault = !!urlTarget && urlTarget.vaultId === vaultId;
  const effectiveFocusItemId = focusItemId ?? (urlSpeaksOfThisVault ? urlTarget.itemId : undefined);
  /**
   * L'INTENTION SUIT LA CIBLE, ET DE LA MÊME SOURCE QU'ELLE. La lire ailleurs
   * (l'onglet quand la cible vient de l'adresse, ou l'inverse) ferait ouvrir
   * l'élément d'un raccourci avec l'intention d'un autre — donc surgir une
   * modale d'édition sur un élément que personne n'a demandé à ouvrir.
   */
  const effectiveOpen =
    focusItemId !== undefined ? !!openFocusedItem : urlSpeaksOfThisVault && !!urlTarget.open;
  const vault = useSelector((s: RootState) => selectVaultById(s, vaultId));
  const loading = useSelector((s: RootState) => s.vaults.loading);
  const initialLoadRequested = useSelector((s: RootState) => s.vaults.initialLoadRequested);
  const handleExit = useCallback(() => navigate(vaultFolderRoute(vaultId)), [navigate, vaultId]);
  const handleHome = useCallback(() => navigate('/'), [navigate]);
  const handleTabChange = useCallback(
    (tab: string) =>
      // `replace` : parcourir six onglets ne doit pas empiler six entrées
      // d'historique entre l'explorateur et le retour arrière.
      navigate(vaultFolderRoute(vaultId, { view: 'settings', tab }), { replace: true }),
    [navigate, vaultId]
  );

  useEffect(() => {
    void dispatch(ensureVaultsLoaded());
  }, [dispatch]);

  if (!vault) {
    // « Chargé » = une demande a été faite ET elle est retombée. Avant cela,
    // l'absence du coffre n'est pas une information (terminal ≠ jetable).
    const settled = initialLoadRequested && !loading;
    return settled ? <OrphanVaultFallback /> : <LazyLoadingFallback />;
  }
  if (urlSpeaksOfThisVault && urlTarget.view === 'settings') {
    return (
      <LazyVaultKeypairGate>
        <LazyVaultSettingsView
          key={vaultId}
          vaultId={vaultId}
          tab={urlTarget.tab}
          focus={urlTarget.focus}
          onExit={handleExit}
          onTabChange={handleTabChange}
        />
      </LazyVaultKeypairGate>
    );
  }
  return (
    <LazyVaultKeypairGate>
      <LazyVaultFolderView
        key={vaultId}
        vaultId={vaultId}
        focusItemId={effectiveFocusItemId}
        openFocusedItem={effectiveOpen}
        onExit={handleHome}
      />
    </LazyVaultKeypairGate>
  );
};

export const RouteContent: React.FC<RouteContentProps> = ({ route: rawRoute }) => {
  // Les routes ANCIENNES (`/vaults`, `/vaults/<id>`) sont normalisées ICI, à
  // l'entrée : un panneau scindé non focalisé ne passe jamais par React Router
  // (donc jamais par l'effet de remplacement d'URL de useTabNavigation), et sa
  // route lui arrive telle quelle depuis l'état des onglets.
  const route = normalizeRoute(rawRoute);
  // Subscribe to folder ownership so a profile-switch (which resets the
  // folders slice) immediately invalidates orphan `/folder/<id>` tabs from
  // a previous profile. Without this subscription the route would still
  // mount `<FolderView>` with a stale id until the user navigates away.
  const folderIds = useSelector((state: RootState) => state.folders.byId);
  const foldersLoading = useSelector((state: RootState) => state.folders.loading);
  // Enterprise routes are hidden from the sidebar in personal space, but a
  // deep-link or a restored tab from a previous enterprise session can still
  // hit them — guard the routes themselves so the enterprise UI never mounts
  // (and never fires its org-scoped fetches) outside enterprise space.
  const isEnterpriseSpace = useSelector(selectIsEnterpriseSpace);
  const inOrgSpace = useSelector(selectIsOrgSpaceEntered);
  const canUseSharedVaults = useSelector(selectCanUseTeamVaults);

  const content = useMemo(() => {
    if (route === '/') return <Home />;
    if (route === '/profile') return <Profile />;
    if (route === '/settings') return <Settings />;
    if (route === '/trash') return <TrashView />;
    if (route === '/collections') return <CollectionsPanel />;
    if (route === '/timeline') return <Timeline />;
    if (route === '/automation') return <AutomationRulesPanel />;
    if (route === '/shares') return <SharesView />;
    if (route === '/reminders') return <RemindersView />;
    if (route === '/organization') {
      // Trois états, et le troisième manquait. Dans l'espace organisation SANS
      // organisation, la console n'a rien à montrer — mais renvoyer au repli
      // personnel serait un mensonge : la personne est bien au bon endroit, il
      // lui manque seulement une organisation, ce que cet écran lui dit et lui
      // permet de réparer.
      if (isEnterpriseSpace) return <OrgDashboard />;
      if (inOrgSpace) return <OrgNoOrgState />;
      return <PersonalSpaceFallback />;
    }
    if (route === '/board') {
      return (
        <ErrorBoundary fallback={<FeatureErrorFallback featureName="le Tableau" />}>
          <NotesBoardRoute />
        </ErrorBoundary>
      );
    }
    if (route === '/notes' || route.startsWith('/notes/')) {
      /**
       * UNE NOTE DE COFFRE SE LIT DANS L'ONGLET NOTES, et son adresse est lue
       * AVANT celle d'une note personnelle : `/notes/(.+)` est gourmand et
       * prendrait `vault/<coffre>/<élément>` pour l'identifiant d'une note
       * locale — qui n'existerait pas, donc un panneau vide sans un mot.
       *
       * L'habilitation compte ici comme sur la route du coffre : sans elle
       * l'adresse retombe sur l'onglet Notes ordinaire plutôt que de monter un
       * éditeur que le compte n'a pas le droit d'ouvrir.
       */
      const vaultNote = canUseSharedVaults ? notesVaultNoteFromRoute(route) : null;
      const noteMatch = vaultNote ? null : route.match(/^\/notes\/(.+)$/);
      return (
        <ErrorBoundary fallback={<FeatureErrorFallback featureName="Notes" />}>
          <Suspense fallback={<LazyLoadingFallback />}>
            <LazyNotesView initialNoteId={noteMatch?.[1]} vaultNote={vaultNote ?? undefined} />
          </Suspense>
        </ErrorBoundary>
      );
    }
    if (route === '/marketplace') {
      return (
        <ErrorBoundary fallback={<FeatureErrorFallback featureName="Marketplace" />}>
          <Suspense fallback={<LazyLoadingFallback />}>
            <LazyMarketplaceView />
          </Suspense>
        </ErrorBoundary>
      );
    }
    const vaultTarget = vaultTargetFromRoute(route);
    if (vaultTarget) {
      // Entitlement, not space: shared vaults live in the personal space now.
      if (!canUseSharedVaults) return <VaultEntitlementFallback />;
      return (
        <ErrorBoundary fallback={<FeatureErrorFallback featureName="le Coffre partagé" />}>
          <Suspense fallback={<LazyLoadingFallback />}>
            <VaultFolderRoute
              vaultId={vaultTarget.vaultId}
              focusItemId={vaultTarget.itemId}
              openFocusedItem={vaultTarget.open}
            />
          </Suspense>
        </ErrorBoundary>
      );
    }
    const folderMatch = route.match(/^\/folder\/(.+)$/);
    if (folderMatch) {
      const folderId = folderMatch[1];
      // Owned by the active profile, or still loading after a profile
      // switch — let FolderView render. Otherwise the tab is an orphan
      // from a previous profile (Bug 2): show a friendly fallback instead
      // of leaking the foreign folder's view.
      const owned = !!folderIds[folderId];
      if (!owned && !foldersLoading) {
        return <OrphanFolderFallback />;
      }
      return (
        <ErrorBoundary fallback={<FeatureErrorFallback featureName="l'Explorateur de Fichiers" />}>
          <FolderView folderId={folderId} />
        </ErrorBoundary>
      );
    }

    return (
      <div className="flex items-center justify-center h-full text-[var(--color-text-secondary)]">
        404 - Page non trouvee
      </div>
    );
  }, [route, folderIds, foldersLoading, isEnterpriseSpace, canUseSharedVaults]);

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0 bg-[var(--color-background)] overflow-y-auto overflow-x-hidden">
      <ErrorBoundary>{content}</ErrorBoundary>
    </div>
  );
};

export default RouteContent;
