/**
 * ManageDevicesModal — List and revoke devices + pairing buttons
 */

import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import Modal, { ModalBody, ModalFooter } from '../ui/Modal/Modal';
import * as authApi from '../../../services/auth/authApi';
import PairingInitiateModal from './PairingInitiateModal';
import PairingJoinModal from './PairingJoinModal';

interface Device {
  id: string;
  name: string;
  os: string;
  lastSeenAt: string;
  createdAt: string;
  /** Une session est-elle ENCORE ouverte depuis cet appareil ? */
  hasActiveSession?: boolean;
  /** Derniere activite (rotation du jeton) ; null sans session. */
  lastActiveAt?: string | null;
  /** Session vivante mais muette depuis 30 jours, ou plus de session du tout. */
  dormant?: boolean;
}

interface ManageDevicesModalProps {
  isOpen: boolean;
  onClose: () => void;
  profileId: string;
}

function getOsIcon(os: string): string {
  const lower = os.toLowerCase();
  if (lower.includes('windows')) return '\uD83E\uDE9F'; // 🪟
  if (lower.includes('mac') || lower.includes('darwin')) return '\uD83C\uDF4E'; // 🍎
  if (lower.includes('linux')) return '\uD83D\uDC27'; // 🐧
  return '\uD83D\uDCBB'; // 💻
}

function formatRelativeTime(dateStr: string, lang: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return lang === 'fr' ? "À l'instant" : 'Just now';
  if (minutes < 60) return lang === 'fr' ? `Il y a ${minutes}min` : `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return lang === 'fr' ? `Il y a ${hours}h` : `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return lang === 'fr' ? `Il y a ${days}j` : `${days}d ago`;
}

