/**
 * useDeviceWipe — E9-11 client side of the admin remote-wipe.
 *
 * When the main process detects a `device_wipe_required` refresh it (a) clears all local keys + cache
 * itself and (b) fires `device-wipe-required` to the renderer. The renderer's job here is the PROOF of
 * execution: sign the ack with the in-memory per-user identity key (E2) — which only works while the
 * vault is unlocked — and POST it to the anonymous, signature-gated `/device/wipe-ack` endpoint
 * (E9-11a). The signature must be produced BEFORE we forget the keys from RAM.
 *
 * Then we reset to a clean logged-out state: the account session is dead (tokens gone) and the keys
 * are wiped, so the encrypted content on disk is undecryptable. A full reload re-runs auth init →
 * no tokens → the login / profile screen. Honest + best-effort: if the vault was locked we can't sign,
 * the device is still wiped, and the server marks it wipe_pending_stale.
 *
 * Mounted in AppContent (above the lock gate) so it's always listening — even at the lock screen.
 */

import { useEffect } from 'react';
import apiClient from '../services/network/apiClient';
import { signWithIdentity, hasUserKeypair } from '../services/auth/userKeypair';
import { forgetSessionSecrets } from '../services/auth/sessionTeardown';
import { purgeCollabOnKeyLoss } from '../services/collab/collabSession';

interface WipeOrder {
  deviceId: string;
  wipeNonce: string;
  ts: number;
}

// Byte-identical to the worker's buildWipeAckSignedBytes minus the identity domain that
// signWithIdentity prepends — see infra/cloudflare-worker/src/device-wipes.ts.
function wipeAckMessage(o: WipeOrder): Uint8Array {
  return new TextEncoder().encode(
    `filarr.device.wipe.ack.v1\n${o.deviceId}\n${o.wipeNonce}\n${o.ts}`
  );
}

export function useDeviceWipe(): void {
  useEffect(() => {
    let fired = false;
    const handler = async (order: WipeOrder) => {
      if (fired || !order?.deviceId) return; // terminal + idempotent — run once
      fired = true;
      try {
        // Proof of execution: sign + POST while the identity key is still in RAM (vault unlocked).
        if (order.wipeNonce && hasUserKeypair()) {
          const signature = await signWithIdentity(wipeAckMessage(order));
          await apiClient
            .post('/device/wipe-ack', {
              deviceId: order.deviceId,
              wipeNonce: order.wipeNonce,
              ts: order.ts,
              signature,
            })
            .catch(() => {}); // best-effort — the stale cron covers a missed ack
        }
      } catch {
        /* signing/proof is best-effort; the wipe itself already happened in main */
      } finally {
        // `null` — la fenêtre entière est rechargée deux lignes plus bas ; y
        // poser un écran de verrouillage serait un clignotement sans lecteur.
        void forgetSessionSecrets(null);
        // Reset to a coherent logged-out state — main already cleared tokens + keys on disk.
        setTimeout(() => {
          try {
            window.location.reload();
          } catch {
            /* ignore */
          }
        }, 50);
      }
    };
    window.electron?.ipcRenderer?.on('device-wipe-required', handler);
    // The preload bridge exposes no removeListener; the handler is guarded (`fired`) + the event is
    // terminal (a reload follows), so a stray duplicate is harmless (the server ack is idempotent).
  }, []);
}
