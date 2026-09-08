/**
 * UNE NOTE DE COFFRE, POSÉE DANS LE PANNEAU D'ÉDITION DE L'ONGLET NOTES.
 *
 * LE DÉFAUT QU'IL FERME, rapporté après un essai réel : « pour les notes dans
 * un coffre partagé, ça n'ouvre pas dans les notes de base de l'app ». Cliquer
 * une ligne de la section « Coffres partagés » emportait la personne dans
 * l'explorateur du coffre, où une fenêtre s'ouvrait par-dessus une grille de
 * fichiers. Or ce clic ne demande rien d'autre que de LIRE UNE NOTE : il doit
 * la poser là où on est, exactement comme un clic sur une note personnelle.
 *
 * ══ CE QUE CE FICHIER N'EST PAS, ET C'EST L'ESSENTIEL ═══════════════════════
 *
 * Ce n'est PAS un éditeur. Il ne connaît ni le chiffrement d'un élément, ni le
 * compare-and-set sur sa version, ni les révisions, ni la salle. Il monte
 * `VaultNoteEditor` — le vrai, le seul — dans son cadre « panneau », et se
 * contente de lui apporter les quatre choses que l'explorateur de coffre lui
 * apportait jusqu'ici : l'élément, le rôle, le droit d'écrire, et une sortie.
 *
 * L'alternative — brancher une note de coffre sur `notesSlice` et la rendre
 * avec `NoteEditor` — a été écartée, et l'en-tête d'`interactiveNoteExtensions`
 * dit pourquoi : la persistance d'une note de coffre n'a RIEN de commun avec
 * celle d'une note locale (élément chiffré, garde de version, révisions, salle
 * collaborative). La faire passer par le magasin des notes, ce serait la faire
 * ramasser par la recherche globale, le graphe, les modèles et la sync locale —
 * et perdre au passage l'élection d'enregistrement, sans laquelle deux membres
 * s'écrasent mutuellement.
 *
 * CE QUI EST DONC IDENTIQUE À L'OUVERTURE DEPUIS LE COFFRE : la salle
 * (`useVaultNoteCollab`), l'élection (`saveElection`), le veto de lecture seule
 * du relais (`serverReadOnly`), la bannière de version plus récente
 * (`shouldAnnounceNewerVersion`), la garde de fermeture. Seul le cadre change.
 *
 * ══ LA BANNIÈRE DE VERSION A BESOIN D'UNE LISTE VIVANTE ═════════════════════
 *
 * « Une version plus récente existe » se lit sur `item.version`, qui vient de
 * la LISTE d'éléments du magasin. Un panneau qui chargerait la liste une fois
 * et l'oublierait n'allumerait jamais cette bannière. On déclare donc ce coffre
 * au guetteur (`declareVaultsListed`) tant que la note est ouverte — le même
 * geste que fait la section qui a mené ici, pour la même raison.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDispatch, useSelector } from 'react-redux';

import { VaultKeypairGateModal } from '../vaults/VaultKeypairGate';
import type { AppDispatch, RootState } from '../../../store';
import {
  ensureVaultsLoaded,
  loadVaultItems,
  selectVaultById,
  selectVaultItems,
} from '../../../store/slices/vaultsSlice';
import { selectCanUseTeamVaults } from '../../../store/selectors/authSelectors';
import { declareVaultsListed } from '../../../services/vault/vaultListedElsewhere';
import { VaultKeypairGate } from '../vaults/VaultKeypairGate';
import { VaultNoteEditor } from '../vaults/VaultNoteEditor';
import { canEditVault, type VaultRole } from '../vaults/vaultExplorerModel';

interface Props {
  vaultId: string;
  itemId: string;
  /** Retour au panneau de notes ordinaire (la note se referme). */
  onExit: () => void;
  /** Vers l'explorateur du coffre, sur ce même élément. */
  onOpenInVault: () => void;
}

