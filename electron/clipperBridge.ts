/**
 * Clipper Bridge — local WebSocket server for the Filarr Web Clipper extension.
 *
 * Runs in the Electron main process. A browser extension (Chrome/Firefox/Edge)
 * pairs once with a 6-digit code, then sends captured web pages over an
 * AES-256-GCM encrypted channel. Filarr sanitises, converts to Markdown,
 * encrypts with the FEK and saves the result as a note — NO cloud auth, so the
 * E2EE guarantee is preserved end to end.
 *
 * This is deliberately SEPARATE from electron/extensionBridge.ts (the dormant
 * password-manager bridge): keeping them apart means enabling the clipper never
 * exposes the credential-serving message types. Same battle-tested pattern
 * (loopback bind, session-burn pairing, per-IP rate limit), single capability:
 * `clip`.
 *
 * Security:
 *  - Binds 127.0.0.1 only (no external reachability)
 *  - 6-digit pairing code, 60s TTL, session burned after 3 wrong guesses
 *  - All post-pairing traffic AES-256-GCM with a per-client shared secret
 *  - Per-IP rate limit: 5 failures/min → 5 min cooldown
 *  - Clip rate limit: 60 clips/hour/client (matches roadmap #9)
 */

import { WebSocketServer, WebSocket } from 'ws';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { app, BrowserWindow, safeStorage } from 'electron';

// ==================== TYPES ====================

interface PairedClient {
  id: string;
  name: string;
  sharedSecret: string; // hex
  pairedAt: string;
  lastSeen: string;
}

interface PairingCode {
  code: string;
  expiresAt: number;
  failedAttempts: number;
}

interface BridgeMessage {
  type: string;
  id?: string;
  payload?: ClipPayload | Record<string, unknown>;
}

interface EncryptedMessage {
  encrypted: true;
  iv: string; // hex
  data: string; // hex (AES-256-GCM ciphertext + auth tag)
}

interface RateLimitEntry {
  failures: number;
  lastFailure: number;
  cooldownUntil: number;
}

/** A captured web page sent by the extension. Mirrors the extension payload. */
export interface ClipPayload {
  url: string;
  title: string;
  /** Raw outer HTML of the page or the user's selection (sanitised app-side). */
  html?: string;
  /** Plain-text selection, when the user clipped a highlight rather than a page. */
  selectionText?: string;
  /** ISO capture timestamp from the browser (informational only). */
  capturedAt?: string;
}

/** Result the renderer returns after persisting a clip. */
export interface ClipSaveResult {
  ok: boolean;
  noteId?: string;
  error?: string;
}

// ==================== CONSTANTS ====================

const DEFAULT_PORT = 28092; // distinct from extensionBridge's 28080
const PAIRING_CODE_EXPIRY_MS = 60_000;
const RATE_LIMIT_MAX_FAILURES = 5;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_COOLDOWN_MS = 300_000;
const PAIRING_SESSION_MAX_FAILURES = 3;
const AUTH_TAG_LENGTH = 16;
const CHALLENGE_EXPIRY_MS = 30_000; // 30 seconds
const CLIP_RATE_WINDOW_MS = 3_600_000; // 1 hour
const CLIP_RATE_MAX = 60; // 60 clips/hour/client (roadmap #9)
const RENDERER_SAVE_TIMEOUT_MS = 15_000; // generous: encryption + disk write

// ==================== CRYPTO HELPERS ====================

function generatePairingCode(): string {
  return crypto.randomInt(100000, 999999).toString();
}

function generateSharedSecret(): string {
  return crypto.randomBytes(32).toString('hex');
}

function encryptMessage(plaintext: string, secretHex: string): EncryptedMessage {
  const key = Buffer.from(secretHex, 'hex');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    encrypted: true,
    iv: iv.toString('hex'),
    data: Buffer.concat([encrypted, authTag]).toString('hex'),
  };
}

