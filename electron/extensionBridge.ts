/**
 * Extension Bridge - WebSocket server for browser extension communication
 *
 * Runs in the Electron main process. Provides a secure WebSocket server
 * on localhost for browser extensions to communicate with Filarr.
 *
 * Security:
 * - Binds to 127.0.0.1 only (no external access)
 * - Pairing via 6-digit code with shared secret exchange
 * - All post-pairing messages encrypted with AES-256-GCM
 * - Rate limiting: 5 failures/min -> 5 min cooldown
 * - PM must be unlocked to serve credentials
 */

// TODO: Enable in v2.x when Password Manager is shipped
export const EXTENSION_BRIDGE_ENABLED = false;

import { WebSocketServer, WebSocket } from 'ws';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { app, BrowserWindow, ipcMain, safeStorage } from 'electron';

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
  /**
   * Wrong-code attempts against this exact pairing session. Per-IP rate
   * limit alone is insufficient because everything connects from
   * 127.0.0.1 — counting on the SESSION instead means a malware loop on
   * localhost burns the code after a handful of guesses regardless of
   * what client IP it claims.
   */
  failedAttempts: number;
}

interface BridgeMessage {
  type: string;
  id?: string;
  payload?: any;
}

interface EncryptedMessage {
  encrypted: true;
  iv: string;    // hex
  data: string;  // hex (AES-256-GCM ciphertext + auth tag)
}

interface RateLimitEntry {
  failures: number;
  lastFailure: number;
  cooldownUntil: number;
}

interface PendingChallenge {
  challenge: string;
  expiresAt: number;
}

// ==================== CONSTANTS ====================

const DEFAULT_PORT = 28080;
const PAIRING_CODE_LENGTH = 6;
const PAIRING_CODE_EXPIRY_MS = 60_000; // 60 seconds
const RATE_LIMIT_MAX_FAILURES = 5;
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_COOLDOWN_MS = 300_000; // 5 minutes
// Hard cap on guesses against any one pairing session, independent of IP.
// 6 digits = 10^6 codes, expires in 60s — 3 attempts means an attacker has
// p ≈ 3e-6 of brute-forcing a single session. Anything more lets a local
// malware burn through the space across many fresh sessions.
const PAIRING_SESSION_MAX_FAILURES = 3;
const AUTH_TAG_LENGTH = 16;
const CHALLENGE_EXPIRY_MS = 30_000; // 30 seconds

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

// ==================== EXTENSION BRIDGE ====================

export class ExtensionBridge {
  private wss: WebSocketServer | null = null;
  private port: number = DEFAULT_PORT;
  private pairedClients: Map<string, PairedClient> = new Map();
  private activePairingCode: PairingCode | null = null;
  private rateLimits: Map<string, RateLimitEntry> = new Map();
  private pendingChallenges: Map<string, PendingChallenge> = new Map();
  private clientConnections: Map<string, WebSocket> = new Map();
  private mainWindow: BrowserWindow | null = null;

  constructor() {
    this.loadPairedClients();
  }

  // ==================== SERVER LIFECYCLE ====================

  start(port?: number): void {
    if (this.wss) {
      this.stop();
    }

    this.port = port || this.port;

    try {
      this.wss = new WebSocketServer({
        host: '127.0.0.1',
        port: this.port,
      });

      this.wss.on('connection', (ws, req) => {
        const clientIp = req.socket.remoteAddress || 'unknown';
        this.handleConnection(ws, clientIp);
      });

      this.wss.on('error', (err) => {
        console.error('[ExtensionBridge] Server error:', err);
      });

    } catch (err) {
      console.error('[ExtensionBridge] Failed to start server:', err);
    }
  }

  stop(): void {
    if (this.wss) {
      this.clientConnections.forEach((ws) => {
        try { ws.close(); } catch { /* ignore */ }
      });
      this.clientConnections.clear();
      this.wss.close();
      this.wss = null;
    }
  }

  setMainWindow(win: BrowserWindow): void {
    this.mainWindow = win;
  }

