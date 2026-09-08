/**
 * useVaultSettings — lire les réglages d'un coffre, et ouvrir son bloc scellé.
 *
 * QUI APPELLE, ET POURQUOI QUATRE LECTURES PLUTÔT QU'UN CHARGEUR PARTAGÉ.
 * QUATRE surfaces ont besoin de ces réglages, et chacune les lit pour son
 * compte : la page « Gérer le coffre » (elle les montre et les enregistre),
 * l'explorateur (`itemDeleteRequiresAdmin`), le panneau de partage par élément
 * (`itemGrantsEnabled`, `grantMaxExpiryDays`) et la porte rapide de partage
 * (le rôle pré-coché de sa ligne d'invitation).
 *
 * ELLES NE SONT PAS TOUTES EXCLUSIVES, ET IL FAUT LE DIRE PLUTÔT QUE DE LE
 * CROIRE. La page REMPLACE bien l'explorateur dans son panneau, mais le partage
 * par élément s'OUVRE DEPUIS l'explorateur : jusqu'à trois `GET /:id/settings`
 * peuvent donc partir autour d'un même geste. On l'assume — la route lit UNE
 * ligne, sans seau de lecture, et un cache de module avec sa péremption et son
 * invalidation coûterait ici plus de failles qu'il n'économise de requêtes : un
 * réglage servi périmé juste après un enregistrement rouvrirait précisément la
 * porte que ces réglages ferment. C'est le même arbitrage que
 * `useSpaceDirectory`, et il sera à revoir le jour où cette route cessera
 * d'être la lecture d'une seule ligne — jour DÉJÀ EN CHEMIN : F20, F23 et F24
 * posent leurs champs sur cette même ligne, ce qui l'alourdit sans la
 * multiplier. C'est un agrégat (un décompte d'éléments, un quota consommé) qui
 * ferait basculer l'arbitrage, pas un champ de plus.
 *
 * LA LECTURE EST OUVERTE À TOUT MEMBRE, LECTEURS COMPRIS. Ces règles contraignent
 * ce que leur application a le droit de faire ; les leur cacher les leur ferait
 * subir sans les comprendre. Seule l'ÉCRITURE est réservée aux administrateurs.
 *
 * QUAND ON N'A RIEN PU LIRE, ON RETOMBE SUR LES DÉFAUTS D'AVANT F13 — donc sur
 * le comportement le plus PERMISSIF. Ce n'est pas un oubli : un client plus
 * strict que le serveur rend introuvable un geste légitime (le partage par
 * élément disparaîtrait sur une panne réseau), tandis qu'un client plus
 * permissif récolte un refus que le serveur nomme et que l'écran traduit déjà
 * (`grants_disabled`, `grant_expiry_too_far`, `setting_forbidden`). L'écran, lui,
 * distingue les deux : `state` dit s'il a su lire.
 *
 * LE BLOC EST OUVERT AVEC LA CLÉ DE SON ÉPOQUE, PAS AVEC LA COURANTE. Une
 * rotation faite par un client d'avant F13 laisse le bloc scellé sous la clé
 * précédente : l'ouvrir avec la clé courante échouerait, et l'écran afficherait
 * une description vide — un texte qu'on croirait effacé. On tente donc
 * `getVaultKey(vaultId, settingsEpoch)`, ce qui le rend souvent lisible quand
 * même (les époques passées restent en cache), et `seal` dit qu'il faut le
 * ré-enregistrer pour le resceller.
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { getVaultKey } from '../../../../services/vault/vaultKeyCache';
import { subscribeVaultLive, vaultLiveNonce } from '../../../../services/vault/vaultLiveRefresh';
import { rememberVaultDescription } from '../../../../services/vault/vaultDescriptionIndex';
import { decryptVaultBlob } from '../../../../services/vault/vaultCrypto';
import {
  apiGetVaultSettings,
  type VaultSettingsReadDTO,
} from '../../../../services/vault/vaultApi';
import { errorText } from '../../../../services/vault/vaultErrorMessages';
import {
  DEFAULT_VAULT_SETTINGS,
  decodeVaultSettingsBlock,
  readVaultSettings,
  settingsSealVerdict,
  type SealVerdict,
  type VaultSettingsBlock,
  type VaultSettingsDocument,
} from './vaultSettingsModel';

/**
 * `unavailable` recouvre les deux façons de ne pas savoir (panne, refus) parce
 * qu'elles appellent le même écran : les réglages d'un coffre ne sont refusés à
 * aucun membre, donc un échec ici est toujours un incident, jamais un droit
 * manquant. `ok` recouvre aussi « pas demandé » : un écran qui n'a pas besoin
 * des réglages n'a pas à afficher un reproche pour un appel qu'on n'a pas fait.
 */
export type VaultSettingsLoadState = 'loading' | 'ok' | 'unavailable';

