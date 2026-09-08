/**
 * Service d'appairage — process principal Electron. PROTOCOLE v2.
 *
 * Transfert de la FEK d'un appareil déjà déverrouillé (rôle A) vers un
 * appareil qui rejoint (rôle B). La FEK ne quitte JAMAIS un appareil en clair
 * : elle est emballée sous AES-256-GCM avec une clé dérivée d'un ECDH
 * éphémère. Les formules vivent dans `pairingProtocol.ts` (module pur,
 * rejouable contre les vecteurs dorés) ; ce fichier n'orchestre que la
 * CÉRÉMONIE — qui parle à qui, dans quel ordre, et à quel moment l'humain
 * confirme.
 *
 * POURQUOI v2 EXISTE
 * ------------------
 * En v1, la clé d'emballage était dérivée avec le CODE À SIX CHIFFRES comme
 * sel HKDF. Ce code est aussi la clé d'index KV du serveur
 * (`pairing:{code}:pubkey-a`). Le serveur connaissait donc toutes les entrées
 * de la dérivation sauf le secret ECDH — et ce secret, il l'obtenait en
 * substituant sa propre clé publique à celle de B : il déballait la FEK puis
 * la ré-emballait vers le vrai B, qui ne voyait rien. Le chiffrement était
 * correct ; c'est l'AUTHENTIFICATION qui manquait. Un ECDH non authentifié ne
 * protège que d'un écoutant passif, jamais de celui qui achemine les
 * messages. Le serveur pouvait lire la clé qui déchiffre tout le coffre : le
 * zero-knowledge revendiqué était faux, et le défaut valait aussi bien
 * mobile↔bureau que bureau↔bureau.
 *
 * CE QUE LA CÉRÉMONIE v2 CHANGE, CONCRÈTEMENT
 * -------------------------------------------
 * 1. A engendre un secret `S` de 32 octets, le met dans le QR, et ne l'envoie
 *    à AUCUNE route. `S` est le sel HKDF. Le serveur peut toujours substituer
 *    des clés : il ne sait plus dériver la clé d'emballage.
 * 2. A publie `commitA = SHA-256(étiquette ‖ pubA)` À L'INITIATION et ne
 *    révèle `pubA` qu'APRÈS avoir reçu `pubB`. Sans cet ENGAGEMENT, un
 *    intercepteur verrait `pubB` avant de choisir la clé qu'il livre à A, et
 *    broierait hors ligne ~10⁶ candidats jusqu'à faire coïncider les deux
 *    SAS — quelques secondes. Avec lui, chaque camp est figé avant que
 *    l'autre ne soit connu : une seule tentative à l'aveugle, 10⁻⁶, en ligne
 *    et destructrice. (Structure de ZRTP, RFC 6189 §7.1.)
 * 3. Les deux appareils affichent un SAS de six chiffres dérivé du secret
 *    ECDH ET des deux clés publiques. L'humain confirme qu'ils coïncident.
 *    C'est la SEULE protection du mode manuel, qui n'a pas de secret QR.
 * 4. Un pair v1 fait échouer la cérémonie, FERMÉE. Voir
 *    `PAIRING_ALLOW_LEGACY_V1` plus bas.
 *
 * LA RÈGLE DURE, celle dont tout le reste dépend :
 *
 *   A n'emballe et ne publie la FEK qu'APRÈS la confirmation humaine sur A.
 *   B ne SONDE ni ne déballe la FEK qu'APRÈS la confirmation humaine sur B.
 *
 * Aucune dérogation. En particulier on ne pré-calcule pas l'emballage « pour
 * gagner du temps », et B ne sonde pas `wrapped-fek` en avance : laisser la
 * FEK emballée résider dans la mémoire de B pendant que l'humain hésite
 * encore serait strictement plus faible que ne pas la demander.
 *
 * CE QUI TRAVERSE L'IPC VERS LE RENDERER : le code d'appairage, la charge du
 * QR (qui contient `S` — elle doit bien être gravée en image quelque part),
 * les six chiffres du SAS (faits pour être lus), et des noms d'appareils.
 * JAMAIS la FEK, jamais une clé privée, jamais une clé d'emballage. Rien de
 * tout cela n'est journalisé : `log` ne reçoit que des codes d'appairage et
 * des noms d'étape.
 */

import * as os from 'os';
import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { BrowserWindow, app } from 'electron';
import log from 'electron-log';
import { API_BASE, fetchWithTimeout, getAccessToken, getMe, getAuthStatus } from './authService';
import { decideFekAdoption } from './publish/adoptionGuard';
import type { FekAdoptionDecision } from './publish/types';
import * as publishEngine from './publish/publishEngine';
import StorageService from './storageService';
import profileManager from './profileManager';
import * as syncService from './sync/syncService';
import * as r2 from './sync/syncR2Client';
import type { SyncManifest } from './sync/syncManifest';
import { buildPairingQrPayloadV2, parsePairingQrV2 } from './pairingQr';
import {
  computeCommitA,
  deriveSessionMaterial,
  generateEphemeralKeyPair,
  generatePairingCode,
  generatePairingSecret,
  IV_LENGTH,
  unwrapFek,
  verifyCommitA,
  wrapFek,
  WRAPPED_FEK_LENGTH,
  zeroize,
  type PairingMode,
  type Sas,
  type WebCryptoKey,
} from './pairingProtocol';

/**
 * Autorise le protocole d'appairage v1 (ECDH non authentifié).
 *
 * VAUT `false`. Le mettre à `true` réintroduit le défaut documenté en tête de
 * ce fichier : le serveur peut obtenir la FEK par substitution de clé
 * publique. N'existe que pour un incident de déploiement où une flotte se
 * retrouverait bloquée. Toute mise à `true` est temporaire, journalisée, et
 * s'accompagne d'un correctif de version.
 *
 * C'EST LE SEUL POINT DE BASCULE DE TOUT LE CODE BUREAU. Aucun autre endroit
 * ne doit tester la version du protocole pour décider d'un repli : une
 * bascule répartie sur trois `if` est une bascule qu'on oublie de refermer.
 */
