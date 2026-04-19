/**
 * ExtensionSettings Component
 *
 * Settings section for the browser extension WebSocket bridge.
 * Manages pairing, port configuration, and paired client list.
 */

import React, { useState, useEffect, useCallback, FC } from 'react';
import { useNotification } from '../../ui/Notification';

// ==================== TYPES ====================

interface PairedClientInfo {
  id: string;
  name: string;
  pairedAt: string;
  lastSeen: string;
  connected: boolean;
}

interface ExtensionStatus {
  running: boolean;
  port: number;
  connectedClients: number;
  pairedClients: PairedClientInfo[];
}

// ==================== ICONS ====================

const PlugIcon: FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" width="20" height="20">
    <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m9.86-1.027l4.5-4.5a4.5 4.5 0 00-6.364-6.364l-1.757 1.757" />
  </svg>
);

const TrashIcon: FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" width="14" height="14">
    <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
  </svg>
);

const CopyIcon: FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" width="14" height="14">
    <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9.75a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
  </svg>
);

// ==================== HELPERS ====================

const ipcRenderer = typeof window !== 'undefined' && (window as any).electron?.ipcRenderer;

async function getExtensionStatus(): Promise<ExtensionStatus | null> {
  if (!ipcRenderer) return null;
  try {
    return await ipcRenderer.invoke('extension:getStatus');
  } catch {
    return null;
  }
}

async function generatePairingCode(): Promise<string | null> {
  if (!ipcRenderer) return null;
  try {
    const result = await ipcRenderer.invoke('extension:generatePairingCode');
    return result?.code || null;
  } catch {
    return null;
  }
}

async function removePairedClient(clientId: string): Promise<boolean> {
  if (!ipcRenderer) return false;
  try {
    const result = await ipcRenderer.invoke('extension:removePairedClient', clientId);
    return result?.success || false;
  } catch {
    return false;
  }
}

async function setExtensionPort(port: number): Promise<boolean> {
  if (!ipcRenderer) return false;
  try {
    const result = await ipcRenderer.invoke('extension:setPort', port);
    return result?.success || false;
  } catch {
    return false;
  }
}

// ==================== COMPONENT ====================

