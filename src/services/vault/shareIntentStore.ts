/**
 * Le MAGASIN des intentions de partage de dossier — lire, modifier, resceller.
 *
 * ── LE DOCUMENT, ET CE QU'IL PORTE ──────────────────────────────────────────
 *
 * « Le dossier F est partagé avec P, sauf ces éléments. » Scellé sous K_vault
 * (table `vault_share_intents`, migration 0100) : le serveur range et rend, il
 * ne voit ni les chemins, ni les destinataires, ni les exclusions.
 *
 * ── POURQUOI UN ÉCRIVAIN UNIQUE ─────────────────────────────────────────────
 *
 * Le document s'écrit ENTIER, sous compare-and-set. Chaque appelant qui
 * bricolerait son propre cycle « lire, modifier, sceller » finirait par en
 * oublier une moitié — et perdre une intention ne dégrade pas un affichage : au
 * prochain rattrapage, ça REND ACCESSIBLE ce qu'on avait retiré.
 *
 * Ce module est donc le seul chemin. Il expose des gestes (`rememberFolderShare`,
 * `rememberExclusion`), jamais le document brut.
 *
 * ── CE QU'IL NE FAIT PAS ────────────────────────────────────────────────────
 *
 * Il ne scelle aucun accès et n'appelle jamais l'API des grants. Mémoriser
 * l'intention et donner un accès sont deux gestes, et les confondre ferait
 * qu'un échec de l'un annulerait silencieusement l'autre.
 */

import { getVaultKey } from './vaultKeyCache';
import { encryptVaultBlob, decryptVaultBlob } from './vaultCrypto';
import { apiGetVaultShareIntents, apiPutVaultShareIntents } from './vaultApi';
import { normalizePath } from './vaultPaths';
import type { FolderShareIntent } from './folderGrantPlan';

/** Le document déchiffré : une liste d'intentions, rien d'autre. */
export interface ShareIntentDocument {
  intents: FolderShareIntent[];
}

/**
 * Ce que l'appelant reçoit d'une lecture.
 *
 * `readable: false` n'est PAS « aucune intention » : c'est « le bloc existe et
 * nous ne savons pas l'ouvrir » (époque de clé perdue, coffre verrouillé). La
 * distinction décide de tout — écrire par-dessus un document illisible
 * effacerait des exclusions qu'on n'a jamais lues.
 */
export interface LoadedIntents {
  version: number;
  readable: boolean;
  document: ShareIntentDocument;
  /**
   * L'heure du SERVEUR au moment de la lecture, ou `null` s'il ne la rend pas.
   *
   * C'est elle qui estampille `since`. Voir `horodatageDuPartage` ci-dessous
   * pour la raison — elle tient à l'asymétrie de l'erreur, pas à l'élégance.
   */
  serverNow: string | null;
}

const VIDE: ShareIntentDocument = { intents: [] };

/** La clé d'une intention : un dossier, une personne. */
function sameIntent(a: FolderShareIntent, folderPath: string, granteeUserId: string): boolean {
  return a.granteeUserId === granteeUserId && a.folderPath === normalizePath(folderPath);
}

/**
 * NE PREND PAS D'ÉPOQUE, et c'est voulu : l'époque sous laquelle ouvrir le bloc
 * est celle que le SERVEUR a enregistrée avec lui (`intentsEpoch`), jamais
 * l'époque courante du coffre. Les confondre ferait échouer la lecture juste
 * après une rotation faite par un autre administrateur — le bloc est encore
 * scellé sous l'ancienne clé, et c'est normal.
 */