export const PAIRING_ALLOW_LEGACY_V1 = false;

/** Version du protocole que ce client parle. Littérale, jamais négociée. */
const PROTOCOL_VERSION = 2;

// ── Types ───────────────────────────────────────────────────────────────────

type PairingRole = 'A' | 'B';

/**
 * Motifs d'échec. Ils voyagent jusqu'au renderer pour choisir le bon message
 * — un « erreur réseau » générique après un SAS divergent serait un mensonge
 * dangereux : l'utilisateur doit savoir que quelqu'un a peut-être tenté de
 * s'interposer.
 */
export type PairingFailureReason =
  | 'sas-rejected'
  | 'commit-mismatch'
  | 'unwrap-failed'
  | 'expired'
  | 'cancelled'
  | 'peer-too-old'
  | 'role-taken'
  | 'invalid-code'
  | 'network'
  /**
   * Le coffre porte déjà du contenu sous une AUTRE clé. Ce n'est PAS un échec
   * d'appairage : la clé du compte est arrivée, elle est vérifiée, et elle est
   * conservée. C'est une BIFURCATION — le parcours « Publier ce coffre sur le
   * compte » prend le relais, et c'est le seul instant où il est réalisable,
   * puisque l'appareil détient alors les deux clés.
   */
  | 'publish-required'
  /**
   * Le coffre est verrouillé : on ne peut pas lire ce qu'il contient, donc on
   * ne peut ni l'adopter sans risque ni le migrer. La sortie est « déverrouille
   * le coffre, puis recommence » — et elle existe, elle.
   */
  | 'vault-locked';

interface HumanGate {
  promise: Promise<boolean>;
  settle: (confirmed: boolean) => void;
}

interface PairingSession {
  role: PairingRole;
  code: string;
  privateKey: WebCryptoKey;
  publicKeyRaw: Uint8Array;
  /**
   * Le secret du QR. Toujours présent côté A (il l'engendre). Côté B il n'est
   * présent que si l'entrée venait d'un scan — ce qui, sur le bureau, n'arrive
   * jamais : il n'y a pas de caméra, donc le bureau rejoint TOUJOURS en mode
   * manuel, protégé par le seul SAS. C'est précisément le cas que le SAS
   * existe pour couvrir.
   */
  secret: Uint8Array | null;
  expiresAt: number;
  abortController: AbortController;
  gate: HumanGate | null;
}

interface PairingResult {
  success: boolean;
  error?: string;
  reason?: PairingFailureReason;
  profileIds?: string[];
  /**
   * Renseigné avec `reason: 'publish-required'` : de quoi peindre l'écran 0
   * sans une seconde énumération du disque.
   */
  publish?: { itemCount: number; byteCount: number; profileCount: number };
}

interface InitiateResult {
  code: string;
  expiresAt: number;
  /**
   * La charge du QR, `filarr://pair?v=2&code=…&s=…`. Elle CONTIENT le secret :
   * c'est tout son intérêt, puisque le secret ne doit voyager que par l'image.
   * Le renderer la grave puis l'oublie ; elle n'est ni journalisée, ni
   * persistée, ni recopiée dans le presse-papiers. `null` si la construction a
   * échoué — l'interface retombe alors sur les six chiffres, qui restent un
   * chemin complet (mode manuel).
   */
  qrPayload: string | null;
}

// ── Constantes ──────────────────────────────────────────────────────────────

const PAIRING_TTL_MS = 5 * 60 * 1000; // 300 s — aligné sur le TTL du worker
const POLL_INTERVAL_MS = 2_000;
const MAX_CODE_COLLISION_RETRIES = 3;
const MAX_DEVICE_NAME_LENGTH = 64;

// ── État ────────────────────────────────────────────────────────────────────

let mainWindow: BrowserWindow | null = null;

/** Sessions en cours, en MÉMOIRE UNIQUEMENT, indexées par code. */
const activeSessions = new Map<string, PairingSession>();

export function setMainWindow(win: BrowserWindow): void {
  mainWindow = win;
}

function notifyRenderer(channel: string, data: Record<string, unknown>): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

// ── Client HTTP conscient du code de statut ─────────────────────────────────

interface PairingHttpResult<T> {
  status: number;
  ok: boolean;
  data?: T;
  error?: string;
}

/**
 * L'appairage est le seul protocole du produit dont la MACHINE À ÉTATS est
 * pilotée par les codes HTTP : `404` = « pas encore », `409` = « quelqu'un a
 * déjà pris ce rôle », `410` = « session détruite, avec un motif », `426` =
 * « ce serveur ne parle plus v1 ». `authenticatedApiCall` ne rend que
 * `{success, error}` et perd le statut — on ne peut donc pas distinguer « B
 * n'est pas encore là » (on continue de sonder) de « B a été volé par
 * quelqu'un d'autre » (on abandonne immédiatement). D'où ce client local, qui
 * ne fait rien de plus qu'exposer le statut.
 *
 * `getAccessToken` rafraîchit le jeton de lui-même quand il a expiré : une
 * cérémonie de cinq minutes ne meurt donc pas sur une expiration de jeton.
 */
