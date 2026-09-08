/**
 * LE TRAITEMENT D'UN ÉLÉMENT — et la règle qui commande tout le reste.
 *
 * ═══ C1 : LA MIGRATION NE RESCELLE RIEN LOCALEMENT ═══
 *
 * Pour chaque élément : LIRE avec la clé active, rechiffrer EN MÉMOIRE (ou vers
 * un fichier de transport hors du coffre) pour l'ENVOI SEULEMENT, TÉLÉVERSER.
 * Le fichier du coffre ne bouge pas, pas un octet, à aucun instant.
 *
 * POURQUOI CETTE RÈGLE EXISTE — et ce qu'elle remplace. La version précédente
 * rescellait le fichier LOCAL sous la clé entrante avant la bascule (transcodage
 * dans un fichier d'attente, puis renommage PAR-DESSUS l'original). Dès le
 * premier élément traité, une partie du coffre ne s'ouvrait plus qu'avec la clé
 * entrante — alors que tous les chemins de sortie autres que la réussite
 * JETAIENT cette clé. La migration déplaçait donc la dépendance des données vers
 * une clé qu'elle s'autorisait ensuite à détruire : abandonner rendait illisible
 * tout ce qui avait été migré, et une simple indisponibilité du trousseau
 * suffisait à déclencher ce sort.
 *
 * Sous C1, abandonner devient GRATUIT à n'importe quel instant : rien sur
 * l'appareil n'a changé, donc il n'y a rien à défaire. Les chemins de
 * destruction ne sont pas « gérés », ils n'existent plus.
 *
 * ═══ COMMENT LA RÈGLE EST TENUE — par le TYPE, pas par la vigilance ═══
 *
 * Le port `VaultReader` ci-dessous n'expose AUCUNE opération d'écriture. Ce
 * module ne peut donc pas modifier le coffre, quoi qu'on lui demande.
 * Réintroduire un rescellement local exigerait d'ajouter une méthode d'écriture
 * à ce port — ce qu'un test refuse explicitement
 * (`publishItemTransfer.test.ts`). C'est le seul verrou qui survit à une
 * réécriture distraite de l'orchestrateur.
 *
 * ═══ LE FICHIER DE TRANSPORT, DIT SANS DÉTOUR ═══
 *
 * Un conteneur V3 de plusieurs gigaoctets ne peut pas être rechiffré « en
 * mémoire » : le transcodage streame, et le téléversement multipart lit depuis
 * un CHEMIN. Un fichier de transport est donc écrit — dans le répertoire de
 * migration (`publish/<migrationId>/outbox/`), JAMAIS dans le coffre, JAMAIS
 * renommé par-dessus quoi que ce soit, et supprimé dès l'envoi confirmé. Ce
 * n'est pas un rescellement : le fichier du coffre n'est ni lu en écriture, ni
 * remplacé, ni même ouvert en écriture. Le coût est de l'espace disque
 * temporaire, égal à la taille de l'élément en cours — et lui, il est réel.
 *
 * Module PUR : il ne connaît ni `electron`, ni `fs`, ni le réseau. Tout passe
 * par des ports injectés, donc tout se teste sans process principal.
 */

import type { LedgerLine, PublishItem } from './types';

/**
 * Accès au coffre — LECTURE SEULE, par construction.
 *
 * L'absence de toute méthode d'écriture n'est pas un oubli : c'est le mécanisme
 * qui tient C1. Voir l'en-tête de fichier.
 */
export interface VaultReader {
  /** Le fichier est-il un conteneur V3 (streamable) ? */
  isV3Container(vaultPath: string): Promise<boolean>;
  /** Octets CHIFFRÉS du fichier, tels quels. */
  readAll(vaultPath: string): Promise<Buffer>;
  /** SHA-256 des octets chiffrés, en streaming. */
  sha256OfFile(vaultPath: string): Promise<string>;
}

/**
 * Le répertoire de TRANSPORT. Toutes ses écritures vivent hors du coffre, et
 * l'appelant garantit que `path()` ne peut jamais désigner un fichier de coffre.
 */
