/**
 * PendingInviteHost — l'écran qui fait aboutir une invitation reçue.
 *
 * Monté à côté de FilarrBoxHost et ShellProtectHost, et pour la même raison :
 * c'est le seul point de l'arbre où le profil est sélectionné, le coffre
 * déverrouillé (LaunchScreen retire tout l'arbre au verrouillage), le Router
 * monté et le store hydraté. L'invitation, elle, a été captée bien plus tôt —
 * au chargement de la page, avant même le premier rendu (pendingInvite.ts) —
 * puis a traversé l'onboarding, la connexion et la sélection de profil.
 *
 * CE COMPOSANT N'EST QU'UN ADAPTATEUR. L'enchaînement de l'acceptation, les
 * verdicts et la décision d'effacer le jeton vivent dans `pendingInviteFlow` ;
 * le choix du geste à proposer quand l'adresse invitée n'est pas celle du compte
 * connecté vit dans `inviteAccountMatch`. Les deux sont testés : c'est là qu'il
 * faut lire ce que fait cet écran.
 *
 * LE BON COMPTE, AVANT D'AGIR (F29). L'aperçu public est demandé pour les DEUX
 * sortes d'invitation — l'espace l'avait depuis toujours, le coffre l'a
 * maintenant — si bien que l'écran peut dire « envoyée à B, vous êtes connecté
 * avec A » AVANT le geste, au lieu de laisser accepter puis d'afficher un refus.
 * Et le geste proposé dépend de la plateforme : sur le web il n'y a qu'une
 * session par navigateur, donc changer de compte c'est se déconnecter ; sur le
 * bureau chaque PROFIL porte son propre compte, et se déconnecter serait
 * détacher le compte du profil courant au lieu d'ouvrir celui qui porte déjà la
 * bonne adresse.
 *
 * L'acceptation ne peut PAS se faire sur le site vitrine : les deux routes
 * exigent une session, et ouvrir le coffre exige la clé privée de
 * l'utilisateur, qui ne quitte jamais l'appareil. filarr.com ne fait que
 * renvoyer ici.
 */

import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import type { AppDispatch, RootState } from '../../../store';
import { Button, Modal, ModalBody, ModalFooter, ModalHeader } from '../ui';
import { useNotification } from '../ui/Notification';
import { useAuth } from '../../../hooks/useAuth';
import { isWebPlatform } from '../../../services/platform/isWebPlatform';
import {
  clearPendingInvite,
  muteInviteForAccount,
  readPendingInvite,
  subscribePendingInvite,
  type PendingInvite,
} from '../../../services/invites/pendingInvite';
import { setInviteSignInHint } from '../../../services/invites/inviteSignInHint';
import {
  apiGetOrgInvitationPreview,
  apiGetVaultInvitationPreview,
} from '../../../services/vault/vaultApi';
import { joinErrorKey, isVaultErrorRetryable } from '../../../services/vault/vaultErrorMessages';
import { fetchOrgs } from '../../../store/slices/orgSlice';
import { requestProfileSwitch } from '../../../store/slices/uiSlice';
import { joinVault, loadVaults } from '../../../store/slices/vaultsSlice';
import { vaultFolderRoute } from '../layout/RouteContent/routeCompat';
import {
  consumeOnClose,
  displayedInviteErrorCode,
  isForAnotherAccount,
  isWrongRecipientError,
  runAcceptance,
  UNKNOWN_FAILURE_CODE,
  type InviteInvoke,
  type InvitePhase as Phase,
} from './pendingInviteFlow';
import { inviteAccountMatch, type InviteProfileRef } from './inviteAccountMatch';

/**
 * Les deux aperçus publics réduits à UNE forme.
 *
 * Ils ne rendent pas la même chose — l'espace a un nom, le coffre n'en a pas
 * (chiffré de bout en bout, le serveur ne l'a pas) — mais l'écran leur pose la
 * même question : à qui, pour quel rôle, et est-ce encore vivant. Les fondre ici
 * évite deux jeux d'états parallèles qui divergeraient à la première retouche.
 */