const ManageDevicesModal: React.FC<ManageDevicesModalProps> = ({ isOpen, onClose, profileId }) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language?.startsWith('fr') ? 'fr' : 'en';

  const [devices, setDevices] = useState<Device[]>([]);
  /**
   * L'identifiant de CET appareil, remonté par le processus principal
   * (`.device_id`). Sans lui, l'écran DEVINAIT — il prenait le premier de la
   * liste, donc le dernier vu — et se trompait dès que cette machine n'était pas
   * la plus récemment active : on lisait « Cet appareil » sur la machine de
   * quelqu'un d'autre, et le bouton « Révoquer » manquait précisément là où il
   * aurait servi.
   */
  const [currentDeviceId, setCurrentDeviceId] = useState<string | null>(null);
  /** Sessions vivantes, appareils dédoublonnés. */
  const [activeCount, setActiveCount] = useState(0);
  /** Plafond du palier, ou 0 = illimité (la jauge n'est alors pas affichée). */
  const [cap, setCap] = useState(0);
  const [loading, setLoading] = useState(true);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [revokingDormant, setRevokingDormant] = useState(false);
  const [showInitiate, setShowInitiate] = useState(false);
  const [showJoin, setShowJoin] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    authApi.getDevices().then((result) => {
      const data = result.data as
        | { devices?: Device[]; activeCount?: number; cap?: number; currentDeviceId?: string }
        | undefined;
      if (result.success && data?.devices) {
        setDevices(data.devices);
        setActiveCount(data.activeCount ?? 0);
        setCap(data.cap ?? 0);
        setCurrentDeviceId(data.currentDeviceId ?? null);
      }
      setLoading(false);
    });
  }, [isOpen]);

  const dormantCount = devices.filter((d) => d.dormant && d.id !== currentDeviceId).length;

  /*
    LE GESTE QUI RANGE. Quatorze lignes « Connecte » pour trois machines : chaque
    ancien profil, chaque navigateur vide, chaque reinstallation garde une
    session vivante pendant 90 jours. Les fermer une par une, c'est quatorze
    clics pour retrouver la verite. Le serveur ne touche jamais a l'appareil
    d'ou l'on clique.
  */
  const handleRevokeDormant = async () => {
    setRevokingDormant(true);
    try {
      const result = await authApi.revokeDormantDevices();
      if (result.success) {
        const refreshed = await authApi.getDevices();
        const data = refreshed.data as
          | { devices?: Device[]; activeCount?: number; cap?: number; currentDeviceId?: string }
          | undefined;
        if (refreshed.success && data?.devices) {
          setDevices(data.devices);
          setActiveCount(data.activeCount ?? 0);
        }
      }
    } finally {
      setRevokingDormant(false);
    }
  };

  const handleRevoke = async (deviceId: string) => {
    setRevoking(deviceId);
    const result = await authApi.deleteDevice(deviceId);
    if (result.success) {
      setDevices((prev) => prev.filter((d) => d.id !== deviceId));
    }
    setRevoking(null);
  };

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title={t('settings.devices.title', 'Appareils connectés')}
        size="md"
      >
        <ModalBody>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <svg
                className="animate-spin w-6 h-6"
                style={{ color: 'var(--color-primary-600)' }}
                viewBox="0 0 24 24"
                fill="none"
              >
                <circle
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                  opacity="0.25"
                />
                <path
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  opacity="0.75"
                />
              </svg>
            </div>
          ) : devices.length === 0 ? (
            <p className="text-sm text-center py-8" style={{ color: 'var(--color-text-tertiary)' }}>
              {t('settings.devices.empty', 'Aucun appareil connecté.')}
            </p>
          ) : (
            <div className="space-y-2">
              {/*
                LA JAUGE N'APPARAÎT QUE SI UN PLAFOND EXISTE (`cap > 0`).
                Sans politique posée par l'exploitant, afficher « 4 sur ∞ »
                n'apprendrait rien et laisserait croire à une limite qui n'existe
                pas — la pire façon de parler d'une règle : en l'inventant.
              */}
              {cap > 0 && (
                <div
                  className="p-4 rounded-lg mb-3"
                  style={{
                    backgroundColor: 'var(--color-background-secondary)',
                    border: '1px solid var(--color-border)',
                  }}
                >
                  <div className="flex items-baseline justify-between gap-4">
                    <div className="flex items-baseline gap-2">
                      <span
                        className="text-2xl font-semibold"
                        style={{ color: 'var(--color-text-primary)' }}
                      >
                        {activeCount}
                      </span>
                      <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                        {t('settings.devices.gauge', 'appareils actifs sur {{cap}}', { cap })}
                      </span>
                    </div>
                  </div>
                  <div className="mt-3 flex gap-1.5">
                    {Array.from({ length: cap }).map((_, i) => (
                      <div
                        key={i}
                        className="h-1.5 flex-1 rounded-full"
                        style={{
                          backgroundColor:
                            i < activeCount ? 'var(--color-primary-300)' : 'var(--color-border)',
                        }}
                      />
                    ))}
                  </div>
                </div>
              )}
              {devices.map((device) => (
                <div
                  key={device.id}
                  className="flex items-center gap-3 p-3 rounded-lg"
                  style={{ backgroundColor: 'var(--color-background-secondary)' }}
                >
                  <span className="text-xl">{getOsIcon(device.os)}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p
                        className="text-sm font-medium truncate"
                        style={{ color: 'var(--color-text-primary)' }}
                      >
                        {device.name}
                      </p>
                      {currentDeviceId === device.id && (
                        <span
                          className="text-xs px-2 py-0.5 rounded-full shrink-0"
                          style={{
                            backgroundColor:
                              'color-mix(in srgb, var(--color-success-500) 14%, transparent)',
                            color: 'var(--color-success-on-background)',
                          }}
                        >
                          {t('settings.devices.current', 'Cet appareil')}
                        </span>
                      )}
                      {/*
                        « Connecté » dit le PRÉSENT. La liste est un historique :
                        sans ce badge, elle montrait des appareils déconnectés
                        depuis des mois à côté de ceux qui travaillent, et le
                        geste qu'elle propose — déconnecter — n'a de sens que sur
                        les seconds.
                      */}
                      {device.hasActiveSession &&
                        !device.dormant &&
                        currentDeviceId !== device.id && (
                          <span
                            className="text-xs px-2 py-0.5 rounded-full shrink-0"
                            style={{
                              backgroundColor:
                                'color-mix(in srgb, var(--color-info-500) 14%, transparent)',
                              color: 'var(--color-info-on-background)',
                            }}
                          >
                            {t('settings.devices.connected', 'Connecté')}
                          </span>
                        )}
                      {/*
                        « Connecte » disait le jeton, pas l'usage : un portable ferme
                        depuis trois semaines garde une session vivante 90 jours. Ici
                        c'est la derniere ROTATION qui parle — au-dela de 30 jours,
                        l'appareil est inactif, et il se lit comme tel.
                      */}
                      {device.dormant && currentDeviceId !== device.id && (
                        <span
                          className="text-xs px-2 py-0.5 rounded-full shrink-0"
                          style={{
                            backgroundColor: 'var(--color-background-tertiary)',
                            color: 'var(--color-text-tertiary)',
                          }}
                        >
                          {device.lastActiveAt
                            ? t('settings.devices.dormant', 'Inactif depuis {{days}} j', {
                                days: Math.max(
                                  1,
                                  Math.floor(
                                    (Date.now() - new Date(device.lastActiveAt).getTime()) /
                                      86_400_000
                                  )
                                ),
                              })
                            : t('settings.devices.noSession', 'Aucune session')}
                        </span>
                      )}
                    </div>
                    <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                      {device.os} &middot;{' '}
                      {device.lastActiveAt
                        ? t('settings.devices.lastActive', 'actif {{when}}', {
                            when: formatRelativeTime(device.lastActiveAt, lang).toLowerCase(),
                          })
                        : t('settings.devices.lastLogin', 'connexion {{when}}', {
                            when: formatRelativeTime(device.lastSeenAt, lang).toLowerCase(),
                          })}
                    </p>
                  </div>
                  {currentDeviceId !== device.id && (
                    <button
                      onClick={() => handleRevoke(device.id)}
                      disabled={revoking === device.id}
                      className="px-3 py-1.5 text-xs font-medium rounded-lg shrink-0"
                      style={{
                        border: '1px solid #fca5a5',
                        color: '#dc2626',
                        backgroundColor: 'transparent',
                        cursor: revoking === device.id ? 'not-allowed' : 'pointer',
                        opacity: revoking === device.id ? 0.5 : 1,
                      }}
                    >
                      {revoking === device.id
                        ? t('settings.devices.revoking', 'Révocation...')
                        : t('settings.devices.revoke', 'Révoquer')}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </ModalBody>

        <ModalFooter>
          {dormantCount > 0 && (
            <button
              onClick={handleRevokeDormant}
              disabled={revokingDormant}
              className="w-full mb-2 px-4 py-2 text-sm font-medium rounded-lg"
              style={{
                border: '1px solid var(--color-border)',
                color: 'var(--color-text-primary)',
                backgroundColor: 'transparent',
                cursor: revokingDormant ? 'wait' : 'pointer',
                opacity: revokingDormant ? 0.6 : 1,
              }}
            >
              {t('settings.devices.revokeDormant', 'Déconnecter les {{count}} appareils inactifs', {
                count: dormantCount,
              })}
            </button>
          )}
          <div className="flex gap-2 w-full">
            <button
              onClick={() => setShowInitiate(true)}
              className="flex-1 px-4 py-2 text-sm font-medium rounded-lg text-white"
              style={{ backgroundColor: 'var(--color-primary-600)', cursor: 'pointer' }}
            >
              {t('settings.devices.pairNew', 'Jumeler un nouvel appareil')}
            </button>
            <button
              onClick={() => setShowJoin(true)}
              className="flex-1 px-4 py-2 text-sm font-medium rounded-lg"
              style={{
                border: '1px solid var(--color-border)',
                color: 'var(--color-text-primary)',
                backgroundColor: 'transparent',
                cursor: 'pointer',
              }}
            >
              {t('settings.devices.joinDevice', 'Rejoindre depuis un autre appareil')}
            </button>
          </div>
        </ModalFooter>
      </Modal>

      <PairingInitiateModal
        isOpen={showInitiate}
        onClose={() => setShowInitiate(false)}
        profileId={profileId}
      />
      <PairingJoinModal
        isOpen={showJoin}
        onClose={() => setShowJoin(false)}
        profileId={profileId}
      />
    </>
  );
};

export default ManageDevicesModal;
