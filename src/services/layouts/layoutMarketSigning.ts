/**
 * LA CRYPTO DU MARCHÉ DE MODÈLES — signer, et surtout vérifier.
 *
 * ── LE MODÈLE, EN UNE PHRASE ────────────────────────────────────────────────
 *
 * Le serveur est un relais d'octets réputé HOSTILE. La seule vérité est la
 * signature Ed25519 de l'éditeur, posée sur les octets EXACTS de l'enveloppe —
 * et le client la re-vérifie à l'installation ET à chaque chargement, parce
 * qu'un modèle rangé dans le stockage local n'est jamais présumé intact.
 *
 * C'est le même modèle que les greffons (`pluginSigning.ts`), à une différence
 * près qui simplifie tout : il n'y a PAS de paquet séparé. Un modèle plafonne à
 * 256 Kio de texte, donc la disposition voyage DANS l'enveloppe signée. Il n'y
 * a rien à hacher à côté, rien à télécharger en second, et donc aucune fenêtre
 * entre « j'ai vérifié le manifeste » et « j'ai reçu le contenu ».
 *
 * ── L'ORDRE DES VÉRIFICATIONS N'EST PAS NÉGOCIABLE ──────────────────────────
 *
 * LA CRYPTO PARLE AVANT LE PARSEUR, LE PARSEUR AVANT TOUT LE RESTE :
 *
 *   1. le plafond d'octets — avant d'analyser quoi que ce soit ;
 *   2. la SIGNATURE, sur la chaîne verbatim ;
 *   3. `JSON.parse`, seulement maintenant ;
 *   4. la forme de l'enveloppe, reconstruite champ par champ ;
 *   5. slug et version === CE QUI A ÉTÉ DEMANDÉ (anti-substitution) ;
 *   6. l'empreinte RECALCULÉE depuis la clé qui a signé ;
 *   7. la disposition elle-même, par `validateLayoutFile`.
 *
 * Inverser 2 et 3 laisserait un JSON malveillant choisir ce que le parseur voit
 * avant que la cryptographie ait parlé. C'est la faute classique, et elle ne se
 * voit pas à la relecture : le code « marche » dans les deux ordres.
 *
 * ── CE QUE L'ÉTAPE 5 FERME ──────────────────────────────────────────────────
 *
 * Un serveur compromis ne peut pas servir, sous le slug A, l'enveloppe
 * validement signée du modèle B — ni ressortir la v1.0.0 sous le nom de la
 * v2.0.0 pour rejouer une disposition retirée. Les deux attaques réussissent si
 * l'on se contente de « la signature est bonne ».
 */

import { computeFingerprint, signWithIdentity, verifyWithIdentity } from '../auth/userKeypair';
import {
  LAYOUT_MARKET_FORMAT_VERSION,
  LAYOUT_MARKET_KIND,
  LAYOUT_MARKET_MAX_ENVELOPE_BYTES,
  LayoutMarketVerifyError,
  inspectEnvelope,
  type EnvelopeInspection,
  type LayoutMarketEnvelope,
} from './layoutMarketTypes';
import { utf8ByteLength } from './layoutFormat';

/**
 * Le domaine de signature. MUST MATCH le worker (`layoutMarket.ts`, chantier
 * 02), qui reconstruit `IDENTITY_SIG_DOMAIN + LAYOUT_MANIFEST_DOMAIN + json`.
 *
 * `signWithIdentity` prépend LUI-MÊME le domaine d'identité : on ne passe ici
 * que la partie « modèle », comme le fait `pluginSigning`. Deux domaines
 * distincts pour deux objets distincts — sans quoi une signature d'enveloppe de
 * modèle serait rejouable comme signature de manifeste de greffon.
 */
export const LAYOUT_MANIFEST_DOMAIN = 'filarr.layout.manifest.v1\n';

const ENC = new TextEncoder();

// ==================== Construire ====================

/**
 * Les champs de l'enveloppe, dans l'ORDRE CANONIQUE.
 *
 * `JSON.stringify` respecte l'ordre d'insertion : construire l'objet ici, une
 * seule fois, garantit que deux publications du même contenu produisent les
 * mêmes octets. Ce n'est pas une exigence du protocole (la signature couvre les
 * octets, quels qu'ils soient) mais c'est ce qui rend un `diff` d'enveloppes
 * lisible, et ce qui permet à un test de comparer sans normaliser.
 */
