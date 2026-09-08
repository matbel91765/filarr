/**
 * TrustLine — la confiance, dite en une phrase.
 *
 * ── CE QUE CETTE LIGNE REMPLACE ─────────────────────────────────────────────
 *
 * Avant :  v1.2.0 · 143 téléchargements · 41209 77304 18822 90015 33471 60902
 * Après :  Même auteur que « Markdown Pro », déjà installée
 *
 * Les trente chiffres n'ont pas disparu : ils sont dans le dépliant technique,
 * là où ils servent (une comparaison hors bande). Ce qu'ils faisaient en
 * première ligne, en revanche — occuper la place de l'information utile et
 * enseigner à l'utilisateur que cet écran n'est pas pour lui — cesse.
 *
 * ── LA RÈGLE DE TON ─────────────────────────────────────────────────────────
 *
 * « Premier auteur » N'EST PAS UN AVERTISSEMENT. Tout auteur est nouveau une
 * fois ; peindre cet état en orange rendrait la couleur d'alerte insignifiante
 * et punirait toute nouveauté. Le seul rouge de cet écran est réservé à ce qui
 * est réellement anormal : une signature qui ne vérifie plus, une clé qui change.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { fingerprintGroups, type PublisherTrust, type TrustLevel } from './trustModel';
import { ShieldGlyph, ShieldAlertGlyph, UserGlyph } from './icons';
import './marketplace.css';

const GLYPH: Record<TrustLevel, React.FC<{ className?: string }>> = {
  yours: UserGlyph,
  known: ShieldGlyph,
  first: ShieldGlyph,
  unknown: ShieldAlertGlyph,
  key_changed: ShieldAlertGlyph,
};

export const TrustLine: React.FC<{ trust: PublisherTrust }> = ({ trust }) => {
  const { t } = useTranslation();
  const Glyph = GLYPH[trust.level];

  let text: string;
  switch (trust.level) {
    case 'yours':
      text = t('marketplace.trust.yours');
      break;
    case 'known':
      // Le premier nom est cité, le reste est compté : « Markdown Pro et 2
      // autres » se lit, « Markdown Pro, CSV Studio, Kanban, Mermaid… » non.
      text = t('marketplace.trust.known', {
        count: trust.alsoBy.length,
        first: trust.alsoBy[0] ?? '',
        extra: trust.alsoBy.length - 1,
      });
      break;
    case 'unknown':
      text = t('marketplace.trust.unknown');
      break;
    case 'key_changed':
      text = t('marketplace.trust.keyChanged');
      break;
    case 'first':
    default:
      text = t('marketplace.trust.first');
      break;
  }

  return (
    <span className={`mkt-trust mkt-trust--${trust.level}`}>
      <Glyph className="mkt-trust__glyph" />
      {text}
    </span>
  );
};

/**
 * Le dépliant technique — TOUT le jargon de l'écran tient ici.
 *
 * Il porte sa propre légende : une empreinte affichée sans la phrase qui dit ce
 * qu'elle est reste une suite de chiffres. C'est la différence entre exposer une
 * donnée et la rendre utilisable.
 */
export const FingerprintDisclosure: React.FC<{
  fingerprint: string;
  /** Faits techniques supplémentaires (identifiant, condensat, octets). */
  facts?: { label: string; value: string; mono?: boolean }[];
}> = ({ fingerprint, facts }) => {
  const { t } = useTranslation();
  const groups = fingerprintGroups(fingerprint);

  return (
    <details className="mkt-adv">
      <summary>{t('marketplace.trust.advancedTitle')}</summary>
      <div className="mkt-adv__body">
        <p className="mkt-adv__hint">{t('marketplace.trust.fingerprintExplained')}</p>
        {groups.length > 0 ? (
          <div className="mkt-fp" aria-label={t('marketplace.trust.fingerprintLabel')}>
            {groups.map((g, i) => (
              <span className="mkt-fp__group" key={`${g}-${i}`}>
                {g}
              </span>
            ))}
          </div>
        ) : (
          <p className="mkt-adv__hint">{t('marketplace.trust.fingerprintMissing')}</p>
        )}
        {facts && facts.length > 0 && (
          <dl className="mkt-facts" style={{ marginTop: 'var(--spacing-3)' }}>
            {facts.map((f) => (
              <React.Fragment key={f.label}>
                <dt>{f.label}</dt>
                <dd style={f.mono ? { fontFamily: 'var(--font-family-mono)' } : undefined}>
                  {f.value}
                </dd>
              </React.Fragment>
            ))}
          </dl>
        )}
      </div>
    </details>
  );
};
