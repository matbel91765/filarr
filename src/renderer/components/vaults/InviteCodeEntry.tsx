/**
 * InviteCodeEntry — « J'ai une invitation ».
 *
 * POURQUOI CETTE SAISIE EXISTE. Sur le web, le lien de l'e-mail suffit : il est
 * capté au chargement. Sur le bureau il n'y a AUCUNE URL à capter — l'e-mail
 * ouvre le navigateur, pas l'application — et c'est donc le seul chemin. Elle
 * sert aussi de rattrapage sur le web quand le lien a été ouvert dans un autre
 * navigateur que celui où l'on est connecté.
 *
 * Elle ne fait qu'ARMER l'invitation : PendingInviteHost, seul à savoir si le
 * coffre est déverrouillé et le store hydraté, la reprend et l'accepte.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import type { RootState } from '../../../store';
import { Button, Input, Modal, ModalBody, ModalFooter, ModalHeader } from '../ui';
import {
  parseInviteLink,
  readPendingInvites,
  setPendingInvite,
  subscribePendingInvite,
  type PendingInvite,
} from '../../../services/invites/pendingInvite';

export const InviteCodeEntry: React.FC = () => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [armed, setArmed] = useState(false);
  const email = useSelector((s: RootState) => s.auth.cloudUser?.email ?? null);

  /**
   * L'INVENTAIRE des invitations en attente.
   *
   * Le module en range jusqu'à cinq et n'en propose qu'UNE : la tête de liste.
   * Rien de perdu — régler la première fait remonter la suivante — mais après un
   * « Plus tard », plus rien dans l'application n'indiquait qu'il restait quelque
   * chose à accepter. Sur le web on pouvait rouvrir l'e-mail ; sur le bureau il
   * fallait le retrouver ET refaire « copier l'adresse du lien ».
   *
   * `subscribePendingInvite` ne livre que la tête : on s'en sert comme d'un
   * signal de changement, et on relit la liste entière.
   */
  const [pending, setPending] = useState<PendingInvite[]>([]);
  useEffect(() => subscribePendingInvite(() => setPending(readPendingInvites())), []);

  /** Remet une invitation en tête : l'écran d'acceptation la reprend aussitôt. */
  const resume = useCallback(
    (invite: PendingInvite) => {
      setArmed(false);
      setPendingInvite(invite, { unmuteFor: email });
    },
    [email]
  );

  const submit = useCallback(() => {
    const parsed = parseInviteLink(value);
    if (!parsed) {
      setInvalid(true);
      return;
    }
    // Coller un lien à la main est un geste EXPLICITE de CE compte : il lève la
    // sourdine qu'il avait pu poser. Sans cela, quelqu'un qui avait cliqué « Ne
    // plus me la proposer » en se croyant sur le mauvais compte recollait son
    // propre lien et n'obtenait RIEN — la sourdine était reconduite, l'entrée
    // écartée à la relecture, la fenêtre se refermait en silence.
    setPendingInvite(parsed, { unmuteFor: email });
    setOpen(false);
    setValue('');
    setInvalid(false);
    // Le seul accusé de réception que ce formulaire ait jamais eu était
    // l'apparition de la fenêtre d'acceptation — laquelle n'arrive pas toujours
    // tout de suite, et pas du tout si le coffre est encore verrouillé.
    setArmed(true);
  }, [value, email]);

  return (
    <>
      <div className="px-6 py-4 flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-[var(--color-text-primary)]">
            {t('teamVaults.join.entry.trigger')}
          </p>
          <p className="text-xs text-[var(--color-text-tertiary)] mt-0.5">
            {t('teamVaults.join.entry.description')}
          </p>
          {armed && (
            <p role="status" className="text-xs mt-1" style={{ color: 'var(--color-success-600)' }}>
              {t('teamVaults.join.entry.armed')}
            </p>
          )}
        </div>
        {/* Le déclencheur portait `entry.submit` — « Continuer » — c'est-à-dire la
            même chaîne que le bouton de validation de la fenêtre qu'il ouvre. Hors
            contexte, un lecteur d'écran n'annonçait donc que « Continuer, bouton ».
            `entry.trigger` nomme l'action ; les deux clés existaient déjà. */}
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            setArmed(false);
            setOpen(true);
          }}
        >
          {t('teamVaults.join.entry.trigger')}
        </Button>
      </div>

      {pending.length > 0 && (
        <div className="px-6 pb-4 -mt-2">
          <p className="text-xs text-[var(--color-text-tertiary)] m-0 mb-1.5">
            {t('teamVaults.join.entry.pendingCount', { count: pending.length })}
          </p>
          <ul className="list-none m-0 p-0 flex flex-col gap-1.5">
            {pending.map((inv) => (
              <li
                key={`${inv.kind}:${inv.vaultId ?? ''}:${inv.token}`}
                className="flex items-center justify-between gap-3"
              >
                <span className="text-xs text-[var(--color-text-secondary)]">
                  {inv.kind === 'org'
                    ? t('teamVaults.join.entry.pendingSpace')
                    : t('teamVaults.join.entry.pendingVault')}
                </span>
                <Button variant="ghost" size="sm" onClick={() => resume(inv)}>
                  {t('teamVaults.join.entry.resume')}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Modal isOpen={open} onClose={() => setOpen(false)} size="sm">
        <ModalHeader onClose={() => setOpen(false)} closeLabel={t('common.close')}>
          {t('teamVaults.join.entry.title')}
        </ModalHeader>
        <ModalBody>
          <p className="text-sm text-[var(--color-text-secondary)] mt-0 mb-3">
            {t('teamVaults.join.entry.desc')}
          </p>
          {/* Les deux sortes de jeton sont indiscernables et seul le lien porte
              l'identifiant du coffre : le dire ici évite l'erreur, plutôt que de
              la rattraper par un refus. */}
          <p className="text-xs text-[var(--color-text-tertiary)] mt-0 mb-3">
            {t('teamVaults.join.entry.linkForVault')}
          </p>
          {/* `data-autofocus` EN PLUS de `autoFocus` : React n'émet aucun
              attribut dans le DOM pour ce dernier, si bien que le piège à focus
              de Modal ne trouvait rien et posait le focus sur la croix de
              fermeture — sur un écran dont l'unique raison d'être est de coller
              quelque chose dans ce champ. */}
          <Input
            label={t('teamVaults.join.entry.label')}
            placeholder={t('teamVaults.join.entry.placeholder')}
            value={value}
            fullWidth
            autoFocus
            data-autofocus
            error={invalid ? t('teamVaults.join.entry.invalid') : undefined}
            onChange={(e) => {
              setValue(e.target.value);
              setInvalid(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
            }}
          />
        </ModalBody>
        <ModalFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            {t('teamVaults.join.later')}
          </Button>
          <Button variant="primary" onClick={submit} disabled={!value.trim()}>
            {t('teamVaults.join.entry.submit')}
          </Button>
        </ModalFooter>
      </Modal>
    </>
  );
};

export default InviteCodeEntry;
