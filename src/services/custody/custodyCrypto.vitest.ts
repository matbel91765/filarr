/**
 * VECTEURS CROISÉS — un libellé scellé par le MOBILE doit s'ouvrir au BUREAU,
 * et réciproquement.
 *
 * ════════════════════════════════════════════════════════════════════════
 * CE QUE CE FICHIER JUGE, ET POURQUOI PAS AUTREMENT
 * ════════════════════════════════════════════════════════════════════════
 * Un test de round-trip contre soi-même ne prouve RIEN sur un protocole
 * inter-clients : un séparateur de domaine fautif, un sel de HKDF dans le
 * mauvais ordre ou un IV rangé après le chiffré passeraient tous les trois. Le
 * bureau relirait parfaitement ce qu'il vient d'écrire, et le mobile
 * n'ouvrirait jamais rien — un échec silencieux, découvert le jour où
 * l'utilisateur cherche le nom de son partage.
 *
 * Deux juges, donc, et aucun des deux n'est nous :
 *
 *   1. DES VECTEURS FIGÉS, produits hors de ce dépôt en réimplémentant le
 *      chemin de `filarr-mobile/src/services/custody/custodyCrypto.ts` (mêmes
 *      octets que `filarr-website/src/lib/custody-crypto.ts`). Ce sont des
 *      CONSTANTES : elles ne bougent pas quand notre code bouge, ce qui est
 *      exactement leur rôle. Les modifier pour faire passer un test serait
 *      supprimer le test.
 *   2. UNE RÉIMPLÉMENTATION FIDÈLE du côté mobile/site, écrite ici, qui ouvre
 *      ce que nous scellons. C'est le sens montant.
 *
 * ════════════════════════════════════════════════════════════════════════
 * POURQUOI ARGON2 EST INJECTÉ ET NON CALCULÉ
 * ════════════════════════════════════════════════════════════════════════
 * La KEK du vecteur EST une constante du vecteur : elle a été dérivée une fois,
 * avec le profil du site (m=19456, t=2, p=1, 32 octets), et elle est figée ici
 * avec le reste. L'injecter permet de vérifier le DÉBALLAGE — la seule partie
 * que ce module écrit — sans allouer 19 Mio à chaque assertion et sans
 * dépendre d'une chaîne native dans un environnement `node`.
 *
 * La correspondance des PARAMÈTRES Argon2, elle, est jugée à part, du côté du
 * processus principal : `electron/__tests__/custodyKdf.vitest.ts`. C'est là que
 * vit la primitive, et c'est là que le profil doit être vérifié.
 */

import { describe, expect, it, afterEach } from 'vitest';
import { x25519 } from '@noble/curves/ed25519.js';

import { openJson, openSecret, sealJson, unlockCustody } from './custodyCrypto';
import { setCustodyArgon2 } from './custodyKdf';
import {
  base64ToBytes,
  bytesToBase64,
  ERR_CORRUPT_CUSTODY,
  ERR_SEAL_DECRYPT_FAILED,
  ERR_WRONG_PASSPHRASE,
  isCustodyKeyMaterial,
  type CustodyKeyMaterial,
} from './custodyFormat';

// ════════════════════════════════════════════════════════════════════════
// LES VECTEURS. Produits hors dépôt par le chemin du mobile/site.
// ════════════════════════════════════════════════════════════════════════

/** La phrase de récupération du vecteur — accentuée À DESSEIN (UTF-8, pas de normalisation). */
const VECTOR_PASSPHRASE = 'phrasé de récupération d’essai';

/** KEK = Argon2id(phrase, sel, m=19456, t=2, p=1, 32 o), figée avec le vecteur. */
const VECTOR_KEK = 'eUaBWN+2TTktV7o//0dMjKw/s5hW2LynwLiA9pBpYvE=';

/** Matériel de clé tel que `GET /account/custody-key` le rendrait. */
const VECTOR_KEY: CustodyKeyMaterial = {
  custodyPublicKey: 'hSDwCYkwp1R0i33ctD73Wg2_Og0mOBr066SpjqqbTmo',
  wrappedPrivateKey:
    'qrvM3e7/ABEiM0RVi011b+KvxaHOQyKb32dVkWQ2s/OEtX8Wednp1pF+IVmzDwRy0qUsPdyVVBvaMN24',
  kdfSalt: 'AQIDBAUGBwgJCgsMDQ4PEA==',
  kdfScheme: 'passphrase-v1',
};

