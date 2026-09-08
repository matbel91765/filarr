/**
 * Clé de garde du compte — point d'export.
 *
 *   custodyFormat.ts    constantes et dispositions d'octets (module PUR)
 *   custodyKdf.ts       Argon2id (via IPC vers le paquet natif du principal)
 *   custodyCrypto.ts    déverrouillage, ouverture, scellement JSON
 *   custodyApi.ts       les trois routes du worker, relayées par le principal
 *   custodySession.ts   la privée déverrouillée, EN MÉMOIRE DU RENDERER
 *   custodyRemember.ts  la mémoire OPTIONNELLE, derrière `safeStorage`
 *   custodyModel.ts     ce que l'écran en dit (modèle pur)
 */

export {
  base64ToBytes,
  bytesToBase64,
  bytesToBase64Url,
  CUSTODY_ARGON2_PARAMS,
  CUSTODY_IV_LENGTH,
  CUSTODY_SALT_LENGTH,
  CUSTODY_SCHEME_LEGACY,
  CUSTODY_SCHEME_PASSPHRASE,
  custodySchemeOf,
  ERR_CORRUPT_CUSTODY,
  ERR_INVALID_CUSTODY_KEY,
  ERR_SEAL_DECRYPT_FAILED,
  ERR_WRONG_PASSPHRASE,
  isCustodyKeyMaterial,
  X25519_KEY_LENGTH,
} from './custodyFormat';
export type { CustodyKeyMaterial, CustodyScheme } from './custodyFormat';

export { custodyArgon2id, isCustodyArgon2Available, setCustodyArgon2 } from './custodyKdf';
export type { Argon2idParams, CustodyArgon2Fn } from './custodyKdf';

export { openJson, openSecret, sealJson, unlockCustody } from './custodyCrypto';

export { fetchCustodyKey, fetchShareLabels, putShareLabel } from './custodyApi';
export type { ShareKind, ShareLabelListing, ShareLabelRow } from './custodyApi';

export {
  clearCustodySession,
  custodyPrivateKey,
  custodyPublicKeyForSealing,
  getCustodySession,
  lockCustody,
  resetCustodySessionForTests,
  setCustodyKey,
  setCustodyUnlocked,
  subscribeCustodySession,
} from './custodySession';
export type { CustodySessionState } from './custodySession';

export {
  forgetRememberedCustody,
  rememberCustody,
  rememberedCustodyStatus,
  restoreRememberedCustody,
} from './custodyRemember';
export type { RememberStatus, RestoreCustodyOutcome } from './custodyRemember';

export {
  custodyBannerVisible,
  custodyCanUnlock,
  custodyPhase,
  custodyPhaseKey,
  custodyUnlockErrorKey,
  custodyUnlockErrorOf,
  labelSyncReasonKey,
} from './custodyModel';
export type { CustodyPhase, CustodyPhaseInput, CustodyUnlockError } from './custodyModel';