export interface VaultSettingsHandle {
  /** Ce que le coffre APPLIQUE — les défauts d'avant F13 tant qu'on n'a pas lu. */
  settings: VaultSettingsDocument;
  /** La ligne enregistrée telle quelle : version (0 = aucune), bloc, qui, quand. */
  stored: VaultSettingsReadDTO | null;
  /** Le bloc DÉCHIFFRÉ. Vide quand il n'y en a pas — ou qu'on n'a pas su l'ouvrir. */
  block: VaultSettingsBlock;
  /**
   * Faux quand un bloc EXISTE et n'a pas pu être ouvert : c'est ce qui sépare
   * « pas de description » de « je n'ai pas su la lire », deux écrans vides
   * identiques et deux gestes opposés.
   */
  blockReadable: boolean;
  /** Sous quelle clé le bloc a été scellé — `superseded` demande un ré-enregistrement. */
  seal: SealVerdict;
  state: VaultSettingsLoadState;
  /**
   * Un refus `host_plan_lapsed` REÇU pour ce coffre (F19). Le serveur ne publie
   * l'entitlement d'un espace nulle part : c'est la seule preuve disponible, et
   * tant qu'elle n'existe pas la fiche d'identité ne dit rien du plan.
   */
  planRefused: boolean;
  /** Enregistrer un refus de plan observé par un appelant (l'écran d'écriture). */
  notePlanRefusal: () => void;
  reload: () => Promise<void>;
}

