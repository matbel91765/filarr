/**
 * OrgNoOrgState — ce que voit un compte d'organisation qui n'appartient à
 * aucune organisation.
 *
 * ── LE SILENCE QU'IL REMPLACE ────────────────────────────────────────────────
 *
 * Quelqu'un qui vient de créer son compte d'organisation — sur le site ou dans
 * l'assistant — n'appartient encore à rien. Il entrait donc dans une application
 * rigoureusement ordinaire : la marque « Organisation » dans l'en-tête, et
 * aucune trace de l'organisation nulle part. Pas d'entrée dans la barre, pas de
 * console, aucun moyen d'en créer une ni d'en rejoindre une. L'espace était
 * choisi et vide de lui-même, ce qui se lit comme un produit en panne.
 *
 * Les deux seules choses qu'on puisse faire depuis ici sont donc nommées et
 * offertes. Et la troisième — attendre une invitation — est DITE, parce que
 * c'est le cas le plus fréquent chez un salarié : sans cette phrase, il
 * chercherait à créer une organisation que son employeur a déjà.
 */

import React, { FC, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDispatch, useSelector } from 'react-redux';
import type { AppDispatch } from '../../../store';
import { initOrgContext, fetchOrgs, setCurrentOrg } from '../../../store/slices/orgSlice';
import { selectOrgs } from '../../../store/selectors/authSelectors';
import { AdminSection, InfoCallout } from './enterprise/AdminPrimitives';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { useNotification } from '../ui/Notification';
import './enterprise/enterprise.css';

const OrgNoOrgState: FC = () => {
  const { t } = useTranslation();
  const dispatch = useDispatch<AppDispatch>();
  const { error: notifyError, success } = useNotification();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  /*
    LA PORTE DE SORTIE QUE LE COURRIEL PROMETTAIT. « N'importe quel
    propriétaire peut annuler la fermeture depuis la console » — sauf que la
    console filtrait les organisations en fermeture partout : sélecteurs,
    contexte, changeur. Un propriétaire qui avait cliqué par erreur ne
    retrouvait plus rien à restaurer, et le serveur, lui, attendait son
    POST /restore pendant trente jours. Elles apparaissent ici, dans l'écran
    qu'il voit justement PARCE QU'elles ont disparu du reste.
  */
  const orgs = useSelector(selectOrgs);
  const closing = orgs.filter(
    (o) => !o.isPersonal && o.status === 'pending_deletion' && o.role === 'owner'
  );
  const [restoring, setRestoring] = useState<string | null>(null);
  const restore = useCallback(
    async (orgId: string) => {
      const ipc = window.electron?.ipcRenderer;
      if (!ipc || restoring) return;
      setRestoring(orgId);
      try {
        const res = await ipc.invoke('org:restore', orgId);
        if (res?.success) {
          success(t('org.noOrg.restored', 'Organisation restaurée'));
          await dispatch(fetchOrgs());
          dispatch(setCurrentOrg(orgId));
          await dispatch(initOrgContext());
        } else {
          notifyError(t(`org.errors.${res?.code ?? 'generic'}`, t('org.errors.generic')));
        }
      } catch {
        notifyError(t('org.errors.generic'));
      } finally {
        setRestoring(null);
      }
    },
    [restoring, dispatch, t, success, notifyError]
  );

  const create = useCallback(async () => {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    const ipc = window.electron?.ipcRenderer;
    if (!ipc) return;
    setBusy(true);
    try {
      const res = await ipc.invoke('org:create', trimmed);
      if (res?.success) {
        success(t('org.noOrg.created', 'Organisation créée'));
        // Recharger le contexte : c'est lui qui choisit l'organisation active et
        // fait apparaître la console. Sans ce rappel, on resterait sur cet écran
        // en ayant pourtant réussi.
        await dispatch(initOrgContext());
      } else {
        notifyError(t(`org.errors.${res?.code ?? 'generic'}`, t('org.errors.generic')));
      }
    } catch {
      notifyError(t('org.errors.generic'));
    } finally {
      setBusy(false);
    }
  }, [name, busy, dispatch, t, notifyError, success]);

  return (
    <div style={{ padding: 'var(--spacing-6)', maxWidth: 680, margin: '0 auto' }}>
      {closing.map((o) => (
        <div
          key={o.id}
          className="ent-band ent-band--warning"
          style={{ marginBottom: 'var(--spacing-4)' }}
        >
          <div className="ent-band__icon">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v5l3 2" />
            </svg>
          </div>
          <div className="ent-band__body">
            <div className="ent-band__title">{t('org.noOrg.closing.title', { name: o.name })}</div>
            <p className="ent-band__text">{t('org.noOrg.closing.text')}</p>
            <div className="ent-band__actions">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void restore(o.id)}
                loading={restoring === o.id}
              >
                {t('org.noOrg.closing.restore')}
              </Button>
            </div>
          </div>
        </div>
      ))}
      <AdminSection
        title={t('org.noOrg.title', 'Vous n’appartenez à aucune organisation')}
        description={t(
          'org.noOrg.desc',
          'Votre compte est bien un compte d’organisation — il ne lui manque qu’une organisation.'
        )}
      >
        <InfoCallout>
          {t(
            'org.noOrg.invited',
            'Si votre équipe utilise déjà Filarr, ne créez rien : votre administrateur doit vous envoyer une invitation par courriel. Le lien qu’elle contient vous rattachera à son organisation, avec le rôle qu’il aura choisi, et sans rien à payer de votre côté.'
          )}
        </InfoCallout>

        <h4
          className="text-xs font-semibold uppercase tracking-wide mt-5 mb-1"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          {t('org.noOrg.createHeading', 'Ou fondez la vôtre')}
        </h4>
        <p className="text-sm" style={{ color: 'var(--color-text-secondary)', maxWidth: '62ch' }}>
          {t(
            'org.noOrg.createDesc',
            'Vous en devenez le propriétaire. À savoir avant de créer : une organisation neuve ne donne accès à rien tant que l’abonnement n’est pas souscrit — ni invitations, ni coffres d’équipe, ni marque. La facturation est au siège, avec un minimum de trois, et les lecteurs sont gratuits.'
          )}
        </p>

        <div className="flex gap-2 mt-3" style={{ maxWidth: 460 }}>
          <div style={{ flex: 1 }}>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('org.noOrg.namePlaceholder', 'Nom de l’organisation')}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void create();
              }}
              fullWidth
            />
          </div>
          <Button onClick={() => void create()} disabled={busy || !name.trim()}>
            {busy ? t('common.saving', 'Création…') : t('org.noOrg.createCta', 'Créer')}
          </Button>
        </div>
      </AdminSection>
    </div>
  );
};

export default OrgNoOrgState;
