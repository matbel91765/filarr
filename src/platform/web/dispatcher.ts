/**
 * Dispatcher de plateforme web (DW-01, ETW-1001/1003/1005).
 *
 * Réimplémente la façade du preload (invoke/send/on) pour le navigateur :
 *  - un canal avec handler enregistré → exécution web (fetch, localStorage,
 *    WebCrypto, OPFS selon la famille) ;
 *  - un canal classé 'desktop' → ChannelUnavailableError (défense en
 *    profondeur : l'UI est censée le masquer via les gates isElectron) ;
 *  - un canal légitime pas encore livré → ChannelNotImplementedError avec
 *    son palier, pour que l'échec soit diagnostiquable et non silencieux.
 *
 * La table src/platform/web/channelClassification.ts est la copie web des
 * allowlists du preload ; son exhaustivité est verrouillée par le test
 * __tests__/channelRegistry.vitest.ts (ETW-1004).
 */

import { INVOKE_CHANNELS, RECEIVE_CHANNELS, SEND_CHANNELS } from './channelClassification';
import { ChannelNotImplementedError, ChannelUnavailableError } from './errors';
import { authHandlers } from './handlers/authHandlers';
import { billingHandlers } from './handlers/billingHandlers';
import { configHandlers } from './handlers/configHandlers';
import { custodyHandlers } from './handlers/custodyHandlers';
import { custodyLabelHandlers } from './handlers/custodyLabelHandlers';
import { metaHandlers } from './handlers/metaHandlers';
import { orgHandlers } from './handlers/orgHandlers';
import { profileHandlers } from './handlers/profileHandlers';
import { spaceKeypairHandlers } from './handlers/spaceKeypairHandlers';
import { webFileHandlers } from './handlers/webFileHandlers';
import { webStorageHandlers } from './handlers/webStorageHandlers';
import { syncApiHandlers } from './handlers/syncApiHandlers';
import { shareApiHandlers } from './handlers/shareApiHandlers';
import { syncStatusHandlers } from './handlers/syncStatusHandlers';
import { removeAllWebListeners, subscribeWebEvent, subscribeWebEventOnce } from './webEventBus';

type Handler = (...args: unknown[]) => unknown;

const registry = new Map<string, Handler>();

/**
 * Les canaux effectivement SERVIS, pour que les gardes-fous puissent le demander
 * sans les invoquer. Invoquer un canal pour savoir s'il existe déclenche ce qu'il
 * fait — un appel réseau, une écriture — ce qu'un test n'a aucune raison de
 * provoquer.
 */
export function registeredWebChannels(): string[] {
  return [...registry.keys()];
}

/** Enregistre un handler web ; les paliers suivants (storage, sync…) s'ajoutent ici. */
export function registerWebHandlers(handlers: Record<string, Handler>): void {
  for (const [channel, handler] of Object.entries(handlers)) {
    registry.set(channel, handler);
  }
}

registerWebHandlers(configHandlers);
registerWebHandlers(authHandlers);
registerWebHandlers(billingHandlers);
registerWebHandlers(custodyHandlers);
// Clé de garde du COMPTE — à ne pas confondre avec la custody de la clé de
// PROFIL juste au-dessus : matériel de clé et libellés scellés des partages.
registerWebHandlers(custodyLabelHandlers);
registerWebHandlers(metaHandlers);
registerWebHandlers(orgHandlers);
registerWebHandlers(syncApiHandlers);
// Partage par lien : six relais fetch — le geste n°1 du produit, enfin servi au web.
registerWebHandlers(shareApiHandlers);
registerWebHandlers(syncStatusHandlers);
registerWebHandlers(profileHandlers);
registerWebHandlers(spaceKeypairHandlers);
registerWebHandlers(webStorageHandlers);
registerWebHandlers(webFileHandlers); // après webStorageHandlers : sa corbeille réelle prime

export async function webInvoke(channel: string, ...args: unknown[]): Promise<unknown> {
  const handler = registry.get(channel);
  if (handler) return handler(...args);

  const cls = INVOKE_CHANNELS[channel];
  if (!cls) {
    throw new ChannelUnavailableError(channel, 'canal inconnu du preload desktop');
  }
  if (cls.target === 'desktop') {
    throw new ChannelUnavailableError(channel, 'fonctionnalité desktop-only, jamais portée');
  }
  throw new ChannelNotImplementedError(channel, cls.palier);
}

export function webSend(channel: string, ..._args: unknown[]): void {
  // Les 5 canaux send sont desktop-only (drag natif, restart, open-external
  // géré à part) : no-op silencieux, comme un renderer sans main à l'écoute.
  if (channel === 'open-external' && typeof _args[0] === 'string') {
    window.open(_args[0], '_blank', 'noopener,noreferrer');
    return;
  }
  if (!(channel in SEND_CHANNELS)) {
    // Canal hors allowlist : même silence que le preload (qui l'aurait bloqué).
  }
}

export function webOn(channel: string, listener: (...args: unknown[]) => void): () => void {
  if (!(channel in RECEIVE_CHANNELS)) {
    // Contrat du preload : un canal non allowlisté n'attache rien. On rend
    // quand même un désabonnement inoffensif pour ne pas casser l'appelant.
    return () => {};
  }
  return subscribeWebEvent(channel, listener);
}

export function webOnce(channel: string, listener: (...args: unknown[]) => void): void {
  if (!(channel in RECEIVE_CHANNELS)) return;
  subscribeWebEventOnce(channel, listener);
}

export function webRemoveAllListeners(channel: string): void {
  removeAllWebListeners(channel);
}
