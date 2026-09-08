/**
 * DeviceLimitDialog — « trop d'appareils actifs », et le choix qui va avec.
 *
 * ═══ POURQUOI CET ÉCRAN EXISTE ═══
 *
 * Le serveur peut refuser une connexion quand le palier est atteint. Sans cet
 * écran, ce refus arrivait sous forme de message d'erreur brut : l'utilisateur
 * voyait « Too many active devices » et n'avait AUCUN moyen d'agir — la
 * connexion venait d'échouer, donc il n'existait aucune session avec laquelle
 * aller déconnecter quoi que ce soit dans les réglages.
 *
 * Un refus qui ne dit pas quoi faire est indiscernable d'une panne.
 *
 * ═══ COMMENT LE GESTE SE FAIT ═══
 *
 * L'appareil choisi repart DANS la connexion (`revokeDeviceId`), qu'on rejoue
 * avec le même mot de passe. Le serveur le revérifie : l'autorisation est donc
 * prouvée au moins aussi bien qu'avec un jeton d'accès, sans avoir à inventer un
 * jeton de révocation à usage unique.
 *
 * ═══ CE QUE L'ÉCRAN NE FAIT PAS ═══
 *
 * Il ne culpabilise personne et n'accuse pas de fraude. Bureau, portable, web,
 * téléphone et une réinstallation font cinq sessions chez quelqu'un de
 * parfaitement seul. Il propose la sortie utile — déconnecter le plus inactif —
 * et mentionne les coffres partagés pour ceux que ça concerne vraiment.
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

import Modal, { ModalBody, ModalFooter } from '../ui/Modal/Modal';
import type { DeviceLimitSession } from '../../../services/auth/authApi';

interface Props {
  isOpen: boolean;
  cap: number;
  /** Sessions vivantes, la plus INACTIVE en tête (le serveur les trie). */
  sessions: DeviceLimitSession[];
  busy?: boolean;
  onCancel: () => void;
  /** Rejoue la connexion en déconnectant cet appareil-là. */
  onConfirm: (deviceId: string) => void;
}

function ilYA(iso: string | null, lang: string): string {
  if (!iso) return lang === 'fr' ? 'jamais utilisé' : 'never used';
  const diff = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(diff)) return '—';
  const min = Math.floor(diff / 60000);
  if (min < 60) return lang === 'fr' ? `inactif depuis ${min} min` : `idle for ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return lang === 'fr' ? `inactif depuis ${h} h` : `idle for ${h} h`;
  const j = Math.floor(h / 24);
  return lang === 'fr' ? `inactif depuis ${j} j` : `idle for ${j} d`;
}

export const DeviceLimitDialog: React.FC<Props> = ({
  isOpen,
  cap,
  sessions,
  busy,
  onCancel,
  onConfirm,
}) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language?.startsWith('fr') ? 'fr' : 'en';
  /**
   * Le premier est PRÉ-SÉLECTIONNÉ parce que le serveur trie par inactivité :
   * c'est celui qu'on déconnecte le plus volontiers, et il évite de faire lire
   * toute la liste à quelqu'un qui voulait juste se connecter.
   */
  const [choisi, setChoisi] = useState<string | null>(sessions[0]?.deviceId ?? null);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onCancel}
      title={t('auth.deviceLimit.title', 'Trop d’appareils actifs')}
      size="md"
    >
      <ModalBody>
        <p className="text-sm" style={{ color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>
          {t(
            'auth.deviceLimit.body',
            'Votre palier autorise {{cap}} appareils connectés en même temps. Choisissez celui à déconnecter pour continuer sur celui-ci.',
            { cap }
          )}
        </p>

        <div className="mt-4 space-y-2">
          {sessions.map((s) => {
            const actif = choisi === s.deviceId;
            return (
              <button
                key={s.deviceId}
                type="button"
                onClick={() => setChoisi(s.deviceId)}
                className="w-full flex items-center gap-3 p-3 rounded-lg text-left"
                style={{
                  backgroundColor: actif
                    ? 'var(--color-background-tertiary)'
                    : 'var(--color-background-secondary)',
                  border: `1px solid ${actif ? 'var(--color-primary-600)' : 'var(--color-border)'}`,
                  cursor: 'pointer',
                }}
              >
                <span
                  className="shrink-0 rounded-full flex items-center justify-center"
                  style={{
                    width: 18,
                    height: 18,
                    border: `1.5px solid ${actif ? 'var(--color-primary-300)' : 'var(--color-border-strong)'}`,
                  }}
                >
                  {actif && (
                    <span
                      style={{
                        width: 9,
                        height: 9,
                        borderRadius: 9999,
                        backgroundColor: 'var(--color-primary-300)',
                      }}
                    />
                  )}
                </span>
                <span className="flex-1 min-w-0">
                  <span
                    className="block text-sm font-medium truncate"
                    style={{ color: 'var(--color-text-primary)' }}
                  >
                    {s.name || t('auth.deviceLimit.unnamed', 'Appareil sans nom')}
                  </span>
                  <span className="block text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                    {[s.os, ilYA(s.lastUsedAt, lang)].filter(Boolean).join(' · ')}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        {/*
          Ceux que ce plafond gêne vraiment sont ceux qui partagent un compte à
          plusieurs. On le dit ici, une fois, sans accuser personne : la plupart
          des gens qui arrivent sur cet écran ont simplement beaucoup d'appareils.
        */}
        <div
          className="mt-4 p-3 rounded-lg"
          style={{
            backgroundColor: 'var(--color-background-secondary)',
            border: '1px solid var(--color-border)',
          }}
        >
          <p className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
            {t('auth.deviceLimit.teamTitle', 'Vous travaillez à plusieurs sur ce compte ?')}
          </p>
          <p
            className="text-sm mt-1"
            style={{ color: 'var(--color-text-secondary)', lineHeight: 1.6 }}
          >
            {t(
              'auth.deviceLimit.teamBody',
              'Un coffre partagé donne à chacun son propre accès, révocable, et montre qui a écrit quoi.'
            )}
          </p>
        </div>
      </ModalBody>

      <ModalFooter>
        <div className="flex gap-2 justify-end w-full">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium rounded-lg"
            style={{
              border: '1px solid var(--color-border)',
              color: 'var(--color-text-primary)',
              backgroundColor: 'transparent',
              cursor: 'pointer',
            }}
          >
            {t('common.cancel', 'Annuler')}
          </button>
          <button
            type="button"
            disabled={!choisi || busy}
            onClick={() => choisi && onConfirm(choisi)}
            className="px-4 py-2 text-sm font-medium rounded-lg text-white"
            style={{
              backgroundColor: 'var(--color-primary-600)',
              border: 'none',
              cursor: !choisi || busy ? 'not-allowed' : 'pointer',
              opacity: !choisi || busy ? 0.5 : 1,
            }}
          >
            {busy
              ? t('auth.deviceLimit.working', 'Déconnexion…')
              : t('auth.deviceLimit.confirm', 'Déconnecter et continuer')}
          </button>
        </div>
      </ModalFooter>
    </Modal>
  );
};

export default DeviceLimitDialog;
