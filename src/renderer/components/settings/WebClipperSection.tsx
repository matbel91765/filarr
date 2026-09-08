/**
 * Web Clipper Settings Section (roadmap #9)
 *
 * Controls the local loopback bridge (electron/clipperBridge.ts):
 *  - enable/disable toggle (persisted via the `clipper-enabled` flag)
 *  - one-time browser pairing with a 6-digit code (60s TTL)
 *  - list / remove paired browsers
 *  - Free-tier usage display (50 clips/month, Solo+ unlimited)
 */

import { FC, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { Toggle } from '../ui/Toggle/Toggle';
import { Button } from '../ui/Button/Button';
import { selectClipperUnlimited } from '../../../store/selectors/authSelectors';
import { getClipUsage, CLIPPER_FREE_MONTHLY_LIMIT } from '../../../services/clipper/clipReceiver';

interface ClipperStatus {
  running: boolean;
  enabled: boolean;
  port: number;
  pairedCount: number;
}

interface PairedClient {
  id: string;
  name: string;
  pairedAt: string;
  lastSeen: string;
  connected: boolean;
}

const PAIRING_CODE_TTL_S = 60;

const WebClipperSection: FC = () => {
  const { t } = useTranslation();
  const unlimited = useSelector(selectClipperUnlimited);

  const [status, setStatus] = useState<ClipperStatus | null>(null);
  const [clients, setClients] = useState<PairedClient[]>([]);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [codeSecondsLeft, setCodeSecondsLeft] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [clipCount, setClipCount] = useState(0);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const ipc = window.electron?.ipcRenderer;

  const refresh = useCallback(async () => {
    if (!ipc) return;
    try {
      const [s, c] = await Promise.all([
        ipc.invoke('clipper:getStatus'),
        ipc.invoke('clipper:listClients'),
      ]);
      setStatus(s as ClipperStatus);
      setClients(Array.isArray(c) ? (c as PairedClient[]) : []);
      setClipCount(getClipUsage().count);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [ipc]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // A successful pairing hides the code and refreshes the client list.
  useEffect(() => {
    if (!ipc) return;
    const handler = () => {
      setPairingCode(null);
      if (countdownRef.current) clearInterval(countdownRef.current);
      refresh();
    };
    ipc.on('clipper:clientPaired', handler);
    return () => {
      ipc.removeListener('clipper:clientPaired', handler);
    };
  }, [ipc, refresh]);

  useEffect(
    () => () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
    },
    []
  );

  const handleToggle = async (next: boolean) => {
    if (!ipc) return;
    setError(null);
    try {
      const s = (await ipc.invoke('clipper:setEnabled', next)) as ClipperStatus;
      setStatus(s);
      await ipc.invoke('flag:set', 'clipper-enabled', next ? 'true' : '');
      if (!next) {
        setPairingCode(null);
        if (countdownRef.current) clearInterval(countdownRef.current);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleGenerateCode = async () => {
    if (!ipc) return;
    setError(null);
    try {
      const { code } = (await ipc.invoke('clipper:generatePairingCode')) as { code: string };
      setPairingCode(code);
      setCodeSecondsLeft(PAIRING_CODE_TTL_S);
      if (countdownRef.current) clearInterval(countdownRef.current);
      countdownRef.current = setInterval(() => {
        setCodeSecondsLeft((s) => {
          if (s <= 1) {
            if (countdownRef.current) clearInterval(countdownRef.current);
            setPairingCode(null);
            return 0;
          }
          return s - 1;
        });
      }, 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleRemoveClient = async (clientId: string) => {
    if (!ipc) return;
    if (!confirm(t('settings.webClipper.confirmRemove', 'Dissocier ce navigateur ?') as string))
      return;
    try {
      await ipc.invoke('clipper:removeClient', clientId);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const running = status?.running ?? false;

  return (
    <div className="divide-y divide-[var(--color-border-light)]">
      {error && <div className="px-6 py-3 text-xs text-red-600 bg-red-50">{error}</div>}

      {/* Enable toggle + usage */}
      <div className="px-6 py-4 flex items-center justify-between gap-4">
        <div>
          <div className="text-sm font-medium text-[var(--color-text-primary)]">
            {t('settings.webClipper.enable', 'Activer le Web Clipper')}
          </div>
          <div className="text-xs text-[var(--color-text-tertiary)] mt-0.5">
            {running
              ? t('settings.webClipper.statusRunning', 'Pont local actif sur 127.0.0.1:{{port}}', {
                  port: status?.port,
                })
              : t('settings.webClipper.statusStopped', 'Pont local désactivé')}
            {' · '}
            {unlimited
              ? t('settings.webClipper.unlimitedNote', 'Clips illimités (plan Solo/Pro).')
              : t(
                  'settings.webClipper.clipsThisMonth',
                  '{{count}}/{{limit}} clips ce mois-ci (plan Free)',
                  {
                    count: clipCount,
                    limit: CLIPPER_FREE_MONTHLY_LIMIT,
                  }
                )}
          </div>
        </div>
        <Toggle checked={running} onChange={(e) => handleToggle(e.target.checked)} size="md" />
      </div>

      {/* Pairing */}
      {running && (
        <div className="px-6 py-4">
          {pairingCode ? (
            <div className="flex flex-col items-center gap-1 py-3 rounded-lg bg-[var(--color-background-secondary)]">
              <div className="text-2xl font-bold tracking-[0.4em] text-[var(--color-primary-500)]">
                {pairingCode}
              </div>
              <div className="text-xs text-[var(--color-text-tertiary)]">
                {t(
                  'settings.webClipper.codeExpires',
                  'Expire dans {{s}}s — saisissez ce code dans l’extension',
                  { s: codeSecondsLeft }
                )}
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-4">
              <p className="text-xs text-[var(--color-text-tertiary)] flex-1">
                {t(
                  'settings.webClipper.pairHint',
                  'Installez l’extension Filarr Web Clipper, puis associez votre navigateur avec un code unique.'
                )}
              </p>
              <Button variant="secondary" size="sm" onClick={handleGenerateCode}>
                {t('settings.webClipper.pairBrowser', 'Associer un navigateur')}
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Paired browsers */}
      {clients.length > 0 && (
        <div className="px-6 py-4">
          <div className="text-xs font-medium text-[var(--color-text-secondary)] mb-2">
            {t('settings.webClipper.pairedBrowsers', 'Navigateurs associés')}
          </div>
          <div className="space-y-2">
            {clients.map((c) => (
              <div
                key={c.id}
                className="flex items-center justify-between gap-4 rounded-lg px-3 py-2 bg-[var(--color-background-secondary)]"
              >
                <div>
                  <div className="text-sm text-[var(--color-text-primary)]">
                    {c.name}
                    {c.connected && (
                      <span className="ml-2 text-xs text-emerald-500">
                        ● {t('settings.webClipper.connected', 'connecté')}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-[var(--color-text-tertiary)]">
                    {t('settings.webClipper.lastSeen', 'Dernière activité : {{date}}', {
                      date: new Date(c.lastSeen).toLocaleString(),
                    })}
                  </div>
                </div>
                <Button variant="danger" size="sm" onClick={() => handleRemoveClient(c.id)}>
                  {t('settings.webClipper.remove', 'Dissocier')}
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default WebClipperSection;