export async function loadShareIntents(vaultId: string): Promise<LoadedIntents> {
  const stored = await apiGetVaultShareIntents(vaultId);
  if (!stored.encrypted) {
    // Aucun bloc : lisible ET vide. C'est le cas courant, et il autorise
    // l'écriture — il n'y a rien à écraser.
    return {
      version: stored.version,
      readable: true,
      document: { intents: [] },
      serverNow: stored.serverNow,
    };
  }
  const kVault = getVaultKey(vaultId, stored.encrypted.intentsEpoch);
  if (!kVault) {
    return {
      version: stored.version,
      readable: false,
      document: VIDE,
      serverNow: stored.serverNow,
    };
  }
  try {
    const clair = await decryptVaultBlob(
      stored.encrypted.intentsEncrypted,
      stored.encrypted.intentsIv,
      kVault
    );
    const brut = JSON.parse(clair) as unknown;
    /*
      UNE FORME INATTENDUE VAUT « ILLISIBLE », PAS « VIDE ».

      Le bloc s'est ouvert, donc la clé est la bonne — mais son contenu n'est
      pas le document qu'on attend. Le rendre comme `{ intents: [] }` LISIBLE
      autoriserait l'écriture suivante à le remplacer, et on effacerait ce
      qu'on n'a pas su lire : exactement ce que le `catch` ci-dessous refuse
      pour un bloc abîmé. La règle vaut ici aussi, et elle manquait.

      Le cas concret n'est pas théorique : un client d'une version ULTÉRIEURE
      pourrait ranger les intentions autrement. Un client d'aujourd'hui doit
      alors s'abstenir, pas écraser.

      (Trou signalé par la session mobile, qui l'avait fermé de son côté.)
    */
    if (!Array.isArray((brut as ShareIntentDocument)?.intents)) {
      return {
        version: stored.version,
        readable: false,
        document: VIDE,
        serverNow: stored.serverNow,
      };
    }
    const intents = (brut as ShareIntentDocument).intents;
    return {
      version: stored.version,
      readable: true,
      document: { intents },
      serverNow: stored.serverNow,
    };
  } catch {
    // Bloc présent mais illisible (clé d'une autre époque, blob abîmé).
    // Surtout PAS `{ intents: [] }` avec `readable: true` : l'écriture
    // suivante remplacerait le document par du vide.
    return {
      version: stored.version,
      readable: false,
      document: VIDE,
      serverNow: stored.serverNow,
    };
  }
}

/**
 * L'HORODATAGE D'UN PARTAGE — l'heure du serveur, et sinon la nôtre.
 *
 * `since` se compare à `created_at` d'un élément, que le serveur estampille
 * (`DEFAULT (datetime('now'))`, migration 0019). Les deux doivent donc venir de
 * la même horloge.
 *
 * L'ERREUR N'EST PAS SYMÉTRIQUE. Une horloge locale EN AVANCE rend `since` trop
 * tardif : le rattrapage accorde trop peu, et quelqu'un s'en plaint. Une horloge
 * EN RETARD rend `since` trop ancien : des éléments qui existaient au moment du
 * partage passent pour « arrivés depuis » — exactement ceux que la borne devait
 * écarter, les décochés et les révoqués. Le filet s'ouvre en silence.
 *
 * Une horloge de téléphone se règle à la main et se recule volontiers ; c'est le
 * mobile qui a soulevé le point, et il vaut ici aussi — un poste dont l'heure
 * dérive n'est pas une hypothèse d'école.
 *
 * REPLI ASSUMÉ : face à un serveur qui ne rend pas encore `serverNow` (ordre de
 * déploiement), on retombe sur l'horloge locale. C'est ce qu'on faisait avant, et
 * ne rien poser du tout empêcherait le partage lui-même.
 */
function horodatageDuPartage(loaded: LoadedIntents): string {
  return loaded.serverNow ?? new Date().toISOString();
}

/**
 * Écrit le document ENTIER, scellé sous l'époque COURANTE.
 *
 * Refuse si le document lu était illisible : on ne remplace pas ce qu'on n'a
 * pas su lire. C'est la seule protection contre « une rotation de clé efface
 * toutes les exclusions du coffre ».
 */