function decryptMessage(msg: EncryptedMessage, secretHex: string): string {
  const key = Buffer.from(secretHex, 'hex');
  const iv = Buffer.from(msg.iv, 'hex');
  const dataBuffer = Buffer.from(msg.data, 'hex');
  const authTag = dataBuffer.subarray(dataBuffer.length - AUTH_TAG_LENGTH);
  const ciphertext = dataBuffer.subarray(0, dataBuffer.length - AUTH_TAG_LENGTH);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(ciphertext) + decipher.final('utf8');
}

// ==================== CLIPPER BRIDGE ====================

export class ClipperBridge {
  private wss: WebSocketServer | null = null;
  private port: number = DEFAULT_PORT;
  private enabled = false;
  private pairedClients: Map<string, PairedClient> = new Map();
  private activePairingCode: PairingCode | null = null;
  private rateLimits: Map<string, RateLimitEntry> = new Map();
  private pendingChallenges: Map<string, { challenge: string; expiresAt: number }> = new Map();
  private clientConnections: Map<string, WebSocket> = new Map();
  private clipCounts: Map<string, { count: number; windowStart: number }> = new Map();
  private mainWindow: BrowserWindow | null = null;
  /** In-flight renderer save requests keyed by requestId. */
  private pendingSaves: Map<
    string,
    { resolve: (r: ClipSaveResult) => void; timer: NodeJS.Timeout }
  > = new Map();

  constructor() {
    this.loadPairedClients();
  }

  // ==================== SERVER LIFECYCLE ====================

  /** Enable + start the server. No-op if already running. */
  start(port?: number): void {
    if (this.wss) this.stop();
    this.port = port || this.port;
    this.enabled = true;
    try {
      this.wss = new WebSocketServer({ host: '127.0.0.1', port: this.port });
      this.wss.on('connection', (ws, req) => {
        const clientIp = req.socket.remoteAddress || 'unknown';
        this.handleConnection(ws, clientIp);
      });
      this.wss.on('error', (err) => console.error('[ClipperBridge] Server error:', err));
    } catch (err) {
      console.error('[ClipperBridge] Failed to start server:', err);
    }
  }

  stop(): void {
    this.enabled = false;
    if (this.wss) {
      this.clientConnections.forEach((ws) => {
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      });
      this.clientConnections.clear();
      this.wss.close();
      this.wss = null;
    }
  }

  setEnabled(enabled: boolean): void {
    if (enabled && !this.wss) this.start();
    else if (!enabled && this.wss) this.stop();
  }

  setMainWindow(win: BrowserWindow): void {
    this.mainWindow = win;
  }

  getPort(): number {
    return this.port;
  }

  isRunning(): boolean {
    return this.wss !== null;
  }

  // ==================== CONNECTION HANDLING ====================

  private handleConnection(ws: WebSocket, clientIp: string): void {
    let authenticatedClientId: string | null = null;

    ws.on('message', async (data) => {
      try {
        const raw = data.toString();
        let message: BridgeMessage;

        if (authenticatedClientId) {
          const client = this.pairedClients.get(authenticatedClientId);
          if (!client) {
            ws.close(4001, 'Client not found');
            return;
          }
          try {
            const encrypted = JSON.parse(raw) as EncryptedMessage;
            if (encrypted.encrypted) {
              message = JSON.parse(decryptMessage(encrypted, client.sharedSecret));
            } else {
              message = JSON.parse(raw);
            }
          } catch {
            ws.close(4002, 'Decryption failed');
            return;
          }

          client.lastSeen = new Date().toISOString();
          this.savePairedClients();

          const response = await this.handleAuthenticatedMessage(message, authenticatedClientId);
          const encryptedResponse = encryptMessage(JSON.stringify(response), client.sharedSecret);
          ws.send(JSON.stringify(encryptedResponse));
        } else {
          message = JSON.parse(raw);
          if (message.type === 'auth') {
            const result = this.handlePairing(message, clientIp);
            if (result.success && result.clientId) {
              authenticatedClientId = result.clientId as string;
              this.clientConnections.set(authenticatedClientId, ws);
            }
            ws.send(JSON.stringify(result));
          } else if (message.type === 'requestChallenge') {
            // Issue a one-time server challenge for an existing paired client.
            const clientId = (message.payload as Record<string, unknown>)?.clientId as
              | string
              | undefined;
            if (clientId && this.pairedClients.has(clientId)) {
              const challenge = crypto.randomBytes(32).toString('hex');
              this.pendingChallenges.set(clientId, {
                challenge,
                expiresAt: Date.now() + CHALLENGE_EXPIRY_MS,
              });
              ws.send(JSON.stringify({ type: 'challenge', challenge }));
            } else {
              ws.send(JSON.stringify({ type: 'error', error: 'Unknown client' }));
            }
          } else if (message.type === 'reconnect') {
            const result = this.handleReconnect(message, clientIp);
            if (result.success && result.clientId) {
              authenticatedClientId = result.clientId as string;
              this.clientConnections.set(authenticatedClientId, ws);
            }
            ws.send(JSON.stringify(result));
          } else {
            ws.send(JSON.stringify({ type: 'error', error: 'Not authenticated' }));
          }
        }
      } catch (err) {
        console.error('[ClipperBridge] Message handling error:', err);
        try {
          ws.send(JSON.stringify({ type: 'error', error: 'Invalid message' }));
        } catch {
          /* ignore */
        }
      }
    });

    ws.on('close', () => {
      if (authenticatedClientId) this.clientConnections.delete(authenticatedClientId);
    });
    ws.on('error', (err) => console.error('[ClipperBridge] WebSocket error:', err));
  }

