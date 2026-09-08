/**
 * LE BLOB SCELLÉ PAR L'APP DOIT S'OUVRIR AVEC LE COFFRE DU SITE.
 *
 * Un partage app ne survivait pas à son appareil : K_share ne vivait que dans
 * le localStorage du créateur. On la scelle désormais sur la clé de custody du
 * compte, comme le fait déjà Filarr Send — mais seulement si le format est
 * EXACTEMENT celui qu'ouvre `openSealedFileKey` du site.
 *
 * Le piège que ce test ferme : la fonction de scellement déjà présente dans
 * l'app (`sealToPublicKey`) produit un blob d'apparence identique avec un autre
 * séparateur de domaine HKDF. Le serveur l'aurait stocké sans broncher et le
 * site ne l'aurait JAMAIS ouvert — un échec silencieux, découvert le jour où
 * l'utilisateur cherche son lien perdu. On vérifie donc le round-trip contre
 * une réimplémentation fidèle de l'ouverture côté site, pas contre nous-mêmes.
 */

import { describe, expect, it } from 'vitest';
import { x25519 } from '@noble/curves/ed25519.js';
import { sealToCustodyKey } from './custodySeal';

const IV_LENGTH = 12;
/** Copie littérale de FR_SEAL_INFO — src/lib/file-request-crypto.ts du site. */
const SITE_SEAL_INFO = 'filarr.filerequest.seal.v1';

function pin(u: Uint8Array): Uint8Array {
  const out = new Uint8Array(new ArrayBuffer(u.length));
  out.set(u);
  return out;
}
function u8ToBase64Url(d: Uint8Array): string {
  let bin = '';
  for (const b of d) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function base64ToU8(input: string): Uint8Array {
  let s = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad = s.length % 4;
  if (pad === 2) s += '==';
  else if (pad === 3) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Réimplémentation fidèle de openSealedFileKey du SITE (avec son séparateur de
 * domaine). C'est le juge : si ceci ouvre le blob, le coffre l'ouvrira aussi.
 */
async function siteOpenSealed(
  sealedB64: string,
  privB64Url: string,
  info: string = SITE_SEAL_INFO
): Promise<Uint8Array> {
  const priv = base64ToU8(privB64Url);
  const blob = base64ToU8(sealedB64);
  if (blob.length <= 32 + IV_LENGTH) throw new Error('SEAL_DECRYPT_FAILED');
  const ephPub = pin(blob.slice(0, 32));
  const iv = blob.slice(32, 32 + IV_LENGTH);
  const ct = blob.slice(32 + IV_LENGTH);
  const shared = pin(x25519.getSharedSecret(priv, ephPub));
  const myPub = pin(x25519.getPublicKey(priv));
  const km = await crypto.subtle.importKey('raw', shared as BufferSource, 'HKDF', false, [
    'deriveKey',
  ]);
  const salt = new Uint8Array(ephPub.length + myPub.length);
  salt.set(ephPub, 0);
  salt.set(myPub, ephPub.length);
  const key = await crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: salt as BufferSource,
      info: new TextEncoder().encode(info),
    },
    km,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );
  return new Uint8Array(
    await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct as BufferSource)
  );
}

function custodyKeypair() {
  const priv = x25519.utils.randomSecretKey();
  return { priv: u8ToBase64Url(priv), pub: u8ToBase64Url(x25519.getPublicKey(priv)) };
}

describe('sealToCustodyKey — compatibilité avec le coffre du site', () => {
  it('le site rouvre exactement la K_share scellée par l’app', async () => {
    const kp = custodyKeypair();
    const kShare = crypto.getRandomValues(new Uint8Array(32));
    const opened = await siteOpenSealed(await sealToCustodyKey(kShare, kp.pub), kp.priv);
    expect(Array.from(opened)).toEqual(Array.from(kShare));
  });

  it('respecte la disposition ephPub(32)‖IV(12)‖ct+tag attendue', async () => {
    const kp = custodyKeypair();
    const blob = base64ToU8(await sealToCustodyKey(new Uint8Array(32), kp.pub));
    // 32 octets de clé + 12 d'IV + 32 de secret + 16 de tag GCM.
    expect(blob.length).toBe(32 + 12 + 32 + 16);
  });

  it('le mauvais séparateur de domaine NE passe PAS — le piège est bien réel', async () => {
    // Si un jour quelqu'un « harmonise » CUSTODY_SEAL_INFO sur celui de
    // userkey, ce test dit pourquoi le lien ne se reconstruira plus.
    const kp = custodyKeypair();
    const sealed = await sealToCustodyKey(crypto.getRandomValues(new Uint8Array(32)), kp.pub);
    await expect(siteOpenSealed(sealed, kp.priv, 'filarr.userkey.seal.v1')).rejects.toThrow();
  });

  it('une autre clé de custody n’ouvre rien', async () => {
    const mien = custodyKeypair();
    const autrui = custodyKeypair();
    const sealed = await sealToCustodyKey(crypto.getRandomValues(new Uint8Array(32)), mien.pub);
    await expect(siteOpenSealed(sealed, autrui.priv)).rejects.toThrow();
  });

  it('deux scellements de la même clé diffèrent — éphémère et IV frais', async () => {
    const kp = custodyKeypair();
    const k = crypto.getRandomValues(new Uint8Array(32));
    expect(await sealToCustodyKey(k, kp.pub)).not.toBe(await sealToCustodyKey(k, kp.pub));
  });

  it('refuse une clé publique de custody malformée plutôt que de sceller dans le vide', async () => {
    await expect(
      sealToCustodyKey(new Uint8Array(32), u8ToBase64Url(new Uint8Array(16)))
    ).rejects.toThrow('INVALID_CUSTODY_KEY');
  });
});
