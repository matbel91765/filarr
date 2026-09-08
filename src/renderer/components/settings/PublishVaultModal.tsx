/**
 * « PUBLIER CE COFFRE SUR LE COMPTE » — les six écrans.
 *
 * POURQUOI CE PARCOURS EXISTE. Un poste servi en local pendant des semaines,
 * puis relié à un compte : l'appairage réussissait, puis la garde d'adoption
 * refusait — à juste titre, car adopter la clé du compte rendrait illisibles les
 * N éléments déjà scellés. Mais le refus était un cul-de-sac : le message
 * conseillait « appaire un appareil encore vide », un geste qu'aucun bouton ne
 * permettait, et le travail restait prisonnier de l'appareil.
 *
 * LA LIGNE QUI NE DOIT JAMAIS DISPARAÎTRE DE L'ÉCRAN 3 : « Rien n'a encore
 * changé sur cet appareil. » C'est l'instant où l'utilisateur doit savoir qu'il
 * peut encore tout arrêter sans conséquence. Elle n'est pas décorative — et
 * depuis que la migration ne rescelle plus rien localement, elle est vraie à
 * TOUT instant du parcours, pas seulement là.
 *
 * CE QUE CET ÉCRAN NE DIT PLUS, ET POURQUOI. Il annonçait qu'un profil non
 * publié « deviendrait illisible ». C'était vrai de l'ancienne conception, où
 * la bascule jetait l'ancienne clé. Ce ne l'est plus : l'appareil CONSERVE son
 * ancienne clé en lecture seule, donc un profil non publié reste parfaitement
 * ouvrable — il reste seulement LOCAL. L'écran dit désormais cela, et il dit
 * aussi ce que la conservation coûte (deux clés sur l'appareil), parce qu'un
 * coût tu est un coût qu'on découvre au mauvais moment.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Modal, { ModalBody, ModalFooter } from '../ui/Modal/Modal';
import { Button } from '../ui/Button';
import { Checkbox } from '../ui/Checkbox';
import { ProgressBar } from '../ui/ProgressBar';
import {
  abandonPublishing,
  buildPublishInventory,
  commitKeySwitch,
  formatBytes,
  getPublishState,
  onPublishStateChanged,
  pausePublishing,
  retryPublishing,
  startPublishing,
  type PublishBlocker,
  type PublishSnapshot,
} from '../../../services/publish/publishBridge';

interface PublishVaultModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Compteurs remontés par la garde, pour peindre l'écran 0 sans re-scan. */
  intro?: { itemCount: number; byteCount: number };
}

