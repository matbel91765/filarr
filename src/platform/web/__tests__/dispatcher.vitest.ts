/**
 * Tests unitaires du dispatcher web : erreurs typées (ETW-1003), routage,
 * bus d'événements (contrat on() → désabonnement du preload).
 */

import { describe, expect, it, vi } from 'vitest';
import { INVOKE_CHANNELS } from '../channelClassification';
import { registerWebHandlers, registeredWebChannels, webInvoke, webOn } from '../dispatcher';
import { ChannelNotImplementedError, ChannelUnavailableError } from '../errors';
import { emitWebEvent } from '../webEventBus';

describe('webInvoke — erreurs typées (ETW-1003)', () => {
  it('canal inconnu du preload → ChannelUnavailableError', async () => {
    await expect(webInvoke('canal:inexistant')).rejects.toBeInstanceOf(ChannelUnavailableError);
  });

  it('canal desktop-only → ChannelUnavailableError', async () => {
    const desktopChannel = Object.entries(INVOKE_CHANNELS).find(
      ([, c]) => c.target === 'desktop'
    )?.[0];
    expect(desktopChannel).toBeDefined();
    await expect(webInvoke(desktopChannel as string)).rejects.toBeInstanceOf(
      ChannelUnavailableError
    );
  });

  it('canal légitime non implémenté → ChannelNotImplementedError avec palier', async () => {
    /**
     * LE CANAL TÉMOIN EST TROUVÉ, PAS ÉCRIT EN DUR.
     *
     * Ce test nommait `org:members:list`. Le porter l'a donc fait échouer — non
     * pas parce qu'une régression était survenue, mais parce qu'un PROGRÈS
     * l'avait rendu faux. Un garde-fou qui casse quand on avance apprend à son
     * lecteur à le rafistoler sans réfléchir, ce qui est la façon la plus sûre
     * de lui faire rater le jour où il aura raison.
     *
     * On le cherche donc dans le registre, sans invoquer quoi que ce soit :
     * appeler un canal pour savoir s'il existe déclenche ce qu'il fait — une
     * requête réseau, une écriture — ce qu'un test n'a aucune raison de
     * provoquer.
     */
    const served = new Set(registeredWebChannels());
    const witness = Object.keys(INVOKE_CHANNELS).find(
      (ch) => INVOKE_CHANNELS[ch]?.target !== 'desktop' && !served.has(ch)
    );

    if (!witness) {
      // Plus aucun canal classé n'attend d'être servi : c'est un aboutissement,
      // pas un échec, et le test le dit plutôt que d'accuser un innocent.
      expect(served.size).toBeGreaterThan(0);
      return;
    }
    const err = await webInvoke(witness).catch((e) => e);
    expect(err).toBeInstanceOf(ChannelNotImplementedError);
    expect((err as Error).message).toMatch(/palier M[1-4]/);
  });

  it('handler enregistré → exécuté avec ses arguments', async () => {
    registerWebHandlers({ 'test:echo': (...args: unknown[]) => args });
    await expect(webInvoke('test:echo', 1, 'a')).resolves.toEqual([1, 'a']);
  });

  it('flag:get/set survivent sans localStorage (environnement node)', async () => {
    await expect(webInvoke('flag:get', 'clé')).resolves.toBeNull();
  });
});

describe('bus d’événements — contrat du preload', () => {
  it('on() délivre les émissions et le désabonnement retourné détache', async () => {
    const seen: unknown[] = [];
    const off = webOn('files-updated', (v) => seen.push(v));
    emitWebEvent('files-updated', 42);
    await vi.waitFor(() => expect(seen).toEqual([42]));
    off();
    emitWebEvent('files-updated', 43);
    await new Promise((r) => setTimeout(r, 10));
    expect(seen).toEqual([42]);
  });

  it('canal receive non allowlisté → aucun attachement, désabonnement inoffensif', () => {
    const off = webOn('canal:fantome', () => {});
    expect(typeof off).toBe('function');
    off();
  });
});