export const VaultNotePane: React.FC<Props> = ({ vaultId, itemId, onExit, onOpenInVault }) => {
  const { t } = useTranslation();
  const dispatch = useDispatch<AppDispatch>();

  const canUseTeamVaults = useSelector(selectCanUseTeamVaults);
  const vault = useSelector((s: RootState) => selectVaultById(s, vaultId));
  const items = useSelector((s: RootState) => selectVaultItems(s, vaultId));
  const unlocked = useSelector((s: RootState) => s.vaults.unlockedVaultIds.includes(vaultId));
  /**
   * « CHARGÉ » = LA CLÉ EXISTE, pas « le tableau est non vide » — même règle
   * que la section qui a mené ici. C'est la seule façon de distinguer une
   * réponse qui n'est pas revenue d'un coffre réellement vide.
   */
  const itemsLoaded = useSelector((s: RootState) => vaultId in s.vaults.itemsByVault);
  const loadFailed = useSelector((s: RootState) => vaultId in s.vaults.loadFailureByVault);

  /**
   * LA PORTE DE LA PAIRE DE CLÉS, OUVERTE À LA DEMANDE.
   *
   * Un coffre est « verrouillé » quand la clé privée du COMPTE n'est pas en
   * mémoire : c'est elle qui descelle K_vault. Le message se contentait de le
   * DIRE — « déverrouillez votre compte » —, ce qui ne décrit aucun geste. On
   * cherche alors un cadenas quelque part, et il n'y en a pas.
   *
   * On offre donc le geste : le bouton monte la porte, qui demande le mot de
   * passe du compte une fois.
   */
  const [gateOpen, setGateOpen] = useState(false);

  // Un onglet rouvert au démarrage sur cette adresse arrive avant tout chargement.
  useEffect(() => {
    void dispatch(ensureVaultsLoaded());
  }, [dispatch]);

  useEffect(() => {
    if (!unlocked || itemsLoaded) return;
    void dispatch(loadVaultItems({ vaultId }));
  }, [dispatch, vaultId, unlocked, itemsLoaded]);

  // Tant que la note est à l'écran, le guetteur tient sa liste à jour : c'est
  // ce qui permet à la bannière « version plus récente » de s'allumer seule.
  useEffect(() => declareVaultsListed([vaultId]), [vaultId]);

  const item = useMemo(() => items.find((i) => i.id === itemId) ?? null, [items, itemId]);

  const role = (vault?.role ?? 'viewer') as VaultRole;
  const canEdit = canEditVault(role, !!vault?.frozenAt);

  /**
   * LE SILENCE N'EST JAMAIS RENDU COMME UN VIDE — même discipline que la
   * section. Chaque raison de ne rien afficher a sa phrase, et aucune n'est
   * affirmée sur une ignorance : tant que la liste n'est pas revenue, on dit
   * « chargement », jamais « cette note n'existe pas ».
   */
  if (!canUseTeamVaults) return null;

  /**
   * ⚠ TROIS SITUATIONS PARTAGEAIENT UNE SEULE PHRASE, ET DEUX N'ÉTAIENT PAS DES
   * CHARGEMENTS.
   *
   * `!vault || !unlocked || !itemsLoaded` rendait « Chargement des notes… ».
   * Or un coffre VERROUILLÉ ne se déverrouille pas tout seul, et un coffre
   * AUQUEL ON N'A PLUS ACCÈS n'arrivera jamais : dans les deux cas le message
   * était faux, et il l'était pour toujours.
   *
   * ── ET SURTOUT, IL N'Y AVAIT AUCUNE SORTIE ────────────────────────────────
   *
   * Le retour et la fermeture vivent dans la barre de l'éditeur, que ce repli
   * ne rend pas. Quelqu'un qui quitte l'application sur une note de coffre, la
   * rouvre avec le coffre verrouillé, et retombe ici, n'avait plus AUCUN moyen
   * de revenir à ses notes ordinaires : chaque note cliquée réaffichait ce même
   * texte, puisque le panneau restait monté. C'est ce qui a fait dire, à juste
   * titre, que « toutes les notes étaient bloquées ».
   *
   * Chaque repli porte donc désormais le retour. Une impasse dans un écran est
   * un défaut plus grave que le message qui l'accompagne.
   */
  /**
   * L'ÉTAT VIDE DU PANNEAU — centré, borné, et toujours muni d'une sortie.
   *
   * L'ancien repli posait deux lignes de texte dans le coin haut-gauche d'une
   * zone d'écran entière. Ce n'est pas seulement laid : un message minuscule
   * perdu dans un grand vide se lit comme un reste d'affichage, pas comme une
   * explication qu'on nous adresse. On le centre, on le borne à une largeur de
   * lecture, et on lui donne un glyphe qui dit de quoi il retourne AVANT qu'on
   * ait lu la phrase.
   */
  const placeholder = (
    body: React.ReactNode,
    glyph: 'lock' | 'wait' | 'gone'
  ): React.ReactElement => (
    <div className="vault-note-pane vault-note-pane--placeholder">
      <div className="vault-stuck">
        <span className={`vault-stuck__glyph vault-stuck__glyph--${glyph}`} aria-hidden="true">
          {glyph === 'lock' ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
              <rect x="4" y="10" width="16" height="10" rx="2" />
              <path d="M8 10V7a4 4 0 0 1 8 0v3" strokeLinecap="round" />
            </svg>
          ) : glyph === 'gone' ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
              <circle cx="12" cy="12" r="8" />
              <path d="M8.5 8.5l7 7" strokeLinecap="round" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
              <circle cx="12" cy="12" r="8" />
              <path d="M12 8v4l2.5 2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </span>
        {body}
        <button type="button" className="vault-stuck__exit" onClick={onExit}>
          {t('teamVaults.notesSection.backToNotes')}
        </button>
      </div>
    </div>
  );

  // 1. LE COFFRE N'EST PLUS LÀ. Accès retiré, coffre supprimé, ou simplement
  //    pas encore revenu de la liste — mais `ensureVaultsLoaded` a été demandé
  //    au montage, donc au-delà d'un instant c'est un vrai « plus d'accès ».
  if (!vault) {
    return placeholder(
      <p className="vault-stuck__body">{t('teamVaults.notesSection.noAccess')}</p>,
      'gone'
    );
  }

  // 2. LE COFFRE EST VERROUILLÉ. Ce n'est pas une panne : c'est un geste qui
  //    manque, et la phrase le dit — même vocabulaire que la section.
  if (!unlocked) {
    return placeholder(
      <>
        <p className="vault-stuck__title">{t('teamVaults.notesSection.sharedLockedTitle')}</p>
        <p className="vault-stuck__body">{t('teamVaults.notesSection.sharedLockedBody')}</p>
        <button type="button" className="vault-stuck__action" onClick={() => setGateOpen(true)}>
          {t('teamVaults.notesSection.unlockAction')}
        </button>
        <VaultKeypairGateModal
          isOpen={gateOpen}
          onClose={() => setGateOpen(false)}
          onReady={() => {
            setGateOpen(false);
            /**
             * La clé est en mémoire ; il reste à REDESCELLER les coffres.
             *
             * `ensureVaultsLoaded` est fait pour exactement ça : sa garde
             * autorise UN rechargement de plus dès que la clé arrive, et son
             * commentaire nomme ce cas — « le cas qui rendait un coffre
             * verrouillé après le mot de passe ». Sans ce second temps, la
             * porte se refermerait sur le même écran, et le geste paraîtrait
             * n'avoir servi à rien.
             */
            void dispatch(ensureVaultsLoaded());
          }}
        />
      </>,
      'lock'
    );
  }

  // 3. LA LECTURE A ÉCHOUÉ. Avec une reprise : un aveu sans geste n'est qu'un
  //    reproche, et un réseau parti puis revenu se répare d'un clic.
  if (loadFailed) {
    return placeholder(
      <>
        <p className="vault-stuck__body">{t('teamVaults.notesSection.failed')}</p>
        <button
          type="button"
          className="vault-failed__retry"
          onClick={() => void dispatch(loadVaultItems({ vaultId }))}
        >
          {t('teamVaults.notesSection.retry')}
        </button>
      </>,
      'wait'
    );
  }

  // 4. Et seulement maintenant : un vrai chargement, qui va aboutir.
  if (!itemsLoaded) {
    return placeholder(
      <p className="vault-stuck__body vault-loading">
        <span className="vault-loading__dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        {t('teamVaults.notesSection.loading')}
      </p>,
      'wait'
    );
  }

  if (!item) {
    return placeholder(
      <p className="vault-stuck__body">{t('teamVaults.noteEditor.loadError')}</p>,
      'gone'
    );
  }

  return (
    /* La paire de clés E2 est un prérequis BLOQUANT de toute UI de coffre — le
       corps de l'élément ne se déchiffre pas sans elle. La route du coffre pose
       la même porte ; ne pas la poser ici aurait produit, après un
       déverrouillage par code, un éditeur qui échoue au chargement sans dire
       pourquoi. */
    <VaultKeypairGate>
      <VaultNoteEditor
        isOpen
        variant="pane"
        onClose={onExit}
        onOpenInVault={onOpenInVault}
        vaultName={vault.name}
        vaultId={vaultId}
        item={item}
        canEdit={canEdit}
        role={role}
      />
    </VaultKeypairGate>
  );
};

export default VaultNotePane;
