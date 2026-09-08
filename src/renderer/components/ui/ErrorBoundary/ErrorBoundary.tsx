import React, { Component, ErrorInfo, ReactNode } from 'react';
import { isChunkLoadError, recoverFromChunkError } from './chunkRecovery';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  showDetails: boolean;
  /** Un chunk manquant : la page se recharge, l'erreur n'appartient a personne. */
  recovering: boolean;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      showDetails: false,
      recovering: false,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    /**
     * UN CHUNK MANQUANT N'EST PAS UNE PANNE, C'EST UNE VERSION PERIMEE.
     *
     * Un onglet reste ouvert pendant un deploiement demande des fichiers que le
     * nouveau build ne porte plus : la premiere route paresseuse ouverte apres
     * coup echoue. Recharger va rechercher `index.html`, qui nomme les nouveaux
     * fichiers — c'est la reparation, pas un contournement. Une seule tentative
     * par minute (chunkRecovery), sinon un vrai fichier absent bouclerait.
     */
    const recovering = recoverFromChunkError(error, {
      storage: typeof sessionStorage === 'undefined' ? null : sessionStorage,
      reload: () => window.location.reload(),
    });
    if (recovering) {
      this.setState({ errorInfo, recovering: true });
      return;
    }

    console.error('[ErrorBoundary] Caught error:', error);
    console.error('[ErrorBoundary] Component stack:', errorInfo.componentStack);
    this.setState({ errorInfo });
    this.props.onError?.(error, errorInfo);
  }

  handleReload = (): void => {
    window.location.reload();
  };

  handleToggleDetails = (): void => {
    this.setState((prevState) => ({
      showDetails: !prevState.showDetails,
    }));
  };

  render(): ReactNode {
    if (this.state.hasError) {
      // Le rechargement est deja demande : afficher une panne serait mentir.
      if (this.state.recovering) {
        return (
          <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-900 p-6">
            <p className="text-sm text-gray-600 dark:text-gray-400" role="status">
              Une nouvelle version de Filarr est disponible. Rechargement...
            </p>
          </div>
        );
      }

      if (this.props.fallback) {
        return this.props.fallback;
      }

      const { error, errorInfo, showDetails } = this.state;

      return (
        <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-900 p-6">
          <div className="w-full max-w-lg bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-8">
            {/* Icon */}
            <div className="flex justify-center mb-6">
              <div className="flex items-center justify-center w-16 h-16 rounded-full bg-red-100 dark:bg-red-900/30">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                  className="w-8 h-8 text-red-600 dark:text-red-400"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
                  />
                </svg>
              </div>
            </div>

            {/* Title */}
            <h1 className="text-xl font-semibold text-center text-gray-900 dark:text-gray-100 mb-2">
              Une erreur inattendue est survenue
            </h1>

            {/* Error message */}
            <p className="text-sm text-center text-gray-600 dark:text-gray-400 mb-6">
              {isChunkLoadError(error)
                ? "Un fichier de l'application n'a pas pu etre charge, et le rechargement automatique n'y a rien change. Verifiez votre connexion, puis rechargez."
                : error?.message ||
                  "L'application a rencontre un probleme. Veuillez recharger la page."}
            </p>

            {/* Action buttons */}
            <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
              <button
                type="button"
                onClick={this.handleReload}
                className="inline-flex items-center justify-center px-5 py-2.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 rounded-lg transition-colors"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                  className="w-4 h-4 mr-2"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182"
                  />
                </svg>
                Recharger l'application
              </button>

              <button
                type="button"
                onClick={this.handleToggleDetails}
                className="inline-flex items-center justify-center px-5 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2 rounded-lg transition-colors"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                  className={`w-4 h-4 mr-2 transition-transform ${showDetails ? 'rotate-180' : ''}`}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="m19.5 8.25-7.5 7.5-7.5-7.5"
                  />
                </svg>
                {showDetails ? 'Masquer les details' : 'Afficher les details'}
              </button>
            </div>

            {/* Error details (collapsible) */}
            {showDetails && (
              <div className="mt-6 rounded-lg bg-gray-100 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 overflow-hidden">
                <div className="p-4 space-y-3">
                  {/* Error name and message */}
                  <div>
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">
                      Erreur
                    </h3>
                    <pre className="text-xs text-red-700 dark:text-red-400 whitespace-pre-wrap break-words font-mono">
                      {error?.name}: {error?.message}
                    </pre>
                  </div>

                  {/* Stack trace */}
                  {error?.stack && (
                    <div>
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">
                        Stack trace
                      </h3>
                      <pre className="text-xs text-gray-700 dark:text-gray-300 whitespace-pre-wrap break-words font-mono max-h-40 overflow-y-auto">
                        {error.stack}
                      </pre>
                    </div>
                  )}

                  {/* Component stack */}
                  {errorInfo?.componentStack && (
                    <div>
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">
                        Component stack
                      </h3>
                      <pre className="text-xs text-gray-700 dark:text-gray-300 whitespace-pre-wrap break-words font-mono max-h-40 overflow-y-auto">
                        {errorInfo.componentStack}
                      </pre>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