  // ==================== PAIRING ====================

  private handlePairing(message: BridgeMessage, clientIp: string): Record<string, unknown> {
    if (this.isRateLimited(clientIp)) {
      return { type: 'auth_result', success: false, error: 'Too many attempts. Try again later.' };
    }
    const payload = (message.payload ?? {}) as Record<string, unknown>;
    const pairingCode = payload.pairingCode as string | undefined;

    if (!pairingCode || !this.activePairingCode) {
      this.recordFailure(clientIp);
      return { type: 'auth_result', success: false, error: 'No active pairing code' };
    }
    if (Date.now() > this.activePairingCode.expiresAt) {
      this.activePairingCode = null;
      this.recordFailure(clientIp);
      return { type: 'auth_result', success: false, error: 'Pairing code expired' };
    }
    if (pairingCode !== this.activePairingCode.code) {
      this.recordFailure(clientIp);
      this.activePairingCode.failedAttempts += 1;
      if (this.activePairingCode.failedAttempts >= PAIRING_SESSION_MAX_FAILURES) {
        this.activePairingCode = null;
        return {
          type: 'auth_result',
          success: false,
          error: 'Too many wrong codes — pairing session invalidated, please regenerate',
        };
      }
      return { type: 'auth_result', success: false, error: 'Invalid pairing code' };
    }

    this.activePairingCode = null;
    const clientId = crypto.randomUUID();
    const sharedSecret = generateSharedSecret();
    const clientName = (payload.clientName as string) || 'Web Clipper';

    this.pairedClients.set(clientId, {
      id: clientId,
      name: clientName,
      sharedSecret,
      pairedAt: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
    });
    this.savePairedClients();
    this.notifyRenderer('clipper:clientPaired', { clientId, clientName });

    return { type: 'auth_result', success: true, clientId, sharedSecret };
  }