async function saveShareIntents(
  vaultId: string,
  currentKeyEpoch: number,
  loaded: LoadedIntents,
  next: ShareIntentDocument
): Promise<{ ok: true } | { ok: false; reason: 'unreadable' | 'locked' | 'conflict' | 'failed' }> {
  if (!loaded.readable) return { ok: false, reason: 'unreadable' };
  const kVault = getVaultKey(vaultId, currentKeyEpoch);
  if (!kVault) return { ok: false, reason: 'locked' };

  const { ciphertext, iv } = await encryptVaultBlob(JSON.stringify(next), kVault);
  const res = await apiPutVaultShareIntents(vaultId, {
    expectedVersion: loaded.version,
    encrypted: { intentsEncrypted: ciphertext, intentsIv: iv, sealedEpoch: currentKeyEpoch },
  });
  if (res.ok) return { ok: true };
  return { ok: false, reason: res.code === 'version_conflict' ? 'conflict' : 'failed' };
}

/**
 * MÉMORISE un partage de dossier : ce dossier, cette personne, ces exclusions,
 * à cet instant.
 *
 * `since` est posé ICI, une seule fois, et c'est lui qui rend le rattrapage sûr
 * (voir `folderGrantPlan`) : tout ce qui existait avant est réputé arbitré.
 * Le rafraîchir à chaque modification rouvrirait les éléments antérieurs — d'où
 * sa conservation quand l'intention existe déjà.
 */
export async function rememberFolderShare(
  vaultId: string,
  currentKeyEpoch: number,
  folderPath: string,
  granteeUserId: string,
  excludedItemIds: string[]
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const loaded = await loadShareIntents(vaultId);
  const chemin = normalizePath(folderPath);
  const existante = loaded.document.intents.find((i) => sameIntent(i, chemin, granteeUserId));

  const suivante: FolderShareIntent = {
    folderPath: chemin,
    granteeUserId,
    // Les exclusions s'AJOUTENT : repartager un dossier en décochant moins ne
    // doit pas rouvrir ce qu'un partage précédent avait retiré. Retirer une
    // exclusion est un geste explicite, pas un effet de bord d'un repartage.
    excludedItemIds: [...new Set([...(existante?.excludedItemIds ?? []), ...excludedItemIds])],
    since: existante?.since ?? horodatageDuPartage(loaded),
  };

  const autres = loaded.document.intents.filter((i) => !sameIntent(i, chemin, granteeUserId));
  return saveShareIntents(vaultId, currentKeyEpoch, loaded, {
    intents: [...autres, suivante],
  });
}

/**
 * MÉMORISE une exclusion — appelé par la RÉVOCATION d'un accès.
 *
 * C'est la moitié qui empêche un rattrapage de défaire une révocation. Elle ne
 * concerne que les éléments POSTÉRIEURS à l'intention : les antérieurs sont
 * déjà écartés par la borne de date. On l'écrit quand même pour tous, parce que
 * distinguer coûterait une lecture de plus pour une économie de quelques octets.
 *
 * SANS INTENTION SUR CE DOSSIER, IL N'Y A RIEN À FAIRE : aucun rattrapage ne
 * visera cet élément, donc aucune exclusion n'est nécessaire. On ne crée pas
 * d'intention à la volée — ce serait mémoriser un partage de dossier qui n'a
 * jamais eu lieu.
 */
export async function rememberExclusion(
  vaultId: string,
  currentKeyEpoch: number,
  granteeUserId: string,
  itemId: string,
  itemPath: string
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const loaded = await loadShareIntents(vaultId);
  if (!loaded.readable) return { ok: false, reason: 'unreadable' };

  const chemin = normalizePath(itemPath);
  let touche = false;
  const suivantes = loaded.document.intents.map((i) => {
    if (i.granteeUserId !== granteeUserId) return i;
    // L'élément est-il sous le dossier de cette intention ? On compare les
    // chemins ici plutôt que d'importer `isShareableUnder` : l'appelant nous
    // donne un chemin, pas un élément complet.
    const sousLIntention =
      i.folderPath === '' || chemin === i.folderPath || chemin.startsWith(`${i.folderPath}/`);
    if (!sousLIntention || i.excludedItemIds.includes(itemId)) return i;
    touche = true;
    return { ...i, excludedItemIds: [...i.excludedItemIds, itemId] };
  });

  if (!touche) return { ok: true };
  return saveShareIntents(vaultId, currentKeyEpoch, loaded, { intents: suivantes });
}
