/**
 * blockCodec.ts — Compression d'un bloc avant chiffrement. PORTABLE.
 *
 * Lot 18 du chantier synchronisation. Compresser AVANT de chiffrer, jamais
 * après : un chiffré est indistinguable d'aléa, donc incompressible. C'est
 * l'ordre qui donne les −38 % de stockage.
 *
 * ── POURQUOI DEFLATE ET NON ZSTD ─────────────────────────────────────────────
 * Le dossier disait « zstd niveau 3 », et zstd compresse effectivement mieux :
 * sur un échantillon de notes JSON de 40 Kio, zstd rend 1 104 octets contre
 * 1 944 pour deflate. Mais le lot 8 — le web et le mobile doivent LIRE les
 * fichiers delta — change la question : le codec doit exister sur les trois
 * surfaces, sinon un bloc écrit par le bureau est illisible ailleurs, ce qui
 * est exactement la rupture qu'on est en train de réparer.
 *
 *   - `'deflate-raw'` désigne un ALGORITHME — DEFLATE brut au sens de la
 *     RFC 1951 — et JAMAIS une API. Les trois surfaces utilisent des MOTEURS
 *     DIFFÉRENTS : `CompressionStream`/`DecompressionStream` ici et sur le web,
 *     `fflate` sur mobile (ni `CompressionStream` ni `DecompressionStream`
 *     n'existent en React Native — vérifié par la session mobile ; Hermes n'a
 *     même pas `TextDecoder`). Seule la conformité est imposée.
 *   - zstd n'est pas exposé par l'API des navigateurs. L'utiliser imposerait
 *     d'embarquer un décodeur WebAssembly dans l'app web et dans le mobile.
 *
 * L'écart réel est plus petit qu'il n'y paraît : les deux dépassent 95 % de
 * réduction sur du JSON. On échange quelques points de taux contre l'absence de
 * dépendance et la garantie qu'un bloc écrit quelque part se lit partout.
 * Le champ `codec` du manifeste laisse la porte ouverte à zstd le jour où les
 * trois surfaces sauront le lire.
 *
 * ⚠ L'ENCODEUR DEFLATE N'EST PAS DÉTERMINISTE, ET C'EST CONFORME.
 * La RFC 1951 spécifie le DÉCODEUR. Le découpage en blocs et le choix des arbres
 * de Huffman sont libres : deux compresseurs conformes produisent deux encodages
 * valides et DIFFÉRENTS du même clair, et chacun relit l'autre. Mesuré ici — le
 * même clair rend 70 octets au niveau 1 et 53 au niveau 6 ; mesuré côté mobile —
 * 65 536 zéros rendent 78 octets via les flux et 79 via `fflate`.
 * CONSÉQUENCE POUR LES VECTEURS : un bloc COMPRESSÉ ne peut pas être lié « octet
 * pour octet » entre surfaces. Seul son DÉCHIFFREMENT est opposable. Voir §5.2
 * de la fiche de parité et `deltaVectors.vitest.ts`.
 *
 * ── LA RÈGLE D'UTILITÉ, NON NÉGOCIABLE ───────────────────────────────────────
 * Un bloc ne doit JAMAIS grossir. Sur des octets déjà comprimés — JPEG, MP4,
 * PDF, archives — deflate ajoute un en-tête et des marqueurs : mesuré ici,
 * 65 536 octets aléatoires ressortent à 65 558. `maybeCompress` compare et rend
 * le clair quand la compression ne gagne rien, en laissant le bit à 0.
 *
 * ── ZÉRO IMPORT ──────────────────────────────────────────────────────────────
 * Recopié par le mobile, importé par l'app web. Pas de `zlib`, pas de `Buffer`.
 */

import { ERR_CORRUPT } from './blockFormat';

/**
 * Nom du codec, tel qu'il apparaît dans `chunking.codec` du manifeste v5.
 * Absent du manifeste = pas de compression (fichiers écrits avant ce lot).
 */
export const CODEC_DEFLATE_RAW = 'deflate-raw';

/**
 * Sous cette taille, on ne tente même pas : l'en-tête deflate coûterait plus
 * que le gain, et l'aller-retour de flux n'est pas gratuit.
 */
export const MIN_COMPRESS_SIZE = 128;

/**
 * Fraction du clair au-dessus de laquelle on garde le clair.
 *
 * Un bloc qui ne gagne que 2 % ne vaut pas le coût de décompression à chaque
 * lecture, sur chaque appareil, pour toujours. On exige un gain franc.
 */
export const COMPRESS_RATIO_THRESHOLD = 0.95;

/**
 * Plafond de sortie, en octets, au-delà duquel la lecture est ABANDONNÉE.
 *
 * Sans plafond, une bombe de décompression est intégralement matérialisée en
 * mémoire avant d'être rejetée par le contrôle de longueur : quelques
 * kilo-octets peuvent gonfler en gigaoctets, et le processus tombe avant même
 * d'avoir pu dire non. Le plafond transforme un plantage mémoire en refus.
 *
 * ⚠ Le piège, signalé par la session mobile après mesure sur `fflate` : une
 * borne de sortie qui TRONQUE au lieu de lever est pire que pas de borne. Le
 * contrôle de longueur voit alors la bonne taille et le mauvais contenu. Ici on
 * lit délibérément JUSQU'À DÉPASSER le plafond avant de refuser, précisément
 * pour que le dépassement soit détectable au lieu d'être silencieux.
 */