  /**
   * Re-authenticate an already-paired client without re-entering a code. The
   * client proves possession of the shared secret over a fresh server challenge:
   * proof = HMAC-SHA256(sharedSecret, serverChallenge + clientNonce). One-time
   * challenge consumption blocks replay.
   */
  private handleReconnect(message: BridgeMessage, clientIp: string): Record<string, unknown> {
    if (this.isRateLimited(clientIp)) {
      return { type: 'auth_result', success: false, error: 'Too many attempts. Try again later.' };
    }
    const payload = (message.payload ?? {}) as Record<string, unknown>;
    const clientId = payload.clientId as string | undefined;
    const proof = payload.proof as string | undefined;
    const clientNonce = payload.nonce as string | undefined;

    if (!clientId || !clientNonce) {
      this.recordFailure(clientIp);
      return { type: 'auth_result', success: false, error: 'Missing client ID or nonce' };
    }
    const client = this.pairedClients.get(clientId);
    if (!client) {
      this.recordFailure(clientIp);
      return { type: 'auth_result', success: false, error: 'Unknown client' };
    }
    const pending = this.pendingChallenges.get(clientId);
    if (!pending || Date.now() > pending.expiresAt) {
      this.pendingChallenges.delete(clientId);
      this.recordFailure(clientIp);
      return { type: 'auth_result', success: false, error: 'No valid challenge. Request a new one.' };
    }
    const expected = crypto
      .createHmac('sha256', Buffer.from(client.sharedSecret, 'hex'))
      .update(pending.challenge + clientNonce)
      .digest('hex');
    this.pendingChallenges.delete(clientId); // one-time use

    if (!proof || proof !== expected) {
      this.recordFailure(clientIp);
      return { type: 'auth_result', success: false, error: 'Authentication failed' };
    }
    client.lastSeen = new Date().toISOString();
    this.savePairedClients();
    return { type: 'auth_result', success: true, clientId };
  }

  // ==================== AUTHENTICATED MESSAGE HANDLING ====================

  private async handleAuthenticatedMessage(
    message: BridgeMessage,
    clientId: string
  ): Promise<Record<string, unknown>> {
    const responseId = message.id;
    switch (message.type) {
      case 'ping':
        return { type: 'pong', id: responseId };
      case 'clip':
        return await this.handleClip(message.payload as ClipPayload, clientId, responseId);
      default:
        return { type: 'error', id: responseId, error: `Unknown message type: ${message.type}` };
    }
  }

  private async handleClip(
    payload: ClipPayload | undefined,
    clientId: string,
    responseId?: string
  ): Promise<Record<string, unknown>> {
    if (!payload || !payload.url) {
      return { type: 'clipResult', id: responseId, ok: false, error: 'Empty clip' };
    }
    if (!this.allowClip(clientId)) {
      return { type: 'clipResult', id: responseId, ok: false, error: 'Clip rate limit reached' };
    }
    const result = await this.sendClipToRenderer(payload);
    return { type: 'clipResult', id: responseId, ...result };
  }

  // ==================== RENDERER COMMUNICATION ====================

  /**
   * Forward a clip to the renderer for sanitise → markdown → FEK-encrypt → save,
   * and await its result. Uses a fixed channel pair (`clipper:save` out,
   * `clipper:saveResult` back via resolveSaveResult) so it plays nicely with the
   * preload allowlist — no dynamic channel names.
   */
  private sendClipToRenderer(payload: ClipPayload): Promise<ClipSaveResult> {
    return new Promise((resolve) => {
      if (!this.mainWindow || this.mainWindow.isDestroyed()) {
        resolve({ ok: false, error: 'App window not available' });
        return;
      }
      const requestId = crypto.randomUUID();
      const timer = setTimeout(() => {
        this.pendingSaves.delete(requestId);
        resolve({ ok: false, error: 'Timed out waiting for the app to save the clip' });
      }, RENDERER_SAVE_TIMEOUT_MS);
      this.pendingSaves.set(requestId, { resolve, timer });
      this.mainWindow.webContents.send('clipper:save', { requestId, payload });
    });
  }

