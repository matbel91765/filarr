/**
 * Service de nettoyage automatique de la corbeille
 *
 * Gère le nettoyage automatique des éléments de la corbeille plus vieux que 30 jours
 */

import type { AppDispatch } from '../../store';
import { autoCleanupTrash } from '../../store/slices/trashSlice';

// Intervalle de vérification: toutes les 24 heures
const CLEANUP_INTERVAL = 24 * 60 * 60 * 1000; // 24 heures en millisecondes

// Nombre de jours avant suppression automatique
const AUTO_DELETE_DAYS = 30;

class TrashCleanupService {
  private dispatch: AppDispatch | null = null;
  private cleanupIntervalId: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;

  /**
   * Initialise le service avec le dispatch Redux
   */
  initialize(dispatch: AppDispatch): void {
    this.dispatch = dispatch;
  }

  /**
   * Démarre le nettoyage automatique
   */
  start(): void {
    if (this.isRunning) {
      console.warn('[TrashCleanupService] Service already running');
      return;
    }

    if (!this.dispatch) {
      console.error('[TrashCleanupService] Dispatch not initialized');
      return;
    }

    // Exécuter immédiatement au démarrage
    this.runCleanup();

    // Puis programmer l'exécution périodique
    this.cleanupIntervalId = setInterval(() => {
      this.runCleanup();
    }, CLEANUP_INTERVAL);

    this.isRunning = true;
  }

  /**
   * Arrête le nettoyage automatique
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    if (this.cleanupIntervalId) {
      clearInterval(this.cleanupIntervalId);
      this.cleanupIntervalId = null;
    }

    this.isRunning = false;
  }

  /**
   * Exécute le nettoyage
   */
  private async runCleanup(): Promise<void> {
    if (!this.dispatch) {
      console.error('[TrashCleanupService] Dispatch not initialized');
      return;
    }

    try {

      // Exécuter le nettoyage automatique
      const result = await this.dispatch(autoCleanupTrash());

      if (autoCleanupTrash.fulfilled.match(result)) {
        const deletedCount = result.payload;
        if (deletedCount > 0) {
        } else {
        }
      } else {
        console.error('[TrashCleanupService] Auto-cleanup failed:', result);
      }
    } catch (error) {
      console.error('[TrashCleanupService] Error during auto-cleanup:', error);
    }
  }

  /**
   * Force l'exécution manuelle du nettoyage
   */
  async forceCleanup(): Promise<number> {
    if (!this.dispatch) {
      throw new Error('Dispatch not initialized');
    }

    const result = await this.dispatch(autoCleanupTrash());

    if (autoCleanupTrash.fulfilled.match(result)) {
      return result.payload;
    }

    throw new Error('Auto-cleanup failed');
  }

  /**
   * Obtient le statut du service
   */
  getStatus(): {
    isRunning: boolean;
    nextCleanup: Date | null;
  } {
    let nextCleanup: Date | null = null;

    if (this.isRunning && this.cleanupIntervalId) {
      // Estimer la prochaine exécution (approximatif)
      nextCleanup = new Date(Date.now() + CLEANUP_INTERVAL);
    }

    return {
      isRunning: this.isRunning,
      nextCleanup
    };
  }
}

// Instance singleton
const trashCleanupService = new TrashCleanupService();

export default trashCleanupService;