  setPort(port: number): void {
    this.port = port;
    if (this.wss) {
      this.stop();
      this.start(port);
    }
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

        // If authenticated, decrypt the message
        if (authenticatedClientId) {
          const client = this.pairedClients.get(authenticatedClientId);
          if (!client) {
            ws.close(4001, 'Client not found');
            return;
          }
          try {
            const encrypted = JSON.parse(raw) as EncryptedMessage;
            if (encrypted.encrypted) {
              const decrypted = decryptMessage(encrypted, client.sharedSecret);
              message = JSON.parse(decrypted);
            } else {
              message = JSON.parse(raw);
            }
          } catch {
            ws.close(4002, 'Decryption failed');
            return;
          }

          // Update last seen
          client.lastSeen = new Date().toISOString();
          this.savePairedClients();

          // Handle authenticated message
          const response = await this.handleAuthenticatedMessage(message, authenticatedClientId);
          const responseStr = JSON.stringify(response);
          const encryptedResponse = encryptMessage(responseStr, client.sharedSecret);
          ws.send(JSON.stringify(encryptedResponse));
        } else {
          // Not yet authenticated - only accept auth/pairing messages
          message = JSON.parse(raw);

          if (message.type === 'auth') {
            // Pairing flow
            const result = this.handlePairing(message, clientIp);
            if (result.success && result.clientId) {
              authenticatedClientId = result.clientId;
              this.clientConnections.set(result.clientId, ws);
            }
            ws.send(JSON.stringify(result));
          } else if (message.type === 'requestChallenge') {
            // Issue a server-generated challenge for reconnect
            const clientId = message.payload?.clientId;
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
            // Reconnect with existing shared secret
            const result = this.handleReconnect(message, clientIp);
            if (result.success && result.clientId) {
              authenticatedClientId = result.clientId;
              this.clientConnections.set(result.clientId, ws);
            }
            ws.send(JSON.stringify(result));
          } else {
            ws.send(JSON.stringify({ type: 'error', error: 'Not authenticated' }));
          }
        }
      } catch (err) {
        console.error('[ExtensionBridge] Message handling error:', err);
        ws.send(JSON.stringify({ type: 'error', error: 'Invalid message' }));
      }
    });

    ws.on('close', () => {
      if (authenticatedClientId) {
        this.clientConnections.delete(authenticatedClientId);
      }
    });

    ws.on('error', (err) => {
      console.error('[ExtensionBridge] WebSocket error:', err);
    });
  }

  // ==================== PAIRING ====================

  private handlePairing(message: BridgeMessage, clientIp: string): any {
    // Rate limit check
    if (this.isRateLimited(clientIp)) {
      return { type: 'auth_result', success: false, error: 'Too many attempts. Try again later.' };
    }

    const pairingCode = message.payload?.pairingCode;
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
      // Burn the session after enough wrong guesses, regardless of which IP
      // (or fake IP) sent them. Without this guard, a localhost loop could
      // exhaust the 10^6 code space across many fresh sessions.
      if (this.activePairingCode.failedAttempts >= PAIRING_SESSION_MAX_FAILURES) {
        console.warn(
          `[ExtensionBridge] Pairing session burned after ${this.activePairingCode.failedAttempts} failed attempts`
        );
        this.activePairingCode = null;
        return {
          type: 'auth_result',
          success: false,
          error: 'Too many wrong codes — pairing session invalidated, please regenerate',
        };
      }
      return { type: 'auth_result', success: false, error: 'Invalid pairing code' };
    }

    // Pairing successful
    this.activePairingCode = null;
    const clientId = crypto.randomUUID();
    const sharedSecret = generateSharedSecret();
    const clientName = message.payload?.clientName || 'Browser Extension';

    const pairedClient: PairedClient = {
      id: clientId,
      name: clientName,
      sharedSecret,
      pairedAt: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
    };

    this.pairedClients.set(clientId, pairedClient);
    this.savePairedClients();


    // Notify renderer
    this.notifyRenderer('extension:clientPaired', { clientId, clientName });

    return {
      type: 'auth_result',
      success: true,
      clientId,
      sharedSecret,
    };
  }

  private handleReconnect(message: BridgeMessage, clientIp: string): any {
    if (this.isRateLimited(clientIp)) {
      return { type: 'auth_result', success: false, error: 'Too many attempts. Try again later.' };
    }

    const clientId = message.payload?.clientId;
    const proof = message.payload?.proof; // HMAC(sharedSecret, serverChallenge + clientNonce)
    const clientNonce = message.payload?.nonce;

    if (!clientId || !clientNonce) {
      this.recordFailure(clientIp);
      return { type: 'auth_result', success: false, error: 'Missing client ID or nonce' };
    }

    const client = this.pairedClients.get(clientId);
    if (!client) {
      this.recordFailure(clientIp);
      return { type: 'auth_result', success: false, error: 'Unknown client' };
    }

    // Check for pending challenge (server-generated)
    const pendingChallenge = this.pendingChallenges.get(clientId);
    if (!pendingChallenge || Date.now() > pendingChallenge.expiresAt) {
      this.pendingChallenges.delete(clientId);
      this.recordFailure(clientIp);
      return { type: 'auth_result', success: false, error: 'No valid challenge. Request a new one.' };
    }

    // Verify: HMAC(sharedSecret, serverChallenge + clientNonce)
    const expectedProof = crypto
      .createHmac('sha256', Buffer.from(client.sharedSecret, 'hex'))
      .update(pendingChallenge.challenge + clientNonce)
      .digest('hex');

    // Consume the challenge (one-time use)
    this.pendingChallenges.delete(clientId);

    if (!proof || proof !== expectedProof) {
      this.recordFailure(clientIp);
      return { type: 'auth_result', success: false, error: 'Authentication failed' };
    }

    client.lastSeen = new Date().toISOString();
    this.savePairedClients();

    return {
      type: 'auth_result',
      success: true,
      clientId,
    };
  }

  // ==================== AUTHENTICATED MESSAGE HANDLING ====================

  private async handleAuthenticatedMessage(message: BridgeMessage, _clientId: string): Promise<any> {
    const responseId = message.id;

    switch (message.type) {
      case 'lockStatus':
        return await this.handleLockStatus(responseId);

      case 'getCredentials':
        return await this.handleGetCredentials(message.payload?.url, responseId);

      case 'fillCredential':
        return await this.handleFillCredential(message.payload?.entryId, responseId);

      case 'getTOTP':
        return await this.handleGetTOTP(message.payload?.entryId, responseId);

      case 'search':
        return await this.handleSearch(message.payload?.query, responseId);

      case 'ping':
        return { type: 'pong', id: responseId };

      default:
        return { type: 'error', id: responseId, error: `Unknown message type: ${message.type}` };
    }
  }

  private async handleLockStatus(responseId?: string): Promise<any> {
    const result = await this.sendToRenderer('extension:getLockStatus');
    return {
      type: 'lockStatus',
      id: responseId,
      ...result,
    };
  }

  private async handleGetCredentials(url: string, responseId?: string): Promise<any> {
    if (!url) {
      return { type: 'credentials', id: responseId, entries: [], error: 'No URL provided' };
    }

    const result = await this.sendToRenderer('extension:getCredentialsForUrl', { url });
    return {
      type: 'credentials',
      id: responseId,
      entries: result?.entries || [],
    };
  }

  private async handleFillCredential(entryId: string, responseId?: string): Promise<any> {
    if (!entryId) {
      return { type: 'fillResult', id: responseId, error: 'No entry ID provided' };
    }

    const result = await this.sendToRenderer('extension:fillCredential', { entryId });
    return {
      type: 'fillResult',
      id: responseId,
      ...result,
    };
  }

  private async handleGetTOTP(entryId: string, responseId?: string): Promise<any> {
    if (!entryId) {
      return { type: 'totpResult', id: responseId, error: 'No entry ID provided' };
    }

    const result = await this.sendToRenderer('extension:getTOTPCode', { entryId });
    return {
      type: 'totpResult',
      id: responseId,
      ...result,
    };
  }

  private async handleSearch(query: string, responseId?: string): Promise<any> {
    if (!query) {
      return { type: 'searchResults', id: responseId, entries: [] };
    }

    const result = await this.sendToRenderer('extension:search', { query });
    return {
      type: 'searchResults',
      id: responseId,
      entries: result?.entries || [],
    };
  }

  // ==================== RENDERER COMMUNICATION ====================

  private sendToRenderer(channel: string, data?: any): Promise<any> {
    return new Promise((resolve) => {
      if (!this.mainWindow || this.mainWindow.isDestroyed()) {
        resolve({ locked: true, exists: false });
        return;
      }

      const responseChannel = `${channel}:response:${Date.now()}`;

      const timeout = setTimeout(() => {
        ipcMain.removeAllListeners(responseChannel);
        resolve({ error: 'Timeout waiting for renderer response' });
      }, 5000);

      ipcMain.once(responseChannel, (_event, response) => {
        clearTimeout(timeout);
        resolve(response);
      });

      this.mainWindow.webContents.send(channel, { ...data, responseChannel });
    });
  }

  private notifyRenderer(channel: string, data: any): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(channel, data);
    }
  }

  // ==================== RATE LIMITING ====================

  private isRateLimited(clientIp: string): boolean {
    const entry = this.rateLimits.get(clientIp);
    if (!entry) return false;

    if (Date.now() < entry.cooldownUntil) return true;

    // Reset if outside window
    if (Date.now() - entry.lastFailure > RATE_LIMIT_WINDOW_MS) {
      this.rateLimits.delete(clientIp);
      return false;
    }

    return false;
  }

  private recordFailure(clientIp: string): void {
    const entry = this.rateLimits.get(clientIp) || { failures: 0, lastFailure: 0, cooldownUntil: 0 };

    // Reset if outside window
    if (Date.now() - entry.lastFailure > RATE_LIMIT_WINDOW_MS) {
      entry.failures = 0;
    }

    entry.failures++;
    entry.lastFailure = Date.now();

    if (entry.failures >= RATE_LIMIT_MAX_FAILURES) {
      entry.cooldownUntil = Date.now() + RATE_LIMIT_COOLDOWN_MS;
      console.warn(`[ExtensionBridge] Rate limit activated for ${clientIp}`);
    }

    this.rateLimits.set(clientIp, entry);
  }

  // ==================== PAIRING CODE MANAGEMENT ====================

  generatePairingCode(): string {
    const code = generatePairingCode();
    this.activePairingCode = {
      code,
      expiresAt: Date.now() + PAIRING_CODE_EXPIRY_MS,
      failedAttempts: 0,
    };
    return code;
  }

  // ==================== CLIENT MANAGEMENT ====================

  getPairedClients(): Array<{ id: string; name: string; pairedAt: string; lastSeen: string; connected: boolean }> {
    const clients: Array<{ id: string; name: string; pairedAt: string; lastSeen: string; connected: boolean }> = [];
    this.pairedClients.forEach((client) => {
      clients.push({
        id: client.id,
        name: client.name,
        pairedAt: client.pairedAt,
        lastSeen: client.lastSeen,
        connected: this.clientConnections.has(client.id),
      });
    });
    return clients;
  }

  removePairedClient(clientId: string): boolean {
    const ws = this.clientConnections.get(clientId);
    if (ws) {
      try { ws.close(4003, 'Unpaired by user'); } catch { /* ignore */ }
      this.clientConnections.delete(clientId);
    }
    const deleted = this.pairedClients.delete(clientId);
    if (deleted) {
      this.savePairedClients();
    }
    return deleted;
  }

  getConnectedClientCount(): number {
    return this.clientConnections.size;
  }

  // ==================== PERSISTENCE ====================

  private get storagePath(): string {
    return path.join(app.getPath('userData'), 'extension-paired-clients.json');
  }

  private loadPairedClients(): void {
    try {
      // Try safeStorage-protected file first
      const safePath = this.storagePath + '.safe';
      if (safeStorage.isEncryptionAvailable() && fs.existsSync(safePath)) {
        const encryptedData = fs.readFileSync(safePath);
        const decrypted = safeStorage.decryptString(encryptedData);
        const clients = JSON.parse(decrypted) as PairedClient[];
        clients.forEach((c) => this.pairedClients.set(c.id, c));
        console.log(`[ExtensionBridge] Loaded ${clients.length} paired client(s) (encrypted)`);
        return;
      }

      // Migrate legacy unencrypted file
      if (fs.existsSync(this.storagePath)) {
        const data = fs.readFileSync(this.storagePath, 'utf-8');
        const clients = JSON.parse(data) as PairedClient[];
        clients.forEach((c) => this.pairedClients.set(c.id, c));
        console.log(`[ExtensionBridge] Loaded ${clients.length} paired client(s) (legacy)`);
        // Re-save encrypted and remove legacy file
        this.savePairedClients();
        try { fs.unlinkSync(this.storagePath); } catch { /* ignore */ }
      }
    } catch (err) {
      console.error('[ExtensionBridge] Failed to load paired clients:', err);
    }
  }

  private savePairedClients(): void {
    try {
      const clients = Array.from(this.pairedClients.values());
      const json = JSON.stringify(clients, null, 2);

      if (safeStorage.isEncryptionAvailable()) {
        const encrypted = safeStorage.encryptString(json);
        fs.writeFileSync(this.storagePath + '.safe', encrypted, { mode: 0o600 });
      } else {
        fs.writeFileSync(this.storagePath, json, 'utf-8');
      }
    } catch (err) {
      console.error('[ExtensionBridge] Failed to save paired clients:', err);
    }
  }
}

// Singleton instance
export const extensionBridge = new ExtensionBridge();
