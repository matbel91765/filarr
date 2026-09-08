/**
 * FilePluginEditorModal — l'HÔTE d'édition d'un greffon pour un fichier
 * PERSONNEL (l'explorateur, pas un coffre partagé).
 *
 * POURQUOI UN SECOND HÔTE. `PluginEditorModal` est l'hôte des COFFRES : tout
 * son contrat parle vaultId, VaultItemSummary, `updateVaultItem` sous verrou de
 * version, époque de clé, salle de collaboration. Un fichier personnel n'a rien
 * de tout cela — il a un dossier, un nom, et le chemin de lecture/écriture
 * chiffré du stockage local/hybride. Réécrire ce contrat dans l'hôte de coffre
 * l'aurait rendu conditionnel de bout en bout ; on garde donc deux hôtes qui
 * servent le MÊME contrat de greffon (`EditorHost` de pluginTypes.ts), chacun
 * branché sur son propre monde de stockage.
 *
 * CE QUE CET HÔTE GARANTIT AU GREFFON — le même contrat, moins ce qui n'existe
 * pas ici :
 *
 *  1. Les pannes se VOIENT : un `mount()` rejeté et un `onFatal` du pont
 *     s'affichent en bandeau (texte React, jamais innerHTML).
 *  2. Les sauvegardes sont SÉRIALISÉES et portent leur ORIGINE. Une seule en
 *     vol ; la suivante rejette `save_in_flight`.
 *  3. `readOnly` est une OBLIGATION VÉRIFIÉE : saveBytes jette `read_only`
 *     sans regarder ce que le greffon a bien voulu respecter.
 *  4. Le drapeau `dirty` ne se fait pas écraser : une frappe arrivée PENDANT
 *     l'aller-retour de sauvegarde survit à son succès (dirtySeqRef).
 *  5. Une autosave ne coûte ni toast ni rechargement du dossier : indicateur
 *     discret, `onSaved()` différé à la fermeture.
 *
 * CE QU'IL N'A PAS, ET POURQUOI. Pas de `collab` : les salles temps réel sont
 * indexées par (coffre, élément, époque de clé) — un fichier personnel n'a
 * aucune de ces trois coordonnées, l'éditeur monte donc en SOLO (le champ est
 * optionnel dans `EditorHost`, le greffon docs sait déjà travailler sans).
 * Pas de `item_version_conflict` non plus : le stockage personnel n'expose pas
 * de verrou de version — la dernière écriture gagne, exactement comme pour
 * n'importe quel autre fichier de l'explorateur.
 */

import React, { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, ConfirmModal, Modal } from '../../ui';
import { viderait as viderait_ } from '../../../../services/plugins/emptyGuard';
import * as fileVersionStore from '../../../../services/core/fileVersionStore';
import { useNotification } from '../../ui/Notification';
import { readFile, renameFile, updateFileMetadata } from '../../../../services/core/fileService';
import storageAdapter from '../../../../services/core/storageAdapter';
import type { EditorInstance, EditorProvider } from '../../../../services/plugins/pluginTypes';
import { PluginEditorShell, type PluginEditorSaveState } from '../../plugins/PluginEditorShell';

/**
 * Le PRÉFIXE que `parseFdoc` du greffon docs jette quand l'enveloppe annonce
 * une version qu'il ne connaît pas — miroir de PluginEditorModal. Ce n'est pas
 * un plantage : c'est le contrat « refuser, jamais dégrader ». L'utilisateur
 * doit lire « mettez à jour », pas « le plugin a cessé de fonctionner ».
 */
const FDOC_VERSION_TOO_NEW = 'Unsupported fdoc version';

/** Les CODES que `host.saveBytes` rejette — jamais une phrase traduite. */
const SAVE_READ_ONLY = 'read_only';
const SAVE_IN_FLIGHT = 'save_in_flight';
/**
 * Le refus d'écraser un document plein par un document vide.
 *
 * C'est un code, pas une phrase : le greffon le reçoit comme rejet de
 * `saveBytes` et garde son drapeau « sale ». L'hôte, lui, le rattrape et
 * demande confirmation — parce que vider un document est un geste légitime,
 * simplement pas un geste qu'on fait sans le vouloir.
 */
const SAVE_WOULD_EMPTY = 'would_empty';
/** Le refus générique : une CLÉ i18n de l'hôte, identifiant stable. */
const SAVE_FAILED_KEY = 'folder.documentEditor.saveFailed';