export const ExtensionSettings: FC = () => {
  const { success, error: showError } = useNotification();

  const [status, setStatus] = useState<ExtensionStatus | null>(null);
  const [portInput, setPortInput] = useState('28080');
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [pairingCountdown, setPairingCountdown] = useState(0);
  const [loading, setLoading] = useState(false);

  // Fetch status on mount and periodically
  const fetchStatus = useCallback(async () => {
    const s = await getExtensionStatus();
    if (s) {
      setStatus(s);
      setPortInput(s.port.toString());
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  // Pairing countdown
  useEffect(() => {
    if (pairingCountdown <= 0) {
      setPairingCode(null);
      return;
    }
    const timer = setTimeout(() => setPairingCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [pairingCountdown]);

  const handleGeneratePairingCode = async () => {
    setLoading(true);
    const code = await generatePairingCode();
    setLoading(false);
    if (code) {
      setPairingCode(code);
      setPairingCountdown(60);
      success('Code d\'association genere');
    } else {
      showError('Impossible de generer le code');
    }
  };

  const handleRemoveClient = async (clientId: string) => {
    const removed = await removePairedClient(clientId);
    if (removed) {
      success('Client supprime');
      fetchStatus();
    } else {
      showError('Impossible de supprimer le client');
    }
  };

  const handleChangePort = async () => {
    const port = parseInt(portInput, 10);
    if (isNaN(port) || port < 1024 || port > 65535) {
      showError('Port invalide (1024-65535)');
      return;
    }
    const ok = await setExtensionPort(port);
    if (ok) {
      success(`Port change vers ${port}`);
      fetchStatus();
    } else {
      showError('Impossible de changer le port');
    }
  };

  const handleCopyCode = () => {
    if (pairingCode) {
      navigator.clipboard.writeText(pairingCode);
      success('Code copie');
    }
  };

  const formatDate = (iso: string) => {
    return new Date(iso).toLocaleDateString('fr-FR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  };

  return (
    <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-[var(--color-border-light)]">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-[var(--color-primary-50)] text-[var(--color-primary-600)]">
            <PlugIcon />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">Extension Navigateur</h3>
            <p className="text-xs text-[var(--color-text-tertiary)]">Auto-remplissage des mots de passe dans le navigateur</p>
          </div>
        </div>
      </div>

      <div className="divide-y divide-[var(--color-border-light)]">
        {/* Server status */}
        <div className="px-6 py-4 flex items-center justify-between gap-4 transition-colors hover:bg-[var(--color-surface-hover)]">
          <div>
            <div className="text-sm font-medium text-[var(--color-text-primary)]">Serveur WebSocket</div>
            <div className="text-xs text-[var(--color-text-tertiary)]">Permet la communication avec l'extension</div>
          </div>
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-full ${
              status?.running
                ? 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                : 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400'
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full ${status?.running ? 'bg-green-500' : 'bg-red-500'}`} />
              {status?.running ? 'Actif' : 'Inactif'}
            </span>
            {status?.running && (
              <span className="text-xs text-[var(--color-text-tertiary)]">
                {status.connectedClients} connecte{status.connectedClients !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>

        {/* Port */}
        <div className="px-6 py-4 flex items-center justify-between gap-4 transition-colors hover:bg-[var(--color-surface-hover)]">
          <div>
            <div className="text-sm font-medium text-[var(--color-text-primary)]">Port</div>
            <div className="text-xs text-[var(--color-text-tertiary)]">Port d'ecoute du serveur WebSocket (defaut: 28080)</div>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1024}
              max={65535}
              value={portInput}
              onChange={(e) => setPortInput(e.target.value)}
              className="w-24 px-3 py-1.5 text-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-400)]"
            />
            <button
              onClick={handleChangePort}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-[var(--color-primary-50)] text-[var(--color-primary-600)] hover:bg-[var(--color-primary-100)] transition-colors"
            >
              Appliquer
            </button>
          </div>
        </div>

        {/* Pairing */}
        <div className="px-6 py-4 flex flex-col gap-3 transition-colors hover:bg-[var(--color-surface-hover)]">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-[var(--color-text-primary)]">Association</div>
              <div className="text-xs text-[var(--color-text-tertiary)]">Generez un code pour associer une extension navigateur</div>
            </div>
            <button
              onClick={handleGeneratePairingCode}
              disabled={loading || pairingCountdown > 0}
              className="px-4 py-1.5 text-xs font-medium rounded-lg bg-[var(--color-primary-500)] text-white hover:bg-[var(--color-primary-600)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? 'Generation...' : 'Generer un code'}
            </button>
          </div>

          {pairingCode && (
            <div className="flex items-center gap-3 p-3 rounded-lg bg-[var(--color-primary-50)] border border-[var(--color-primary-200)]">
              <span className="font-mono text-2xl font-bold tracking-widest text-[var(--color-primary-700)]">
                {pairingCode.slice(0, 3)} {pairingCode.slice(3)}
              </span>
              <button
                onClick={handleCopyCode}
                className="p-1.5 rounded-md hover:bg-[var(--color-primary-100)] text-[var(--color-primary-600)] transition-colors"
                title="Copier le code"
              >
                <CopyIcon />
              </button>
              <span className="ml-auto text-xs text-[var(--color-primary-600)]">
                Expire dans {pairingCountdown}s
              </span>
            </div>
          )}
        </div>

        {/* Paired clients list */}
        <div className="px-6 py-4 flex flex-col gap-3">
          <div className="text-sm font-medium text-[var(--color-text-primary)]">
            Clients appaires ({status?.pairedClients?.length || 0})
          </div>

          {(!status?.pairedClients || status.pairedClients.length === 0) ? (
            <p className="text-xs text-[var(--color-text-tertiary)]">
              Aucune extension associee. Generez un code d'association pour connecter votre navigateur.
            </p>
          ) : (
            <div className="space-y-2">
              {status.pairedClients.map((client) => (
                <div
                  key={client.id}
                  className="flex items-center justify-between gap-3 p-3 rounded-lg bg-[var(--color-background-secondary)] border border-[var(--color-border-light)]"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${client.connected ? 'bg-green-500' : 'bg-gray-400'}`} />
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-[var(--color-text-primary)] truncate">{client.name}</div>
                      <div className="text-xs text-[var(--color-text-tertiary)]">
                        Appaire le {formatDate(client.pairedAt)} - Vu le {formatDate(client.lastSeen)}
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => handleRemoveClient(client.id)}
                    className="flex-shrink-0 p-1.5 rounded-md text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                    title="Supprimer l'association"
                  >
                    <TrashIcon />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ExtensionSettings;
