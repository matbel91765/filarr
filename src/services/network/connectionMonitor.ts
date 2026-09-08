/**
 * Connection Monitor Service
 *
 * Monitors network connectivity using navigator.onLine and periodic API health checks.
 * Emits events when connectivity status changes.
 */

import { isApiReachable } from './apiClient';

export type ConnectionStatus = 'online' | 'offline' | 'degraded';

type StatusChangeHandler = (status: ConnectionStatus) => void;

let currentStatus: ConnectionStatus = navigator.onLine ? 'online' : 'offline';
let healthCheckInterval: ReturnType<typeof setInterval> | null = null;
const listeners: Set<StatusChangeHandler> = new Set();
const HEALTH_CHECK_INTERVAL = 30000; // 30 seconds

function notifyListeners(status: ConnectionStatus): void {
  if (status !== currentStatus) {
    currentStatus = status;
    listeners.forEach(fn => fn(status));
  }
}

async function checkHealth(): Promise<void> {
  if (!navigator.onLine) {
    notifyListeners('offline');
    return;
  }

  const reachable = await isApiReachable();
  notifyListeners(reachable ? 'online' : 'degraded');
}

/**
 * Start monitoring connectivity
 */
export function startMonitoring(): void {
  window.addEventListener('online', () => {
    checkHealth();
  });

  window.addEventListener('offline', () => {
    notifyListeners('offline');
  });

  healthCheckInterval = setInterval(checkHealth, HEALTH_CHECK_INTERVAL);
  checkHealth();
}

/**
 * Stop monitoring
 */
export function stopMonitoring(): void {
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
    healthCheckInterval = null;
  }
}

/**
 * Subscribe to status changes
 */
export function onStatusChange(handler: StatusChangeHandler): () => void {
  listeners.add(handler);
  return () => listeners.delete(handler);
}

/**
 * Get current connection status
 */
export function getConnectionStatus(): ConnectionStatus {
  return currentStatus;
}

/**
 * Check if currently online (online or degraded)
 */
export function isOnline(): boolean {
  return currentStatus !== 'offline';
}