  /** Called by the main-process IPC handler when the renderer reports a result. */
  resolveSaveResult(requestId: string, result: ClipSaveResult): void {
    const pending = this.pendingSaves.get(requestId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pendingSaves.delete(requestId);
    pending.resolve(result);
  }

  private notifyRenderer(channel: string, data: unknown): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(channel, data);
    }
  }

  // ==================== RATE LIMITING ====================

  private isRateLimited(clientIp: string): boolean {
    const entry = this.rateLimits.get(clientIp);
    if (!entry) return false;
    if (Date.now() < entry.cooldownUntil) return true;
    if (Date.now() - entry.lastFailure > RATE_LIMIT_WINDOW_MS) {
      this.rateLimits.delete(clientIp);
      return false;
    }
    return false;
  }

  private recordFailure(clientIp: string): void {
    const entry = this.rateLimits.get(clientIp) || { failures: 0, lastFailure: 0, cooldownUntil: 0 };
    if (Date.now() - entry.lastFailure > RATE_LIMIT_WINDOW_MS) entry.failures = 0;
    entry.failures++;
    entry.lastFailure = Date.now();
    if (entry.failures >= RATE_LIMIT_MAX_FAILURES) {
      entry.cooldownUntil = Date.now() + RATE_LIMIT_COOLDOWN_MS;
    }
    this.rateLimits.set(clientIp, entry);
  }

  /** Sliding-window clip cap per paired client. */
  private allowClip(clientId: string): boolean {
    const now = Date.now();
    const entry = this.clipCounts.get(clientId);
    if (!entry || now - entry.windowStart > CLIP_RATE_WINDOW_MS) {
      this.clipCounts.set(clientId, { count: 1, windowStart: now });
      return true;
    }
    if (entry.count >= CLIP_RATE_MAX) return false;
    entry.count += 1;
    return true;
  }

  // ==================== PAIRING CODE + CLIENT MANAGEMENT ====================

  generatePairingCode(): string {
    const code = generatePairingCode();
    this.activePairingCode = {
      code,
      expiresAt: Date.now() + PAIRING_CODE_EXPIRY_MS,
      failedAttempts: 0,
    };
    return code;
  }

  getPairedClients(): Array<{
    id: string;
    name: string;
    pairedAt: string;
    lastSeen: string;
    connected: boolean;
  }> {
    return Array.from(this.pairedClients.values()).map((c) => ({
      id: c.id,
      name: c.name,
      pairedAt: c.pairedAt,
      lastSeen: c.lastSeen,
      connected: this.clientConnections.has(c.id),
    }));
  }

  removePairedClient(clientId: string): boolean {
    const ws = this.clientConnections.get(clientId);
    if (ws) {
      try {
        ws.close(4003, 'Unpaired by user');
      } catch {
        /* ignore */
      }
      this.clientConnections.delete(clientId);
    }
    const deleted = this.pairedClients.delete(clientId);
    if (deleted) this.savePairedClients();
    return deleted;
  }

  getStatus(): { running: boolean; enabled: boolean; port: number; pairedCount: number } {
    return {
      running: this.isRunning(),
      enabled: this.enabled,
      port: this.port,
      pairedCount: this.pairedClients.size,
    };
  }

  // ==================== PERSISTENCE ====================

  private get storagePath(): string {
    return path.join(app.getPath('userData'), 'clipper-paired-clients.json');
  }

  private loadPairedClients(): void {
    try {
      const safePath = this.storagePath + '.safe';
      if (safeStorage.isEncryptionAvailable() && fs.existsSync(safePath)) {
        const decrypted = safeStorage.decryptString(fs.readFileSync(safePath));
        (JSON.parse(decrypted) as PairedClient[]).forEach((c) => this.pairedClients.set(c.id, c));
        return;
      }
      if (fs.existsSync(this.storagePath)) {
        const clients = JSON.parse(fs.readFileSync(this.storagePath, 'utf-8')) as PairedClient[];
        clients.forEach((c) => this.pairedClients.set(c.id, c));
        this.savePairedClients();
        try {
          fs.unlinkSync(this.storagePath);
        } catch {
          /* ignore */
        }
      }
    } catch (err) {
      console.error('[ClipperBridge] Failed to load paired clients:', err);
    }
  }

  private savePairedClients(): void {
    try {
      const json = JSON.stringify(Array.from(this.pairedClients.values()), null, 2);
      if (safeStorage.isEncryptionAvailable()) {
        fs.writeFileSync(this.storagePath + '.safe', safeStorage.encryptString(json), {
          mode: 0o600,
        });
      } else {
        fs.writeFileSync(this.storagePath, json, 'utf-8');
      }
    } catch (err) {
      console.error('[ClipperBridge] Failed to save paired clients:', err);
    }
  }
}

// Singleton instance
export const clipperBridge = new ClipperBridge();