async function through(
  stream: TransformStream<Uint8Array, Uint8Array>,
  input: Uint8Array,
  limit = Number.POSITIVE_INFINITY
): Promise<Uint8Array> {
  const writer = stream.writable.getWriter();
  // On n'ATTEND pas l'écriture — un flux dont le tampon interne est plus petit
  // que l'entrée se bloquerait, c'est le lecteur ci-dessous qui le draine.
  //
  // Mais on ne peut pas non plus la laisser tomber avec `void` : quand le flux
  // casse (octets qui ne sont pas du deflate), CES promesses-là rejettent
  // aussi, et personne ne les attrape. Le `try/catch` de l'appelant ne couvre
  // que la lecture, si bien que l'erreur ressortait en rejet non géré — la
  // suite passait au vert avec deux erreurs à côté, et sur un `unhandled
  // rejection` fatal en production c'est le processus principal qui tombe.
  // On les neutralise ici : l'échec réel est rapporté par le lecteur.
  const ignore = () => undefined;
  writer.write(input).catch(ignore);
  writer.close().catch(ignore);

  const reader = stream.readable.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    total += value.length;
    if (total > limit) {
      // On a DÉPASSÉ le plafond, on ne l'a pas atteint : le dépassement est
      // donc constaté, jamais deviné. On rend la main au flux avant de lever,
      // sinon le décompresseur reste ouvert derrière nous.
      await reader.cancel().catch(() => undefined);
      throw new Error(ERR_CORRUPT);
    }
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** Compresse sans se demander si c'est utile. Réservé aux tests et aux vecteurs. */
export async function deflateRaw(input: Uint8Array): Promise<Uint8Array> {
  return through(new CompressionStream('deflate-raw') as TransformStream<Uint8Array, Uint8Array>, input);
}

/**
 * Décompresse. Lève `ERR_CORRUPT` sur des octets qui ne sont pas du deflate —
 * même message que le reste de la chaîne, pour qu'un bloc abîmé donne toujours
 * la même erreur quelle que soit l'étape où il casse.
 */
export async function inflateRaw(
  input: Uint8Array,
  limit = Number.POSITIVE_INFINITY
): Promise<Uint8Array> {
  try {
    return await through(
      new DecompressionStream('deflate-raw') as TransformStream<Uint8Array, Uint8Array>,
      input,
      limit
    );
  } catch {
    throw new Error(ERR_CORRUPT);
  }
}

export interface MaybeCompressed {
  /** Les octets à chiffrer : compressés, ou le clair d'origine. */
  payload: Uint8Array;
  /** À reporter dans le bit 4 de l'en-tête du bloc. */
  compressed: boolean;
}

/**
 * Compresse si — et seulement si — ça vaut le coup.
 *
 * Rend toujours de quoi remplir l'en-tête : le drapeau et la charge utile ne
 * peuvent pas se désynchroniser puisqu'ils sortent ensemble. C'est délibéré,
 * un appelant ne doit jamais avoir à décider lui-même de la valeur du bit.
 */
export async function maybeCompress(plain: Uint8Array): Promise<MaybeCompressed> {
  if (plain.length < MIN_COMPRESS_SIZE) {
    return { payload: plain, compressed: false };
  }
  let candidate: Uint8Array;
  try {
    candidate = await deflateRaw(plain);
  } catch {
    // Une panne de compression n'est jamais une panne de synchronisation : on
    // stocke le clair. Perdre quelques pourcents de stockage vaut mieux que
    // perdre un fichier.
    return { payload: plain, compressed: false };
  }
  if (candidate.length >= Math.floor(plain.length * COMPRESS_RATIO_THRESHOLD)) {
    return { payload: plain, compressed: false };
  }
  return { payload: candidate, compressed: true };
}

/**
 * Rétablit le clair à partir de la charge utile et du drapeau lu dans l'en-tête.
 *
 * `expectedSize` vient du manifeste, authentifié par la FEK : on VÉRIFIE que la
 * décompression rend bien la longueur annoncée. Sans ce contrôle, une bombe de
 * décompression — quelques kilo-octets qui gonflent en gigaoctets — passerait
 * pour un bloc légitime. Le manifeste étant authentifié, la taille attendue ne
 * peut pas être falsifiée par qui stocke les octets.
 */
export async function decodePayload(
  payload: Uint8Array,
  compressed: boolean,
  expectedSize: number
): Promise<Uint8Array> {
  if (!compressed) {
    if (payload.length !== expectedSize) throw new Error(ERR_CORRUPT);
    return payload;
  }
  // Le plafond est la taille attendue : un clair conforme la remplit
  // exactement, un clair plus long la depasse et la lecture est abandonnee
  // AVANT que la bombe ne soit materialisee.
  const plain = await inflateRaw(payload, expectedSize);
  if (plain.length !== expectedSize) throw new Error(ERR_CORRUPT);
  return plain;
}
