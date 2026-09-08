/**
 * MemberTrustModal (F11) — le numéro de sécurité d'un membre, son histoire, et
 * le seul geste qui transforme « vu » en « vérifié ».
 *
 * LA CÉRÉMONIE EST SYMÉTRIQUE, ET C'EST TOUT L'INTÉRÊT. La carte « Vous » (F15)
 * montre à chacun SON propre numéro ; cette boîte montre celui de l'autre. Les
 * deux se lisent à voix haute, par blocs de quatre, et c'est la comparaison qui
 * fait la vérification — pas le bouton. Le bouton ne fait qu'en garder la trace.
 *
 * « J'AI COMPARÉ CE NUMÉRO » APPELLE LA MÊME PRIMITIVE QUE L'INVITATION :
 * `acceptPeerKeyChange`, plus une marque locale datée. C'est voulu — deux
 * chemins vers la même décision de sécurité, avec deux mémoires différentes,
 * finiraient par ne plus dire la même chose ; l'un des deux serait alors le
 * moins surveillé, donc le plus permissif.
 *
 * DEUX REFUS NE SE LÈVENT PAS D'ICI. Une chaîne qui ne recalcule pas et une clé
 * servie qui n'est pas la dernière du journal sont des preuves côté SERVEUR :
 * aucune case cochée sur cet appareil ne les efface (c'est déjà la règle
 * d'`isBlockedStatus` dans la cérémonie d'invitation). Le bouton disparaît donc,
 * et une phrase dit pourquoi et quoi faire à la place.
 *
 * L'HISTORIQUE DIT CE QU'IL EST, ET RIEN DE PLUS. Une chaîne de hachages légère
 * et une confiance à la première rencontre — pas un journal Merkle audité
 * (CONIKS). Le texte de l'écran l'écrit noir sur blanc : promettre davantage
 * serait pire que de ne rien montrer.
 *
 * RIEN ICI N'EST SECRET : une empreinte est un condensé de clé PUBLIQUE, c'est
 * exactement ce qu'on est censé lire à voix haute.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Avatar, Button, Modal } from '../../ui';
import { useNotification } from '../../ui/Notification';
import {
  RelativeTime,
  StatusBadge,
  type BadgeTone,
} from '../../settings/enterprise/AdminPrimitives';
import { formatFingerprint } from '../../../utils/formatFingerprint';
import { apiGetKeyLog } from '../../../../services/vault/vaultApi';
import { verifyKeyLogChain, type KeyLogEntry } from '../../../../services/vault/keyTransparency';
import type { MemberTrustState, MemberTrustVerdict } from './memberTrustModel';

/** Le ton de chaque état — aucun n'est neutre par hasard. */
export const TRUST_TONE: Record<MemberTrustState, BadgeTone> = {
  verified: 'success',
  seen: 'neutral',
  changed: 'error',
  unpublished: 'warning',
  unknown: 'info',
};

interface Props {
  /** `null` ferme la boîte — l'hôte n'a qu'un état à tenir. */
  member: { userId: string; label: string } | null;
  verdict: MemberTrustVerdict | null;
  onClose: () => void;
  /** Poser la marque locale ET ré-épingler, pour CETTE empreinte. */
  onConfirm: (userId: string, fingerprint: string) => void;
}

/** Le journal, tel qu'on a su le lire — trois états, jamais confondus. */
type LogState =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'ok'; entries: KeyLogEntry[]; chainValid: boolean };

/** Le numéro, en blocs séparés : on le dicte bloc par bloc sans se perdre. */
const Blocs: React.FC<{ value: string; size?: number }> = ({ value, size = 18 }) => (
  <div className="flex flex-wrap gap-1.5">
    {formatFingerprint(value)
      .split(' ')
      .map((bloc, i) => (
        <span
          key={`${bloc}-${i}`}
          className="ent-mono"
          style={{
            fontSize: size,
            letterSpacing: '0.1em',
            padding: '2px 8px',
            borderRadius: 6,
            background: 'var(--color-background-secondary)',
          }}
        >
          {bloc}
        </span>
      ))}
  </div>
);

