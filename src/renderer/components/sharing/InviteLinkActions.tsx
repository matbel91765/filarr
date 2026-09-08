/**
 * InviteLinkActions (F16) — « Copier le lien » et « QR », juste après l'envoi.
 *
 * LE DÉFAUT QU'ELLE FERME. L'invitation ne partait que par e-mail. Quand celui-ci
 * n'arrivait pas — filtre anti-spam, boîte pleine, adresse en aiguillage,
 * domaine qui rejette — l'hôte n'avait AUCUN moyen de transmettre l'accès, ni
 * même de voir ce qui avait été envoyé : il ne lui restait qu'à relancer, ce qui
 * refait exactement le même chemin. Le lien est là, il vient d'être fabriqué, et
 * personne ne pouvait le lire.
 *
 * ELLE NE MONTRE PAS L'URL, ET C'EST DÉLIBÉRÉ. Un porteur affiché en clair dans
 * une page se retrouve dans une capture d'écran, dans un partage d'écran, dans
 * un enregistrement de réunion. Les deux seuls chemins offerts sont ceux qu'on
 * contrôle : le presse-papiers (qui s'efface) et un QR (que l'on referme).
 *
 * QUATRE RÈGLES D'HYGIÈNE, ET ELLES SONT RÉPARTIES :
 *   · l'URL vit dans l'état LOCAL de l'hôte de ce composant, jamais dans Redux
 *     ni dans localStorage — le thunk `inviteMember` la jette explicitement ;
 *   · elle est effacée du presse-papiers après une minute, et SEULEMENT si le
 *     presse-papiers la contient encore (`copyInviteLinkOnce`) ;
 *   · elle est coupée des fils d'ariane Sentry (`crashReporter`) ;
 *   · LE COMPTE À REBOURS NE MEURT PAS AVEC CET ÉCRAN. Il vivait ici, annulé au
 *     démontage — c'est-à-dire à la fermeture du dialogue, au changement
 *     d'onglet, au clic sur « Masquer ». Or copier PUIS fermer PUIS coller est
 *     le geste normal : l'effacement n'avait donc jamais lieu dans le chemin
 *     dominant, pendant que la phrase le promettait. Le minuteur appartient
 *     maintenant à `inviteLinkHygiene`, qui ne l'annule que pour le remplacer.
 *
 * ET SUR LE WEB, ON NE PROMET PAS CE QU'ON NE PEUT PAS TENIR. L'effacement relit
 * le presse-papiers avant d'écrire ; `readText` hors geste utilisateur est refusé
 * par les navigateurs (le nettoyage part d'un `setTimeout`), là où le processus
 * principal l'autorise sous Electron. La ligne affichée après la copie dit donc
 * la vérité de la plateforme : effacement sur le bureau, à vous de le remplacer
 * dans un navigateur.
 *
 * F28 — SUR UNE BANDE COMPACTE, LE QR PASSE DEVANT. Sur un poste, le geste
 * naturel est « copier le lien » : on le colle dans un message, dans un courriel.
 * Sur un téléphone, le presse-papiers ne mène nulle part — le destinataire est
 * en face de soi, avec SON appareil, et le carré est le seul transport qui ne
 * demande ni compte ni réseau partagé. Les deux boutons restent là, toujours :
 * seul leur ORDRE et lequel des deux est le bouton primaire changent. Retirer
 * l'un des deux ferait disparaître un geste selon la largeur de la fenêtre, ce
 * qui est la pire façon de se replier.
 *
 * LE QR DIT POUR QUI IL EST. Un carré noir et blanc ne porte aucune information
 * lisible : sans la phrase en dessous, on le scanne avec le mauvais téléphone,
 * connecté au mauvais compte, et le refus qui suit (`/join` est NOMINAL) passe
 * pour une panne. La date d'expiration n'est affichée que si le serveur l'a
 * donnée — jamais un TTL deviné côté client.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import QRCode from 'qrcode';
import { useContainerBreakpoint } from '../../styles/useContainerBreakpoint';
import { Button, Modal } from '../ui';
import { useNotification } from '../ui/Notification';
import { copyInviteLinkOnce } from '../../../services/vault/inviteLinkHygiene';
import { isWebPlatform } from '../../../services/platform/isWebPlatform';

/** La taille du carré, en pixels — celle de l'appairage, qui scanne bien. */
const QR_SIZE = 240;

interface Props {
  /** L'URL rendue UNE SEULE FOIS par le serveur, tenue en état local par l'hôte. */
  url: string;
  /** À qui ce lien est destiné — le QR le dit, parce qu'il ne le montre pas. */
  email: string;
  /** L'échéance (ms) quand le serveur l'a donnée ; sinon la phrase se tait. */
  expiresAtMs?: number | null;
  /** Ranger la ligne : l'hôte efface l'URL de son état. */
  onDismiss?: () => void;
}

