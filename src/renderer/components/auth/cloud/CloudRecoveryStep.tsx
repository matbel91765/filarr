/**
 * CloudRecoveryStep — Display and acknowledge BIP-39 recovery codes
 *
 * Used in:
 *   - Onboarding (cloud flow, step 2)
 *   - Settings migration modal (local → cloud)
 *
 * Recovery codes come from the parent (returned by CloudRegisterStep).
 * They are NEVER stored in Redux or localStorage.
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isWebPlatform } from '../../../../services/platform/isWebPlatform';

// ── Props ───────────────────────────────────────────────────────────────────

interface CloudRecoveryStepProps {
  recoveryCodes: string[];
  language: 'en' | 'fr';
  /**
   * L'espace d'où l'on vient. Les codes jouent le MÊME rôle des deux côtés,
   * mais du côté entreprise il faut dire ce que la clé de récupération de
   * l'organisation ne fera PAS à leur place — sans quoi on les range avec
   * l'idée qu'un administrateur pourra toujours rattraper leur perte.
   */
  accountType?: 'personal' | 'enterprise';
  onAcknowledged: () => void;
}

// ── Component ───────────────────────────────────────────────────────────────

const CloudRecoveryStep: React.FC<CloudRecoveryStepProps> = ({
  recoveryCodes,
  language,
  onAcknowledged,
  accountType = 'personal',
}) => {
  const { t } = useTranslation();
  const [acknowledged, setAcknowledged] = useState(false);
  const isOrg = accountType === 'enterprise';

  return (
    <div>
      <h2 className="text-xl font-bold mb-1" style={{ color: 'var(--color-text-primary)' }}>
        {t('onboarding.cloud.recovery.title', 'Sauvegardez vos codes de récupération')}
      </h2>

      {/* Warning */}
      {/* Couleurs du THÈME : cet encart était rouge très pâle sur bordure rose,
          posé sur le fond sombre de l'accueil. */}
      <div
        className="flex items-start gap-2 p-3 rounded-lg mb-4 text-sm"
        style={{
          backgroundColor: 'color-mix(in srgb, var(--color-warning-500) 10%, transparent)',
          border: '1px solid color-mix(in srgb, var(--color-warning-500) 28%, transparent)',
          color: 'var(--color-text-secondary)',
          lineHeight: 'var(--line-height-relaxed)',
        }}
      >
        <span className="flex-shrink-0 text-base">&#9888;&#65039;</span>
        <span>
          {t(
            'onboarding.cloud.recovery.warning',
            "Ces 24 mots sont la SEULE façon de récupérer l'accès à votre compte si vous perdez votre mot de passe. Ils ne seront plus jamais affichés."
          )}
        </span>
      </div>

      {/*
        CE QUE L'ORGANISATION NE PEUT PAS FAIRE À LEUR PLACE.
        Un salarié range ces codes avec l'idée qu'un administrateur pourra
        toujours le dépanner. La clé de récupération de l'organisation ne rend
        l'accès qu'aux coffres d'organisation SCELLÉS APRÈS SA CRÉATION — jamais
        à ce compte, jamais à l'espace personnel, jamais aux coffres antérieurs.
        Dit ici, cette phrase change la façon dont on range les codes ; dite le
        jour de la perte, elle n'est plus qu'un constat.
      */}
      {isOrg && (
        <div
          className="p-3 rounded-lg mb-4 text-xs"
          style={{
            backgroundColor: 'color-mix(in srgb, var(--color-info-500) 9%, transparent)',
            border: '1px solid color-mix(in srgb, var(--color-info-500) 26%, transparent)',
            color: 'var(--color-text-secondary)',
            lineHeight: 'var(--line-height-relaxed)',
          }}
        >
          <strong style={{ color: 'var(--color-text-primary)' }}>
            {t('onboarding.cloud.recovery.orgNoteTitle') + ' '}
          </strong>
          {t('onboarding.cloud.recovery.orgNote')}
        </div>
      )}

      {/* 24-word grid: 4 columns × 6 rows */}
      <div
        className="grid grid-cols-4 gap-2 mb-4 p-3 rounded-lg"
        style={{ backgroundColor: 'var(--color-background-secondary)' }}
      >
        {recoveryCodes.map((word, i) => (
          <div
            key={i}
            className="flex items-center gap-1.5 px-2 py-1.5 rounded text-sm"
            style={{ backgroundColor: 'var(--color-surface)' }}
          >
            <span
              className="text-xs font-mono"
              style={{ color: 'var(--color-text-tertiary)', minWidth: '1.25rem' }}
            >
              {i + 1}.
            </span>
            <span className="font-medium" style={{ color: 'var(--color-text-primary)' }}>
              {word}
            </span>
          </div>
        ))}
      </div>

      {/* Action buttons */}
      <div className="flex gap-2 mb-5">
        <button
          onClick={() => navigator.clipboard.writeText(recoveryCodes.join(' '))}
          className="flex-1 px-4 py-2 text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
          style={{
            border: '1px solid var(--color-border)',
            color: 'var(--color-text-primary)',
            backgroundColor: 'var(--color-surface)',
            cursor: 'pointer',
          }}
        >
          <svg
            className="w-4 h-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9.75a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184"
            />
          </svg>
          {t('onboarding.cloud.recovery.copy', 'Copier')}
        </button>
        {/* Le PDF passe par le dialogue d'impression natif du bureau
            (`pdf:printRecoveryCodes`, desktop-only) : sur le web le bouton
            n'a rien derrière lui — le dispatcher lèverait, en rejet non géré.
            On ne le montre pas ; « Copier » reste. */}
        {!isWebPlatform() && (
          <button
            onClick={() => {
              void window.electron.ipcRenderer.invoke(
                'pdf:printRecoveryCodes',
                recoveryCodes,
                language
              );
            }}
            className="flex-1 px-4 py-2 text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
            style={{
              border: '1px solid var(--color-border)',
              color: 'var(--color-text-primary)',
              backgroundColor: 'var(--color-surface)',
              cursor: 'pointer',
            }}
          >
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
              />
            </svg>
            {t('onboarding.cloud.recovery.download', 'Télécharger PDF')}
          </button>
        )}
      </div>

      {/* Acknowledgment checkbox */}
      <label
        className="flex items-start gap-3 p-3 rounded-lg cursor-pointer select-none transition-all"
        style={{
          backgroundColor: !acknowledged
            ? 'rgba(239,68,68,0.06)'
            : 'var(--color-background-secondary)',
          border: !acknowledged ? '1px solid rgba(239,68,68,0.3)' : '1px solid transparent',
        }}
      >
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(e) => {
            setAcknowledged(e.target.checked);
            if (e.target.checked) onAcknowledged();
          }}
          className="mt-0.5 w-4 h-4 rounded"
          style={{ accentColor: 'var(--color-primary-600)' }}
        />
        <span
          className="text-sm"
          style={{ color: acknowledged ? 'var(--color-text-primary)' : '#991b1b' }}
        >
          {t(
            'onboarding.cloud.recovery.acknowledge',
            "J'ai sauvegardé mes codes de récupération dans un endroit sûr. Je comprends qu'ils ne seront plus jamais affichés."
          )}
        </span>
      </label>
      {!acknowledged && (
        <p className="text-xs mt-2" style={{ color: '#ef4444' }}>
          {t(
            'onboarding.cloud.recovery.mustAcknowledge',
            'Veuillez confirmer avoir sauvegardé vos codes avant de continuer.'
          )}
        </p>
      )}
    </div>
  );
};

export default CloudRecoveryStep;