export const MemberTrustModal: React.FC<Props> = ({ member, verdict, onClose, onConfirm }) => {
  const { t } = useTranslation();
  const { success } = useNotification();
  const [log, setLog] = useState<LogState>({ kind: 'loading' });

  /**
   * Le journal n'est lu QU'À L'OUVERTURE de cette boîte : c'est une lecture par
   * personne, et la déclencher pour tout le tableau doublerait le coût du
   * contrôle de page (§7, amplification de lecture).
   */
  const userId = member?.userId ?? null;
  useEffect(() => {
    if (!userId) return () => {};
    let vivant = true;
    setLog({ kind: 'loading' });
    void (async () => {
      try {
        const entries = await apiGetKeyLog(userId);
        const v = await verifyKeyLogChain(userId, entries);
        if (vivant) setLog({ kind: 'ok', entries, chainValid: v.valid });
      } catch {
        // `apiGetKeyLog` LÈVE sur une enveloppe malformée plutôt que de rendre
        // un journal vide : on garde donc « je n'ai pas su lire », jamais
        // « ce compte n'a pas de journal ».
        if (vivant) setLog({ kind: 'error' });
      }
    })();
    return () => {
      vivant = false;
    };
  }, [userId]);

  const confirmer = useCallback(() => {
    if (!member || !verdict?.fingerprint) return;
    onConfirm(member.userId, verdict.fingerprint);
    success(t('teamVaults.settings.trust.modal.compared'));
    onClose();
  }, [member, verdict, onConfirm, success, t, onClose]);

  if (!member || !verdict) return null;

  // Les deux verdicts qu'aucune comparaison ne lève (voir l'en-tête).
  const bloqué = verdict.reason === 'chain_broken' || verdict.reason === 'served_not_latest';

  return (
    <Modal
      isOpen={!!member}
      onClose={onClose}
      title={t('teamVaults.settings.trust.modal.title', { name: member.label })}
      size="lg"
    >
      <div style={{ padding: 'var(--spacing-4)' }} className="flex flex-col gap-4">
        <div className="flex items-center gap-2 min-w-0">
          <Avatar label={member.label} seed={member.userId} size="sm" title={null} />
          <span className="truncate text-sm text-[var(--color-text-primary)]">{member.label}</span>
          <StatusBadge tone={TRUST_TONE[verdict.state]} dot>
            {t(`teamVaults.settings.trust.state.${verdict.state}`)}
          </StatusBadge>
        </div>

        {/* POURQUOI cet état, en une phrase — le badge seul ne se vérifie
            contre rien, et deux causes très différentes (une clé qui tourne, un
            journal réécrit) n'appellent pas la même réaction. */}
        <p className="text-sm text-[var(--color-text-secondary)] m-0">
          {t(`teamVaults.settings.trust.reason.${verdict.reason}`)}
        </p>
        {verdict.verifiedAt !== null && (
          <p className="ent-hint m-0">
            {t('teamVaults.settings.trust.verifiedOn', {
              date: new Date(verdict.verifiedAt).toLocaleDateString(),
            })}
          </p>
        )}

        {verdict.fingerprint ? (
          <div>
            <p className="text-sm m-0 mb-2 text-[var(--color-text-secondary)]">
              {t('teamVaults.settings.trust.modal.hint')}
            </p>
            <p className="text-[10px] uppercase tracking-wide text-[var(--color-text-tertiary)] m-0 mb-1">
              {t('teamVaults.settings.trust.modal.current')}
            </p>
            <Blocs value={verdict.fingerprint} />
            {/* LE NUMÉRO D'AVANT, quand il diffère : « la clé a changé » ne se
                vérifie contre rien si on ne montre pas de quoi vers quoi. */}
            {verdict.previousFingerprint && (
              <div style={{ marginTop: 'var(--spacing-3)' }}>
                <p className="text-[10px] uppercase tracking-wide text-[var(--color-text-tertiary)] m-0 mb-1">
                  {t('teamVaults.settings.trust.modal.previous')}
                </p>
                <Blocs value={verdict.previousFingerprint} size={13} />
              </div>
            )}
          </div>
        ) : (
          <p className="ent-hint m-0">{t('teamVaults.settings.trust.modal.nothing')}</p>
        )}

        {bloqué ? (
          <p
            className="text-sm m-0"
            style={{ color: 'var(--color-error-500, #ef4444)' }}
            role="alert"
          >
            {t('teamVaults.settings.trust.modal.blocked')}
          </p>
        ) : (
          verdict.fingerprint && (
            <div>
              <Button variant="primary" size="sm" onClick={confirmer}>
                {t('teamVaults.settings.trust.modal.compare')}
              </Button>
              {/* « Sur cet appareil » n'est pas une excuse, c'est la raison :
                  une marque rangée dans le coffre serait écrite par n'importe
                  quel administrateur, sans signature. */}
              <p className="ent-hint m-0" style={{ marginTop: 'var(--spacing-2)' }}>
                {t('teamVaults.settings.trust.localOnly')}
              </p>
            </div>
          )
        )}

        {/* ── L'historique de clé ─────────────────────────────────────────── */}
        <div>
          <p className="text-sm font-medium m-0">{t('teamVaults.settings.trust.history.title')}</p>
          <p className="ent-hint m-0 mb-2">{t('teamVaults.settings.trust.history.hint')}</p>

          {log.kind === 'loading' && (
            <p className="ent-hint m-0">{t('teamVaults.settings.trust.checking')}</p>
          )}
          {log.kind === 'error' && (
            <p className="ent-hint m-0">{t('teamVaults.settings.trust.history.error')}</p>
          )}
          {log.kind === 'ok' && log.entries.length === 0 && (
            <p className="ent-hint m-0">{t('teamVaults.settings.trust.history.empty')}</p>
          )}
          {log.kind === 'ok' && log.entries.length > 0 && (
            <>
              <div className="mb-2">
                <StatusBadge tone={log.chainValid ? 'success' : 'error'} dot>
                  {t(
                    log.chainValid
                      ? 'teamVaults.settings.trust.history.chainOk'
                      : 'teamVaults.settings.trust.history.chainBroken'
                  )}
                </StatusBadge>
                {/* La clé servie n'est pas la dernière entrée : c'est le
                    verdict du contrôle, redit ICI où l'on voit les entrées. */}
                {verdict.reason === 'served_not_latest' && (
                  <span style={{ marginLeft: 6 }}>
                    <StatusBadge tone="error">
                      {t('teamVaults.settings.trust.history.notLatest')}
                    </StatusBadge>
                  </span>
                )}
              </div>
              <ul className="list-none m-0 p-0 flex flex-col gap-2">
                {/* La plus récente en tête : c'est celle qui décide de ce qui
                    est scellé aujourd'hui. */}
                {[...log.entries].reverse().map((e, i) => {
                  const ms = Date.parse(e.createdAt);
                  return (
                    <li
                      key={e.entryHash}
                      className="flex flex-col gap-1 pb-2 border-b border-[var(--color-border)] last:border-0"
                    >
                      <div className="flex items-center gap-2 flex-wrap">
                        {Number.isNaN(ms) ? (
                          <span className="ent-hint">—</span>
                        ) : (
                          <RelativeTime ms={ms} />
                        )}
                        {i === 0 && (
                          <StatusBadge tone="info">
                            {t('teamVaults.settings.trust.history.latest')}
                          </StatusBadge>
                        )}
                        {verdict.fingerprint === e.fingerprint && (
                          <StatusBadge tone="success">
                            {t('teamVaults.settings.trust.history.served')}
                          </StatusBadge>
                        )}
                      </div>
                      <span className="ent-mono text-xs break-all">
                        {formatFingerprint(e.fingerprint)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
};

export default MemberTrustModal;