export interface Outbox {
  /** Chemin d'un fichier de transport, dans le répertoire de migration. */
  path(name: string): string;
  /**
   * Transcode un conteneur V3 du coffre vers l'outbox : lecture sous la clé
   * ACTIVE, écriture sous la clé du COMPTE. La source n'est jamais écrite.
   * Rend l'empreinte SHA-256 du CLAIR traversé.
   */
  transcodeFromVault(vaultPath: string, outPath: string): Promise<string>;
  /**
   * Empreinte du clair d'un fichier de transport, relu SOUS LA CLÉ DU COMPTE.
   * C'est la preuve immédiate que ce qu'on s'apprête à envoyer sera lisible
   * par le compte — la faire APRÈS l'envoi ne prouverait plus rien d'utile.
   */
  plaintextShaUnderAccountKey(outPath: string): Promise<string>;
  write(outPath: string, data: Buffer): Promise<void>;
  remove(outPath: string): Promise<void>;
  sizeOf(outPath: string): Promise<number>;
  sha256OfFile(outPath: string): Promise<string>;
}

export interface TransferPorts {
  vault: VaultReader;
  outbox: Outbox;
  /** Ouvre un blob « format renderer » avec la clé ACTIVE. Lève si illisible. */
  openRendererBlob(blob: Buffer): Buffer;
  /** Rechiffre EN MÉMOIRE sous la clé du compte — pour l'envoi seulement. */
  sealRendererBlobForTransport(plain: Buffer): Buffer;
  /** Relit sous la clé du COMPTE : la preuve que ce qui part sera lisible. */
  openRendererBlobUnderAccountKey(blob: Buffer): Buffer;
  sha256OfBuffer(data: Buffer): string;
  uploadFromPath(
    fileId: string,
    filePath: string,
    size: number,
    checksum: string
  ): Promise<string[]>;
  uploadFromBuffer(fileId: string, data: Buffer, checksum: string): Promise<string[]>;
  /** Au-delà, l'envoi passe par un fichier de transport (multipart depuis un chemin). */
  multipartThreshold: number;
  now(): string;
}

/**
 * Traite un élément et rend LA ligne de registre à ajouter.
 *
 * UNE SEULE LIGNE, complète. La version précédente en écrivait deux (`uploaded`
 * puis `done`) parce qu'un rescellement local s'intercalait entre les deux ; ce
 * découpage n'a plus d'objet sous C1, et il portait un défaut réel : le registre
 * ne retient que la DERNIÈRE ligne d'une clé, si bien que la ligne `done` —
 * dépourvue de `r`/`n`/`ch`/`ks` — effaçait les empreintes de transport dont le
 * manifeste cible et la preuve ont besoin. Une ligne autosuffisante ferme ce cas
 * par construction.
 */
export async function transferItem(
  item: PublishItem,
  /** Chemin ABSOLU du fichier dans le coffre. Ouvert en LECTURE, jamais autrement. */
  vaultPath: string,
  previous: LedgerLine | null,
  ports: TransferPorts
): Promise<LedgerLine> {
  // ── Cas 1 : l'élément n'est PAS sous la FEK (clé machine).
  // Il survit intact à la bascule ; ses octets partent TELS QUELS et le
  // manifeste cible emporte la clé machine du profil pour que les autres
  // appareils sachent les lire.
  if (item.keyClass === 'machine') {
    const encryptedSha = await ports.vault.sha256OfFile(vaultPath);
    const chunks = await ports.uploadFromPath(item.key, vaultPath, item.size, encryptedSha);
    return {
      k: item.key,
      s: 'done',
      r: encryptedSha,
      n: item.size,
      ch: chunks.length,
      ks: chunks,
      t: ports.now(),
    };
  }

  // ── Cas 2 : aucune clé ne l'ouvre. On le compte, on le nomme, on ne touche
  // pas un octet. Il était perdu avant la migration, il l'est après — changer
  // de clé ne lui retire rien.
  if (item.keyClass === 'none') {
    return { k: item.key, s: 'damaged', why: 'unreadable', t: ports.now() };
  }

  // ── Cas 3 : l'élément est scellé sous la FEK ACTIVE.

  // REPRISE D'UNE LIGNE `uploaded` HÉRITÉE. Elle atteste un transfert CONFIRMÉ ;
  // sous C1 rien de local ne restait à faire derrière, donc il n'y a qu'à la
  // conclure. On ne repaie ni la lecture ni l'envoi.
  if (previous?.s === 'uploaded' && previous.r) {
    return {
      k: item.key,
      s: 'done',
      c: previous.c,
      r: previous.r,
      n: previous.n,
      ch: previous.ch,
      ks: previous.ks,
      t: ports.now(),
    };
  }

  if (await ports.vault.isV3Container(vaultPath)) {
    return transferV3Item(item, vaultPath, ports);
  }
  return transferRendererBlob(item, vaultPath, ports);
}

