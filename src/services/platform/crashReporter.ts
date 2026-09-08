/**
 * Crash Reporter Service
 *
 * Captures unhandled errors and unhandled promise rejections in the renderer.
 * Three layers:
 * 1. console.error — always (even if disabled)
 * 2. localStorage — recent crashes for local diagnostics
 * 3. Sentry — remote error tracking (free tier, 10K events/month)
 *
 * Controlled by the `crashReportsEnabled` setting in settingsSlice.
 * When disabled, only console.error fires (no localStorage, no Sentry).
 */

import * as Sentry from '@sentry/browser';
import { getAppVersion } from './appVersion';
import { isWebPlatform } from './isWebPlatform';
import { scrubBreadcrumbLinks, scrubEventLinks } from '../vault/inviteLinkHygiene';

// Sentry DSN — replace with your project DSN from https://sentry.io
// Create project: sentry.io → New Project → Browser JavaScript → copy DSN
const SENTRY_DSN =
  'https://db0e7f8b8ef839d3bbc552c461d38b76@o4511051074764800.ingest.de.sentry.io/4511051078303824'; // e.g. 'https://abc123@o123456.ingest.sentry.io/789'

const MAX_STACK_LENGTH = 2000;
const THROTTLE_MS = 10_000; // Max 1 report per 10 seconds
const LOCAL_CRASHES_KEY = 'filarr_recent_crashes';
const MAX_LOCAL_CRASHES = 20;

let enabled = true;
let sentryInitialized = false;
let lastReportTime = 0;

/**
 * Enable or disable crash reporting.
 */
export function setCrashReportingEnabled(value: boolean): void {
  enabled = value;
}

/**
 * Initialize the crash reporter.
 * Sets up Sentry + installs global error handlers as fallback.
 */
export function initCrashReporter(): void {
  const version = getAppVersion();

  // Initialize Sentry if DSN is configured — DESKTOP ONLY.
  //
  // On app.filarr.com the CSP pins connect-src to api.filarr.com
  // (public/_headers, infra/web-app/worker.js): every envelope to sentry.io is
  // refused by the browser and logged in red, on each error, without ever
  // reporting anything. Widening the CSP is NOT the fix — the web dossier wants
  // zero third-party origin and any telemetry opt-in, off by default
  // (ESW-1605). Layers 1 (console) and 2 (localStorage) stay active there.
  if (SENTRY_DSN && !sentryInitialized && !isWebPlatform()) {
    try {
      Sentry.init({
        dsn: SENTRY_DSN,
        release: `filarr@${version}`,
        environment: process.env.NODE_ENV === 'development' ? 'development' : 'production',
        // Active in all environments (Sentry free tier has 10K events/month)
        enabled: true,
        // Sample rate — 100% of errors (free tier has 10K/month)
        sampleRate: 1.0,
        // No performance tracing (keep bundle small)
        tracesSampleRate: 0,
        // Strip PII
        beforeSend(event) {
          if (!enabled) return null;
          // Remove user IP
          if (event.user) {
            delete event.user.ip_address;
          }
          /**
           * LE JETON D'INVITATION NE PART PAS AVEC LE RAPPORT (F16).
           *
           * `beforeBreadcrumb` couvre le chemin normal (une URL enregistrée par
           * l'intégration `history` ou `fetch`), mais un lien peut aussi arriver
           * ICI : dans le message d'une exception, ou dans l'URL de la page au
           * moment du plantage. Les deux crochets appellent donc les deux
           * fonctions de `services/vault/inviteLinkHygiene`, qui vivent là-bas
           * pour être ÉPROUVÉES : un garde branché dans `Sentry.init` n'est
           * testé par rien.
           */
          scrubEventLinks(event);
          return event;
        },
        /**
         * Le fil d'ariane est le chemin le PLUS probable : Sentry enregistre
         * l'URL de chaque navigation et de chaque requête, si bien qu'un lien
         * d'invitation ouvert dans l'application y entrerait tout seul, sans que
         * personne ait écrit une ligne pour cela. On coupe la valeur du jeton et
         * on garde le reste : un fil d'ariane muet ne sert à rien.
         */
        beforeBreadcrumb(breadcrumb) {
          scrubBreadcrumbLinks(breadcrumb);
          return breadcrumb;
        },
        // Minimal integrations — we handle our own global handlers
        defaultIntegrations: false,
        integrations: [
          Sentry.breadcrumbsIntegration({ console: false }),
          Sentry.dedupeIntegration(),
        ],
      });

      // Set device context (anonymous)
      const deviceId = localStorage.getItem('filarr_device_id') || 'unknown';
      const os = navigator.userAgent.includes('Win')
        ? 'windows'
        : navigator.userAgent.includes('Mac')
          ? 'macos'
          : navigator.userAgent.includes('Linux')
            ? 'linux'
            : 'unknown';

      Sentry.setTag('os', os);
      Sentry.setTag('device_id', deviceId);

      sentryInitialized = true;
    } catch (err) {
      console.warn('[CrashReporter] Sentry init failed:', err);
    }
  }

  // Global error handlers (always active — Sentry + local logging)
  window.addEventListener('error', (event) => {
    handleCrash(
      {
        type: 'uncaughtException',
        message: event.message || 'Unknown error',
        stack: event.error?.stack,
        source: event.filename,
        line: event.lineno,
        column: event.colno,
      },
      event.error
    );
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    handleCrash(
      {
        type: 'unhandledRejection',
        message: reason?.message || String(reason) || 'Unhandled promise rejection',
        stack: reason?.stack,
      },
      reason instanceof Error ? reason : undefined
    );
  });
}

/**
 * Get locally stored crash reports (for diagnostics / future export).
 */
export function getRecentCrashes(): CrashEntry[] {
  try {
    const raw = localStorage.getItem(LOCAL_CRASHES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

interface CrashData {
  type: string;
  message: string;
  stack?: string;
  source?: string;
  line?: number;
  column?: number;
}

interface CrashEntry extends CrashData {
  timestamp: string;
  version: string;
}

function handleCrash(crash: CrashData, originalError?: Error): void {
  // Always log locally regardless of enabled state
  console.error(`[CrashReporter] ${crash.type}: ${crash.message}`);

  if (!enabled) return;

  // Throttle
  const now = Date.now();
  if (now - lastReportTime < THROTTLE_MS) return;
  lastReportTime = now;

  const version = getAppVersion();

  // Layer 2: Persist to localStorage for local diagnostics
  try {
    const entry: CrashEntry = {
      ...crash,
      stack: crash.stack?.slice(0, MAX_STACK_LENGTH),
      timestamp: new Date().toISOString(),
      version,
    };
    const existing = getRecentCrashes();
    existing.unshift(entry);
    localStorage.setItem(LOCAL_CRASHES_KEY, JSON.stringify(existing.slice(0, MAX_LOCAL_CRASHES)));
  } catch {
    // localStorage full or unavailable — ignore
  }

  // Layer 3: Send to Sentry
  if (sentryInitialized) {
    try {
      if (originalError) {
        Sentry.captureException(originalError);
      } else {
        Sentry.captureMessage(`${crash.type}: ${crash.message}`, {
          level: 'error',
          extra: {
            stack: crash.stack?.slice(0, MAX_STACK_LENGTH),
            source: crash.source,
            line: crash.line,
            column: crash.column,
          },
        });
      }
    } catch {
      // Sentry should never crash the app
    }
  }
}