/** La privée que l'emballage ci-dessus doit rendre, aux 32 octets près. */
const VECTOR_PRIVATE = 'dwdtCnMYpX08FsFyUbJmRd9ML4frwJkqsXf7pR25LCo=';

/** Un libellé de partage scellé par le mobile vers `VECTOR_KEY.custodyPublicKey`. */
const VECTOR_SEALED_LABEL =
  '3p7bfXt9wbTTW2HC7OQ1Nz+DQ8hbeGdNrfx+FG+IK08PDg0MCwoJCAcGBQ8efIImIyN2hhWB/KUCMDw5lM8l5glDkM3Gl1qTupLBhDiXhmo3voEbcm+Mzz6dNkNMMzY5JOBvjDebirz4ITgw/pfsPD8GL3RoK+lh';

/** Le libellé en clair que le sceau doit rendre. */
const VECTOR_LABEL = { label: 'Devis toiture — été', client: 'Dupont & Fils' };

/**
 * Substitution d'Argon2 : rend la KEK du vecteur pour la phrase du vecteur, et
 * des octets DIFFÉRENTS pour tout autre secret. C'est ce second point qui rend
 * le test « mauvaise phrase » honnête — une substitution constante ferait
 * passer n'importe quelle saisie.
 */
function installVectorKdf(): void {
  setCustodyArgon2(async (passphrase, _salt, _params, len) => {
    if (passphrase === VECTOR_PASSPHRASE) return base64ToBytes(VECTOR_KEK);
    const wrong = new Uint8Array(len);
    wrong.fill(0x5a);
    return wrong;
  });
}

afterEach(() => {
  setCustodyArgon2(null);
});

// ════════════════════════════════════════════════════════════════════════
// LE JUGE MONTANT : réimplémentation fidèle du mobile/site.
// ════════════════════════════════════════════════════════════════════════

/** Copie littérale de `CUSTODY_SEAL_INFO` du mobile / `FR_SEAL_INFO` du site. */
const OTHER_SIDE_SEAL_INFO = 'filarr.filerequest.seal.v1';

function pin(u: Uint8Array): Uint8Array {
  const out = new Uint8Array(new ArrayBuffer(u.length));
  out.set(u);
  return out;
}

/**
 * Ouvre un sceau comme le ferait le mobile (`openSecret` de son
 * `custodyCrypto.ts`) : `ephPub(32) ‖ iv(12) ‖ ct+tag`, HKDF-SHA-256 salé par
 * les DEUX publiques, destinataire RECALCULÉ depuis la privée.
 */
async function otherSideOpen(sealedB64: string, privRaw: Uint8Array): Promise<Uint8Array> {
  const blob = base64ToBytes(sealedB64);
  const ephPub = pin(blob.slice(0, 32));
  const iv = pin(blob.slice(32, 44));
  const ct = pin(blob.slice(44));
  const ownPub = pin(x25519.getPublicKey(pin(privRaw)));
  const shared = pin(x25519.getSharedSecret(pin(privRaw), ephPub));
  const salt = new Uint8Array(new ArrayBuffer(64));
  salt.set(ephPub, 0);
  salt.set(ownPub, 32);
  const km = await crypto.subtle.importKey('raw', shared as BufferSource, 'HKDF', false, [
    'deriveKey',
  ]);
  const key = await crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: salt as BufferSource,
      info: new TextEncoder().encode(OTHER_SIDE_SEAL_INFO),
    },
    km,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );
  return new Uint8Array(
    await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      key,
      ct as BufferSource
    )
  );
}

// ════════════════════════════════════════════════════════════════════════

