/**
 * Le passage par le disque HORS BUREAU : un pont qui LÈVE doit rendre l'échec
 * explicite promis par l'en-tête du module — jamais un rejet.
 *
 * LE DÉFAUT QUE CECI ÉPINGLE. `takePendingLayoutOpen` est appelée au montage de
 * l'accueil, sans geste. Sur app.filarr.com, `window.electron.ipcRenderer`
 * EXISTE (c'est l'émulation web de installWebPlatform.ts) et le canal
 * `layouts:takePendingOpen`, classé desktop-only, y lève
 * `ChannelUnavailableError`. Tester la présence du pont ne protégeait donc de
 * rien : la promesse partait en rejet non géré, que le CrashReporter remontait à
 * chaque ouverture de l'accueil (constaté en prod le 2026-08-28).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChannelNotImplementedError, ChannelUnavailableError } from '../../../platform/web/errors';
import { readLayoutFile, saveLayoutFile, takePendingLayoutOpen } from '../layoutFileIo';
import { LAYOUT_FILE_FORMAT_VERSION, LAYOUT_FILE_KIND, type LayoutFile } from '../layoutFormat';

type Invoke = (channel: string, ...args: unknown[]) => Promise<unknown>;
interface FakeWindow {
  electron?: { ipcRenderer: { invoke: Invoke } };
  __FILARR_WEB__?: boolean;
}

function installWindow(win: FakeWindow): void {
  Object.defineProperty(globalThis, 'window', { value: win, configurable: true, writable: true });
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

/** Un pont qui LÈVE, comme le dispatcher web sur un canal qu'il ne sert pas. */
function throwingBridge(error: Error, web: boolean) {
  const invoke = vi.fn<Invoke>(async () => {
    throw error;
  });
  installWindow({ electron: { ipcRenderer: { invoke } }, __FILARR_WEB__: web || undefined });
  return invoke;
}

const FILE: LayoutFile = {
  kind: LAYOUT_FILE_KIND,
  formatVersion: LAYOUT_FILE_FORMAT_VERSION,
  id: 'layout-1',
  name: 'Essentiel',
  description: '',
  target: 'home',
  widgets: [],
  requires: [],
  version: 1,
};

describe('takePendingLayoutOpen', () => {
  it('web : ne présente même pas le canal au dispatcher, et rend null', async () => {
    const invoke = throwingBridge(
      new ChannelUnavailableError('layouts:takePendingOpen', 'desktop-only'),
      true
    );
    await expect(takePendingLayoutOpen()).resolves.toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });

  it('un pont qui lève rend null — jamais un rejet (défense en profondeur)', async () => {
    // Sans le marqueur web : c'est le cas d'un pont quelconque qui refuse. Le
    // contrat de l'en-tête tient quand même.
    throwingBridge(new ChannelUnavailableError('layouts:takePendingOpen', 'desktop-only'), false);
    await expect(takePendingLayoutOpen()).resolves.toBeNull();
  });

  it('sans pont du tout : null', async () => {
    installWindow({});
    await expect(takePendingLayoutOpen()).resolves.toBeNull();
  });

  it('bureau : rend le fichier en attente tel que le principal le livre', async () => {
    const invoke = vi.fn<Invoke>(async () => ({ content: '{}', fileName: 'mine.filarrlayout' }));
    installWindow({ electron: { ipcRenderer: { invoke } } });
    await expect(takePendingLayoutOpen()).resolves.toEqual({
      content: '{}',
      fileName: 'mine.filarrlayout',
    });
    expect(invoke).toHaveBeenCalledWith('layouts:takePendingOpen');
  });

  it('bureau : rien en attente → null', async () => {
    const invoke = vi.fn<Invoke>(async () => null);
    installWindow({ electron: { ipcRenderer: { invoke } } });
    await expect(takePendingLayoutOpen()).resolves.toBeNull();
  });
});

describe('readLayoutFile / saveLayoutFile', () => {
  it('web : le canal pas encore porté donne « unsupported », pas une exception', async () => {
    // `layouts:importFile` est classé storage/M2 : le dispatcher lève
    // ChannelNotImplementedError tant qu'il n'est pas livré. Le dialogue
    // d'import attend un statut, et affiche « lecture impossible ».
    throwingBridge(new ChannelNotImplementedError('layouts:importFile', 'M2'), true);
    await expect(readLayoutFile()).resolves.toEqual({ status: 'error', message: 'unsupported' });
  });

  it('web : idem pour l’export', async () => {
    throwingBridge(new ChannelNotImplementedError('layouts:exportFile', 'M2'), true);
    await expect(saveLayoutFile(FILE)).resolves.toEqual({
      status: 'error',
      message: 'unsupported',
    });
  });

  it('sans pont : « unsupported » des deux côtés', async () => {
    installWindow({});
    await expect(readLayoutFile()).resolves.toEqual({ status: 'error', message: 'unsupported' });
    await expect(saveLayoutFile(FILE)).resolves.toEqual({
      status: 'error',
      message: 'unsupported',
    });
  });

  it('bureau : les verdicts du principal passent intacts (ok, canceled, erreur nommée)', async () => {
    const invoke = vi.fn<Invoke>(async (channel) => {
      if (channel === 'layouts:importFile') {
        return { success: true, content: '{"a":1}', fileName: 'x.filarrlayout' };
      }
      return { success: true, path: 'C:/x.filarrlayout' };
    });
    installWindow({ electron: { ipcRenderer: { invoke } } });
    await expect(readLayoutFile()).resolves.toEqual({
      status: 'ok',
      value: { content: '{"a":1}', fileName: 'x.filarrlayout' },
    });
    await expect(saveLayoutFile(FILE)).resolves.toEqual({
      status: 'ok',
      value: 'C:/x.filarrlayout',
    });

    invoke.mockImplementation(async () => ({ canceled: true }));
    await expect(readLayoutFile()).resolves.toEqual({ status: 'canceled' });

    invoke.mockImplementation(async () => ({ success: false, error: 'too-large' }));
    await expect(readLayoutFile()).resolves.toEqual({ status: 'error', message: 'too-large' });
  });
});
