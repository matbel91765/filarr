/**
 * CloudVerifyStep — Email verification polling step
 *
 * Used in:
 *   - Onboarding (cloud flow, step 3)
 *   - Settings migration modal (local → cloud)
 *
 * Polls GET /auth/verify-status every 3 seconds (public endpoint, no auth).
 * Auto-advances via onVerified() when the email is confirmed.
 * Cleanup: clearInterval on unmount.
 */

import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { resolveApiBase } from '../../../../platform/web/webApiBase';

/**
 * L'origine du Worker, RÉSOLUE — plus l'hôte `filarr-api.filarr-app.workers.dev`
 * figé ici. Sur app.filarr.com la CSP n'autorise que `https://api.filarr.com` :
 * le sondage toutes les 3 s était refusé par le navigateur (violation CSP dans
 * la console), `verified:true` n'était jamais observé et l'inscrit restait sur
 * « vérifiez votre e-mail » pour toujours, sans message. `resolveApiBase()`
 * rend api.filarr.com (le même Worker, sous son domaine) et honore l'override
 * `filarr-server-url` que le reste du client lit déjà.
 */
const API_BASE = resolveApiBase();

// ── Props ───────────────────────────────────────────────────────────────────

interface CloudVerifyStepProps {
  email: string;
  maskedEmail: string;
  language: 'en' | 'fr';
  onVerified: () => void;
  onChangeEmail?: () => void;
}

// ── Component ───────────────────────────────────────────────────────────────

const CloudVerifyStep: React.FC<CloudVerifyStepProps> = ({
  email,
  maskedEmail,
  language,
  onVerified,
  onChangeEmail,
}) => {
  const { t } = useTranslation();
  const [resendCooldown, setResendCooldown] = useState(0);

  // Polling: check verification status every 3 seconds (public endpoint, no auth)
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch(
          `${API_BASE}/auth/verify-status?email=${encodeURIComponent(email)}`
        );
        const data = await res.json();
        if (data.success && data.data?.verified) {
          clearInterval(interval);
          onVerified();
        }
      } catch {
        // Ignore polling errors
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [email, onVerified]);

  // Resend cooldown timer
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setTimeout(() => setResendCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  const handleResend = async () => {
    setResendCooldown(60);
    try {
      await fetch(`${API_BASE}/auth/resend-verification`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
    } catch {
      // Ignore — best effort
    }
  };

  return (
    <div className="text-center">
      <div
        className="mx-auto mb-4 w-16 h-16 rounded-full flex items-center justify-center"
        style={{ backgroundColor: 'var(--color-primary-50)' }}
      >
        <svg
          className="w-8 h-8"
          style={{ color: 'var(--color-primary-600)' }}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75"
          />
        </svg>
      </div>

      <h2 className="text-xl font-bold mb-2" style={{ color: 'var(--color-text-primary)' }}>
        {t('onboarding.cloud.verify.title', 'Vérifiez votre adresse email')}
      </h2>

      <p className="text-sm mb-1" style={{ color: 'var(--color-text-secondary)' }}>
        {t('onboarding.cloud.verify.sent', 'Un email de vérification a été envoyé à')}
      </p>
      <p className="text-sm font-semibold mb-6" style={{ color: 'var(--color-text-primary)' }}>
        {maskedEmail}
      </p>

      {/* Spinner */}
      <div className="flex items-center justify-center gap-2 mb-6">
        <svg
          className="animate-spin w-4 h-4"
          style={{ color: 'var(--color-primary-600)' }}
          viewBox="0 0 24 24"
          fill="none"
        >
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" opacity="0.25" />
          <path
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            opacity="0.75"
          />
        </svg>
        <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
          {t('onboarding.cloud.verify.waiting', 'En attente de vérification...')}
        </span>
      </div>

      {/* Resend button */}
      <button
        onClick={handleResend}
        disabled={resendCooldown > 0}
        className="px-4 py-2 text-sm font-medium rounded-lg transition-colors mb-4"
        style={{
          border: '1px solid var(--color-border)',
          color: resendCooldown > 0 ? 'var(--color-text-tertiary)' : 'var(--color-text-primary)',
          backgroundColor: 'var(--color-surface)',
          cursor: resendCooldown > 0 ? 'not-allowed' : 'pointer',
          opacity: resendCooldown > 0 ? 0.6 : 1,
        }}
      >
        {resendCooldown > 0
          ? `${t('onboarding.cloud.verify.resend', 'Renvoyer')} (${resendCooldown}s)`
          : t('onboarding.cloud.verify.resend', "Renvoyer l'email")}
      </button>

      {onChangeEmail && (
        <div>
          <button
            onClick={onChangeEmail}
            className="text-xs underline"
            style={{
              color: 'var(--color-text-tertiary)',
              cursor: 'pointer',
              background: 'none',
              border: 'none',
            }}
          >
            {t('onboarding.cloud.verify.changeEmail', "Changer d'adresse email")}
          </button>
        </div>
      )}
    </div>
  );
};

export default CloudVerifyStep;