export function useVaultSettings(
  vaultId: string,
  currentKeyEpoch: number,
  enabled = true
): VaultSettingsHandle {
  const [stored, setStored] = useState<VaultSettingsReadDTO | null>(null);
  const [block, setBlock] = useState<VaultSettingsBlock>({ description: '' });
  const [blockReadable, setBlockReadable] = useState(true);
  const [state, setState] = useState<VaultSettingsLoadState>(enabled ? 'loading' : 'ok');
  const [planRefused, setPlanRefused] = useState(false);
  const [attempt, setAttempt] = useState(0);

  /**
   * LA RELECTURE DEMANDÉE DE L'EXTÉRIEUR (propagation vivante).
   *
   * Un ADMIN change les règles du coffre depuis sa machine ; ici, rien ne le
   * sait. Le guetteur des têtes (`VaultHeadsWatcher`) voit bouger
   * `settingsVersion` et incrémente ce compteur ; l'effet ci-dessous le lit
   * comme il lit `attempt`, et TOUTES les instances montées relisent — la
   * page, l'explorateur, le panneau de partage. Il n'y a rien à mettre en
   * cache et rien à coordonner : le compteur ne dit que « relis ».
   */
  const nonceVivant = useSyncExternalStore(
    useCallback((f) => subscribeVaultLive('settings', vaultId, f), [vaultId]),
    useCallback(() => vaultLiveNonce('settings', vaultId), [vaultId])
  );

  /**
   * LES APPELANTS QUI ATTENDENT LA RELECTURE.
   *
   * `reload()` ne fait qu'incrémenter un compteur : la lecture, elle, part dans
   * l'effet. Une promesse qui se résoudrait tout de suite mentirait à
   * `await settings.reload()` — le prochain appelant qui lirait `stored` à la
   * ligne suivante obtiendrait la ligne PÉRIMÉE, sans qu'aucun type ne bronche.
   * On garde donc les résolveurs ici, et c'est l'effet qui les libère quand il a
   * fini. Le démontage les libère aussi : un appelant ne doit jamais rester
   * suspendu à une promesse que plus personne ne tiendra (son `finally`
   * n'éteindrait jamais son propre « en cours »).
   */
  const attentesRef = useRef<Array<() => void>>([]);
  const libererAttentes = useCallback(() => {
    const attentes = attentesRef.current;
    attentesRef.current = [];
    for (const resoudre of attentes) resoudre();
  }, []);

  // Un geste de la page peut démonter son propre hôte (quitter, supprimer)
  // pendant qu'une lecture est en vol.
  const vivantRef = useRef(true);
  useEffect(() => {
    vivantRef.current = true;
    return () => {
      vivantRef.current = false;
      libererAttentes();
    };
  }, [libererAttentes]);

  useEffect(() => {
    if (!enabled) {
      setState('ok');
      // Personne ne lira : ceux qui attendaient sont servis tout de suite, sinon
      // un `await reload()` sur un chargeur éteint ne rendrait jamais la main.
      libererAttentes();
      // Un cleanup rendu DANS TOUS LES CAS : une fonction qui n'en rend que dans
      // une branche déclenche TS7030.
      return () => {};
    }
    let vivant = true;
    setState('loading');
    void (async () => {
      try {
        const dto = await apiGetVaultSettings(vaultId);
        if (!vivant || !vivantRef.current) return;
        setStored(dto);
        /**
         * `state` NE PASSE À « ok » QU'UNE FOIS LE BLOC TRANCHÉ, et c'est une
         * correction, pas un détail. Il basculait ici même — c'est-à-dire avant
         * le déchiffrement, qui est `await`é plus bas. Entre les deux, la poignée
         * annonçait « lu », `stored` était posé, et `blockReadable` portait
         * encore la réponse du tour PRÉCÉDENT : sur la relecture qui suit un
         * déverrouillage, épingler dans cette fenêtre-là récoltait « bloc
         * illisible » pour un bloc qui allait s'ouvrir à la ligne suivante.
         * « En cours de lecture » doit couvrir TOUTE la lecture, déchiffrement
         * compris — sans quoi personne ne peut distinguer « pas lu » de « pas
         * encore lu » (voir `settingsBlockNotice.pending`).
         */
        const chiffre = dto.encrypted;
        if (!chiffre || typeof chiffre.settingsEpoch !== 'number') {
          setBlock({ description: '' });
          // Pas de bloc = rien à ouvrir, donc rien à reprocher. Un bloc SANS
          // époque, en revanche, ne peut pas être ouvert à coup sûr : on ne
          // devine pas la clé, et `seal` le dira.
          setBlockReadable(!chiffre);
          setState('ok');
          return;
        }
        // La clé de SON époque, jamais la courante — voir l'en-tête.
        const kVault = getVaultKey(vaultId, chiffre.settingsEpoch);
        if (!kVault) {
          setBlock({ description: '' });
          setBlockReadable(false);
          setState('ok');
          return;
        }
        try {
          const clair = await decryptVaultBlob(
            chiffre.settingsEncrypted,
            chiffre.settingsIv,
            kVault
          );
          if (!vivant || !vivantRef.current) return;
          const bloc = decodeVaultSettingsBlock(clair);
          setBlock(bloc);
          setBlockReadable(true);
          setState('ok');
          /**
           * F27 — LES CARTES LISENT, ELLES NE DEMANDENT PAS. La description
           * qu'on vient d'ouvrir est rangée dans un index en mémoire, d'où les
           * cartes de l'accueil et l'en-tête de l'explorateur la tirent sans
           * une requête de plus (voir `vaultDescriptionIndex`). On n'y écrit
           * QU'ICI, c'est-à-dire après un déchiffrement réussi : les trois
           * chemins d'échec ci-dessus n'y touchent pas, sans quoi une clé
           * absente effacerait une description parfaitement valide.
           */
          rememberVaultDescription(vaultId, bloc.description);
        } catch {
          if (!vivant || !vivantRef.current) return;
          // Tag AES-GCM : la clé n'ouvre pas ce blob. Un vide muet ferait croire
          // à une description effacée.
          setBlock({ description: '' });
          setBlockReadable(false);
          setState('ok');
        }
      } catch (e) {
        if (!vivant || !vivantRef.current) return;
        // `apiGetVaultSettings` réduit déjà l'échec à son code canonique et le
        // porte comme MESSAGE (`throwWithCode`) : la réponse axios n'existe plus
        // ici, seul le code a survécu.
        // CE CHEMIN-CI NE PEUT PAS S'ALLUMER AUJOURD'HUI, et il vaut mieux l'écrire
        // que de le croire : le worker garde l'ÉCRITURE
        // (`requireVaultWriteEntitlement` sur le PUT), jamais cette lecture. Le
        // badge « plan échu » de F19 ne s'allume donc que sur un enregistrement
        // refusé — un lecteur ou un membre, qui n'enregistre pas, ne le verra
        // jamais. La branche reste parce qu'elle sera la bonne le jour où le
        // worker publiera l'entitlement d'un espace, ou gardera la lecture.
        if (errorText(e) === 'host_plan_lapsed') setPlanRefused(true);
        setState('unavailable');
      } finally {
        // CE passage-ci a-t-il encore le dernier mot ? Un rechargement demandé
        // pendant le vol en relance un autre : c'est LUI qui répondra aux
        // attentes, et libérer ici rendrait la main sur un état déjà remplacé.
        if (vivant && vivantRef.current) libererAttentes();
      }
    })();
    return () => {
      vivant = false;
    };
  }, [vaultId, enabled, attempt, nonceVivant, libererAttentes]);

  /**
   * La promesse ne se dénoue QU'UNE FOIS LA LECTURE FAITE — voir `attentesRef`.
   * `await settings.reload()` peut donc être suivi d'une lecture de `stored`
   * sans piège, ce que la signature promettait déjà.
   */
  const reload = useCallback(
    () =>
      new Promise<void>((resoudre) => {
        attentesRef.current.push(resoudre);
        setAttempt((n) => n + 1);
      }),
    []
  );

  const notePlanRefusal = useCallback(() => setPlanRefused(true), []);

  return {
    settings: stored ? readVaultSettings(stored.settings) : { ...DEFAULT_VAULT_SETTINGS },
    stored,
    block,
    blockReadable,
    seal: settingsSealVerdict({
      hasBlock: !!stored?.encrypted,
      settingsEpoch: stored?.encrypted?.settingsEpoch ?? null,
      currentKeyEpoch,
    }),
    state,
    planRefused,
    notePlanRefusal,
    reload,
  };
}

export default useVaultSettings;