/**
 * Conteneur V3 : transcodage STREAMÉ vers l'outbox (mémoire plate, chaque
 * morceau authentifié au passage, aucun clair sur le disque), preuve de
 * lisibilité, envoi, puis suppression du fichier de transport.
 */
async function transferV3Item(
  item: PublishItem,
  vaultPath: string,
  ports: TransferPorts
): Promise<LedgerLine> {
  const outPath = ports.outbox.path(`${item.key}.v3`);
  try {
    const plaintextSha = await ports.outbox.transcodeFromVault(vaultPath, outPath);

    // Preuve AVANT l'envoi : le fichier de transport se relit bien sous la clé
    // du compte, et son clair est identique à la source, octet pour octet.
    const check = await ports.outbox.plaintextShaUnderAccountKey(outPath);
    if (check !== plaintextSha) {
      throw new Error('Vérification post-transcodage échouée (empreinte du clair différente)');
    }

    const size = await ports.outbox.sizeOf(outPath);
    const encryptedSha = await ports.outbox.sha256OfFile(outPath);
    const chunks = await ports.uploadFromPath(item.key, outPath, size, encryptedSha);

    return {
      k: item.key,
      s: 'done',
      c: plaintextSha,
      r: encryptedSha,
      n: size,
      ch: chunks.length,
      ks: chunks,
      t: ports.now(),
    };
  } finally {
    // Le fichier de transport ne survit à RIEN — ni au succès, ni à l'échec.
    // Le fichier du coffre, lui, n'a jamais été touché : il n'y a donc rien
    // d'autre à défaire.
    await ports.outbox.remove(outPath);
  }
}

/**
 * Blob « format renderer » (petit fichier de profil hybride).
 *
 * On garde le MÊME format pour l'envoi : le convertir en V3 le rendrait
 * illisible par le renderer, qui décide du format sur le premier octet. Le
 * rechiffrement se fait en mémoire ; seul un blob assez gros pour exiger le
 * multipart transite par un fichier de transport.
 */
async function transferRendererBlob(
  item: PublishItem,
  vaultPath: string,
  ports: TransferPorts
): Promise<LedgerLine> {
  const blob = await ports.vault.readAll(vaultPath);

  let plain: Buffer;
  try {
    plain = ports.openRendererBlob(blob);
  } catch {
    // Aucune clé ne l'ouvre. Les octets restent EXACTEMENT où ils sont — il n'y
    // a rien à nettoyer, puisque rien n'a été écrit.
    return { k: item.key, s: 'damaged', why: 'corrupt', t: ports.now() };
  }

  let sealed: Buffer | null = null;
  try {
    const plaintextSha = ports.sha256OfBuffer(plain);
    sealed = ports.sealRendererBlobForTransport(plain);

    // Preuve de lisibilité, comme pour le V3 : ce qui part doit s'ouvrir sous
    // la clé du compte. La faire ici coûte un déchiffrement d'un petit blob.
    const roundTrip = ports.openRendererBlobUnderAccountKey(sealed);
    const roundTripSha = ports.sha256OfBuffer(roundTrip);
    roundTrip.fill(0);
    if (roundTripSha !== plaintextSha) {
      throw new Error('Vérification post-scellement échouée');
    }

    const encryptedSha = ports.sha256OfBuffer(sealed);

    if (sealed.length >= ports.multipartThreshold) {
      const outPath = ports.outbox.path(`${item.key}.blob`);
      try {
        await ports.outbox.write(outPath, sealed);
        const chunks = await ports.uploadFromPath(
          item.key,
          outPath,
          sealed.length,
          encryptedSha
        );
        return lineFor(item, plaintextSha, encryptedSha, sealed.length, chunks, ports);
      } finally {
        await ports.outbox.remove(outPath);
      }
    }

    const chunks = await ports.uploadFromBuffer(item.key, sealed, encryptedSha);
    return lineFor(item, plaintextSha, encryptedSha, sealed.length, chunks, ports);
  } finally {
    plain.fill(0);
    if (sealed) sealed.fill(0);
  }
}

function lineFor(
  item: PublishItem,
  plaintextSha: string,
  encryptedSha: string,
  size: number,
  chunks: string[],
  ports: TransferPorts
): LedgerLine {
  return {
    k: item.key,
    s: 'done',
    c: plaintextSha,
    r: encryptedSha,
    n: size,
    ch: chunks.length,
    ks: chunks,
    t: ports.now(),
  };
}