describe('vecteurs croisés — la clé de garde du mobile s’ouvre au bureau', () => {
  it('le matériel du vecteur a bien la forme attendue d’un enregistrement serveur', () => {
    expect(isCustodyKeyMaterial(VECTOR_KEY)).toBe(true);
  });

  it('déballe la privée EXACTE du vecteur depuis la phrase de récupération', async () => {
    installVectorKdf();

    const priv = await unlockCustody(VECTOR_PASSPHRASE, VECTOR_KEY);

    expect(bytesToBase64(priv)).toBe(VECTOR_PRIVATE);
    // Et la publique annoncée par le serveur en découle : c'est ce qui prouve
    // que ces 32 octets sont la bonne moitié de la bonne paire, pas seulement
    // 32 octets qui ont survécu à un déchiffrement.
    expect(bytesToBase64(x25519.getPublicKey(pin(priv))).replace(/=+$/, '')).toBe(
      VECTOR_KEY.custodyPublicKey.replace(/-/g, '+').replace(/_/g, '/')
    );
  });

  it('ouvre un libellé SCELLÉ PAR LE MOBILE, accents et tiret cadratin compris', async () => {
    const priv = base64ToBytes(VECTOR_PRIVATE);

    const label = await openJson<typeof VECTOR_LABEL>(VECTOR_SEALED_LABEL, priv);

    expect(label).toEqual(VECTOR_LABEL);
  });

  it('ce QUE NOUS scellons s’ouvre avec la réimplémentation du mobile', async () => {
    const priv = base64ToBytes(VECTOR_PRIVATE);
    const value = { label: 'Contrat — mai', client: 'Société Générale' };

    const sealed = await sealJson(value, VECTOR_KEY.custodyPublicKey);
    const plain = await otherSideOpen(sealed, priv);

    expect(JSON.parse(new TextDecoder().decode(plain))).toEqual(value);
  });

  it('un aller-retour complet passe par les deux implémentations sans se croiser', async () => {
    installVectorKdf();
    const priv = await unlockCustody(VECTOR_PASSPHRASE, VECTOR_KEY);

    const sealed = await sealJson({ label: 'aller-retour' }, VECTOR_KEY.custodyPublicKey);

    await expect(openJson(sealed, priv)).resolves.toEqual({ label: 'aller-retour' });
    await expect(otherSideOpen(sealed, priv)).resolves.toBeInstanceOf(Uint8Array);
  });
});

describe('refus — ce qui ne doit PAS s’ouvrir, et ce que ça doit dire', () => {
  it('une mauvaise phrase lève WRONG_PASSPHRASE, jamais des octets non authentifiés', async () => {
    installVectorKdf();

    await expect(unlockCustody('pas la bonne', VECTOR_KEY)).rejects.toThrow(ERR_WRONG_PASSPHRASE);
  });

  it('un emballage tronqué lève CORRUPT_CUSTODY — un motif DISTINCT de la mauvaise phrase', async () => {
    installVectorKdf();

    await expect(
      unlockCustody(VECTOR_PASSPHRASE, { ...VECTOR_KEY, wrappedPrivateKey: 'AAAA' })
    ).rejects.toThrow(ERR_CORRUPT_CUSTODY);
  });

  it('un sceau ouvert avec UNE AUTRE privée lève SEAL_DECRYPT_FAILED', async () => {
    const autre = pin(x25519.utils.randomSecretKey());

    await expect(openSecret(VECTOR_SEALED_LABEL, autre)).rejects.toThrow(ERR_SEAL_DECRYPT_FAILED);
  });

  it('un sceau réduit à son en-tête est refusé plutôt que déchiffré à vide', async () => {
    const priv = base64ToBytes(VECTOR_PRIVATE);
    const tronque = bytesToBase64(new Uint8Array(44));

    await expect(openSecret(tronque, priv)).rejects.toThrow(ERR_SEAL_DECRYPT_FAILED);
  });

  it('openJson RETOURNE null au lieu de lever : un libellé illisible ne doit pas emporter la ligne', async () => {
    const autre = pin(x25519.utils.randomSecretKey());

    await expect(openJson(VECTOR_SEALED_LABEL, autre)).resolves.toBeNull();
  });

  it('un sceau qui s’ouvre mais ne porte pas du JSON rend null, pas une exception', async () => {
    const priv = base64ToBytes(VECTOR_PRIVATE);
    const { sealToCustodyKey } = await import('../sharing/custodySeal');
    const sealed = await sealToCustodyKey(
      new TextEncoder().encode('ceci n’est pas du JSON'),
      VECTOR_KEY.custodyPublicKey
    );

    await expect(openJson(sealed, priv)).resolves.toBeNull();
  });
});

describe('le sceau lie sa dérivation aux deux publiques', () => {
  /**
   * Le sel du HKDF est `ephPub ‖ pubDestinataire`. Si l'ouverture LISAIT la
   * publique du destinataire dans le blob au lieu de la recalculer, un blob
   * hostile choisirait la moitié du sel. On vérifie donc que remplacer la
   * publique éphémère par une autre casse tout — c'est le signe que le sel est
   * bien lié, et pas ignoré.
   */
  it('changer la publique éphémère du blob rend le sceau illisible', async () => {
    const priv = base64ToBytes(VECTOR_PRIVATE);
    const blob = base64ToBytes(VECTOR_SEALED_LABEL);
    blob.set(x25519.getPublicKey(pin(x25519.utils.randomSecretKey())), 0);

    await expect(openSecret(bytesToBase64(blob), priv)).rejects.toThrow(ERR_SEAL_DECRYPT_FAILED);
  });
});