type SaveOrigin = 'plugin' | 'user';

const errorText = (e: unknown): string =>
  e instanceof Error ? e.message : typeof e === 'string' ? e : '';

/**
 * Normaliser ce que `readFile` a bien voulu rendre — Buffer d'IPC, ArrayBuffer
 * du cloud, tableau sérialisé — en octets.
 *
 * JETER PLUTÔT QUE RENDRE VIDE. Un `new Uint8Array(0)` de repli sur une forme
 * inconnue monterait l'éditeur sur un document VIDE, puis la première
 * sauvegarde écraserait le vrai fichier par ce vide. Un échec de lecture doit
 * rester un échec de lecture.
 */
const toBytes = (data: unknown): Uint8Array => {
  if (ArrayBuffer.isView(data)) {
    const view = data as ArrayBufferView;
    return new Uint8Array(
      view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer
    );
  }
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (Array.isArray(data)) return new Uint8Array(data as number[]);
  // Buffer sérialisé par un pont JSON : { type: 'Buffer', data: [...] }.
  const serialise = data as { data?: unknown } | null;
  if (serialise && Array.isArray(serialise.data)) return new Uint8Array(serialise.data as number[]);
  throw new Error('unreadable_file_content');
};

interface Props {
  folderId: string;
  fileId: string;
  fileName: string;
  provider: EditorProvider;
  /** Lecture seule (fichier verrouillé, dossier en consultation…). */
  readOnly?: boolean;
  onClose: () => void;
  /** Le dossier doit se relire : une sauvegarde a changé la taille du fichier. */
  onSaved: () => void;
  /**
   * `native` — l'éditeur revendique cette extension, il écrit dans le fichier.
   * `import` — il ne sait que LIRE ce format ; enregistrer CONVERTIT.
   *
   * `getBytes()` d'un éditeur rend toujours son format natif. En mode import,
   * réécrire le fichier d'origine y mettrait donc des octets d'un AUTRE format
   * sous son extension d'avant : plus ouvrable ni par l'application d'origine,
   * ni par Filarr. Ce mode existe pour que ça n'arrive jamais.
   */
  openMode?: 'native' | 'import';
  /**
   * Créer le fichier converti. Reçoit le nom proposé et les octets natifs,
   * rend l'identifiant et le nom RÉELLEMENT retenus (l'appelant déduplique).
   *
   * Absent en mode `native`. Son échec fait ÉCHOUER la sauvegarde — voir doSave.
   */
  onConvert?: (fileName: string, bytes: Uint8Array) => Promise<{ id: string; name: string }>;
}