async function pairingApiCall<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<PairingHttpResult<T>> {
  const accessToken = await getAccessToken();
  if (!accessToken) {
    return { status: 0, ok: false, error: 'Not authenticated' };
  }

  let response: Response;
  try {
    response = await fetchWithTimeout(`${API_BASE}${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
        Authorization: `Bearer ${accessToken}`,
      },
    });
  } catch (err) {
    return { status: 0, ok: false, error: (err as Error).message };
  }

  // Défense contre les corps non-JSON (page de défi Cloudflare, erreur de
  // proxy) : sans elle, `response.json()` casse sur un SyntaxError opaque.
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    return {
      status: response.status,
      ok: false,
      error: `Unexpected server response (HTTP ${response.status})`,
    };
  }

  const body = (await response.json()) as { success?: boolean; data?: T; error?: string };
  return {
    status: response.status,
    ok: response.ok && body.success !== false,
    data: body.data,
    error: body.error,
  };
}

// ── Attente humaine ─────────────────────────────────────────────────────────

/**
 * Crée le point d'attente de la confirmation humaine. La promesse ne se
 * résout QUE sur un geste explicite (`pairing:confirmSas` /
 * `pairing:rejectSas`), sur l'annulation, ou à l'expiration du TTL.
 *
 * IL N'Y A PAS DE VALEUR PAR DÉFAUT « CONFIRMÉ ». Un délai qui expire, une
 * fenêtre qui perd le focus, une modale fermée : tout cela vaut REFUS. La
 * confirmation est un geste positif ou n'est pas.
 */
function createHumanGate(expiresAt: number): HumanGate {
  let settle: (confirmed: boolean) => void = () => undefined;
  let settled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const promise = new Promise<boolean>((resolve) => {
    settle = (confirmed: boolean) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(confirmed);
    };
  });

  // Filet d'expiration : au-delà du TTL la session est morte côté serveur, un
  // « oui » tardif n'aurait plus de sens.
  timer = setTimeout(() => settle(false), Math.max(0, expiresAt - Date.now()));

  return { promise, settle };
}

/**
 * Publie le SAS vers l'interface puis attend le verdict.
 *
 * On n'émet l'événement qu'une fois le SAS RÉELLEMENT CALCULÉ : afficher un
 * gabarit « ● ● ● ● ● ● » entraînerait l'utilisateur à confirmer avant de
 * lire, ce qui vide la mesure de son seul contenu.
 */
async function awaitHumanConfirmation(
  session: PairingSession,
  sas: Sas,
  mode: PairingMode,
  peerDeviceName: string
): Promise<boolean> {
  const gate = createHumanGate(session.expiresAt);
  session.gate = gate;

  notifyRenderer('pairing-sas', {
    code: session.code,
    role: session.role,
    // Valeur affichée, groupée `NN NN NN` : un groupement différent de celui
    // du code d'appairage (six chiffres accolés) évite qu'on compare le
    // mauvais nombre, ou qu'on saisisse le SAS dans le champ « code ».
    sasDisplay: sas.display,
    // `manual` déclenche une mention distincte côté interface : dans ce mode
    // le SAS est la SEULE protection, il ne doit pas passer pour une
    // formalité.
    mode,
    peerDeviceName,
  });

  const confirmed = await gate.promise;
  session.gate = null;
  return confirmed;
}

export function confirmSas(code: string): void {
  activeSessions.get(code)?.gate?.settle(true);
}

export function rejectSas(code: string): void {
  activeSessions.get(code)?.gate?.settle(false);
}

// ── API publique — rôle A ───────────────────────────────────────────────────

/**
 * Rôle A : lance la cérémonie.
 *
 * Engendre le code, la paire ECDH éphémère et le secret `S`, publie
 * l'ENGAGEMENT sur `pubA` (et non `pubA` elle-même — voir l'en-tête), puis
 * lance en tâche de fond l'attente de B.
 */
export async function initiatePairing(profileId: string): Promise<InitiateResult> {
  const { privateKey, publicKeyRaw } = await generateEphemeralKeyPair();
  const secret = generatePairingSecret();
  const commitA = computeCommitA(publicKeyRaw);
  const deviceName = getDeviceName();

  // Un code déjà pris (ou brûlé par une pierre tombale) rend 409 : on en tire
  // un autre. Trois essais suffisent — l'espace fait 900 000 valeurs, une
  // collision répétée signale un problème serveur, pas de la malchance.
  let code = '';
  let lastError = 'Failed to initiate pairing';
  for (let attempt = 0; attempt < MAX_CODE_COLLISION_RETRIES; attempt++) {
    const candidate = generatePairingCode();
    const result = await pairingApiCall('/sync/pairing/initiate', {
      method: 'POST',
      body: JSON.stringify({
        protocolVersion: PROTOCOL_VERSION,
        pairingCode: candidate,
        commitA: Buffer.from(commitA).toString('base64'),
        deviceName,
      }),
    });

    if (result.ok) {
      code = candidate;
      break;
    }
    lastError = result.error || lastError;
    if (result.status !== 409) break; // 4xx/5xx autre que collision : abandon
  }

  if (!code) {
    zeroize(secret);
    throw new Error(lastError);
  }

  const expiresAt = Date.now() + PAIRING_TTL_MS;
  const session: PairingSession = {
    role: 'A',
    code,
    privateKey,
    publicKeyRaw,
    secret,
    expiresAt,
    abortController: new AbortController(),
    gate: null,
  };
  activeSessions.set(code, session);

  // Construction de la charge du QR, puis RELECTURE par l'analyseur strict.
  // Ce n'est pas de la paranoïa décorative : un secret mal encodé (bourrage
  // base64url non canonique, longueur fausse) serait accepté par un décodeur
  // laxiste d'en face et produirait un `S` différent — donc un échec MUET que
  // personne ne saurait diagnostiquer. On préfère perdre le QR et retomber
  // sur les six chiffres.
  const qrPayload = buildPairingQrPayloadV2(code, secret);
  const qrIsSound = qrPayload !== null && parsePairingQrV2(qrPayload) !== null;

  void pollForDeviceB(code, profileId).catch((err) => {
    log.error('[pairingService] pollForDeviceB error:', (err as Error).message);
  });

  return { code, expiresAt, qrPayload: qrIsSound ? qrPayload : null };
}

/**
 * Rôle A, en tâche de fond : attendre B, dériver, révéler `pubA`, afficher le
 * SAS, ATTENDRE L'HUMAIN, puis seulement emballer et publier la FEK.
 */
async function pollForDeviceB(code: string, profileId: string): Promise<void> {
  void profileId; // les profils sont restaurés côté B ; A n'a rien à recharger
  const session = activeSessions.get(code);
  if (!session) return;

  try {
    // ── Étape 9 : attendre la clé publique de B, et le MODE qu'il déclare ──
    const peer = await pollForResource<{
      publicKey: string;
      deviceName: string;
      mode: string;
    }>(`/sync/pairing/${code}/device-b-pubkey`, session);

    if (!peer) {
      await failSession(session, 'expired', 'Pairing timed out');
      return;
    }

    const mode = normalizeMode(peer.mode);
    if (!mode) {
      await failSession(session, 'network', 'Peer declared an unknown pairing mode');
      return;
    }

    const peerDeviceName = sanitizeDeviceName(peer.deviceName);
    notifyRenderer('pairing-device-detected', { deviceName: peerDeviceName });

    const publicKeyBRaw = decodeBase64(peer.publicKey);

    // ── Étape 10 : dériver. Le mode vient du serveur, donc de l'adversaire —
    // c'est assumé : `modeByte` et le sel entrent dans les DEUX transcripts,
    // si bien qu'une rétrogradation `qr → manual` fait diverger le SAS et se
    // voit à l'écran. Le mode n'est pas authentifié par le réseau, il l'est
    // par les yeux de l'utilisateur.
    const material = await deriveSessionMaterial({
      privateKey: session.privateKey,
      remotePublicKeyRaw: publicKeyBRaw,
      publicKeyARaw: session.publicKeyRaw,
      publicKeyBRaw,
      mode,
      // A détient toujours `S` : il choisit seulement de s'en servir ou non,
      // selon ce que B a déclaré.
      secret: mode === 'qr' ? session.secret : null,
      code,
      usages: ['wrapKey'],
    });

    // ── Étape 11 : révéler `pubA`. NON conditionné à l'humain, et c'est
    // délibéré : B ne peut calculer son SAS qu'une fois `pubA` connue. Si A
    // la retenait jusqu'à sa propre confirmation, A afficherait un nombre
    // pendant que B afficherait « en attente… » — l'utilisateur validerait
    // sur A SANS AVOIR RIEN COMPARÉ. Révéler ici n'affaiblit rien : à cet
    // instant l'intercepteur a déjà livré sa clé à A, les deux SAS sont
    // figés, apprendre `pubA` ne lui permet plus de les modifier. Seul
    // l'envoi de la FEK est conditionné à l'humain — c'est le seul envoi qui
    // porte un secret.
    const reveal = await pairingApiCall(`/sync/pairing/${code}/pubkey-a`, {
      method: 'PUT',
      body: JSON.stringify({
        publicKey: Buffer.from(session.publicKeyRaw).toString('base64'),
      }),
    });
    if (!reveal.ok) {
      await failSession(session, 'network', reveal.error || 'Failed to publish public key');
      return;
    }

    // ── Étapes 15/16 : afficher le SAS, puis ATTENDRE ────────────────────
    const confirmed = await awaitHumanConfirmation(session, material.sas, mode, peerDeviceName);
    if (!confirmed) {
      // L'humain a refusé (ou le TTL a expiré). `wrapFek` n'est JAMAIS appelé.
      await failSession(session, 'sas-rejected', 'Verification numbers did not match');
      return;
    }

    // ── Étape 17 : seulement maintenant, emballer ────────────────────────
    const fek = await StorageService.loadFEKForPairing();
    if (!fek) {
      await failSession(session, 'network', 'FEK not available — vault not unlocked');
      return;
    }

    const iv = new Uint8Array(crypto.randomBytes(IV_LENGTH));
    const wrapped = await wrapFek(fek, material.wrapKey, iv);

    const upload = await pairingApiCall(`/sync/pairing/${code}/wrapped-fek`, {
      method: 'PUT',
      body: JSON.stringify({ wrappedFek: Buffer.from(wrapped).toString('base64') }),
    });
    zeroize(wrapped, iv);

    if (!upload.ok) {
      await failSession(session, 'network', upload.error || 'Failed to upload wrapped FEK');
      return;
    }

    log.info(`[pairingService] Device A: FEK wrapped and uploaded for code ${code}`);
    notifyRenderer('pairing-complete', { deviceName: peerDeviceName });
    disposeSession(session);
    // ON NE DÉTRUIT PAS LA SESSION ICI. B n'a pas encore lu la clé : il la
    // SONDE, toutes les deux secondes. Détruire dans la foulée du dépôt lui
    // répond 410 Gone et il n'obtient JAMAIS la FEK — l'appairage échoue
    // alors que tout le protocole s'est déroulé correctement, et B affiche
    // « l'autre appareil a interrompu l'appairage », ce qui est exact.
    // Constaté sur appareil : GET /wrapped-fek → 404 (pas encore), puis 410.
    //
    // C'est B qui détruit, après avoir déballé — il est le seul à savoir
    // qu'il a fini. Le TTL de 300 s ramasse ce qui traîne. Ne pas détruire
    // ici ne coûte rien : l'objet déposé est la FEK EMBALLÉE vers la clé
    // publique de B, inutilisable par quiconque d'autre.
    //
    // Le rôle A est implémenté DEUX FOIS (ici et dans filarr-mobile
    // `pairing.ts`) : le correctif doit valoir des deux côtés, sinon
    // l'appairage échoue dès que c'est CET appareil qui donne la clé.
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      disposeSession(session);
      return;
    }
    await failSession(session, 'network', (error as Error).message);
  }
}

// ── API publique — rôle B ───────────────────────────────────────────────────

// ── Entrées de la garde d'adoption ──────────────────────────────────────────

/**
 * Octets bruts de la clé de coffre ACTIVE, ou `null` si elle n'est pas lisible.
 *
 * `null` ne veut PAS dire « pas de clé » : le coffre peut être simplement
 * verrouillé. C'est `hasLocalKeyMaterial` qui distingue les deux, et cette
 * distinction commande deux conduites opposées — adopter ou refuser.
 */
async function loadActiveFekRaw(): Promise<Uint8Array | null> {
  try {
    const key = await StorageService.loadFEKForPairing();
    if (!key) return null;
    return new Uint8Array(await crypto.webcrypto.subtle.exportKey('raw', key));
  } catch {
    return null;
  }
}

/** Un matériel de clé existe-t-il sur le disque, lisible ou non ? */
async function hasLocalKeyMaterial(): Promise<boolean> {
  const rootDir = path.join(app.getPath('userData'), 'FilarData');
  const candidates = [
    path.join(rootDir, 'wrapped_fek.json'),
    path.join(rootDir, '.fek_safe'),
  ];
  try {
    candidates.push(path.join(StorageService.getBaseDir(), 'wrapped_fek.json'));
    candidates.push(path.join(StorageService.getBaseDir(), '.fek_safe'));
  } catch {
    // StorageService pas encore initialisé — la racine suffit.
  }
  for (const candidate of candidates) {
    const found = await fs
      .access(candidate)
      .then(() => true)
      .catch(() => false);
    if (found) return true;
  }
  return false;
}

/**
 * Identifiant du compte pour lequel la migration est ouverte. Le journal le
 * porte pour qu'une migration reprise sur un AUTRE compte soit abandonnée sans
 * discussion : on ne publie rien chez quelqu'un d'autre.
 */
async function currentAccountUserId(): Promise<string> {
  try {
    const me = await getMe();
    if (me.success && me.user) return String((me.user as { id?: string }).id ?? '');
  } catch {
    // Hors ligne : le journal portera une chaîne vide, et la comparaison de
    // compte est neutralisée (voir `decideResume`) plutôt que fausse.
  }
  return '';
}

/**
 * Rôle B : rejoindre une session et recevoir la FEK.
 *
 * Sur le bureau, `code` vient TOUJOURS d'une saisie au clavier : il n'y a pas
 * de caméra, donc pas de secret `S`, donc mode MANUEL. Le SAS y est la seule
 * protection contre un serveur qui s'interposerait — d'où l'insistance de
 * l'interface sur la comparaison. La signature accepte néanmoins un secret
 * pour le jour où le bureau saurait lire un QR (fenêtre de capture, lien
 * profond) : le protocole, lui, est déjà prêt.
 */
export async function joinPairing(
  code: string,
  profileId: string,
  password: string
): Promise<PairingResult> {
  void profileId;
  let session: PairingSession | null = null;

  try {
    if (!/^\d{6}$/.test(code)) {
      return { success: false, reason: 'invalid-code', error: 'Invalid pairing code' };
    }

    // ── B2 : lire la session, et d'abord sa VERSION ──────────────────────
    const meta = await pairingApiCall<{
      protocolVersion?: number;
      commitA?: string;
      deviceName?: string;
    }>(`/sync/pairing/${code}/session`);

    if (!meta.ok || !meta.data) {
      if (meta.status === 429) {
        return { success: false, reason: 'invalid-code', error: 'Too many attempts' };
      }
      return {
        success: false,
        reason: meta.status === 0 ? 'network' : 'invalid-code',
        error: meta.error || 'Invalid or expired pairing code',
      };
    }

    // ── B3 : refus FERMÉ d'un pair trop ancien ───────────────────────────
    // Un repli vers v1 serait un repli vers « le serveur peut lire la FEK ».
    // L'attaquant qui manipule le réseau manipule aussi la négociation de
    // version : il choisirait toujours v1. Il n'y a donc pas de mode dégradé,
    // et pas de bouton « continuer quand même ». La seule issue est la mise à
    // jour de l'autre appareil.
    if (meta.data.protocolVersion !== PROTOCOL_VERSION && !PAIRING_ALLOW_LEGACY_V1) {
      log.warn(
        `[pairingService] Refusing pairing ${code}: peer speaks protocol ` +
          `${String(meta.data.protocolVersion)}, this client requires ${PROTOCOL_VERSION}`
      );
      // On abandonne SANS détruire la session : B n'a encore rien publié, et
      // la destruction appartient à A (§4.6-R7). Un B trop zélé effacerait la
      // session d'un A qui pourrait encore la mener à bien avec un autre
      // appareil — et le ferait, qui plus est, sur la foi d'un champ que le
      // serveur contrôle.
      return { success: false, reason: 'peer-too-old', error: 'Peer uses an older pairing protocol' };
    }

    // ── B4 : mémoriser l'engagement AVANT d'avoir vu quoi que ce soit ────
    const commitA = decodeBase64(meta.data.commitA || '');
    if (commitA.length !== 32) {
      return { success: false, reason: 'commit-mismatch', error: 'Malformed pairing commitment' };
    }
    const peerDeviceName = sanitizeDeviceName(meta.data.deviceName || '');

    // ── B5 : publier sa clé publique et DÉCLARER le mode ─────────────────
    const { privateKey, publicKeyRaw } = await generateEphemeralKeyPair();
    // Le mode se déduit MÉCANIQUEMENT de la présence d'un secret, jamais
    // d'une case à cocher : le bureau n'en a pas, donc `manual`.
    const secret: Uint8Array | null = null;
    const mode: PairingMode = secret !== null ? 'qr' : 'manual';

    session = {
      role: 'B',
      code,
      privateKey,
      publicKeyRaw,
      secret,
      expiresAt: Date.now() + PAIRING_TTL_MS,
      abortController: new AbortController(),
      gate: null,
    };
    activeSessions.set(code, session);

    const claim = await pairingApiCall(`/sync/pairing/${code}/device-b-pubkey`, {
      method: 'PUT',
      body: JSON.stringify({
        publicKey: Buffer.from(publicKeyRaw).toString('base64'),
        deviceName: getDeviceName(),
        mode,
      }),
    });
    if (!claim.ok) {
      // 409 : quelqu'un a déjà réclamé le rôle B sur ce code. On abandonne
      // SANS RÉESSAI — insister reviendrait à courir contre un adversaire qui
      // a déjà gagné la course, et l'utilisateur doit générer un code neuf.
      const reason: PairingFailureReason = claim.status === 409 ? 'role-taken' : 'network';
      disposeSession(session);
      return { success: false, reason, error: claim.error || 'Failed to register device' };
    }

    // ── B6 : attendre que A révèle `pubA` ────────────────────────────────
    const revealed = await pollForResource<{ publicKey: string }>(
      `/sync/pairing/${code}/pubkey-a`,
      session
    );
    if (!revealed) {
      await failSession(session, 'expired', 'Pairing timed out');
      return { success: false, reason: 'expired', error: 'Pairing timed out' };
    }

    const publicKeyARaw = decodeBase64(revealed.publicKey);

    // ── B8 : VÉRIFIER L'ENGAGEMENT, avant toute exploitation de l'ECDH ───
    // C'est ce contrôle qui rend le SAS à six chiffres solide : sans lui, un
    // intercepteur choisirait sa clé APRÈS avoir vu celle de B et ferait
    // coïncider les deux écrans hors ligne en quelques secondes.
    // `computeCommitA` refuse une clé mal formée en levant : une clé publique
    // hors format n'est pas une « erreur réseau », c'est un engagement qui ne
    // tient pas. On la traite comme telle plutôt que de laisser l'exception
    // remonter jusqu'au fourre-tout `network`, qui inviterait à réessayer.
    let commitMatches = false;
    try {
      commitMatches = verifyCommitA(publicKeyARaw, commitA);
    } catch {
      commitMatches = false;
    }
    if (!commitMatches) {
      log.error(
        `[pairingService] SECURITY: commitment mismatch on pairing ${code} — ` +
          'the peer did not present the key it announced'
      );
      await failSession(session, 'commit-mismatch', 'Pairing commitment mismatch');
      return {
        success: false,
        reason: 'commit-mismatch',
        error: 'Peer did not present the key it announced',
      };
    }

    // ── B9 : dériver ─────────────────────────────────────────────────────
    const material = await deriveSessionMaterial({
      privateKey,
      remotePublicKeyRaw: publicKeyARaw,
      publicKeyARaw,
      publicKeyBRaw: publicKeyRaw,
      mode,
      secret,
      code,
      usages: ['unwrapKey'],
    });

    // ── B10/B11 : afficher le SAS, puis ATTENDRE ─────────────────────────
    const confirmed = await awaitHumanConfirmation(session, material.sas, mode, peerDeviceName);
    if (!confirmed) {
      // On n'appelle JAMAIS `GET /wrapped-fek` : ne pas déballer suffirait à
      // la sécurité du coffre, mais laisserait la FEK emballée traîner dans
      // la mémoire de cet appareil. Le sondage lui-même est gardé.
      await failSession(session, 'sas-rejected', 'Verification numbers did not match');
      return {
        success: false,
        reason: 'sas-rejected',
        error: 'Verification numbers did not match',
      };
    }

    // ── B12 : seulement maintenant, réclamer et déballer ─────────────────
    const sealed = await pollForResource<{ wrappedFek: string }>(
      `/sync/pairing/${code}/wrapped-fek`,
      session
    );
    if (!sealed?.wrappedFek) {
      await failSession(session, 'expired', 'Pairing timed out');
      return { success: false, reason: 'expired', error: 'Pairing timed out or was cancelled' };
    }

    const wrapped = decodeBase64(sealed.wrappedFek);
    if (wrapped.length !== WRAPPED_FEK_LENGTH) {
      await failSession(session, 'unwrap-failed', 'Malformed wrapped key');
      return { success: false, reason: 'unwrap-failed', error: 'Malformed wrapped key' };
    }

    let fekRaw: ArrayBuffer;
    try {
      const fek = await unwrapFek(wrapped, material.wrapKey);
      fekRaw = await crypto.webcrypto.subtle.exportKey('raw', fek);
    } catch {
      // Un tag GCM qui ne tombe pas juste n'est pas un aléa réseau : c'est le
      // signe que la clé reçue n'est pas celle attendue. Rien n'est installé.
      log.error(
        `[pairingService] SECURITY: GCM tag verification failed on pairing ${code} — ` +
          'the received key could not be authenticated'
      );
      await failSession(session, 'unwrap-failed', 'Received key failed verification');
      return {
        success: false,
        reason: 'unwrap-failed',
        error: 'The received key could not be verified',
      };
    }

    // ── B13 : DÉCIDER, puis installer ────────────────────────────────────
    //
    // La garde d'adoption s'interpose ICI, entre la clé vérifiée et son
    // installation. Adopter une clé de compte sur un appareil qui porte déjà du
    // contenu sous une AUTRE clé rendrait ce contenu illisible pour toujours —
    // et jusqu'ici il n'existait aucune porte de sortie : le message conseillait
    // « appaire un appareil encore vide », un geste qu'aucun bouton ne
    // permettait. La troisième issue (`publish`) répare ce cul-de-sac.
    let decision: FekAdoptionDecision;
    let inspection = { itemCount: 0, byteCount: 0, profileCount: 0 };
    try {
      inspection = await publishEngine.inspectLocalContent();
      const localKeyRaw = await loadActiveFekRaw();
      const hasKeyFile = await hasLocalKeyMaterial();
      decision = decideFekAdoption({
        localKey: localKeyRaw ? { raw: localKeyRaw } : hasKeyFile ? 'unreadable' : 'absent',
        incomingKey: new Uint8Array(fekRaw),
        localContentCount: inspection.itemCount,
      });
    } catch (err) {
      zeroize(fekRaw);
      log.error('[pairingService] Garde d adoption indisponible:', (err as Error).message);
      await failSession(session, 'network', 'adoption guard unavailable');
      return { success: false, reason: 'network', error: (err as Error).message };
    }

    if (decision.kind === 'refuse') {
      // On ne migre JAMAIS ce qu'on ne peut pas lire : sans la clé qui ouvre le
      // contenu, la migration ne pourrait pas déchiffrer, et échouer à mi-chemin
      // serait pire que refuser tout de suite.
      zeroize(fekRaw);
      disposeSession(session);
      await cleanupPairingServer(code, 'cancelled');
      return {
        success: false,
        reason: 'vault-locked',
        error: 'Vault locked — unlock it, then pair again',
      };
    }

    if (decision.kind === 'publish') {
      // La clé du compte est CONSERVÉE (emballée sous le mot de passe local,
      // marquée « en attente ») mais N'EST PAS ACTIVÉE. Le coffre local reste
      // intact et pleinement utilisable tant que la migration n'est pas
      // confirmée.
      try {
        await publishEngine.beginMigration({
          incomingFekRaw: Buffer.from(new Uint8Array(fekRaw)),
          vaultPassword: password,
          accountUserId: await currentAccountUserId(),
        });
      } finally {
        zeroize(fekRaw);
      }
      disposeSession(session);
      await cleanupPairingServer(code, 'cancelled');
      log.info('[pairingService] Device B: contenu local détecté — parcours de publication ouvert');
      return { success: false, reason: 'publish-required', publish: inspection };
    }

    try {
      await StorageService.initWithExistingFEK(new Uint8Array(fekRaw), password);
    } finally {
      zeroize(fekRaw);
    }

    const restoredProfileIds = await restoreProfilesFromCloud();
    for (const pid of restoredProfileIds) {
      try {
        const profileDir = profileManager.getProfileDataDir(pid);
        await StorageService.reinitialize(profileDir);
        await syncService.triggerSync(pid);
        log.info(`[pairingService] Initial sync complete for profile ${pid}`);
      } catch (err) {
        log.warn(`[pairingService] Initial sync failed for ${pid}:`, (err as Error).message);
      }
    }

    disposeSession(session);
    await cleanupPairingServer(code, 'cancelled');
    log.info('[pairingService] Device B: pairing successful');
    return { success: true, profileIds: restoredProfileIds };
  } catch (error) {
    const msg = (error as Error).message;
    log.error('[pairingService] joinPairing error:', msg);
    if (session) await failSession(session, 'network', msg);
    return { success: false, reason: 'network', error: msg };
  }
}

// ── Annulation ──────────────────────────────────────────────────────────────

export async function cancelPairing(code: string): Promise<void> {
  const session = activeSessions.get(code);
  if (session) {
    session.gate?.settle(false);
    session.abortController.abort();
    disposeSession(session);
  }
  await cleanupPairingServer(code, 'cancelled');
  log.info(`[pairingService] Pairing ${code} cancelled`);
}

export function getCurrentCode(): { code: string; expiresAt: number } | null {
  for (const session of activeSessions.values()) {
    if (session.expiresAt > Date.now()) {
      return { code: session.code, expiresAt: session.expiresAt };
    }
  }
  return null;
}

// ── Fin de session ──────────────────────────────────────────────────────────

/**
 * Efface tout ce que NOUS tenons et retire la session de la table.
 *
 * Les clés privées et la clé d'emballage sont des `CryptoKey` non
 * extractibles : on ne peut pas les zéroïser depuis JS, on lâche la référence
 * et le ramasse-miettes fait le reste. C'est précisément pourquoi elles sont
 * dérivées non extractibles — les octets qu'on ne peut pas effacer, mieux
 * vaut ne jamais les posséder.
 */
function disposeSession(session: PairingSession): void {
  zeroize(session.secret);
  session.secret = null;
  activeSessions.delete(session.code);
}

/**
 * Échec : on détruit la session côté serveur avec son MOTIF, on efface les
 * secrets, et on prévient l'interface.
 *
 * Le motif compte : il fait servir un `410 Gone` explicite au pair, qui
 * affiche une fin claire au lieu d'un décompte muet jusqu'à l'expiration.
 * Une session détruite N'EST JAMAIS REPRISE — un réessai repart d'un code
 * neuf, d'une paire de clés neuve et d'un secret neuf.
 */
async function failSession(
  session: PairingSession,
  reason: PairingFailureReason,
  message: string
): Promise<void> {
  const { code } = session;
  session.gate?.settle(false);
  disposeSession(session);
  await cleanupPairingServer(code, reason);
  notifyRenderer('pairing-error', { error: message, reason });
}

/** Motifs acceptés par le worker ; toute autre valeur y serait ramenée à `cancelled`. */
const DELETE_REASONS = new Set([
  'sas-rejected',
  'commit-mismatch',
  'unwrap-failed',
  'expired',
  'cancelled',
  'peer-too-old',
]);

async function cleanupPairingServer(code: string, reason: string): Promise<void> {
  const safe = DELETE_REASONS.has(reason) ? reason : 'cancelled';
  try {
    await pairingApiCall(`/sync/pairing/${code}?reason=${safe}`, { method: 'DELETE' });
  } catch {
    // Au mieux — le TTL serveur ramassera la session de toute façon.
  }
}

// ── Sondage ─────────────────────────────────────────────────────────────────

/**
 * Sondage générique. `404` signifie « pas encore » et on continue ; `410`
 * signifie « session détruite » et on s'arrête net — sans lui, on tournerait
 * en boucle jusqu'à l'expiration en laissant l'utilisateur devant un
 * décompte qui ne mène nulle part.
 */
async function pollForResource<T>(
  endpoint: string,
  session: PairingSession
): Promise<T | null> {
  const { abortController, expiresAt } = session;

  while (Date.now() < expiresAt) {
    if (abortController.signal.aborted) return null;

    const result = await pairingApiCall<T>(endpoint);
    if (result.ok && result.data) return result.data;
    if (result.status === 410) return null; // session détruite par le pair
    if (result.status === 429) return null; // quota atteint : insister empire

    await sleep(POLL_INTERVAL_MS, abortController.signal);
  }
  return null;
}

// ── Utilitaires ─────────────────────────────────────────────────────────────

function normalizeMode(raw: unknown): PairingMode | null {
  return raw === 'qr' || raw === 'manual' ? raw : null;
}

function decodeBase64(value: string): Uint8Array {
  return Uint8Array.from(Buffer.from(value, 'base64'));
}

function getDeviceName(): string {
  return sanitizeDeviceName(os.hostname() || 'Unknown Device');
}

/**
 * Le nom d'appareil est affiché sur l'écran d'EN FACE, à côté du SAS. Il
 * arrive du serveur, donc de l'adversaire : on le borne en longueur et on
 * retire les caractères de contrôle, qui pourraient sinon fabriquer un faux
 * cadre ou pousser le vrai contenu hors de l'écran.
 */
function sanitizeDeviceName(raw: string): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = raw.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim();
  return cleaned.slice(0, MAX_DEVICE_NAME_LENGTH) || 'Unknown Device';
}

/**
 * Découvre les profils synchronisés dans le nuage, télécharge leurs
 * manifestes et restaure les métadonnées locales.
 *
 * EXPORTÉE, PARCE QU'ELLE N'A RIEN À VOIR AVEC L'APPAIRAGE. Son propre
 * commentaire le disait déjà — « cette étape est postérieure à l'installation
 * de la FEK et n'a aucun rapport avec le protocole d'appairage lui-même » — et
 * elle restait pourtant privée, appelable depuis `joinPairing()` et de nulle
 * part ailleurs. Le jour où l'écran de connexion a appris à SAUTER l'appairage
 * (le serveur détient une copie enveloppée de la FEK, les six chiffres
 * deviennent inutiles), il a du même coup sauté la seule fonction qui
 * ramenait les profils : on se connectait, et l'on héritait d'un profil neuf
 * nommé d'après son adresse e-mail, à la place des siens.
 *
 * PRÉALABLE : la FEK doit être installée. Les métadonnées d'un profil (son nom,
 * sa couleur) vivent dans `manifest.enc`, chiffré ; sans clé, la boucle
 * échouerait profil par profil et rendrait une liste vide.
 */
export async function restoreProfilesFromCloud(): Promise<string[]> {
  const restoredIds: string[] = [];

  /**
   * LE COMPTE AUQUEL CES PROFILS APPARTIENNENT — et ce n'est pas une supposition.
   *
   * `GET /sync/profiles` est portée au `user_id` du jeton : tout ce qu'elle rend
   * appartient, par construction, au compte qui vient de s'authentifier. Poser
   * l'estampille est donc un CONSTAT, pas une devinette.
   *
   * Sans elle, un profil restauré arrivait bien dans la liste, mais rangé sous
   * « Local » au lieu de l'en-tête portant l'adresse du compte — parce que
   * `ProfilePicker` groupe sur `cloudAccount`. La personne retrouvait ses
   * profils exactement là où elle ne les cherchait pas, ce qui, de son point de
   * vue, revient à ne pas les avoir retrouvés.
   *
   * Lu depuis le cache, sans aller-retour réseau : on vient d'en faire un.
   */
  let compte: { email: string; tier: string; accountType?: 'personal' | 'enterprise' } | null = null;
  try {
    const statut = await getAuthStatus();
    if (statut.user) {
      compte = {
        email: statut.user.email,
        tier: statut.user.subscriptionTier,
        accountType: statut.user.accountType,
      };
    }
  } catch {
    // Sans compte lisible on restaure quand même : un profil sans badge vaut
    // mieux qu'un profil absent.
  }

  try {
    const profilesResult = await pairingApiCall<{
      profiles: Array<{
        profileId: string;
        manifestVersion: number;
        deletedAt?: string | null;
      }>;
    }>('/sync/profiles');

    if (!profilesResult.ok || !profilesResult.data?.profiles?.length) {
      log.info('[pairingService] No synced profiles found on cloud');
      return restoredIds;
    }

    for (const { profileId, manifestVersion, deletedAt } of profilesResult.data.profiles) {
      /**
       * PIERRE TOMBALE — profil supprimé du nuage depuis un autre appareil. Le
       * restaurer serait exactement la résurrection que la suppression cherchait
       * à empêcher : on passe. Rien n'est effacé en local pour autant — cette
       * boucle ne fait qu'ajouter, et un profil déjà présent ici garde ses
       * fichiers, y compris ceux que personne n'a jamais remontés.
       */
      if (deletedAt) continue;
      /**
       * IGNORER LES LIGNES FANTÔMES, comme le fait déjà le web (readSync.ts).
       *
       * `getOrCreateProfileSync` crée une ligne `profiles_sync` dès la PREMIÈRE
       * lecture de manifeste, avant même qu'un octet ait été synchronisé. Un
       * compte finit donc par en accumuler à zéro version, sans manifeste
       * derrière : les restaurer est impossible par construction, et chaque
       * tentative coûtait un aller-retour R2 pour un échec silencieux, à chaque
       * connexion.
       */
      if (!manifestVersion) continue;
      try {
        const { manifest: encryptedManifest } = await r2.getManifest(profileId);
        if (!encryptedManifest) continue;

        const decrypted = await StorageService.decryptManifestAuto(encryptedManifest);
        const syncManifest = JSON.parse(decrypted.toString('utf-8')) as SyncManifest;

        if (syncManifest.profileMeta) {
          await profileManager.restoreProfileFromCloud(syncManifest.profileMeta);
          restoredIds.push(profileId);
          /**
           * L'ESTAMPILLE EST POSÉE À CHAQUE PASSAGE, y compris sur un profil que
           * `restoreProfileFromCloud` a laissé tel quel — elle sort en effet
           * immédiatement sur un identifiant déjà connu. Un profil présent en
           * local mais jamais rattaché au compte resterait sinon éternellement
           * sous « Local », et c'est précisément le cas de quelqu'un qui vient
           * de se connecter sur un poste où il travaillait déjà hors ligne.
           */
          if (compte) {
            try {
              await profileManager.setCloudAccount(profileId, compte);
            } catch (err) {
              log.warn(
                `[pairingService] setCloudAccount failed for ${profileId}:`,
                (err as Error).message
              );
            }
          }
          log.info(`[pairingService] Restored profile ${profileId}`);
        }

        if (syncManifest.encryptionKey) {
          const profileDir = profileManager.getProfileDataDir(profileId);
          await StorageService.replaceEncryptionKey(syncManifest.encryptionKey, profileDir);
        }
      } catch (err) {
        log.warn(`[pairingService] Failed to restore profile ${profileId}:`, (err as Error).message);
      }
    }
  } catch (err) {
    log.error('[pairingService] restoreProfilesFromCloud error:', (err as Error).message);
  }

  return restoredIds;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }

    const timer = setTimeout(resolve, ms);

    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true }
    );
  });
}