export const InviteLinkActions: React.FC<Props> = ({ url, email, expiresAtMs, onDismiss }) => {
  const { t } = useTranslation();
  const { success, error } = useNotification();
  const [qrOpen, setQrOpen] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [copied, setCopied] = useState(false);

  const copy = useCallback(async () => {
    try {
      // Rien à retenir ici : le compte à rebours vit dans le module, et une
      // copie de plus y remplace la précédente. Le démonter avec cet écran
      // reviendrait à ne jamais effacer — on copie POUR fermer et aller coller.
      await copyInviteLinkOnce(url);
      setCopied(true);
      success(t('teamVaults.inviteLink.copied'));
    } catch {
      // Un presse-papiers refusé ne doit PAS faire croire à une copie réussie :
      // la personne collerait du vide dans sa messagerie.
      error(t('teamVaults.inviteLink.copyFailed'));
    }
  }, [url, success, error, t]);

  /**
   * La gravure du QR. ÉCHEC = REPLI SILENCIEUX (même règle que l'appairage) :
   * sans image, « Copier le lien » reste un chemin complet — une erreur
   * bloquante ici priverait l'hôte d'un geste qui fonctionne.
   */
  useEffect(() => {
    if (!qrOpen) {
      setQrDataUrl('');
      return undefined;
    }
    let annule = false;
    QRCode.toDataURL(url, {
      width: QR_SIZE,
      // Zone de silence complète (4 modules) : la norme la juge nécessaire au
      // décodage, et la rogner est le premier motif de scans qui échouent.
      margin: 4,
      color: { dark: '#000000', light: '#ffffff' },
    })
      .then((d) => {
        if (!annule) setQrDataUrl(d);
      })
      .catch(() => {
        if (!annule) setQrDataUrl('');
      });
    return () => {
      annule = true;
    };
  }, [qrOpen, url]);

  /** La bande de CETTE zone — mesurée sur elle-même (voir l'en-tête). */
  const [zoneRef, band] = useContainerBreakpoint();

  const audience =
    typeof expiresAtMs === 'number' && Number.isFinite(expiresAtMs)
      ? t('teamVaults.inviteLink.audienceWithExpiry', {
          email,
          date: new Date(expiresAtMs).toLocaleDateString(),
        })
      : t('teamVaults.inviteLink.audience', { email });

  const boutonCopier = (
    <Button
      key="copier"
      variant={band === 'compact' ? 'secondary' : 'primary'}
      size="sm"
      onClick={() => void copy()}
    >
      {t(copied ? 'teamVaults.inviteLink.copyAgain' : 'teamVaults.inviteLink.copy')}
    </Button>
  );
  const boutonQr = (
    <Button
      key="qr"
      variant={band === 'compact' ? 'primary' : 'secondary'}
      size="sm"
      onClick={() => setQrOpen(true)}
    >
      {t('teamVaults.inviteLink.qr')}
    </Button>
  );

  return (
    <div ref={zoneRef} className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-[var(--color-text-tertiary)]">
        {t('teamVaults.inviteLink.hint')}
      </span>
      {/* L'ORDRE EST LE MESSAGE : le premier bouton est celui qu'on attend ici. */}
      {band === 'compact' ? [boutonQr, boutonCopier] : [boutonCopier, boutonQr]}
      {onDismiss && (
        <Button variant="ghost" size="sm" onClick={onDismiss}>
          {t('teamVaults.inviteLink.dismiss')}
        </Button>
      )}
      {copied && (
        <span className="text-xs text-[var(--color-text-tertiary)]">
          {/* Deux plateformes, deux vérités : un navigateur refuse la relecture
              du presse-papiers hors geste utilisateur, donc l'effacement
              programmé n'y aboutit pas. Promettre quand même serait la seule
              phrase fausse de l'écran. */}
          {t(
            isWebPlatform()
              ? 'teamVaults.inviteLink.clipboardManual'
              : 'teamVaults.inviteLink.clipboardTtl'
          )}
        </span>
      )}

      <Modal
        isOpen={qrOpen}
        onClose={() => setQrOpen(false)}
        title={t('teamVaults.inviteLink.qrTitle')}
        size="sm"
      >
        <div
          style={{ padding: 'var(--spacing-4)' }}
          className="flex flex-col items-center gap-3 text-center"
        >
          {qrDataUrl ? (
            /* FOND BLANC EXPLICITE : sur le thème sombre, un PNG à fond
               transparent rendrait un carré noir sur noir, indécodable. C'est
               une contrainte fonctionnelle, pas esthétique (même règle que
               l'appairage). */
            <div style={{ background: '#ffffff', padding: 12, borderRadius: 8 }}>
              {/* Le carré ne DÉBORDE JAMAIS de sa boîte : 240 px plus les marges
                  de la modale ne tiennent pas dans un téléphone étroit, et un QR
                  qui pousse le corps horizontalement emporte la phrase qui dit
                  pour qui il est. Il rétrécit proportionnellement, ce qu'un
                  décodeur accepte tant que la zone de silence est là. */}
              <img
                src={qrDataUrl}
                width={QR_SIZE}
                height={QR_SIZE}
                style={{ maxWidth: '100%', height: 'auto' }}
                alt=""
                aria-hidden="true"
              />
            </div>
          ) : (
            <p className="text-sm text-[var(--color-text-secondary)] m-0">
              {t('teamVaults.inviteLink.qrUnavailable')}
            </p>
          )}
          {/* CE QUE LE CARRÉ NE PEUT PAS DIRE. Il est visuellement muet : sans
              cette phrase, on le scanne avec le mauvais téléphone et le refus
              nominal du serveur passe pour une panne. */}
          <p className="text-sm text-[var(--color-text-secondary)] m-0">{audience}</p>
          <div className="flex justify-end w-full">
            <Button variant="secondary" size="sm" onClick={() => setQrOpen(false)}>
              {t('common.close')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default InviteLinkActions;