export const FilePluginEditorModal: React.FC<Props> = ({
  folderId,
  fileId,
  fileName,
  provider,
  readOnly = false,
  onClose,
  onSaved,
  openMode = 'native',
  onConvert,
}) => {
  const { t } = useTranslation();
  const { success, error } = useNotification();
  /** Le nom accessible de la fenêtre — voir `PluginEditorShellProps.titleId`. */
  const titleId = useId();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const instanceRef = useRef<EditorInstance | null>(null);
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  /**
   * L'etat ECRIT le plus recent — c'est LUI qu'on photographie avant de
   * l'ecraser, jamais le nouveau.
   *
   * Photographier l'apres perdrait l'etat le plus precieux : celui d'avant la
   * premiere modification. Un fichier importe puis edite une fois n'aurait
   * qu'un instantane — sa version modifiee — et l'original serait parti sans
   * laisser de trace. Voir l'en-tete de electron/fileVersionService.ts.
   */
  const precedentRef = useRef<Uint8Array | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  /** Le montage a échoué (exception de mount) — message du greffon, affiché. */
  const [mountError, setMountError] = useState<string | null>(null);
  /** Le pont a rendu l'âme APRÈS le montage (onFatal) — affiché aussi. */
  const [fatalError, setFatalError] = useState<string | null>(null);
  /** Entre la lecture des octets et la résolution du mount. */
  const [mounting, setMounting] = useState(false);
  /**
   * Le montage a échoué parce que le DOCUMENT est plus récent que l'éditeur —
   * un refus délibéré du format, pas une panne.
   */
  const documentTooNew = mountError !== null && mountError.startsWith(FDOC_VERSION_TOO_NEW);
  /** Horodatage de la dernière autosave réussie (indicateur discret du pied). */
  const [autoSavedAt, setAutoSavedAt] = useState<number | null>(null);
  /**
   * Les octets qu'un enregistrement viderait, en attente de confirmation.
   * `null` = aucune question posée.
   */
  const [vidageEnAttente, setVidageEnAttente] = useState<Uint8Array | null>(null);
  /**
   * LE DOCUMENT AVAIT-IL DU CONTENU LA DERNIÈRE FOIS QU'ON L'A ÉCRIT ?
   *
   * Relu auprès du greffon (`isEmpty`), jamais déduit de la taille : un
   * `.fdoc` vide pèse 114 octets de structure, et rien dans ce nombre ne le
   * distingue d'un document plein.
   */
  const contenuAuDepartRef = useRef(false);
  /**
   * La dernière sauvegarde a ÉCHOUÉ. Le toast passe et disparaît ; la pastille,
   * elle, reste rouge tant que rien n'a réussi — sinon une panne d'écriture
   * silencieuse (disque plein, jeton expiré) laisse l'utilisateur devant un
   * indicateur qui dit « Enregistré ».
   */
  const [saveFailed, setSaveFailed] = useState(false);
  /** Une seule sauvegarde en vol : la suivante rejette `save_in_flight`. */
  const inFlightRef = useRef(false);
  /**
   * Compteur de saletés. Le succès d'une sauvegarde ne baisse le drapeau que si
   * AUCUN onDirty(true) n'est arrivé pendant l'aller-retour — sinon la frappe
   * de l'utilisateur pendant l'envoi serait déclarée enregistrée, et la
   * confirmation « quitter sans perdre » sauterait.
   */
  const dirtySeqRef = useRef(0);
  /** Une autosave a réussi : le dossier doit être relu — à la FERMETURE. */
  const pendingReloadRef = useRef(false);

  /**
   * LE NOM COURANT DU FICHIER — découplé du nom MONTÉ (P9-B3).
   *
   * Le renommage depuis le titre change le nom sous lequel les octets sont
   * écrits ; il ne doit RIEN changer d'autre. Or la prop `fileName` alimente
   * l'effet de lecture ET l'effet de montage : la faire suivre le renommage
   * REMONTERAIT l'éditeur — c'est-à-dire détruirait l'instance en cours,
   * perdrait la position du curseur, et (dans l'hôte jumeau des coffres) la
   * liaison de salle. La prop reste donc figée à ce qu'elle était à
   * l'ouverture, et c'est cette référence-ci qui dit où écrire.
   *
   * `displayName` n'existe que pour l'affichage : le rendu doit se rafraîchir
   * après un renommage, une ref ne le déclenche pas.
   */
  const nameRef = useRef(fileName);
  /**
   * L'IDENTITÉ COURANTE DU FICHIER ÉCRIT — elle bouge à la conversion.
   *
   * En mode import, le premier enregistrement ne touche pas au fichier
   * d'origine : il en CRÉE un autre, au format natif de l'éditeur. Tout ce qui
   * suit (méta, historique, renommage) doit alors viser le nouveau, pas
   * l'ancien. D'où une ref plutôt que la prop.
   */
  const fileIdRef = useRef(fileId);
  /** Vrai tant que le fichier d'origine n'a pas encore été converti. */
  const [aConvertir, setAConvertir] = useState(openMode === 'import');
  const aConvertirRef = useRef(openMode === 'import');
  aConvertirRef.current = aConvertir;
  const [displayName, setDisplayName] = useState(fileName);
  /**
   * Un RENOMMAGE est en vol — état distinct de `saving`, et il le faut.
   * Le greffon autosauve toutes les deux secondes : figer le champ de titre
   * sur `saving` le rendrait insaisissable une fois sur deux, en pleine
   * frappe, pour une écriture qui ne le concerne pas.
   */
  const [renaming, setRenaming] = useState(false);

  // ── Le contenu ─────────────────────────────────────────────────────────────
  useEffect(() => {
    let vivant = true;
    // Le chemin de lecture STANDARD des fichiers de l'explorateur : c'est lui
    // qui sait déchiffrer (local, hybride, cloud) — aucune crypto ici.
    void readFile(folderId, fileName, true)
      .then((data) => {
        if (!vivant) return;
        const lus = toBytes(data);
        setBytes(lus);
        // Le premier « avant » est l'etat trouve a l'ouverture : c'est lui
        // qu'on photographiera a la premiere sauvegarde, et c'est ce qui fait
        // survivre l'original a la premiere modification.
        precedentRef.current = lus;
      })
      .catch(() => {
        if (vivant) setLoadError(true);
      });
    return () => {
      vivant = false;
    };
  }, [folderId, fileName]);

  /**
   * LA sauvegarde, sérialisée et consciente de son origine.
   *
   * Un greffon autosauve tout seul, toutes les deux secondes s'il le veut : ce
   * chemin doit donc être SÛR sans surveillance humaine — pas d'empilement, pas
   * de toast toutes les deux secondes, pas de rechargement du dossier à chaque
   * frappe.
   */
  /** La règle vit dans `emptyGuard` : ici on ne fait que lui donner l'état. */
  const viderait = (): boolean =>
    viderait_({
      contenuAuDepart: contenuAuDepartRef.current,
      octetsPrecedents: precedentRef.current?.byteLength ?? 0,
      estVideMaintenant: instanceRef.current?.isEmpty?.(),
      conversion: aConvertirRef.current,
    });

  const doSave = async (b: Uint8Array, opts: { origin: SaveOrigin; force?: boolean }) => {
    // readOnly n'est pas un conseil donné au greffon : c'est une garde d'hôte.
    if (readOnly) throw new Error(SAVE_READ_ONLY);
    if (inFlightRef.current) throw new Error(SAVE_IN_FLIGHT);
    /**
     * LA CEINTURE.
     *
     * Elle est ici, et pas dans `runUserSave`, parce que c'est ici que les
     * deux chemins d'écriture se rejoignent : le bouton, et l'appel du greffon
     * à `saveBytes`. Une garde posée plus haut laisserait le second passer.
     */
    if (!opts.force && viderait()) throw new Error(SAVE_WOULD_EMPTY);
    inFlightRef.current = true;
    const dirtySeqAuDepart = dirtySeqRef.current;
    setSaving(true);
    try {
      // Le chemin d'écriture STANDARD : l'adaptateur chiffre selon le mode de
      // stockage (FEK locale, hybride, cloud) exactement comme un import.
      /**
       * L'HISTORIQUE, AVANT L'ECRASEMENT.
       *
       * Fire-and-forget, et c'est deliberé : un magasin d'instantanes qui
       * tombe ne doit jamais empecher une sauvegarde d'aboutir. Le service
       * deduplique par empreinte, donc une autosave qui repart sans qu'une
       * frappe soit arrivee n'ecrit rien.
       */
      /**
       * LA CONVERSION — et le fichier d'origine n'est JAMAIS écrasé.
       *
       * En mode import, le premier enregistrement crée un fichier neuf au
       * format natif de l'éditeur. L'original reste sur le disque, intact,
       * lisible par l'application qui l'a produit.
       *
       * SON ÉCHEC FAIT ÉCHOUER LA SAUVEGARDE, sans repli. Se rabattre sur
       * l'ancien nom est précisément ce qui détruirait le `.docx` : on y
       * écrirait des octets `.fdoc`. Mieux vaut une sauvegarde qui échoue,
       * visiblement, et un document qu'on peut encore fermer.
       */
      if (aConvertirRef.current) {
        if (!onConvert) throw new Error(SAVE_FAILED_KEY);
        const natif = provider.contribution.extensions[0] ?? '';
        const base = nameRef.current.replace(/\.[^.]*$/, '');
        const cree = await onConvert(natif ? `${base}.${natif}` : base, b);
        nameRef.current = cree.name;
        fileIdRef.current = cree.id;
        setDisplayName(cree.name);
        aConvertirRef.current = false;
        setAConvertir(false);
        // Les octets viennent d'être écrits par la création : ni second
        // enregistrement, ni instantané (l'original est intact sur le disque).
        precedentRef.current = b;
        if (dirtySeqRef.current === dirtySeqAuDepart) setDirty(false);
        setSaveFailed(false);
        success(
          t('folder.documentEditor.converted', 'Document créé : {{name}}', {
            name: cree.name,
          })
        );
        onSaved();
        return;
      }

      const precedent = precedentRef.current;
      if (precedent && precedent.byteLength > 0) {
        void fileVersionStore
          .snapshot({
            fileId: fileIdRef.current,
            fileName: nameRef.current,
            folderId,
            bytes: precedent,
            comment: t('folder.documentEditor.versionBeforeEdit', 'Avant modification'),
          })
          .catch(() => undefined);
      }

      // Le chemin d'écriture STANDARD : l'adaptateur chiffre selon le mode de
      // stockage (FEK locale, hybride, cloud) exactement comme un import.
      // `nameRef` et non la prop : après un renommage, les octets vont au
      // NOUVEAU nom — écrire sous l'ancien recréerait le fichier qu'on vient
      // de déplacer, et le dossier finirait avec les deux.
      await storageAdapter.saveEncryptedFile(folderId, nameRef.current, b as unknown as Buffer);
      // L'etat ecrit devient le prochain « avant ».
      precedentRef.current = b;
      // Et la mémoire du contenu suit ce qui vient d'être écrit : sans ça, un
      // vidage confirmé reposerait la question au prochain enregistrement.
      contenuAuDepartRef.current = instanceRef.current?.isEmpty?.() === false;
      /**
       * La méta suit les octets — sinon la liste continue d'annoncer l'ancienne
       * taille et le tri par date ne bouge jamais.
       *
       * SON ÉCHEC N'EST PAS L'ÉCHEC DE LA SAUVEGARDE. Les octets sont déjà
       * écrits et chiffrés : annoncer « impossible d'enregistrer » pousserait
       * l'utilisateur à réessayer ou à fermer sans confiance pour une ligne de
       * liste périmée, que la prochaine relecture du dossier corrigera.
       */
      try {
        await updateFileMetadata(folderId, fileIdRef.current, {
          size: b.byteLength,
          updatedAt: new Date().toISOString(),
        });
      } catch (metaErr) {
        console.warn('[FilePluginEditorModal] metadata refresh failed after save:', metaErr);
      }
      // Une frappe arrivée PENDANT l'aller-retour n'est pas enregistrée.
      if (dirtySeqRef.current === dirtySeqAuDepart) setDirty(false);
      setSaveFailed(false);
      if (opts.origin === 'user') {
        success(t('folder.documentEditor.saved'));
        pendingReloadRef.current = false;
        onSaved();
      } else {
        // Une autosave ne toaste pas et ne recharge pas le dossier : elle laisse
        // une trace discrète, et la liste se rafraîchit à la fermeture.
        setAutoSavedAt(Date.now());
        pendingReloadRef.current = true;
      }
    } catch (e) {
      setSaveFailed(true);
      error(t(SAVE_FAILED_KEY));
      // Le greffon reçoit un identifiant STABLE, pas la phrase traduite.
      throw new Error(SAVE_FAILED_KEY, { cause: e });
    } finally {
      inFlightRef.current = false;
      setSaving(false);
    }
  };

  const doSaveRef = useRef(doSave);
  doSaveRef.current = doSave;

  // ── Monter le greffon quand les octets sont là ─────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container || bytes === null) return;
    let disposed = false;
    let instance: EditorInstance | null = null;
    setMountError(null);
    setFatalError(null);
    setMounting(true);
    void Promise.resolve(
      provider.mount({
        container,
        fileName,
        readOnly,
        initialBytes: bytes,
        saveBytes: async (b) => {
          await doSaveRef.current(b, { origin: 'plugin' });
        },
        onDirty: (d) => {
          // Chaque « sale » compte : le succès d'une sauvegarde ne baisse le
          // drapeau que si la séquence n'a pas bougé entre-temps.
          if (d) dirtySeqRef.current += 1;
          setDirty(d);
        },
        onFatal: (message: string) => {
          if (!disposed) setFatalError(message || 'sandbox_fatal');
        },
        // Pas de `collab` : un fichier personnel n'appartient à aucune salle.
        // L'éditeur monte en solo — c'est le mode par défaut du contrat.
      })
    ).then(
      (inst) => {
        if (disposed) {
          inst.destroy();
          return;
        }
        instance = inst;
        instanceRef.current = inst;
        /**
         * L'ÉTAT DE DÉPART, demandé au greffon lui-même.
         *
         * C'est la référence de la garde anti-vidage : un document qui était
         * déjà vide à l'ouverture ne peut rien perdre, et l'enregistrer vide
         * ne mérite aucune question.
         */
        contenuAuDepartRef.current = inst.isEmpty?.() === false;
        setMounting(false);
      },
      (e: unknown) => {
        // Un mount() qui jette laissait un cadre VIDE et muet — l'utilisateur
        // attendait un éditeur qui ne viendrait jamais. Il le sait maintenant.
        if (disposed) return;
        setMounting(false);
        setMountError(errorText(e) || 'mount_error');
      }
    );
    return () => {
      disposed = true;
      instance?.destroy();
      instanceRef.current = null;
    };
  }, [bytes, provider, fileName, readOnly]);

  /** La sauvegarde DEMANDÉE : lit les octets courants du greffon puis pousse. */
  const runUserSave = () => {
    const inst = instanceRef.current;
    if (!inst) return;
    // Le pont bac à sable est asynchrone ; un getBytes REJETÉ (iframe morte)
    // doit se DIRE — un doSave échoué, lui, toaste déjà : deux .catch séparés.
    void Promise.resolve(inst.getBytes())
      .then((b) =>
        doSaveRef.current(b, { origin: 'user' }).catch((err: unknown) => {
          // Le seul refus qui MÉRITE une question : vider un document est
          // légitime, mais jamais par accident.
          if ((err as { message?: string } | null)?.message === SAVE_WOULD_EMPTY) {
            setVidageEnAttente(b);
          }
        })
      )
      .catch((err: unknown) => {
        /**
         * Un `getBytes` REJETÉ. Le message du greffon vaut mieux que le nôtre
         * quand il y en a un : « le document n'est pas encore chargé » dit ce
         * qui se passe, là où « bac à sable indisponible » égare.
         */
        const message = (err as { message?: string } | null)?.message;
        error(message || t('folder.documentEditor.sandboxUnavailable'));
      });
  };

  /** La fermeture réelle — c'est ici que le dossier encaisse les autosaves. */
  const finishClose = () => {
    if (pendingReloadRef.current) {
      pendingReloadRef.current = false;
      onSaved();
    }
    onClose();
  };

  const requestClose = () => {
    if (dirty) {
      setConfirmClose(true);
      return;
    }
    finishClose();
  };

  /**
   * LE RENOMMAGE (P9-B3) — le titre de la barre est le nom du fichier.
   *
   * IL PASSE PAR LE MÊME VERROU QUE LA SAUVEGARDE, et ce n'est pas une
   * précaution de style : `renameFile` DÉPLACE les octets chiffrés de l'ancien
   * nom vers le nouveau. Une sauvegarde en vol pendant ce déplacement écrirait
   * sous un nom qui n'existe déjà plus, ou recréerait l'ancien juste après —
   * dans les deux cas le dossier se retrouve avec deux fichiers, dont un
   * périmé, sans que rien ne l'annonce. `inFlightRef` sérialise donc les deux
   * gestes ensemble ; une autosave qui tombe pendant le renommage rejette
   * `save_in_flight` et repassera au tour suivant (le greffon garde son
   * drapeau « sale »).
   */
  const renameTo = async (nextName: string) => {
    if (readOnly) return;
    if (nextName === nameRef.current) return;
    if (inFlightRef.current) {
      error(t('folder.documentEditor.renameBusy'));
      return;
    }
    inFlightRef.current = true;
    setRenaming(true);
    setSaving(true);
    try {
      await renameFile(folderId, fileIdRef.current, nextName);
      nameRef.current = nextName;
      setDisplayName(nextName);
      // La liste du dossier porte l'ancien nom : elle se relira à la fermeture,
      // comme après une autosave.
      pendingReloadRef.current = true;
    } catch (e) {
      console.warn('[FilePluginEditorModal] rename failed:', e);
      error(t('folder.documentEditor.renameFailed'));
    } finally {
      inFlightRef.current = false;
      setSaving(false);
      setRenaming(false);
    }
  };

  /**
   * L'état montré par la pastille. `dirty` prime sur tout le reste : un
   * document modifié dont l'autosave n'est pas encore partie n'est PAS
   * enregistré, et le dire autrement est le seul mensonge qu'une pastille
   * d'enregistrement ne peut pas se permettre.
   */
  const saveState: PluginEditorSaveState = saving
    ? 'saving'
    : saveFailed
      ? 'error'
      : dirty
        ? 'pending'
        : 'synced';

  const saveHint =
    saveState === 'synced' && autoSavedAt !== null
      ? t('folder.documentEditor.autoSavedAt', {
          time: new Date(autoSavedAt).toLocaleTimeString(),
        })
      : null;

  return (
    <>
      <Modal isOpen onClose={requestClose} size="full" ariaLabelledBy={titleId}>
        <PluginEditorShell
          titleId={titleId}
          fileName={displayName}
          // Renommer un fichier qu'on s'apprête à CONVERTIR n'a pas de sens :
          // le nom qui compte est celui du document à créer, et il se déduit du
          // format natif de l'éditeur. Le titre redevient modifiable une fois
          // la conversion faite.
          onRenameTitle={readOnly || aConvertir ? undefined : (next) => void renameTo(next)}
          renaming={renaming}
          onRequestClose={requestClose}
          saveState={saveState}
          saveHint={saveHint}
          onUserSave={readOnly ? undefined : runUserSave}
          containerRef={containerRef}
          veil={
            loadError
              ? t('folder.documentEditor.loadFailed')
              : bytes === null
                ? t('common.loading')
                : null
          }
          veilIsError={loadError}
          banners={
            /* Le message vient du GREFFON — texte brut React, jamais de
               HTML : un bandeau d'erreur n'est pas une surface de rendu. */
            aConvertir ? (
              <p className="plugin-editor-shell__banner" role="status">
                {t(
                  'folder.documentEditor.willConvert',
                  "Ce format est ouvert en lecture. Le texte, les titres, les listes, les tableaux et les images ont été repris — pas la mise en page d'origine (polices, couleurs, alignements, marges, en-têtes et pieds de page), qui n'a pas d'équivalent ici. Enregistrer créera un nouveau document ; le fichier d'origine restera intact."
                )}
              </p>
            ) : documentTooNew ? (
              /* Un refus de version n'est pas un crash : le dire autrement
                 évite d'apprendre à l'utilisateur que Filarr est cassé. */
              <p
                className="plugin-editor-shell__banner plugin-editor-shell__banner--warning"
                role="alert"
              >
                {t('folder.documentEditor.documentTooNew')}
              </p>
            ) : mountError !== null || fatalError !== null ? (
              <div
                className="plugin-editor-shell__banner plugin-editor-shell__banner--error"
                role="alert"
              >
                <p className="plugin-editor-shell__banner-title">
                  {t('folder.documentEditor.crashed')}
                </p>
                <p className="plugin-editor-shell__banner-detail">{mountError ?? fatalError}</p>
              </div>
            ) : mounting ? (
              <p className="plugin-editor-shell__banner" role="status">
                {t('folder.documentEditor.loading')}
              </p>
            ) : null
          }
        >
          {!readOnly && (
            <Button
              variant="primary"
              size="sm"
              loading={saving}
              disabled={bytes === null}
              onClick={runUserSave}
            >
              {t('folder.documentEditor.save')}
            </Button>
          )}
        </PluginEditorShell>
      </Modal>

      {/* VIDER UN DOCUMENT EST LÉGITIME — mais jamais par accident. On ne
          refuse donc pas : on demande, une fois, avec la taille de ce qui
          serait remplacé, parce que c'est le chiffre qui fait reconnaître
          l'erreur. */}
      <ConfirmModal
        isOpen={vidageEnAttente !== null}
        onClose={() => setVidageEnAttente(null)}
        onConfirm={() => {
          const octets = vidageEnAttente;
          setVidageEnAttente(null);
          if (octets) {
            void doSaveRef.current(octets, { origin: 'user', force: true }).catch(() => {});
          }
        }}
        title={t('folder.documentEditor.emptyTitle', 'Enregistrer un document vide ?')}
        message={t(
          'folder.documentEditor.emptyBody',
          'Ce document est vide, alors qu’il avait du contenu. Enregistrer remplacera les {{taille}} octets actuels. L’état précédent restera disponible dans l’historique des versions.',
          { taille: precedentRef.current?.byteLength ?? 0 }
        )}
        confirmText={t('folder.documentEditor.emptyConfirm', 'Enregistrer quand même')}
        variant="warning"
      />
      <ConfirmModal
        isOpen={confirmClose}
        onClose={() => setConfirmClose(false)}
        onConfirm={finishClose}
        title={t('folder.documentEditor.unsavedTitle')}
        message={t('folder.documentEditor.unsavedBody')}
        confirmText={t('folder.documentEditor.discard')}
        variant="warning"
      />
    </>
  );
};

export default FilePluginEditorModal;