interface InvitePreviewState {
  invitedEmail: string | null;
  role: string | null;
  orgName: string | null;
  /** Le serveur a AFFIRMÉ que l'invitation a expiré (410), avant tout geste. */
  expired: boolean;
}

export const PendingInviteHost: React.FC = () => {
  const { t } = useTranslation();
  const dispatch = useDispatch<AppDispatch>();
  const navigate = useNavigate();
  const { success: notifySuccess } = useNotification();
  const { logout } = useAuth();

  const [invite, setInvite] = useState<PendingInvite | null>(null);
  const [preview, setPreview] = useState<InvitePreviewState | null>(null);
  const [phase, setPhase] = useState<Phase>('confirm');
  /**
   * Le refus ET l'invitation qu'il concerne, dans UN SEUL état.
   *
   * POURQUOI LES DEUX ENSEMBLE. Le chemin de succès passait déjà l'invitation
   * réglée à `close`, le chemin d'échec non : il retombait sur `inviteRef`, qui
   * suit ce qui est À L'ÉCRAN. Or l'écran change tout seul — un second onglet qui
   * ouvre l'autre e-mail écrit dans localStorage, l'écouteur `storage` remonte
   * l'invitation suivante, et l'acceptation en vol se règle APRÈS. « Fermer »
   * effaçait alors une invitation parfaitement vivante que personne n'avait
   * présentée au serveur, pendant que la morte restait en place. Deux coffres
   * partagés font deux e-mails : ce n'est pas un cas exotique.
   *
   * Les tenir dans le même état les empêche de diverger par construction.
   */
  const [failure, setFailure] = useState<{ code: string | null; invite: PendingInvite } | null>(
    null
  );
  const errorCode = failure?.code ?? null;
  /** Rattache la description à la fenêtre : sans elle, un lecteur d'écran
   *  annonçait le titre puis « Fermer, bouton », sans jamais dire ce qu'on
   *  rejoint ni sous quelle adresse on est connecté. */
  const descriptionId = useId();

  const accountMode = useSelector((s: RootState) => s.auth.accountMode);
  const email = useSelector((s: RootState) => s.auth.cloudUser?.email ?? null);
  const isCloud = accountMode === 'cloud' && !!email;
  const manifest = useSelector((s: RootState) => s.profiles.manifest);

  /** Le web n'a pas de profils : une session par navigateur, et c'est tout. */
  const platform: 'desktop' | 'web' = isWebPlatform() ? 'web' : 'desktop';

  /**
   * Les profils vers lesquels il y aurait quelque chose à CHANGER — celui qui
   * est ouvert en est donc retiré.
   *
   * POURQUOI L'EXCLURE. Le verdict sert à nommer un geste ; proposer « ouvrez le
   * profil X » quand X est déjà celui qu'on regarde n'est pas un geste, c'est
   * une impasse. Le cas se produit pour de bon : un profil dont la liaison porte
   * encore l'adresse B alors que la session vivante est celle de A (compte
   * changé dans ce profil sans que la liaison ait été refaite).
   *
   * MÉMORISÉ, obligatoirement : un tableau neuf à chaque rendu déstabiliserait
   * le `useMemo` du verdict, et avec lui tout ce qui en dépend.
   */
  const switchableProfiles = useMemo<InviteProfileRef[]>(() => {
    if (platform !== 'desktop' || !manifest) return [];
    return manifest.profiles
      .filter((p) => p.id !== manifest.activeProfileId)
      .map((p) => ({ id: p.id, name: p.name, cloudEmail: p.cloudAccount?.email ?? null }));
  }, [platform, manifest]);

  /** Une seule reprise après rafraîchissement de session par invitation. */
  const sessionRetried = useRef(false);
  /** Où rendre le focus quand le refus démonte le bouton qui le portait. */
  const failureRef = useRef<HTMLParagraphElement>(null);
  /** Le même point d'ancrage, pour la phase de travail (voir plus bas). */
  const workingRef = useRef<HTMLParagraphElement>(null);
  /** L'invitation à l'écran, lisible depuis les rappels de `runAcceptance`. */
  const inviteRef = useRef<PendingInvite | null>(null);
  useEffect(() => {
    inviteRef.current = invite;
  }, [invite]);

  /** Le compte qui décide de ce qu'on a le droit de montrer, et à qui. */
  const filteringAccount = accountMode === 'cloud' ? email : null;

  const applyCurrent = useCallback(() => {
    setInvite(readPendingInvite(filteringAccount));
    setPreview(null);
    setPhase('confirm');
    setFailure(null);
    sessionRetried.current = false;
  }, [filteringAccount]);

  /**
   * POURQUOI L'IDENTITÉ EST UNE DÉPENDANCE, et pas seulement le montage.
   *
   * Fermer sans consommer garde le jeton mais vide l'état local, et
   * `subscribePendingInvite` ne rejoue l'invitation dormante qu'À L'ABONNEMENT :
   * l'hôte n'étant remonté qu'au verrouillage ou au redémarrage, se reconnecter
   * ne la faisait pas revenir. Or c'est exactement ce que la phrase promet —
   * « reconnectez-vous, l'invitation vous attendra ». Ré-exécuter cet effet
   * quand l'identité change relit le porteur RÉEL, et tient la promesse.
   */
  useEffect(() => subscribePendingInvite(applyCurrent), [applyCurrent]);

  /**
   * L'aperçu public — POUR LES DEUX SORTES D'INVITATION.
   *
   * IL NE L'ÉTAIT PAS, et c'était le défaut central de cet écran. Seule
   * l'invitation d'ESPACE avait une route d'aperçu ; celle de COFFRE n'en avait
   * aucune (son nom est chiffré, donc rien n'avait été prévu), donc l'adresse
   * invitée restait inconnue, la garde du bon compte ne se déclenchait jamais,
   * et quelqu'un qui a plusieurs comptes — un perso, un pro, le cas ORDINAIRE —
   * n'apprenait son erreur qu'APRÈS avoir cliqué « Accepter ». La route de
   * coffre existe désormais et sert exactement ce que sert celle de l'espace :
   * l'adresse invitée et le rôle, rien d'autre. Le nom du coffre, lui, n'a
   * toujours pas d'aperçu et n'en aura pas : le serveur ne l'a pas.
   *
   * Un aperçu reste un ORNEMENT : son échec laisse `preview` à `null`, l'écran
   * retombe sur ce qu'il disait avant, et « Accepter » reste debout.
   */
  useEffect(() => {
    let cancelled = false;
    if (invite) {
      const token = invite.token;
      const loaded: Promise<InvitePreviewState | null> =
        invite.kind === 'org'
          ? apiGetOrgInvitationPreview(token).then((p) =>
              p
                ? {
                    invitedEmail: p.invitedEmail ?? null,
                    role: p.role ?? null,
                    orgName: p.orgName ?? null,
                    expired: false,
                  }
                : null
            )
          : apiGetVaultInvitationPreview(token).then((p) =>
              p
                ? {
                    invitedEmail: p.invitedEmail,
                    role: p.role,
                    orgName: null,
                    expired: !!p.expired,
                  }
                : null
            );
      void loaded.then((p) => {
        if (!cancelled) setPreview(p);
      });
    }
    // Rendu dans TOUS les cas, y compris sans invitation : un nettoyage qui ne
    // sort que d'une branche fait échouer la compilation (TS7030).
    return () => {
      cancelled = true;
    };
  }, [invite]);

  /**
   * Referme l'écran. `consume` vient TOUJOURS d'un verdict (`consumeOnClose`),
   * jamais du geste employé pour fermer.
   *
   * Consommer n'efface que l'invitation réglée : la SUIVANTE, s'il y en a une,
   * est remontée dans la foulée par l'abonnement — deux coffres partagés, ce
   * sont deux e-mails, et la seconde invitation ne doit pas attendre un
   * redémarrage. Ne pas consommer laisse le porteur intact et se contente de
   * ranger l'écran.
   *
   * `target` désigne l'invitation RÉGLÉE, et il faut le passer dès qu'on l'a :
   * `inviteRef` suit ce qui est à l'écran, or l'abonnement peut y remonter une
   * AUTRE invitation pendant qu'une acceptation est en vol — on effacerait alors
   * une invitation vivante que personne n'a présentée au serveur.
   */
  const close = useCallback((consume: boolean, target?: PendingInvite) => {
    if (consume) clearPendingInvite(target ?? inviteRef.current ?? undefined);
    else setInvite(null);
  }, []);

  const invitedEmail = preview?.invitedEmail ?? null;

  /**
   * Le geste du BUREAU : revenir au sélecteur de profils.
   *
   * `requestProfileSwitch` est le chemin que l'en-tête emprunte déjà — les notes
   * en attente sont écrites, les données de l'espace sont vidées, et l'écran de
   * choix reprend la main. Le REPÈRE d'adresse est posé au passage : le
   * sélecteur s'en sert pour surligner le profil lié, et si la personne finit
   * par ajouter un compte, le formulaire de connexion s'ouvrira déjà rempli.
   */
  const handleSwitchProfile = useCallback(() => {
    setInviteSignInHint(invitedEmail);
    close(false);
    dispatch(requestProfileSwitch());
  }, [invitedEmail, close, dispatch]);

  /**
   * Le geste du WEB : se déconnecter, puisqu'il n'y a qu'une session par
   * navigateur.
   *
   * C'EST LA VRAIE DÉCONNEXION, celle des Réglages (`useAuth().logout`), et pas
   * une version allégée : elle purge la FEK, la clé de session, la paire de clés
   * et les K_vault ouvertes. En sauter la moitié pour éviter l'écran de
   * verrouillage intermédiaire laisserait au compte SUIVANT, sur ce même
   * navigateur, les clés du précédent — exactement ce que le commentaire de
   * `useAuth.logout` documente. Le jeton d'invitation, lui, est conservé :
   * l'invitation attend son destinataire, et le repère d'adresse fait que le
   * formulaire de connexion s'ouvrira déjà rempli.
   */
  const handleSwitchAccount = useCallback(() => {
    setInviteSignInHint(invitedEmail);
    close(false);
    void logout();
  }, [invitedEmail, close, logout]);

  const invoke = useMemo<InviteInvoke | undefined>(() => {
    const ipc = window.electron?.ipcRenderer;
    return ipc ? (channel, ...args) => ipc.invoke(channel, ...args) : undefined;
  }, []);

  const run = useCallback(async () => {
    if (!invite) return;
    // Figée AVANT le vol : c'est celle-ci que le verdict concerne, quoi qu'un
    // autre onglet remonte à l'écran entre-temps.
    const target = invite;
    setPhase('working');
    setFailure(null);

    const code = await runAcceptance(target, {
      invoke,
      sessionRetried,
      joinVault: async (inv) => {
        const outcome = await dispatch(
          joinVault({ vaultId: inv.vaultId!, token: inv.token, orgId: inv.orgId })
        );
        if (joinVault.rejected.match(outcome)) {
          return (outcome.payload as string) ?? UNKNOWN_FAILURE_CODE;
        }
        return null;
      },
      refreshOrgs: async () => {
        await dispatch(fetchOrgs());
      },
      publishOwnKey: async () => {
        // Publier la clé publique tout de suite : sans elle l'hôte ne peut pas
        // sceller K_vault et se heurte à member_no_key.
        const { ensureUserKeypair } = await import('../../../services/auth/userKeypairSync');
        await ensureUserKeypair();
      },
      loadVaults: async () => {
        await dispatch(loadVaults());
      },
      onAccepted: (inv) => {
        close(true, inv);
        // Une invitation d'ESPACE acceptée mène à l'accueil (où vivent les
        // cartes de coffre — il n'y a plus de page à part) ; une invitation de
        // COFFRE ouvre le coffre à sa route profonde. Sans identifiant (type
        // optionnel), l'accueil aussi : mieux qu'une adresse « undefined ».
        if (inv.kind === 'org' || !inv.vaultId) {
          notifySuccess(
            t(
              inv.kind === 'org' ? 'teamVaults.join.acceptedSpace' : 'teamVaults.join.acceptedVault'
            )
          );
          navigate('/');
        } else {
          notifySuccess(t('teamVaults.join.acceptedVault'));
          navigate(vaultFolderRoute(inv.vaultId));
        }
      },
    });

    if (!code) return;
    setFailure({ code: displayedInviteErrorCode(target, code), invite: target });
    setPhase('failed');
  }, [invite, invoke, dispatch, close, notifySuccess, t, navigate]);

  // Le refus démonte le bouton qui portait le focus (« Accepter » disparaît au
  // profit de « Fermer ») : le ramener sur la phrase, qui est ce qu'il faut lire.
  useEffect(() => {
    if (phase === 'failed') failureRef.current?.focus();
  }, [phase, errorCode]);

  // Et le même soin dans l'autre sens : « Réessayer » se démonte au profit de
  // deux boutons désactivés, si bien que le focus quittait la fenêtre — il
  // repartait sur le document, hors du piège à focus. On le pose sur la
  // description, qui est le seul nœud stable des phases confirm et working.
  useEffect(() => {
    if (phase === 'working') workingRef.current?.focus();
  }, [phase]);

  /**
   * QUE FAIRE quand l'adresse invitée n'est pas celle du compte connecté.
   *
   * Le verdict est calculé même sans session : la branche « connectez-vous »
   * s'en sert pour dire, sur le bureau, DANS QUEL PROFIL se connecter.
   */
  const verdict = inviteAccountMatch({
    invitedEmail,
    connectedEmail: isCloud ? email : null,
    platform,
    profiles: switchableProfiles,
  });

  if (!invite) return null;

  const isOrg = invite.kind === 'org';

  /**
   * Le conseil qui suit un écart d'adresse — et il DIFFÈRE selon la plateforme.
   *
   * C'est le défaut que F29 ferme : l'écran envoyait partout « déconnectez-vous
   * puis reconnectez-vous », ce qui est le geste du web et un contresens sur le
   * bureau, où se déconnecter détache le compte du profil courant au lieu
   * d'ouvrir celui qui porte déjà la bonne adresse.
   */
  const mismatchAdvice = (): string => {
    if (verdict.kind === 'switchProfile') {
      return t('teamVaults.join.switchProfileHint', {
        email: invitedEmail,
        profile: verdict.profile.name,
      });
    }
    if (verdict.kind === 'noProfileForAddress') {
      return t('teamVaults.join.noProfileForAddress', { email: invitedEmail });
    }
    return t('teamVaults.join.oneSessionPerBrowser', { email });
  };

  /** Les deux adresses, côte à côte — la phrase que F29 demande avant tout geste. */
  const addressPair =
    invitedEmail && email
      ? t('teamVaults.join.addressPair', { invited: invitedEmail, connected: email })
      : null;

  // Pas de session nuage : le jeton est CONSERVÉ. L'utilisateur se connecte,
  // l'invitation l'attend — c'est tout l'intérêt de l'avoir mise de côté.
  if (!isCloud) {
    // Sur le bureau, un profil de ce poste porte peut-être déjà l'adresse
    // invitée : le dire évite de se connecter au mauvais endroit puis de
    // recommencer. `verdict` est ici toujours `signIn` (aucune session).
    const signInProfile = verdict.kind === 'signIn' ? verdict.profile : null;
    return (
      <Modal isOpen onClose={() => close(false)} size="sm">
        <ModalHeader onClose={() => close(false)} closeLabel={t('common.close')}>
          {t('teamVaults.join.signInTitle')}
        </ModalHeader>
        <ModalBody>
          <p className="text-sm text-[var(--color-text-secondary)] m-0">
            {t('teamVaults.join.signInDesc')}
          </p>
          <p className="text-sm text-[var(--color-text-secondary)] mt-3 mb-0">
            {t('teamVaults.join.emailMustMatch')}
          </p>
          {invitedEmail && (
            <p className="text-xs text-[var(--color-text-tertiary)] mt-2 mb-0">
              {t('teamVaults.join.invitedAddress', { email: invitedEmail })}
            </p>
          )}
          {signInProfile && (
            <p className="text-xs text-[var(--color-text-tertiary)] mt-1 mb-0">
              {t('teamVaults.join.switchProfileHint', {
                email: invitedEmail,
                profile: signInProfile.name,
              })}
            </p>
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant="ghost" onClick={() => close(false)}>
            {t('teamVaults.join.later')}
          </Button>
          {signInProfile ? (
            <Button variant="primary" onClick={handleSwitchProfile}>
              {t('teamVaults.join.switchProfile')}
            </Button>
          ) : (
            <Button
              variant="primary"
              onClick={() => {
                setInviteSignInHint(invitedEmail);
                close(false);
                // Sans la catégorie, Settings retombe sur « Apparence » : l'écran
                // prescrivait un geste et déposait l'utilisateur sur le sélecteur
                // de thème, à quatorze entrées de celle qui porte le parcours.
                navigate('/settings?cat=compte');
              }}
            >
              {t('teamVaults.join.openAccountSettings')}
            </Button>
          )}
        </ModalFooter>
      </Modal>
    );
  }

  /**
   * L'INVITATION EST DÉJÀ MORTE, et le serveur l'a dit tout seul.
   *
   * Le 410 de l'aperçu est un FAIT affirmé sur l'invitation, pas un silence :
   * la faire vivre jusqu'à « Accepter » ne mènerait qu'au même refus, une
   * requête plus tard. Le jeton est donc consommé à la fermeture, comme il
   * l'aurait été après l'acceptation (`isDeadInviteError('invite_expired')`) —
   * sans quoi la même fenêtre reviendrait à chaque démarrage pendant sept jours,
   * sans qu'aucun geste puisse aboutir.
   */
  if (preview?.expired) {
    return (
      <Modal isOpen onClose={() => close(true, invite)} size="sm">
        <ModalHeader onClose={() => close(true, invite)} closeLabel={t('common.close')}>
          {t('teamVaults.join.title')}
        </ModalHeader>
        <ModalBody>
          <p role="alert" className="text-sm text-[var(--color-text-primary)] m-0">
            {t('teamVaults.join.errors.expired')}
          </p>
        </ModalBody>
        <ModalFooter>
          <Button variant="primary" onClick={() => close(true, invite)}>
            {t('teamVaults.join.dismiss')}
          </Button>
        </ModalFooter>
      </Modal>
    );
  }

  /**
   * L'invitation vise quelqu'un d'autre — et on le sait AVANT le geste.
   *
   * CE QU'ON MONTRE, ET CE QU'ON CONTINUE DE TAIRE. Les deux ADRESSES sont
   * nommées : celui qui regarde cet écran détient le jeton (il a ouvert le
   * lien), et l'adresse invitée est publique pour qui tient le jeton — c'est la
   * règle même des routes d'aperçu, la lui montrer ne lui apprend rien qu'il ne
   * puisse lire lui-même. Le NOM DE L'ESPACE, lui, reste tu : le titre demeure
   * générique, comme avant. C'est la seule chose que l'aperçu apprenait à
   * quelqu'un qui n'est pas le destinataire, et elle ne le regarde pas.
   *
   * « Accepter » DISPARAÎT : le proposer ici, c'est promettre un refus.
   * Le jeton, lui, reste en place — le vrai destinataire le trouvera.
   */
  if (isForAnotherAccount(invitedEmail, email)) {
    return (
      <Modal isOpen onClose={() => close(false)} size="sm">
        <ModalHeader onClose={() => close(false)} closeLabel={t('common.close')}>
          {t('teamVaults.join.title')}
        </ModalHeader>
        <ModalBody>
          <p className="text-sm text-[var(--color-text-primary)] m-0">
            {t('teamVaults.join.errors.wrongAccount')}
          </p>
          {addressPair && (
            <p className="text-xs text-[var(--color-text-tertiary)] mt-2 mb-0">{addressPair}</p>
          )}
          <p className="text-sm text-[var(--color-text-secondary)] mt-3 mb-0">{mismatchAdvice()}</p>
        </ModalBody>
        <ModalFooter>
          {/* Sourdine PAR COMPTE, et jamais sur le jeton : sans elle, la même
              fenêtre revenait à chaque démarrage pour quelqu'un qui n'est pas le
              destinataire, sans autre issue que d'attendre sept jours. */}
          <Button variant="ghost" onClick={() => muteInviteForAccount(invite, email)}>
            {t('teamVaults.join.muteForAccount')}
          </Button>
          <Button variant="ghost" onClick={() => close(false)}>
            {t('teamVaults.join.later')}
          </Button>
          {/* LE geste, et un seul : sur le bureau on retourne au sélecteur de
              profils (c'est le chemin de l'en-tête), sur le web on se déconnecte
              — il n'y a qu'une session par navigateur, et la ligne au-dessus le
              dit sans détour. */}
          <Button
            variant="primary"
            onClick={platform === 'web' ? handleSwitchAccount : handleSwitchProfile}
            data-autofocus
          >
            {platform === 'web'
              ? t('teamVaults.join.switchAccount')
              : t('teamVaults.join.switchProfile')}
          </Button>
        </ModalFooter>
      </Modal>
    );
  }

  const spaceName = preview?.orgName ?? null;
  const title = isOrg
    ? spaceName
      ? t('teamVaults.join.spaceTitle', { space: spaceName })
      : t('teamVaults.join.spaceTitleUnknown')
    : t('teamVaults.join.vaultTitle');

  const retryable = isVaultErrorRetryable(errorCode);
  const wrongRecipient = isWrongRecipientError(errorCode);
  /**
   * TOUTES les sorties de cette fenêtre passent par là — bouton de pied, croix,
   * Échap, clic hors de la fenêtre. Le sort du jeton dépend du VERDICT, jamais
   * du geste : sortir par la croix sur une invitation morte laissait sinon un
   * porteur qui rouvrait la même fenêtre pendant sept jours.
   */
  const dismiss = () => close(consumeOnClose(phase, errorCode), failure?.invite);

  return (
    <Modal isOpen onClose={dismiss} size="sm" ariaDescribedBy={descriptionId}>
      <ModalHeader onClose={dismiss} closeLabel={t('common.close')}>
        {title}
      </ModalHeader>
      <ModalBody>
        {phase === 'failed' ? (
          <>
            <p
              // `key` sur le code : réessayer et se voir opposer LE MÊME refus
              // remonterait le même nœud, et une région live ne réannonce que ce
              // qui change. Le remonter force la relecture — sans quoi le second
              // échec est silencieux pour un lecteur d'écran.
              key={errorCode ?? 'generic'}
              ref={failureRef}
              role="alert"
              tabIndex={-1}
              className="text-sm text-[var(--color-text-primary)] m-0"
            >
              {t(joinErrorKey(errorCode, 'teamVaults.join.errors.generic'))}
            </p>
            {/* Le serveur vient de dire ce que l'aperçu n'avait pas pu dire (hors
                ligne, plafond de requêtes) : le conseil qui suit doit être celui
                de CETTE plateforme, pas celui du web partout. */}
            {wrongRecipient && (
              <p className="text-sm text-[var(--color-text-secondary)] mt-3 mb-0">
                {platform === 'web'
                  ? t('teamVaults.join.wrongAccountAdviceWeb')
                  : t('teamVaults.join.wrongAccountAdviceDesktop')}
              </p>
            )}
          </>
        ) : (
          <>
            <p
              ref={workingRef}
              id={descriptionId}
              tabIndex={-1}
              role={phase === 'working' ? 'status' : undefined}
              className="text-sm text-[var(--color-text-secondary)] m-0"
            >
              {phase === 'working'
                ? t('teamVaults.join.accepting')
                : isOrg
                  ? t('teamVaults.join.spaceDesc')
                  : t('teamVaults.join.vaultDesc')}
            </p>
            {preview?.role && (
              <p className="text-sm text-[var(--color-text-secondary)] mt-2 mb-0">
                {t('teamVaults.join.roleLine', {
                  role: t(`teamVaults.role.${preview.role}`, preview.role),
                })}
              </p>
            )}
            {/* Les deux adresses côte à côte quand on les connaît : c'est la
                phrase qui rend l'écart visible AVANT le geste. Sinon on retombe
                sur ce que l'écran disait avant — l'adresse connectée, et la
                règle qui gouverne l'acceptation. */}
            {addressPair ? (
              <p className="text-xs text-[var(--color-text-tertiary)] mt-3 mb-0">{addressPair}</p>
            ) : (
              <>
                <p className="text-xs text-[var(--color-text-tertiary)] mt-3 mb-0">
                  {t('teamVaults.join.signedInAs', { email })}
                </p>
                <p className="text-xs text-[var(--color-text-tertiary)] mt-1 mb-0">
                  {t('teamVaults.join.emailMustMatch')}
                </p>
              </>
            )}
          </>
        )}
      </ModalBody>
      <ModalFooter>
        {phase === 'failed' ? (
          <>
            {/* « Fermer » n'efface le jeton que si le serveur a dit que
                l'invitation n'existe plus. Un refus seulement TERMINAL — session
                tombée, mauvais compte, panne classée en refus d'accès — le
                laisse en place : ces messages-là promettent tous que
                l'invitation attendra. */}
            <Button variant="ghost" onClick={dismiss}>
              {t('teamVaults.join.dismiss')}
            </Button>
            {/* Le serveur vient de dire que ce compte n'est pas le destinataire.
                Le jeton est CONSERVÉ, et c'est juste — il appartient à quelqu'un
                d'autre — mais sans cette issue la même fenêtre revenait à chaque
                démarrage pendant sept jours. */}
            {wrongRecipient && (
              <>
                <Button
                  variant="ghost"
                  onClick={() => {
                    if (failure) muteInviteForAccount(failure.invite, email);
                  }}
                >
                  {t('teamVaults.join.muteForAccount')}
                </Button>
                <Button
                  variant="primary"
                  onClick={platform === 'web' ? handleSwitchAccount : handleSwitchProfile}
                >
                  {platform === 'web'
                    ? t('teamVaults.join.switchAccount')
                    : t('teamVaults.join.switchProfile')}
                </Button>
              </>
            )}
            {/* Jamais en même temps que le bloc ci-dessus : les refus « mauvais
                destinataire » sont TERMINAUX, donc `retryable` y est déjà faux —
                réappuyer avec le même compte redonnerait le même refus. */}
            {retryable && (
              <Button variant="primary" onClick={() => void run()}>
                {t('teamVaults.join.retry')}
              </Button>
            )}
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={() => close(false)} disabled={phase === 'working'}>
              {t('teamVaults.join.later')}
            </Button>
            <Button
              variant="primary"
              onClick={() => void run()}
              disabled={phase === 'working'}
              loading={phase === 'working'}
              data-autofocus
            >
              {phase === 'working' ? t('teamVaults.join.accepting') : t('teamVaults.join.accept')}
            </Button>
          </>
        )}
      </ModalFooter>
    </Modal>
  );
};

export default PendingInviteHost;
