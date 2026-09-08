/**
 * Le rapporteur d'incidents et la plateforme.
 *
 * Sur app.filarr.com, la CSP épingle `connect-src` à api.filarr.com : chaque
 * enveloppe vers sentry.io est refusée par le navigateur et loguée en rouge, à
 * chaque erreur, sans jamais rien rapporter (constaté en prod le 2026-08-28).
 * La réponse n'est pas d'élargir la CSP (dossier web : aucune origine tierce,
 * télémétrie opt-in — ESW-1605) : Sentry ne s'initialise pas sur le web. Les
 * gestionnaires globaux, eux, restent posés — la console et le journal local
 * continuent d'attraper ce qui casse.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const sentry = vi.hoisted(() => ({
  init: vi.fn(),
  setTag: vi.fn(),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  breadcrumbsIntegration: vi.fn(() => ({ name: 'Breadcrumbs' })),
  dedupeIntegration: vi.fn(() => ({ name: 'Dedupe' })),
}));
vi.mock('@sentry/browser', () => sentry);

type Listener = (event: unknown) => void;

function defineGlobal(name: string, value: unknown): void {
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}

/** Un navigateur minimal ; `web` pose le marqueur de installWebPlatform.ts. */
function installBrowser(web: boolean): Map<string, Listener> {
  const listeners = new Map<string, Listener>();
  defineGlobal('window', {
    addEventListener: (name: string, listener: Listener) => listeners.set(name, listener),
    __FILARR_WEB__: web || undefined,
  });
  defineGlobal('navigator', { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' });
  defineGlobal('localStorage', {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  });
  return listeners;
}

describe('initCrashReporter', () => {
  let consoleError: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('web : Sentry n’est jamais initialisé, les gestionnaires globaux le sont', async () => {
    const listeners = installBrowser(true);
    const { initCrashReporter } = await import('../crashReporter');
    initCrashReporter();

    expect(sentry.init).not.toHaveBeenCalled();
    expect(sentry.setTag).not.toHaveBeenCalled();
    expect(listeners.has('error')).toBe(true);
    expect(listeners.has('unhandledrejection')).toBe(true);

    // Et un incident réel ne tente pas non plus d'atteindre sentry.io.
    listeners.get('unhandledrejection')!({ reason: new Error('boom') });
    expect(sentry.captureException).not.toHaveBeenCalled();
    expect(sentry.captureMessage).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith('[CrashReporter] unhandledRejection: boom');
  });

  it('bureau : Sentry est initialisé, et reçoit les incidents', async () => {
    const listeners = installBrowser(false);
    const { initCrashReporter } = await import('../crashReporter');
    initCrashReporter();

    expect(sentry.init).toHaveBeenCalledTimes(1);
    expect(sentry.setTag).toHaveBeenCalledWith('os', 'windows');

    const err = new Error('boom');
    listeners.get('unhandledrejection')!({ reason: err });
    expect(sentry.captureException).toHaveBeenCalledWith(err);
  });
});
