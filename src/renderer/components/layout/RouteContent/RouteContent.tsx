/**
 * RouteContent Component
 *
 * Mappe une route string vers le composant de vue correspondant.
 * Permet d'afficher deux routes differentes simultanement dans un split-view,
 * sans dependre de React Router (qui ne gere qu'une seule location).
 */

import React, { useMemo, Suspense } from 'react';
import { Home } from '../../views/Home';
import { FolderView } from '../../views/FolderView';
import { Settings } from '../../views/Settings';
import TrashView from '../../views/TrashView/TrashView';
import { CollectionsPanel } from '../../collections';
import { Timeline } from '../../views/Timeline/Timeline';
import { Profile } from '../../views/Profile';
import { AutomationRulesPanel } from '../../automation';
import { ErrorBoundary } from '../../ui/ErrorBoundary';

// Lazy-loaded heavy components (TipTap + ProseMirror + lowlight are ~400KB)
const LazyNotesView = React.lazy(() =>
  import('../../notes/NotesView').then((m) => ({ default: m.NotesView }))
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

export const RouteContent: React.FC<RouteContentProps> = ({ route }) => {
  const content = useMemo(() => {
    if (route === '/') return <Home />;
    if (route === '/profile') return <Profile />;
    if (route === '/settings') return <Settings />;
    if (route === '/trash') return <TrashView />;
    if (route === '/collections') return <CollectionsPanel />;
    if (route === '/timeline') return <Timeline />;
    if (route === '/automation') return <AutomationRulesPanel />;
    if (route === '/notes' || route.startsWith('/notes/')) {
      const noteMatch = route.match(/^\/notes\/(.+)$/);
      return (
        <ErrorBoundary fallback={<FeatureErrorFallback featureName="Notes" />}>
          <Suspense fallback={<LazyLoadingFallback />}>
            <LazyNotesView initialNoteId={noteMatch?.[1]} />
          </Suspense>
        </ErrorBoundary>
      );
    }

    const folderMatch = route.match(/^\/folder\/(.+)$/);
    if (folderMatch) {
      return (
        <ErrorBoundary fallback={<FeatureErrorFallback featureName="l'Explorateur de Fichiers" />}>
          <FolderView folderId={folderMatch[1]} />
        </ErrorBoundary>
      );
    }

    return (
      <div className="flex items-center justify-center h-full text-[var(--color-text-secondary)]">
        404 - Page non trouvee
      </div>
    );
  }, [route]);

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0 bg-[var(--color-background)] overflow-y-auto overflow-x-hidden">
      <ErrorBoundary>{content}</ErrorBoundary>
    </div>
  );
};

export default RouteContent;
