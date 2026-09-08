/**
 * InviteRow — UNE ligne pour faire entrer quelqu'un dans un coffre, et UN SEUL
 * code pour les deux écrans qui la portent (F02).
 *
 * CE QU'ELLE REMPLACE. Il y avait deux implémentations du même geste : le
 * dialogue de partage (une ligne, deux voies détectées) et l'ancien
 * `InviteMemberModal`, où deux boutons sans rapport se disputaient la même
 * boîte — « Invite » envoyait une invitation d'ESPACE, « Give access » scellait
 * la clé du COFFRE, et le seul pont entre les deux était un toast d'erreur.
 * Dix-sept incohérences ont été relevées entre les deux écrans (messages, ordre
 * des rôles, `already_member` à trois sens). Un seul code ne peut plus diverger
 * d'avec lui-même.
 *
 * L'ISSUE EST ANNONCÉE AVANT LE CLIC. Pendant la frappe, une pastille dit ce qui
 * va se passer et le bouton porte le nom de ce geste-là — les cinq états et
 * leurs règles vivent dans `inviteRowModel`, pur et éprouvé :
 *   · dans votre espace  → l'accès est donné MAINTENANT (F06, ajout direct), la
 *     cérémonie du numéro de sécurité se déplie sous la ligne ;
 *   · nouvelle personne  → invitation d'espace + intention (0073), l'accès suit
 *     tout seul à l'acceptation ;
 *   · a déjà accès       → rien à envoyer, et « Voir la ligne » y emmène ;
 *   · adresse incomplète → aucun message alarmant ;
 *   · annuaire illisible → on ne route pas à l'aveugle, on propose de relire.
 *
 * DEUX CHOSES QU'ELLE NE FAIT PLUS COMME AVANT :
 *   — le champ RESTE ACTIF quand l'espace est plein : sceller la clé à quelqu'un
 *     qui y est déjà ne consomme aucun siège, et l'ancien modal désactivait tout ;
 *   — le 409 `already_member` de la route d'ESPACE (l'adresse y est, mais
 *     l'annuaire ne la connaissait pas encore) est traité UNE fois, ici : on
 *     relit l'annuaire et la ligne bascule d'elle-même sur « donner l'accès »,
 *     au lieu du « réessayez dans un instant » qui n'avait aucune chance.
 *
 * ELLE NOMME LES GENS, ELLE NE SE CONTENTE PLUS D'ATTENDRE. Un champ vide ne
 * répond pas à la question que l'hôte se pose vraiment — « qui, dans mon espace,
 * n'a pas encore accès ? ». L'ancien modal avait au moins son sélecteur
 * « Person » ; en le supprimant on a supprimé la seule surface qui répondait,
 * d'où le rapport « je ne vois toujours pas matbel ». Au focus du champ, et
 * pendant la frappe, une liste déroulante propose les candidats de l'espace
 * (`spaceCandidatesModel`) ; choisir une ligne POSE l'adresse dans le champ, ce
 * qui fait tout le reste tout seul — la route bascule sur `member`, la cérémonie
 * d'empreinte se déplie, le bouton s'arme. La liste ne s'ouvre que sur un
 * annuaire LU (`directoryState === 'ok'`) et ne gêne jamais la saisie d'une
 * adresse inconnue : la position « -1 » du cycle des flèches est le texte tapé.
 *
 * CETTE LISTE VIT DANS UN PORTAIL, ET C'EST UN CORRECTIF. Posée dans le flux du
 * champ, elle se faisait DÉCOUPER par ses deux conteneurs — `.ent-section`
 * (`overflow: hidden`) sur l'onglet Membres, `.modal-body` (`overflow-y: auto`,
 * qui calcule l'axe horizontal en `auto`) dans le dialogue de partage — au point
 * de ne montrer qu'une ligne rognée, voire un liseré, au moment précis où l'on
 * vient de prendre le focus pour voir QUI est dans l'espace. Le portail est le
 * chemin que le design système a choisi pour cela : `--z-index-dropdown` (1065)
 * passe AU-DESSUS de `--z-index-modal` (1060), et le `Select` de rôle de la même
 * rangée s'affiche déjà ainsi dans la même modale. Le calcul de position, avec
 * ses trois pièges, vit dans `suggestionAnchor` — lire son en-tête ; ce que le
 * portail découpe VRAIMENT se mesure ici (`clipBoxAround`), parce que la fenêtre
 * ne défile jamais dans cette application.
 *
 * TROIS CHOSES QUE LE PORTAIL A COÛTÉES, ET QU'IL FALLAIT RENDRE À LA MAIN. Le
 * navigateur ne tient plus rien : ni le lien du champ à sa liste (d'où la
 * mesure), ni le défilement de la liste sous les flèches (d'où le rappel de la
 * ligne active sous l'œil — sans lui, le surlignage part sous le bord de la
 * boîte et le cycle se lit comme une panne), ni la présence du `listbox` que
 * `aria-controls` désigne (d'où la boîte montée en permanence, repliée par
 * `hidden`).
 *
 * LA CLÉ SCELLÉE EST TOUJOURS CELLE QUE LA CÉRÉMONIE A VÉRIFIÉE
 * (`kv.sealArgs.peerKey`), jamais une clé re-téléchargée : la redemander
 * rouvrirait la fenêtre où le serveur peut en substituer une autre entre le
 * contrôle et le scellé.
 */