/**
 * ⚠ CETTE LISTE EST UNE LISTE BLANCHE, ET ELLE A DEJA MENTI UNE FOIS.
 *
 * Elle enumere les champs a serialiser. Ajouter un champ a l'enveloppe SANS
 * l'ajouter ici le fait disparaitre en silence : il est saisi, valide, affiche
 * dans l'apercu — et il ne part jamais. C'est arrive au pseudonyme et a l'image
 * d'apercu, tous deux ajoutes plus tard, tous deux perdus sans un message.
 *
 * Rien dans le typage ne l'attrape : `LayoutMarketEnvelope` decrit ce qu'on
 * PEUT porter, pas ce qu'on ecrit. C'est le test `layoutEnvelopeRoundTrip` qui
 * garde cette liste — il remplit TOUS les champs et verifie qu'ils survivent.
 */
export function buildEnvelopeJson(envelope: LayoutMarketEnvelope): string {
  return JSON.stringify({
    kind: LAYOUT_MARKET_KIND,
    formatVersion: LAYOUT_MARKET_FORMAT_VERSION,
    slug: envelope.slug,
    version: envelope.version,
    name: envelope.name,
    ...(envelope.author ? { author: envelope.author } : {}),
    description: envelope.description,
    ...(envelope.icon ? { icon: envelope.icon } : {}),
    ...(envelope.preview ? { preview: envelope.preview } : {}),
    // ⚠ AJOUTÉ ICI AUSSI. C'est la liste blanche qui a déjà avalé `author` puis
    // `preview` en silence : un champ absent d'ici est saisi, validé, affiché
    // en aperçu — et ne part JAMAIS.
    ...(envelope.previews && envelope.previews.length > 0 ? { previews: envelope.previews } : {}),
    category: envelope.category,
    target: envelope.target,
    publisherFingerprint: envelope.publisherFingerprint,
    layout: envelope.layout,
  });
}

/**
 * Signe une enveloppe avec la clé d'identité chargée.
 *
 * ⚠ Prend la CHAÎNE, jamais l'objet. Un appelant qui passerait l'objet et
 * laisserait cette fonction le sérialiser signerait des octets que personne
 * d'autre ne reverra jamais : ce sont les octets transmis qui doivent être
 * signés, et l'appelant est le seul à savoir lesquels il transmet.
 */
export async function signEnvelope(envelopeJson: string): Promise<string> {
  return signWithIdentity(ENC.encode(LAYOUT_MANIFEST_DOMAIN + envelopeJson));
}

// ==================== Vérifier ====================

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * LA vérification complète — à l'installation, et à chaque chargement.
 *
 * `expected` porte le slug et la version RÉELLEMENT DEMANDÉS. Les passer est
 * obligatoire : sans eux, une signature valide suffirait, et c'est précisément
 * ce qui laisse un serveur compromis substituer un modèle à un autre.
 *
 * Jette `LayoutMarketVerifyError` — jamais un booléen. Un appelant qui oublie de
 * regarder un booléen installe le modèle quand même ; un appelant qui oublie
 * d'attraper une exception ne l'installe pas.
 */
export async function verifyPublishedLayout(p: {
  envelopeJson: string;
  signature: string;
  signPublicKey: string;
  expected: { slug: string; version: string };
  knownTypes: ReadonlySet<string>;
}): Promise<EnvelopeInspection> {
  if (typeof p.envelopeJson !== 'string') {
    throw new LayoutMarketVerifyError('bad_envelope', 'not-a-string');
  }
  if (utf8ByteLength(p.envelopeJson) > LAYOUT_MARKET_MAX_ENVELOPE_BYTES) {
    throw new LayoutMarketVerifyError('too_large');
  }

  // 2. LA SIGNATURE, avant le parseur. Sur la chaîne verbatim.
  const ok = await verifyWithIdentity(
    ENC.encode(LAYOUT_MANIFEST_DOMAIN + p.envelopeJson),
    p.signature,
    p.signPublicKey
  );
  if (!ok) throw new LayoutMarketVerifyError('bad_signature');

  // 3-4-7. Analyse, forme, disposition.
  const inspected = inspectEnvelope(p.envelopeJson, p.knownTypes);
  if (!inspected.ok) throw inspected.error;
  const { envelope } = inspected.inspection;

  // 5. ANTI-SUBSTITUTION. La signature peut être parfaitement valide et
  // désigner autre chose que ce qu'on a demandé.
  if (envelope.slug !== p.expected.slug || envelope.version !== p.expected.version) {
    throw new LayoutMarketVerifyError(
      'envelope_mismatch',
      `${envelope.slug}@${envelope.version} ≠ ${p.expected.slug}@${p.expected.version}`
    );
  }

  // 6. L'empreinte est RECALCULÉE depuis la clé qui a réellement signé. Celle
  // que l'enveloppe annonce n'est qu'une prétention — et c'est cette empreinte
  // que l'utilisateur compare à l'écran.
  const real = await computeFingerprint(base64ToBytes(p.signPublicKey));
  if (real !== envelope.publisherFingerprint) {
    throw new LayoutMarketVerifyError('fingerprint_mismatch');
  }

  return inspected.inspection;
}