const PublishVaultModal: React.FC<PublishVaultModalProps> = ({ isOpen, onClose, intro }) => {
  const { t } = useTranslation();
  const [snapshot, setSnapshot] = useState<PublishSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [abandonedIds, setAbandonedIds] = useState<string[]>([]);
  const [fullVerify, setFullVerify] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    void getPublishState().then((s) => {
      setSnapshot(s);
      if (s) setFullVerify(s.verify.full);
    });
    const offState = onPublishStateChanged((s) => setSnapshot(s));
    // L'adoption de la clé après une bascule menée SANS cet écran (reprise au
    // démarrage) n'est PAS gérée ici : elle repose sur l'écoute permanente de
    // `publish:key-adopted` installée au bootstrap du renderer
    // (`initPublishKeyAdoption` dans publishBridge). Une écoute limitée à la
    // durée de vie de cette modale raterait toute bascule achevée écran fermé.
    return () => {
      offState();
    };
  }, [isOpen]);

  const counters = snapshot?.counters;
  const percent = useMemo(() => {
    if (!counters || counters.totalItems === 0) return 0;
    return Math.round(((counters.doneItems + counters.damagedItems) / counters.totalItems) * 100);
  }, [counters]);

  const verifyPercent = useMemo(() => {
    if (!snapshot || snapshot.verify.planned === 0) return 0;
    return Math.round((snapshot.verify.ok / snapshot.verify.planned) * 100);
  }, [snapshot]);

  /** La preuve est-elle FAITE ? C'est la seule condition qui ouvre l'écran 4. */
  const proven =
    snapshot?.state === 'VERIFYING' &&
    snapshot.verify.failed.length === 0 &&
    snapshot.verify.planned > 0 &&
    snapshot.verify.ok === snapshot.verify.planned;

  const run = useCallback(async (fn: () => Promise<{ success: boolean; error?: string }>) => {
    setBusy(true);
    setError('');
    try {
      const res = await fn();
      if (!res.success) setError(res.error ?? '');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);

  const handleBuildInventory = useCallback(
    () => run(() => buildPublishInventory({ abandonedProfileIds: abandonedIds, fullVerify })),
    [run, abandonedIds, fullVerify]
  );

  /**
   * ETA arrondie. « moins d'une minute » sous 60 s, puis des minutes, puis des
   * heures : une précision à la seconde sur une opération de plusieurs heures
   * serait une précision inventée.
   */
  const etaLabel = useMemo(() => {
    const eta = snapshot?.etaSeconds;
    if (eta === null || eta === undefined) return '';
    if (eta < 60) return t('publish.eta.lessThanMinute', 'moins d’une minute');
    if (eta < 3600) {
      return t('publish.eta.minutes', '{{count}} min', { count: Math.round(eta / 60) });
    }
    return t('publish.eta.hours', '{{h}} h {{m}} min', {
      h: Math.floor(eta / 3600),
      m: Math.round((eta % 3600) / 60),
    });
  }, [snapshot, t]);

  const state = snapshot?.state;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('publish.title', 'Publier ce coffre sur le compte')}
      size="md"
    >
      <ModalBody>
        {/* ── ÉCRAN 0 : le refus, réparé ── */}
        {(!snapshot || state === 'PREPARING') && (
          <div className="py-2 space-y-3">
            <p className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>
              {t('publish.intro.heading', 'Ce coffre contient déjà tes fichiers.')}
            </p>
            <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              {t('publish.intro.body', {
                defaultValue:
                  'Cet appareil protège {{items}} éléments ({{size}}) avec sa propre clé. Adopter directement la clé de ton compte les rendrait illisibles.',
                items: intro?.itemCount ?? 0,
                size: formatBytes(intro?.byteCount ?? 0),
              })}
            </p>
            <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              {t('publish.intro.alternative', {
                defaultValue:
                  'Il y a une autre voie : publier ce coffre sur ton compte. Chaque élément est lu, rechiffré au moment de l’envoi avec la clé du compte, envoyé, vérifié — et c’est seulement ensuite que cet appareil change de clé.',
              })}
            </p>
            <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
              {t('publish.intro.safety', {
                defaultValue:
                  'Aucun fichier de cet appareil n’est modifié ni effacé pendant la publication : tu peux l’arrêter à n’importe quel moment, sans rien perdre et sans rien avoir à défaire.',
              })}
            </p>
          </div>
        )}

        {/* ── ÉCRAN 1 : l'inventaire et le devis ── */}
        {state === 'READY' && counters && (
          <div className="py-2 space-y-3">
            <p className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>
              {t('publish.inventory.heading', 'Ce qui va être publié')}
            </p>
            <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              {t('publish.inventory.summary', {
                defaultValue: '{{profiles}} profils · {{items}} éléments · {{size}}',
                profiles: snapshot.targetProfiles.length,
                items: counters.totalItems,
                size: formatBytes(counters.totalBytes),
              })}
            </p>

            <ul className="space-y-1.5">
              {snapshot.targetProfiles.map((target) => (
                <li
                  key={target.localProfileId}
                  className="flex items-center justify-between gap-3 text-xs rounded-lg px-3 py-2"
                  style={{ backgroundColor: 'var(--color-background-secondary)' }}
                >
                  <span style={{ color: 'var(--color-text-primary)' }}>
                    {target.targetName} — {target.itemCount} · {formatBytes(target.byteCount)}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setAbandonedIds((ids) => [...ids, target.localProfileId]);
                    }}
                  >
                    {t('publish.inventory.doNotPublish', 'Ne pas publier')}
                  </Button>
                </li>
              ))}
            </ul>

            {/*
              CE QUE « NE PAS PUBLIER » VEUT DIRE — dit ici, avant le choix, et
              non plus au moment de la bascule sous forme d'avertissement de
              destruction. Le profil ne disparaît pas et ne devient pas
              illisible : il reste sur cet appareil, et lui seul.
            */}
            <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
              {t('publish.inventory.doNotPublishMeaning', {
                defaultValue:
                  'Un profil non publié reste utilisable sur cet appareil, exactement comme aujourd’hui. Il n’ira simplement pas sur ton compte, et tes autres appareils ne le verront pas.',
              })}
            </p>

            {/*
              UN OBSTACLE MÈNE TOUJOURS À UN GESTE (règle C8).

              La version précédente désactivait « Publier » sur un fichier trop
              gros et s'arrêtait là : l'impasse était refermée, pas ouverte.
              Chaque obstacle est donc NOMMÉ, expliqué, et suivi d'une action
              qui existe et qui marche — ici « Reconstruire l'inventaire »,
              qui réévalue la situation une fois le geste fait.
            */}
            {snapshot.blockers.length > 0 && (
              <div
                className="rounded-lg p-3 text-xs space-y-2"
                style={{
                  backgroundColor: 'var(--color-warning-50, #fef3c7)',
                  color: 'var(--color-warning-900, #92400e)',
                }}
              >
                {snapshot.blockers.map((b: PublishBlocker) =>
                  b.kind === 'keychain-unavailable' ? (
                    <p key="keychain">
                      {t('publish.inventory.blocker.keychain', {
                        defaultValue:
                          'Le trousseau de ton système n’est pas disponible. Sans lui, Filarr ne peut pas conserver l’ancienne clé de ce coffre, et basculer rendrait tes fichiers actuels inaccessibles. Déverrouille la session (ou le trousseau) de ton système, puis reconstruis l’inventaire.',
                      })}
                    </p>
                  ) : (
                    <p key={b.itemKey}>
                      {t('publish.inventory.blocker.oversize', {
                        defaultValue:
                          '« {{name}} » ({{size}}) dépasse ce que cette version sait publier. Exporte-le hors du coffre, retire-le du coffre, puis reconstruis l’inventaire.',
                        name: b.name,
                        size: formatBytes(b.size),
                      })}
                    </p>
                  )
                )}
                <Button variant="secondary" size="sm" loading={busy} onClick={handleBuildInventory}>
                  {t('publish.action.rebuild', 'Reconstruire l’inventaire')}
                </Button>
              </div>
            )}

            <Checkbox
              checked={fullVerify}
              onChange={(e) => setFullVerify(e.target.checked)}
              label={t('publish.inventory.fullVerify', {
                defaultValue:
                  'Vérification complète après publication (retélécharge tout, ≈ {{size}} de plus)',
                size: formatBytes(counters.totalBytes),
              })}
            />
          </div>
        )}

        {/* ── ÉCRAN 2 : la publication ── */}
        {state === 'PUBLISHING' && counters && (
          <div className="py-2 space-y-3">
            <p className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>
              {t('publish.progress.heading', 'Publication en cours')}
            </p>
            {/*
              LES DEUX COMPTEURS, toujours. Sur un coffre à un seul fichier de
              4 Go, le compte d'éléments seul mentirait.
            */}
            <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              {t('publish.progress.counts', {
                defaultValue: '{{done}} / {{total}} éléments · {{doneBytes}} / {{totalBytes}}',
                done: counters.doneItems,
                total: counters.totalItems,
                doneBytes: formatBytes(counters.doneBytes),
                totalBytes: formatBytes(counters.totalBytes),
              })}
            </p>
            <ProgressBar
              value={percent}
              showValue
              aria-label={t('publish.progress.heading', 'Publication en cours')}
            />
            {snapshot.currentLabel && (
              <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                {snapshot.currentLabel}
              </p>
            )}
            {etaLabel && (
              <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                {t('publish.progress.eta', {
                  defaultValue: 'Environ {{eta}} restantes',
                  eta: etaLabel,
                })}
              </p>
            )}
            <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
              {t('publish.progress.keepUsing', {
                defaultValue:
                  'Ton coffre reste utilisable. Tu peux quitter cet écran ; la publication continue.',
              })}
            </p>
          </div>
        )}

        {/* ── ÉCRAN 3 : la vérification ── */}
        {state === 'VERIFYING' && !proven && (
          <div className="py-2 space-y-3">
            <p className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>
              {t('publish.verify.heading', 'Vérification')}
            </p>
            <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              {t('publish.verify.body', {
                defaultValue:
                  'Le compte a bien reçu {{received}} éléments. On revérifie maintenant {{sample}} éléments en les retéléchargeant, pour constater qu’ils se relisent bien avec la clé du compte.',
                received: counters?.doneItems ?? 0,
                sample: snapshot?.verify.planned ?? 0,
              })}
            </p>
            <ProgressBar
              value={verifyPercent}
              showValue
              aria-label={t('publish.verify.heading', 'Vérification')}
            />
            {/* Ligne OBLIGATOIRE : c'est l'instant où tout est encore réversible. */}
            <p className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
              {t('publish.verify.nothingChanged', 'Rien n’a encore changé sur cet appareil.')}
            </p>
          </div>
        )}

        {/* ── ÉCRAN 4 : la bascule ── */}
        {proven && (
          <div className="py-2 space-y-3">
            <p className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>
              {t('publish.switch.heading', 'Dernière étape')}
            </p>
            <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              {t('publish.switch.body', {
                defaultValue:
                  'Tout est vérifié. Cet appareil va maintenant utiliser la clé de ton compte pour ce qu’il écrira désormais. Tes fichiers sur cet appareil et ton mot de passe local ne changent pas.',
              })}
            </p>

            {/*
              LA CONSERVATION DE L'ANCIENNE CLÉ, ANNONCÉE — avec son coût.
              C'est elle qui fait que rien ne devient illisible ; la taire
              donnerait une promesse sans mécanisme, et le mécanisme a un prix
              que l'utilisateur a le droit de connaître avant de le payer.
            */}
            <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              {t('publish.switch.retainedKey', {
                defaultValue:
                  'Cet appareil garde aussi son ancienne clé, en lecture seule : c’est ce qui permet à tous tes fichiers actuels de continuer à s’ouvrir. Conséquence à connaître : deux clés de coffre resteront durablement sur cet appareil.',
              })}
            </p>

            {/*
              PROFILS NON PUBLIÉS — une information, pas un avertissement de
              destruction. Ils restent lisibles ici grâce à la clé conservée.
            */}
            {snapshot.abandonedProfiles.map((p) => (
              <p
                key={p.localProfileId}
                className="text-sm"
                style={{ color: 'var(--color-text-secondary)' }}
              >
                {t('publish.switch.localOnlyNotice', {
                  defaultValue:
                    'Le profil « {{name}} » ({{count}} éléments) reste sur cet appareil seulement : il continue de s’ouvrir ici, mais il n’existe pas sur ton compte et tes autres appareils ne le verront pas.',
                  count: p.itemCount,
                  name: p.name,
                })}
              </p>
            ))}

            {(counters?.damagedItems ?? 0) > 0 && (
              <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                {t('publish.switch.damagedWarning', {
                  defaultValue:
                    '{{count}} éléments étaient déjà illisibles avec la clé actuelle. Changer de clé ne leur retire rien : ils étaient perdus avant, ils le restent après, et leurs octets restent sur l’appareil.',
                  count: counters?.damagedItems ?? 0,
                })}
              </p>
            )}
          </div>
        )}

        {/* ── ÉCRAN 5 : le reçu ── */}
        {state === 'DONE' && (
          <div className="py-2 space-y-3">
            <p className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>
              {t('publish.done.heading', 'C’est fait.')}
            </p>
            <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              {t('publish.done.body', {
                defaultValue:
                  '{{count}} éléments publiés. Cet appareil écrit maintenant avec la clé de ton compte, et garde son ancienne clé en lecture pour tout ce qui était déjà là.',
                count: counters?.doneItems ?? 0,
              })}
            </p>
            {(counters?.damagedItems ?? 0) > 0 && (
              <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                {t('publish.done.damaged', {
                  defaultValue:
                    '{{count}} éléments n’ont pas pu être lus. Leurs octets sont toujours sur l’appareil ; ils étaient déjà illisibles avant.',
                  count: counters?.damagedItems ?? 0,
                })}
              </p>
            )}
          </div>
        )}

        {/* ── Échec ── */}
        {state === 'FAILED' && (
          <div className="py-2 space-y-3">
            <p className="text-sm font-medium" style={{ color: '#dc2626' }}>
              {t(`publish.error.${snapshot?.lastError?.code ?? 'internal'}`, {
                defaultValue: t('publish.error.internal', 'La migration s’est arrêtée.'),
              })}
            </p>
            <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
              {t('publish.error.nothingLost', {
                defaultValue:
                  'Rien n’a été effacé : cet appareil garde sa clé et son contenu, et fonctionne exactement comme avant.',
              })}
            </p>
          </div>
        )}

        {state === 'ABANDONED' && (
          <p className="text-sm py-2" style={{ color: 'var(--color-text-secondary)' }}>
            {t('publish.abandoned.body', {
              defaultValue:
                'Le ménage côté compte se termine en arrière-plan. Tu n’as rien à attendre.',
            })}
          </p>
        )}

        {error && (
          <p className="text-xs mt-3" style={{ color: '#dc2626' }}>
            {error}
          </p>
        )}
      </ModalBody>

      <ModalFooter>
        <div className="flex justify-end gap-2 flex-wrap">
          {(!snapshot || state === 'PREPARING') && (
            <>
              <Button variant="secondary" onClick={onClose}>
                {t('publish.action.notNow', 'Pas maintenant')}
              </Button>
              <Button loading={busy} onClick={handleBuildInventory}>
                {t('publish.action.publish', 'Publier ce coffre sur mon compte')}
              </Button>
            </>
          )}

          {state === 'READY' && (
            <>
              <Button variant="secondary" loading={busy} onClick={() => run(abandonPublishing)}>
                {t('common.cancel', 'Annuler')}
              </Button>
              {/* Un blocage ferme le bouton : le fichier doit d'abord sortir. */}
              <Button
                loading={busy}
                disabled={(snapshot?.blockers.length ?? 0) > 0}
                onClick={() => run(startPublishing)}
              >
                {t('publish.action.start', 'Publier')}
              </Button>
            </>
          )}

          {state === 'PUBLISHING' && (
            <Button variant="secondary" loading={busy} onClick={() => run(pausePublishing)}>
              {t('publish.action.pause', 'Interrompre')}
            </Button>
          )}

          {proven && (
            <>
              <Button variant="secondary" onClick={onClose}>
                {t('publish.action.back', 'Revenir en arrière')}
              </Button>
              {/*
                Plus aucune confirmation tapée : elle faisait consentir à une
                destruction qui n'a plus lieu. Faire retaper un nom pour un
                geste sans perte serait une cérémonie mensongère.
              */}
              <Button loading={busy} onClick={() => run(commitKeySwitch)}>
                {t('publish.action.commit', 'Basculer sur la clé du compte')}
              </Button>
            </>
          )}

          {state === 'FAILED' && (
            <>
              <Button variant="secondary" loading={busy} onClick={() => run(abandonPublishing)}>
                {t('publish.action.abandon', 'Abandonner et nettoyer')}
              </Button>
              <Button loading={busy} onClick={() => run(retryPublishing)}>
                {t('common.retry', 'Réessayer')}
              </Button>
            </>
          )}

          {(state === 'DONE' || state === 'ABANDONED') && (
            <Button onClick={onClose}>{t('common.close', 'Fermer')}</Button>
          )}
        </div>
      </ModalFooter>
    </Modal>
  );
};

export default PublishVaultModal;