import React, {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { Avatar, Button, Input, Select } from '../ui';
import { useNotification } from '../ui/Notification';
// La liste de suggestions emprunte la peau des menus du design système
// (`select-dropdown*`) plutôt que d'inventer la sienne. L'import est EXPLICITE :
// s'appuyer sur le fait que le `Select` juste à côté charge déjà cette feuille
// marcherait aujourd'hui et laisserait la liste nue le jour où ce `Select`
// disparaît — une panne visuelle silencieuse, sans erreur nulle part.
import '../ui/Dropdown/Select.css';
import type { AppDispatch, RootState } from '../../../store';
import { addMemberDirect } from '../../../store/slices/vaultsSlice';
import {
  apiGetVaultSeats,
  apiInviteToVaultSpace,
  type SpaceDirectoryEntry,
  type VaultInviteDTO,
  type VaultMemberDTO,
  type VaultSeatsDTO,
} from '../../../services/vault/vaultApi';
import { vaultErrorKey, errorText } from '../../../services/vault/vaultErrorMessages';
import { usePeerKeyVerification, KeyVerificationPanel } from '../vaults/KeyVerification';
import { DirectoryNotice, type DirectoryState } from '../vaults/spaceDirectory';
import {
  ASSIGNABLE_VAULT_ROLES,
  blockedGrantsForVault,
  inviteBlockedBySeats,
  inviteRouteWithDirectory,
  isAssignableVaultRole,
  seatGate,
  type AssignableVaultRole,
} from './shareDialogModel';
import { inviteRowView, INVITE_ROW_KEYS } from './inviteRowModel';
import { InviteLinkActions } from './InviteLinkActions';
import { useContainerBreakpoint } from '../../styles/useContainerBreakpoint';
import { seatsFullState, VAULT_EMPTY_KEYS } from '../vaults/settings/vaultSettingsEmptyStates';
import {
  CANDIDATE_SUGGESTION_LIMIT,
  nextCandidateIndex,
  spaceCandidates,
} from '../vaults/settings/spaceCandidatesModel';
import { suggestionAnchor } from './suggestionAnchor';

/**
 * Les rôles proposés, DANS LE MÊME ORDRE PARTOUT et sous les mêmes clés. Les
 * deux écrans les listaient différemment (member/viewer/admin ici,
 * admin/member/viewer là) : le même menu ne doit pas changer d'ordre selon la
 * porte par laquelle on est entré, sinon le geste appris à un endroit se
 * retourne à l'autre.
 */
export const vaultRoleOptions = (t: TFunction) =>
  ASSIGNABLE_VAULT_ROLES.map((value) => ({ value, label: t(`teamVaults.role.${value}`, value) }));

/**
 * LA BOÎTE QUI DÉCOUPE VRAIMENT LE CHAMP, en coordonnées de fenêtre.
 *
 * POURQUOI LA FENÊTRE NE SUFFIT PAS — ET C'ÉTAIT LE DÉFAUT. `reset.css` pose
 * `body { overflow: hidden }` et `#root { height: 100dvh; overflow: hidden }` :
 * la fenêtre NE DÉFILE JAMAIS ici, `window.scrollY` vaut éternellement 0 et
 * `window.innerHeight` couvre tout. Ce qui défile est un conteneur INTÉRIEUR —
 * la page des réglages (`height: 100%; overflow-y: auto`) et `.modal-body` du
 * dialogue de partage. Un champ entièrement rentré sous l'en-tête de page garde
 * donc un `rect.top` très confortablement compris entre 0 et la hauteur de
 * fenêtre : la garde « liste orpheline » se déclarait satisfaite et la liste
 * remontait se poser sur du contenu étranger.
 *
 * ON CROISE TOUS LES ANCÊTRES QUI DÉCOUPENT, PAS SEULEMENT LE PREMIER. Le
 * premier rencontré sur l'onglet Membres est `.ent-section` (`overflow: hidden`)
 * — et il CONTIENT toujours la rangée, donc il ne dit jamais rien d'utile : s'en
 * contenter laisserait la garde aussi aveugle qu'avant. C'est le conteneur
 * défilant plus haut qui porte le verdict.
 *
 * Le coût est payé seulement liste OUVERTE : la remontée n'a lieu que dans
 * `measureAnchor`, et les deux hôtes ont une dizaine de niveaux au-dessus du
 * champ.
 */
function clipBoxAround(el: HTMLElement): { clipTop: number; clipBottom: number } {
  let clipTop = 0;
  let clipBottom = window.innerHeight;
  for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
    const s = window.getComputedStyle(n);
    if (s.overflowY === 'visible' && s.overflowX === 'visible') continue;
    const r = n.getBoundingClientRect();
    clipTop = Math.max(clipTop, r.top);
    clipBottom = Math.min(clipBottom, r.bottom);
  }
  return { clipTop, clipBottom };
}

export interface InviteRowProps {
  vaultId: string;
  /** L'espace DU COFFRE — c'est là qu'un nouveau venu doit entrer, pas dans le mien. */
  orgId: string | null;
  /** L'annuaire de cet espace (P2), lu par la route du coffre. */
  directory: readonly SpaceDirectoryEntry[];
  /** Ce qu'on sait de sa lecture — jamais avalé : c'est l'état `unknown`. */
  directoryState: DirectoryState;
  onRetryDirectory: () => void;
  /**
   * Les membres du coffre. La LISTE, pas seulement les identifiants : « a déjà
   * accès » doit pouvoir nommer le rôle, et « Voir la ligne » viser la bonne.
   */
  vaultMembers: readonly Pick<VaultMemberDTO, 'userId' | 'role'>[];
  /**
   * Les invitations de coffre que l'hôte a déjà lues, s'il en a. Elles ne
   * changent AUCUNE décision — quelqu'un de l'espace reçoit l'accès directement,
   * invitation en vol ou pas (F06) — elles servent seulement à ne pas laisser
   * croire qu'on n'a rien fait pour cette personne. Absentes pour un rôle sans
   * la route, et la liste se contente alors de ne rien dire.
   */
  pendingInvites?: readonly VaultInviteDTO[];
  /**
   * Le rôle pré-sélectionné — `defaultInviteRole` des réglages du coffre (F13).
   * « membre » quand l'appelant ne les a pas lus, ce qui est le défaut du
   * serveur et le comportement d'avant la fiche.
   */
  defaultRole?: AssignableVaultRole;
  /** Poser la main sur le champ au montage (raccourci « Partager » du menu). */
  autoFocus?: boolean;
  /** Emmener vers la ligne de quelqu'un qui a déjà accès — l'hôte sait où elle est. */
  onSeeRow?: (userId: string) => void;
  /** Le geste a abouti : l'hôte relit sa liste ET invalide ses agrégats. */
  onDone: (kind: 'granted' | 'invited') => void | Promise<void>;
}

/**
 * Ce qu'un hôte peut demander à la ligne, de l'extérieur (F05).
 *
 * POURQUOI UNE POIGNÉE PLUTÔT QU'UN `document.querySelector`. L'état vide
 * « vous êtes seul dans ce coffre » porte un bouton qui doit poser la main dans
 * CE champ-ci. Le viser par sélecteur marcherait aujourd'hui et se casserait en
 * silence au premier champ e-mail ajouté ailleurs sur la page — sans rien
 * casser de visible, juste un bouton qui ne fait plus rien. La poignée, elle,
 * disparaît à la compilation si le champ disparaît.
 */
export interface InviteRowHandle {
  /** Poser la main dans le champ d'adresse. */
  focus: () => void;
  /**
   * Poser une adresse DANS le champ, puis y mettre la main.
   *
   * POURQUOI PAS UN SIMPLE `focus()` SUIVI D'UNE PROP. La section « Dans
   * l'espace de ce coffre, sans accès » nomme des gens et propose de leur
   * donner l'accès : son bouton doit remplir la ligne, pas seulement la
   * désigner. Passer l'adresse par une prop obligerait l'hôte à en tenir
   * l'état — donc à décider quand l'effacer — alors que la ligne est déjà
   * maîtresse de son champ, et qu'elle l'efface elle-même après un envoi
   * réussi. Un geste, un appel.
   */
  prefill: (email: string) => void;
}

export const InviteRow = forwardRef<InviteRowHandle, InviteRowProps>(function InviteRow(
  {
    vaultId,
    orgId,
    directory,
    directoryState,
    onRetryDirectory,
    vaultMembers,
    pendingInvites,
    defaultRole = 'member',
    autoFocus,
    onSeeRow,
    onDone,
  },
  ref
) {
  const { t, i18n } = useTranslation();
  const dispatch = useDispatch<AppDispatch>();
  const navigate = useNavigate();
  const { success, error } = useNotification();
  const [email, setEmail] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const [role, setRole] = useState<AssignableVaultRole>(defaultRole);
  /**
   * LE RÔLE PAR DÉFAUT DU COFFRE ARRIVE APRÈS LE PREMIER RENDU (F13).
   *
   * Il se lit en réseau (`GET /:id/settings`), si bien que `useState(defaultRole)`
   * fige « membre » avant que le coffre ait dit ce qu'il veut — et un réglage
   * qui ne s'applique jamais est pire que pas de réglage. On l'adopte donc quand
   * il arrive, mais SEULEMENT tant que personne n'a touché au menu : sinon un
   * chargement en retard écraserait un choix délibéré, exactement à l'instant où
   * l'hôte s'apprête à cliquer. Un `ref` et non un état : le savoir n'a rien à
   * repeindre.
   */
  const roleTouched = useRef(false);
  useEffect(() => {
    if (!roleTouched.current) setRole(defaultRole);
  }, [defaultRole]);
  const [seats, setSeats] = useState<VaultSeatsDTO | null>(null);
  const [sending, setSending] = useState(false);
  /** L'adresse dont le serveur vient de dire qu'elle est DÉJÀ dans l'espace. */
  const [staleInSpace, setStaleInSpace] = useState<string | null>(null);

  /**
   * LE LIEN D'INVITATION QUI VIENT D'ÊTRE ÉMIS (F16) — état LOCAL, et rien
   * d'autre.
   *
   * Le serveur ne le rend qu'une fois (il ne garde que le SHA-256 du jeton) :
   * s'il n'est pas ici, il n'est plus nulle part. C'est aussi la raison pour
   * laquelle il n'entre ni dans Redux, ni dans localStorage — un porteur d'accès
   * ne se persiste pas, il se transmet puis s'oublie. Démonter la ligne (fermer
   * le dialogue, changer d'onglet) l'efface de l'écran ; le compte à rebours du
   * presse-papiers, lui, SURVIT à ce démontage (il vit dans `inviteLinkHygiene`)
   * — on ferme justement pour aller coller, et c'est à ce moment-là que
   * l'effacement promis doit encore avoir lieu.
   */
  const [issuedLink, setIssuedLink] = useState<{
    url: string;
    email: string;
    expiresAtMs: number | null;
  } | null>(null);

  /**
   * LA LISTE DE SUGGESTIONS. Deux états seulement : est-elle dépliée, et sur
   * quelle ligne sont les flèches. `-1` n'est pas « aucune » mais « le texte que
   * j'ai tapé » — c'est ce qui permet d'inviter un inconnu sans que la liste
   * s'interpose (voir `nextCandidateIndex`).
   */
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const listId = useId();
  /**
   * LA RAISON DU BOUTON ÉTEINT, RATTACHÉE AU BOUTON. Un bouton désactivé sans
   * explication est le pire des deux mondes : le lecteur d'écran l'annonce
   * « indisponible » et s'arrête là. La phrase d'occupation est juste en
   * dessous ; `aria-describedby` la lui donne au lieu de la lui laisser
   * chercher.
   */
  const occupancyId = useId();
  /**
   * OÙ LA POSER, puisqu'elle ne vit plus dans le flux du champ. La liste part
   * dans un portail sur `document.body` — elle était sinon DÉCOUPÉE par ses deux
   * conteneurs (`.ent-section { overflow: hidden }` sur l'onglet Membres,
   * `.modal-body { overflow-y: auto }` dans le dialogue de partage), au point de
   * ne montrer qu'un liseré. Le calcul, avec ses deux pièges, vit dans
   * `suggestionAnchor` : voir son en-tête. `null` = rien à afficher encore.
   */
  const [anchor, setAnchor] = useState<{
    placement: 'below' | 'above';
    top: number;
    left: number;
    width: number;
  } | null>(null);
  /** La boîte du portail — pour ramener sous l'œil la ligne que les flèches désignent. */
  const dropdownRef = useRef<HTMLDivElement>(null);
  /**
   * Ce qu'on vient de poser dans le champ, POUR LE DIRE À VOIX HAUTE. Choisir
   * une suggestion (ou un candidat de la section voisine) déplace le focus vers
   * le champ sans rien annoncer : à un lecteur d'écran, le geste est muet. On
   * garde l'adresse plutôt que la phrase — la ligne existe en deux langues, et
   * `prefill` ne doit pas dépendre de `t`.
   *
   * LE COMPTEUR N'EST PAS DÉCORATIF. Rechoisir LA MÊME personne (le bouton
   * « Donner l'accès » de la section voisine, deux fois de suite, sans frappe
   * entre les deux) réécrivait la même chaîne : React ne touchait pas le nœud de
   * texte, aucune mutation n'atteignait la région polie, et le second geste était
   * muet — c'est-à-dire précisément le silence qu'elle existe pour rompre. Le
   * numéro sert de `key` : le nœud est remplacé, la région le voit.
   */
  const [announced, setAnnounced] = useState<{ email: string; n: number } | null>(null);

  /**
   * Poser une adresse dans le champ et rendre la main — le geste de la
   * sélection d'une suggestion ET celui du bouton « Donner l'accès » de la
   * section des candidats (`InviteRowHandle.prefill`). Le focus revient au
   * champ : la cérémonie d'empreinte se déplie juste dessous, et l'hôte doit
   * pouvoir corriger l'adresse sans reprendre la souris.
   *
   * LE DRAPEAU N'EST PAS DE LA COQUETTERIE. Quand l'appel vient du bouton
   * « Donner l'accès » de la section des candidats, le champ n'a PAS encore le
   * focus : le `focus()` ci-dessous déclenche synchroniquement l'`onFocus` du
   * champ, qui rouvrirait la liste sur la personne qu'on vient justement de
   * choisir. On dit donc une fois, et une seule, que cette prise de focus-là ne
   * doit rien ouvrir.
   */
  const skipNextFocusOpen = useRef(false);
  const prefill = useCallback((next: string) => {
    setEmail(next);
    setStaleInSpace(null);
    setSuggestOpen(false);
    setActiveIndex(-1);
    // Le déplacement du focus est visible ; il n'est pas AUDIBLE. La région
    // polie ci-dessous dit ce qui vient d'être posé, sinon la sélection d'un
    // candidat ne se manifeste par rien pour qui n'a pas l'écran.
    setAnnounced((prev) => ({ email: next, n: (prev?.n ?? 0) + 1 }));
    skipNextFocusOpen.current = true;
    inputRef.current?.focus();
    skipNextFocusOpen.current = false;
  }, []);

  useImperativeHandle(ref, () => ({ focus: () => inputRef.current?.focus(), prefill }), [prefill]);

  /**
   * Les accès que le balayage n'a pas pu accorder seul (clé changée…) : lus ici
   * plutôt que passés par chaque hôte, pour que la pastille apparaisse aux deux
   * endroits sans que personne n'ait à y penser.
   */
  const blockedAll = useSelector((s: RootState) => s.vaults.blockedGrants);
  const blocked = useMemo(() => blockedGrantsForVault(blockedAll, vaultId), [blockedAll, vaultId]);

  // Le plafond de sièges, lu à l'ouverture — AVANT tout refus, pour que la
  // montée d'offre soit proposée plutôt qu'une invitation brûlée.
  const loadSeats = useCallback(() => apiGetVaultSeats().then(setSeats), []);
  useEffect(() => {
    let vivant = true;
    void apiGetVaultSeats().then((s) => {
      if (vivant) setSeats(s);
    });
    // Un cleanup rendu DANS TOUS LES CAS : sinon TS7030.
    return () => {
      vivant = false;
    };
  }, []);

  const memberIds = useMemo(() => vaultMembers.map((m) => m.userId), [vaultMembers]);
  const route = useMemo(
    () => inviteRouteWithDirectory(email, directory, directoryState, memberIds),
    [email, directory, directoryState, memberIds]
  );
  const gate = useMemo(() => seatGate(seats), [seats]);

  /**
   * Les gens de l'espace qui n'ont pas encore accès, réduits par ce qui est
   * tapé. Mon propre identifiant est lu ICI plutôt que passé par chaque hôte :
   * les deux écrans qui portent la ligne ne doivent pas pouvoir en donner deux
   * réponses différentes — et se proposer soi-même serait absurde aux deux.
   */
  const myUserId = useSelector((s: RootState) => s.auth.cloudUser?.id ?? null);
  const candidates = useMemo(
    () =>
      spaceCandidates({
        directory,
        members: vaultMembers,
        invites: pendingInvites,
        myUserId,
        filter: email,
        limit: CANDIDATE_SUGGESTION_LIMIT,
      }),
    [directory, vaultMembers, pendingInvites, myUserId, email]
  );

  /**
   * La liste ne s'ouvre QUE sur un annuaire réellement lu. Sur `forbidden` ou
   * `unavailable`, `directory` est vide : une liste vide se lirait « il n'y a
   * personne dans votre espace », c'est-à-dire l'affirmation exacte que P2
   * s'est employé à supprimer. `DirectoryNotice`, juste dessous, dit ce qui
   * s'est passé — la liste, elle, se tait.
   */
  const suggestions = directoryState === 'ok' ? candidates.items : [];
  const listOpen = suggestOpen && suggestions.length > 0;
  // Un index survivant à un rétrécissement de la liste ne doit pas désigner une
  // ligne disparue : on retombe sur « le texte que j'ai tapé ».
  const active = activeIndex >= 0 && activeIndex < suggestions.length ? activeIndex : -1;

  /**
   * MESURER LE CHAMP, parce que le portail a coupé le lien que le navigateur
   * tenait tout seul. Recopié du `Select` du design système
   * (`ui/Dropdown/Select.tsx`), y compris sa capture : le défilement d'un
   * conteneur INTÉRIEUR — le corps de la modale de partage, la page des
   * réglages — ne bouillonne pas jusqu'à `window`, et sans `capture: true` la
   * liste se décrocherait du champ au premier coup de molette.
   *
   * Un champ sorti de l'écran REFERME la liste au lieu de la traîner : sans son
   * conteneur pour la découper, elle survivrait au champ et se poserait sur un
   * contenu étranger. « Sorti » se juge contre la boîte qui découpe RÉELLEMENT
   * (`clipBoxAround`) et non contre la fenêtre : ici, la fenêtre ne défile
   * jamais — lire son en-tête.
   */
  const measureAnchor = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const { clipTop, clipBottom } = clipBoxAround(el);
    const next = suggestionAnchor(
      { top: r.top, bottom: r.bottom, left: r.left, width: r.width },
      { scrollX: window.scrollX, scrollY: window.scrollY, clipTop, clipBottom }
    );
    if (!next.visible) {
      setSuggestOpen(false);
      setActiveIndex(-1);
      setAnchor(null);
      return;
    }
    // Le même rectangle rend le MÊME objet : `scroll` en capture se déclenche à
    // chaque image, et un objet neuf à chaque fois ferait re-rendre toute la
    // ligne — cérémonie d'empreinte comprise — pendant qu'on fait défiler.
    setAnchor((prev) =>
      prev &&
      prev.placement === next.placement &&
      prev.top === next.top &&
      prev.left === next.left &&
      prev.width === next.width
        ? prev
        : { placement: next.placement, top: next.top, left: next.left, width: next.width }
    );
  }, []);

  useEffect(() => {
    if (!listOpen) {
      setAnchor(null);
      // Un cleanup rendu DANS TOUS LES CAS : sinon TS7030.
      return undefined;
    }
    measureAnchor();
    window.addEventListener('resize', measureAnchor);
    window.addEventListener('scroll', measureAnchor, true);
    return () => {
      window.removeEventListener('resize', measureAnchor);
      window.removeEventListener('scroll', measureAnchor, true);
    };
  }, [listOpen, measureAnchor]);

  /**
   * RAMENER SOUS L'ŒIL LA LIGNE QUE LES FLÈCHES DÉSIGNENT. La liste emprunte
   * `.select-dropdown__list` (`max-height: 280px`, 200 sous 640 px de large) et
   * en montre huit : à 36-40 px la ligne, les deux ou trois dernières sont hors
   * de la boîte. Sans ce rappel, `aria-activedescendant` et le surlignage
   * partaient dessous sans que rien ne bouge à l'écran — le cycle des flèches se
   * lisait comme une panne. Le `Select` du design système, dont cette liste est
   * la copie, fait exactement cela (`ui/Dropdown/Select.tsx`).
   *
   * ON VISE PAR `data-option-index`, PAS PAR L'IDENTIFIANT. `listId` vient de
   * `useId()` et contient des deux-points (`:r0:`) : ce n'est pas un sélecteur
   * CSS valide sans échappement, et c'est précisément pourquoi le design système
   * indexe les siennes.
   */
  useEffect(() => {
    if (listOpen && active >= 0) {
      const li = dropdownRef.current?.querySelector(
        `[data-option-index="${active}"]`
      ) as HTMLElement | null;
      li?.scrollIntoView({ block: 'nearest' });
    }
    // Un cleanup rendu DANS TOUS LES CAS : sinon TS7030.
    return undefined;
  }, [active, listOpen]);

  // La cérémonie ne se lance que pour quelqu'un DE L'ESPACE — la seule personne
  // dont on puisse résoudre la clé (découverte org-scopée, anti-énumération).
  const selectedUserId = route.kind === 'member' ? route.member.userId : null;
  const onLookupFailed = useCallback(() => error(t('teamVaults.errors.noKey')), [error, t]);
  const kv = usePeerKeyVerification(selectedUserId, { onLookupFailed });

  /**
   * LE PLAFOND, POUR CETTE VOIE-LÀ SEULEMENT. Donner l'accès à quelqu'un qui est
   * DÉJÀ dans l'espace ne consomme aucun siège : ce chemin reste ouvert même
   * quand l'espace est plein — c'est ce que l'ancien modal avait faux, en
   * éteignant le champ entier.
   */
  const seatBlocked = inviteBlockedBySeats(route, gate);

  const view = inviteRowView(route, {
    keyReady: kv.canProceed,
    needsConfirm: kv.needsConfirm,
    seatBlocked,
    hasOrg: !!orgId,
    sending,
  });

  /** Le rôle de la personne qui a déjà accès — pour le dire, pas pour décider. */
  const existingRole =
    route.kind === 'inVault'
      ? (vaultMembers.find((m) => m.userId === route.member.userId)?.role ?? 'member')
      : 'member';

  const send = async () => {
    if (!view.canSend) return;
    setSending(true);
    try {
      if (route.kind === 'member') {
        if (!kv.sealArgs) return;
        // Un changement de clé accepté devient la base TOFU AVANT de sceller.
        kv.pinAcceptedChange();
        await dispatch(
          addMemberDirect({
            vaultId,
            userId: route.member.userId,
            email: route.member.email,
            role,
            // La clé EXACTEMENT vérifiée — jamais re-téléchargée.
            peerKey: kv.sealArgs.peerKey,
            // L'avis d'accès parle la langue de celui qui donne, comme les
            // invitations : le serveur ne connaît pas celle du destinataire.
            lang: i18n.language,
          })
        ).unwrap();
        success(t('teamVaults.invite.accessGiven', { email: route.member.email }));
        setEmail('');
        setStaleInSpace(null);
        await onDone('granted');
      } else if (route.kind === 'newcomer') {
        if (!orgId) return;
        const emise = await apiInviteToVaultSpace(orgId, {
          email: route.email,
          // Moindre privilège : un lecteur entre en lecture, les autres en
          // éditeur — qui n'accorde AUCUN droit de gestion sur l'espace.
          role: role === 'viewer' ? 'viewer' : 'editor',
          lang: i18n.language,
          // L'intention (0073) : le rôle DE COFFRE choisi ci-contre. Aucune
          // cérémonie maintenant — différée au balayage de l'hôte.
          intendedVaultId: vaultId,
          intendedVaultRole: role,
        });
        success(t('teamVaults.members.spaceInviteSentWithAccess', { email: route.email }));
        /**
         * LE LIEN, RECUEILLI ICI OU PERDU POUR TOUJOURS (F16). Un worker d'avant
         * la fiche n'en renvoie pas : on n'affiche alors simplement pas les deux
         * boutons — on n'invente pas d'URL, et on ne prétend pas qu'elle a
         * échoué. L'échéance vient du serveur ou reste nulle (jamais un TTL
         * deviné : le QR affiche une date, elle doit être vraie).
         */
        if (emise.inviteUrl) {
          const echeance = emise.expiresAt ? Date.parse(emise.expiresAt) : NaN;
          setIssuedLink({
            url: emise.inviteUrl,
            email: route.email,
            expiresAtMs: Number.isFinite(echeance) ? echeance : null,
          });
        }
        void loadSeats();
        setEmail('');
        setStaleInSpace(null);
        await onDone('invited');
      }
    } catch (e) {
      const code = errorText(e);
      if (code === 'already_member' && route.kind === 'newcomer') {
        /**
         * LE SEUL ENDROIT OÙ CE CODE EST INTERPRÉTÉ, et il ne parle pas du
         * coffre : le serveur dit que l'adresse est déjà dans l'ESPACE, alors
         * que notre annuaire ne la connaissait pas (lecture refusée, ou liste
         * vieille de quelques secondes). « Réessayez dans un instant » n'avait
         * aucune chance d'aboutir — c'est la MÊME requête qui repartirait. On
         * relit l'annuaire : la ligne bascule alors d'elle-même sur « donner
         * l'accès », cérémonie dépliée, et le geste devient possible.
         */
        setStaleInSpace(route.email);
        onRetryDirectory();
        return;
      }
      error(
        t(
          vaultErrorKey(
            code,
            route.kind === 'member' ? 'teamVaults.errors.giveAccess' : 'teamVaults.errors.invite'
          )
        )
      );
    } finally {
      setSending(false);
    }
  };

  /**
   * L'ESPACE EST-IL PLEIN, ET QUE DIRE ALORS (F05). La décision est dans le
   * modèle pur : trois phrases selon ce qu'on sait du plan, et le bouton d'offre
   * seulement quand il existe réellement quelque chose de plus grand au-dessus.
   */
  const seatsFull = useMemo(() => seatsFullState(seats), [seats]);

  /**
   * La pastille du routage — jamais rien quand il n'y a rien d'honnête à dire.
   *
   * LE PLAFOND EST DIT UNE SEULE FOIS, ET PAR LE BLOC QUI PORTE LE GESTE. Avant
   * F05, c'était l'inverse : la pastille gardait la phrase générique et la ligne
   * d'occupation s'effaçait pour ne pas la répéter — si bien que l'hôte à qui il
   * fallait proposer la montée d'offre était précisément le seul à ne pas la
   * voir. Les deux verdicts viennent des mêmes deux nombres (`seatGate` /
   * `seatsFullState`), donc ils ne peuvent pas se contredire : supprimer la
   * pastille ici ne peut pas laisser l'écran muet.
   */
  const notice =
    view.noticeKey && view.noticeKey !== INVITE_ROW_KEYS.routeSpaceFull
      ? t(view.noticeKey, {
          role: t(`teamVaults.role.${existingRole}`, existingRole),
          limit: gate.memberLimit ?? 0,
        })
      : null;

  const showOccupancy = gate.memberLimit !== null && gate.membersUsed !== null;

  /** « Pro (10) / Teams (25) » — les offres nommées, dans l'ordre. */
  const offersText = seatsFull.offers
    .map((o) =>
      t(VAULT_EMPTY_KEYS.seatOffer, {
        tier: t(`${VAULT_EMPTY_KEYS.seatTier}.${o.tier}`),
        limit: o.limit,
      })
    )
    .join(' / ');

  /**
   * LA LISTE EST DÉPLIÉE, c'est-à-dire ouverte ET déjà mesurée. La boîte du
   * portail, elle, est montée EN PERMANENCE : voir le commentaire au point de
   * rendu.
   */
  const deployed = listOpen && anchor !== null;

  /** La bande de CETTE ligne — mesurée sur elle-même (voir le rendu). */
  const [rowRef, band] = useContainerBreakpoint();

  return (
    /* F28 — LA LIGNE S'EMPILE QUAND ELLE NE TIENT PLUS, ET C'EST ELLE QUI LE SAIT.
       La mesure est prise sur SA propre surface, pas sur la fenêtre ni sur une
       classe posée par la page : cette ligne vit à DEUX endroits de largeurs
       très différentes — l'onglet Membres et le dialogue de partage — et le
       dialogue reste étroit même sur un grand écran. Côte à côte dans 320 px,
       le champ d'adresse tombait à une centaine de pixels : on n'y lisait plus
       ce qu'on venait de taper. */
    <div ref={rowRef} className="flex flex-col gap-2">
      <div className={band === 'compact' ? 'flex flex-col gap-2' : 'flex items-end gap-2'}>
        {/* La liste part dans un PORTAIL (voir `suggestionAnchor`) : posée ici,
            dans le flux, elle se faisait découper par `.ent-section` sur
            l'onglet Membres et par `.modal-body` dans le dialogue de partage —
            au mieux une ligne rognée. */}
        <div className="flex-1 min-w-0">
          <Input
            ref={inputRef}
            type="email"
            placeholder={t('teamVaults.members.emailPlaceholder')}
            aria-label={t('teamVaults.members.inviteByEmailLabel')}
            value={email}
            autoFocus={autoFocus}
            // Le motif ARIA du champ à suggestions : le lecteur d'écran annonce
            // la liste, puis chaque ligne parcourue.
            role="combobox"
            aria-expanded={listOpen}
            // `aria-controls` est POSÉ EN PERMANENCE, pas seulement pendant
            // l'ouverture : le motif combobox d'ARIA 1.2 le veut ainsi. C'est
            // pour cela que la boîte du portail est montée en permanence elle
            // aussi (repliée par `hidden`) — sinon l'attribut désignerait un
            // identifiant ABSENT la plus grande partie de la vie du composant,
            // c'est-à-dire un motif revendiqué et faux dans les faits.
            aria-controls={listId}
            aria-activedescendant={
              listOpen && active >= 0 ? `${listId}-${suggestions[active].userId}` : undefined
            }
            aria-autocomplete="list"
            autoComplete="off"
            onFocus={() => {
              if (!skipNextFocusOpen.current) setSuggestOpen(true);
            }}
            // Le clic sur une ligne annule le sien (`onMouseDown` + preventDefault)
            // : la perte de focus signifie donc bien qu'on a quitté le champ.
            onBlur={() => setSuggestOpen(false)}
            onChange={(e) => {
              setEmail(e.target.value);
              setStaleInSpace(null);
              setSuggestOpen(true);
              setActiveIndex(-1);
              // L'annonce ne vaut que pour l'adresse qu'on vient de POSER : dès
              // qu'on retape, elle ne décrit plus le champ. La vider permet
              // aussi de ré-annoncer la même adresse si on la rechoisit.
              setAnnounced(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                if (suggestions.length === 0) return;
                e.preventDefault();
                if (!suggestOpen) {
                  setSuggestOpen(true);
                  setActiveIndex(-1);
                  return;
                }
                setActiveIndex(
                  nextCandidateIndex(active, e.key === 'ArrowDown' ? 1 : -1, suggestions.length)
                );
                return;
              }
              if (e.key === 'Escape') {
                // Échap referme la LISTE d'abord. Sans l'arrêt de propagation,
                // le même appui fermerait aussi le dialogue de partage qui
                // porte la ligne : on perdrait la saisie pour avoir voulu
                // ranger une liste.
                if (listOpen) {
                  e.preventDefault();
                  e.stopPropagation();
                  setSuggestOpen(false);
                  setActiveIndex(-1);
                }
                return;
              }
              if (e.key === 'Tab') {
                setSuggestOpen(false);
                return;
              }
              if (e.key === 'Enter') {
                e.preventDefault();
                // Une ligne parcourue au clavier se CHOISIT ; sinon Entrée
                // garde son sens d'origine — envoyer ce qui est écrit, y
                // compris l'adresse d'un inconnu que la liste ne connaît pas.
                if (listOpen && active >= 0) {
                  prefill(suggestions[active].email);
                  return;
                }
                void send();
              }
            }}
            fullWidth
            // JAMAIS désactivé par le plafond de sièges : donner l'accès à
            // quelqu'un de l'espace n'en consomme aucun.
            disabled={sending}
          />

          {/* LA BOÎTE EST MONTÉE EN PERMANENCE, et c'est `aria-controls` qui
              l'exige. Le champ porte cet attribut à demeure (le motif combobox
              d'ARIA 1.2 le veut ainsi) ; ne rendre le `<ul id={listId}>` que
              pendant l'ouverture en faisait une référence PENDANTE la plus
              grande partie de la vie du composant — un motif revendiqué en
              commentaire et faux dans les faits. Repliée, la boîte est retirée
              de l'arbre d'accessibilité (`hidden`) ET du rendu (`display: none`,
              posé en ligne parce que la règle d'auteur `.select-dropdown
              { display: flex }` l'emporterait sinon sur le `[hidden]` du
              navigateur). */}
          {createPortal(
            <div
              ref={dropdownRef}
              className={`select-dropdown select-dropdown--sm${
                deployed ? ' select-dropdown--open' : ''
              }`}
              hidden={!deployed}
              style={
                deployed && anchor
                  ? {
                      position: 'absolute',
                      top: `${anchor.top}px`,
                      left: `${anchor.left}px`,
                      // Le `Select` du design système prend ici `width: max-content`
                      // parce qu'il porte des libellés courts (« Membre »,
                      // « Lecteur »). La liste porte des ADRESSES : à `max-content`,
                      // une seule adresse longue pousserait la boîte hors de la
                      // fenêtre. On garde la largeur DU CHAMP, et l'ellipse du
                      // design système fait son travail.
                      width: `${anchor.width}px`,
                      // Retournée au-dessus du champ, la boîte se remonte de sa
                      // PROPRE hauteur : `anchor.top` est alors le haut du champ.
                      // Mesurer la liste pour calculer ce haut obligerait à
                      // l'afficher d'abord, donc à la laisser sauter sous l'œil.
                      transform: anchor.placement === 'above' ? 'translateY(-100%)' : undefined,
                    }
                  : { display: 'none' }
              }
              // Le `mousedown` annulé est ici posé AUSSI sur le conteneur, et
              // pas seulement sur les options : il couvre la gouttière et la
              // ligne « +N autres », où un clic faisait jusqu'ici perdre le
              // focus au champ et refermait la liste sous le doigt.
              onMouseDown={(e) => e.preventDefault()}
            >
              <ul
                id={listId}
                role="listbox"
                aria-label={t('teamVaults.invite.candidates.listLabel')}
                className="select-dropdown__list m-0 list-none"
              >
                {suggestions.map((c, index) => (
                  <li
                    key={c.userId}
                    id={`${listId}-${c.userId}`}
                    // Les flèches ramènent la ligne active sous l'œil en la
                    // visant par CET index : `listId` vient de `useId()` et
                    // contient des deux-points, donc n'est pas un sélecteur CSS
                    // valide sans échappement (même raison dans le design système).
                    data-option-index={index}
                    role="option"
                    aria-selected={index === active}
                    className={`select-dropdown__option ${
                      index === active ? 'select-dropdown__option--focused' : ''
                    }`}
                    // `mousedown` plutôt que `click` pour l'annulation : le
                    // champ perdrait le focus AVANT que le clic n'arrive, la
                    // liste se fermerait, et le clic tomberait dans le vide.
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => prefill(c.email)}
                    onMouseEnter={() => setActiveIndex(index)}
                  >
                    <Avatar
                      label={c.email}
                      seed={c.userId}
                      size="xs"
                      title={null}
                      className="shrink-0"
                    />
                    {/* La classe du design système tronque déjà (`overflow`
                        + ellipse) : rien à ajouter, et surtout rien à contredire. */}
                    <span className="select-dropdown__option-label">{c.email}</span>
                    {c.pendingInvite && (
                      <span className="text-[11px] shrink-0 text-[var(--color-text-tertiary)]">
                        {t('teamVaults.invite.candidates.pendingBadge')}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              {/* Ce que la troncature laisse de côté est DIT — hors de la
                  liste, parce qu'une ligne qui n'est pas une option n'a rien
                  à faire dans un `listbox` : une liste qui s'arrête en silence
                  ferait conclure que la personne cherchée n'y est pas,
                  c'est-à-dire le défaut d'origine.

                  UN PIED DE LISTE, PAS UN ÉTAT VIDE. Cette phrase portait
                  `.select-dropdown__empty`, qui est le bloc « Aucun résultat »
                  du design système : 24 px de marge haute et basse, texte
                  centré. Elle se lisait donc comme l'annonce inverse de ce
                  qu'elle dit — et mangeait soixante-dix pixels des 320 de la
                  boîte, au détriment des options elles-mêmes. */}
              {candidates.hidden > 0 && (
                <p className="m-0 px-3 py-2 text-[11px] text-[var(--color-text-tertiary)] border-t border-[var(--color-border)]">
                  {t('teamVaults.invite.candidates.more', { count: candidates.hidden })}
                </p>
              )}
            </div>,
            document.body
          )}
        </div>
        <div className={band === 'compact' ? 'w-full' : 'w-32 shrink-0'}>
          <Select
            ariaLabel={t('teamVaults.members.roleLabel')}
            options={vaultRoleOptions(t)}
            value={role}
            onChange={(v) => {
              const next = Array.isArray(v) ? (v[0] ?? '') : v;
              if (!isAssignableVaultRole(next)) return;
              // Un choix DÉLIBÉRÉ : à partir d'ici, le rôle par défaut du coffre
              // ne reprendra plus la main (voir l'effet plus haut).
              roleTouched.current = true;
              setRole(next);
            }}
            disabled={sending}
            fullWidth
          />
        </div>
        {/* ÉTEINT AVANT LE CLIC, ET AVEC SA RAISON. Le refus de siège arrivait
            jusqu'ici APRÈS l'envoi, en bandeau rouge — le pire moment pour
            l'apprendre, et le seul où l'on ne peut plus rien en faire. */}
        <Button
          variant="primary"
          onClick={() => void send()}
          loading={sending}
          disabled={!view.canSend}
          aria-describedby={seatBlocked && showOccupancy ? occupancyId : undefined}
        >
          {t(view.buttonKey)}
        </Button>
      </div>

      {/* CHOISIR QUELQU'UN NE DOIT PAS ÊTRE MUET. Le clic sur une suggestion (ou
          sur un candidat de la section voisine) pose l'adresse et déplace le
          focus vers le champ : à l'œil c'est évident, à l'oreille il ne se passe
          rien du tout. La région est rendue EN PERMANENCE, vide au repos — une
          région polie qui apparaît en même temps que son texte n'est pas
          annoncée par la plupart des lecteurs d'écran. */}
      <p className="sr-only" role="status" aria-live="polite">
        {/* La `key` est le NUMÉRO du geste, pas l'adresse : rechoisir la même
            personne doit remplacer le nœud, sinon React laisse le texte
            identique en place, aucune mutation n'atteint la région, et le
            second geste est muet. */}
        {announced && (
          <span key={announced.n}>
            {t('teamVaults.invite.candidates.filled', { email: announced.email })}
          </span>
        )}
      </p>

      {notice && (
        <p
          className={`text-xs m-0 flex items-center gap-2 ${
            view.noticeTone === 'warn'
              ? 'text-[var(--color-warning-700,#b45309)]'
              : 'text-[var(--color-text-tertiary)]'
          }`}
        >
          <span>{notice}</span>
          {view.showSeeRow && onSeeRow && route.kind === 'inVault' && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onSeeRow(route.member.userId)}
              // Le clic doit CHANGER l'écran, pas seulement le dire.
            >
              {t('teamVaults.invite.seeRow')}
            </Button>
          )}
        </p>
      )}

      {/* F16 — L'INVITATION VIENT DE PARTIR, ET VOICI L'AUTRE CHEMIN. L'e-mail
          n'arrive pas toujours (filtre, boîte pleine, aiguillage) ; jusqu'ici il
          ne restait qu'à relancer, c'est-à-dire refaire exactement le même
          trajet. Le lien n'est jamais AFFICHÉ : seulement copiable et gravable
          en QR — un porteur en clair sur une page finit dans une capture
          d'écran. */}
      {issuedLink && (
        <InviteLinkActions
          url={issuedLink.url}
          email={issuedLink.email}
          expiresAtMs={issuedLink.expiresAtMs}
          onDismiss={() => setIssuedLink(null)}
        />
      )}

      {/* Le serveur nous a démentis : l'adresse EST dans l'espace. On le dit, et
          l'annuaire se relit pendant ce temps. */}
      {staleInSpace && route.kind !== 'member' && (
        <p className="text-xs text-[var(--color-text-tertiary)] m-0">
          {t('teamVaults.invite.alreadyInSpaceReroute', { email: staleInSpace })}
        </p>
      )}

      {/* L'annuaire n'a pas pu être lu : le dire, et proposer de réessayer quand
          cela peut servir. C'est ce silence-là qui faisait passer tout le monde
          pour un nouveau venu. */}
      <DirectoryNotice state={directoryState} onRetry={onRetryDirectory} />

      {/* Le plafond, dit AVANT qu'une invitation ne soit brûlée — et, quand
          l'espace est plein, AVEC le geste qui le lève (F05). L'ancienne phrase
          disait « passez à l'offre supérieure » sans jamais y mener : c'était
          nommer la solution à l'écran exact où l'on en a besoin, et s'arrêter là. */}
      {showOccupancy &&
        (seatsFull.kind === 'empty' ? (
          <div className="flex flex-wrap items-center gap-2">
            <p id={occupancyId} className="text-xs m-0 text-[var(--color-warning-700,#b45309)]">
              {t(seatsFull.key ?? VAULT_EMPTY_KEYS.seatsFullUnknown, {
                used: gate.membersUsed,
                limit: gate.memberLimit,
                members: gate.activeMembers,
                pending: gate.pendingInvites,
                offers: offersText,
              })}
            </p>
            {seatsFull.action === 'upgrade' && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => navigate('/settings?cat=compte')}
              >
                {t('teamVaults.upgrade.cta')}
              </Button>
            )}
          </div>
        ) : (
          <p id={occupancyId} className="text-xs m-0 text-[var(--color-text-tertiary)]">
            {/* LE DÉTAIL DÈS QU'IL Y A UNE INVITATION DEHORS. « 2 sur 3 » était
                exact au sens des membres et faux au sens de la décision : le
                serveur comptait déjà l'invitation en attente, et refusait au
                clic. On dit donc « 3 sur 3 — 2 membres et 1 invitation en
                attente », le seul énoncé qui prépare le refus au lieu de le
                démentir. Sans le détail (worker plus ancien), la phrase d'avant. */}
            {t(
              gate.pendingInvites !== null && gate.pendingInvites > 0 && gate.activeMembers !== null
                ? 'teamVaults.members.spaceOccupancyDetail'
                : 'teamVaults.members.spaceOccupancy',
              {
                used: gate.membersUsed,
                limit: gate.memberLimit,
                members: gate.activeMembers,
                pending: gate.pendingInvites,
              }
            )}
          </p>
        ))}

      {/* Les accès que le balayage n'a pas pu accorder seul : une action qui
          attend l'hôte, pas un événement qui passe. */}
      {blocked.length > 0 && (
        <span
          className="self-start inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded-full bg-[var(--color-warning-50,#fffbeb)] text-[var(--color-warning-700,#b45309)]"
          title={blocked.map((b) => b.email).join(', ')}
        >
          {t('shareDialog.invite.blockedChip', {
            count: blocked.length,
            defaultValue: '{{count}} access pending your verification',
          })}
        </span>
      )}

      {/* Le numéro de sécurité — SOUS la ligne, une étape du flux, pas une
          modale de plus. */}
      {view.showCeremony && selectedUserId && <KeyVerificationPanel verification={kv} />}
    </div>
  );
});

export default InviteRow;
