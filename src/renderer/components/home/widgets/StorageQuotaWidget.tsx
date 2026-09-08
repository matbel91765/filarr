/**
 * Bloc « Quota de stockage ».
 *
 * L'information existait déjà, mais UNIQUEMENT dans le pied de la vue dossier —
 * autant dire nulle part : il fallait ouvrir un dossier, puis regarder en bas, à
 * un endroit où l'œil ne va jamais. Elle devient un bloc qu'on peut poser sur
 * l'accueil, avec la même règle d'affichage et les mêmes seuils.
 *
 * ── LE COMPTE LOCAL N'A PAS DE QUOTA ────────────────────────────────────────
 *
 * Le bloc ne s'affiche que pour un compte nuage AVEC une limite connue. Inventer
 * un pourcentage pour un coffre local reviendrait à afficher une jauge sur la
 * taille du disque de quelqu'un, ce que le produit n'a jamais prétendu mesurer.
 *
 * Les seuils lisent l'état Redux directement plutôt que `useSyncStatus` : ce
 * crochet déclenche des appels IPC au montage, et un bloc d'affichage n'a pas à
 * lancer un aller-retour vers le processus principal pour dessiner une barre.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import type { RootState } from '../../../../store';
import { selectProfileIsCloud } from '../../../../store/selectors/authSelectors';
import { useFormatSize } from '../../views/Home/DashboardStats';
import type { WidgetProps } from '../widgetOptions';

/** Compte local, ou limite inconnue ⇒ aucun bloc. */
export function isStorageQuotaEmpty(state: RootState): boolean {
  return state.auth.accountMode !== 'cloud' || !(state.sync.storageLimit > 0);
}

/**
 * Les deux seuils du pied de page de la vue dossier, à l'identique : orange à
 * 80 %, rouge à 90 %. Ce sont des couleurs de SIGNAL, pas de thème — elles ne
 * changent pas d'un thème à l'autre, sinon l'alerte cesserait d'alerter.
 */
const thresholdColor = (percent: number): string =>
  percent > 90
    ? 'var(--color-error-500)'
    : percent > 80
      ? 'var(--color-warning-500)'
      : 'var(--color-text-tertiary)';

const DriveIcon: React.FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={1.5}
    stroke="currentColor"
    className="w-4 h-4 shrink-0"
    aria-hidden="true"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M5.25 14.25h13.5m-13.5 0a3 3 0 01-3-3m3 3a3 3 0 100 6h13.5a3 3 0 100-6m-16.5-3a3 3 0 013-3h13.5a3 3 0 013 3m-19.5 0a4.5 4.5 0 01.9-2.7L5.737 5.1a3.375 3.375 0 012.7-1.35h7.126c1.062 0 2.062.5 2.7 1.35l2.587 3.45a4.5 4.5 0 01.9 2.7m0 0a3 3 0 01-3 3m0 3h.008v.008h-.008v-.008zm0-6h.008v.008h-.008v-.008zm-3 6h.008v.008h-.008v-.008zm0-6h.008v.008h-.008v-.008z"
    />
  </svg>
);

export const StorageQuotaWidget: React.FC<WidgetProps> = React.memo(function StorageQuotaWidget({
  editing,
}) {
  const { t } = useTranslation();
  const formatSize = useFormatSize();
  // Le QUOTA est un fait de PROFIL : un profil local n'occupe rien dans le
  // nuage, même quand une session traîne. Voir `selectProfileIsCloud`.
  const isCloud = useSelector(selectProfileIsCloud);
  const storageUsed = useSelector((state: RootState) => state.sync.storageUsed);
  const storageLimit = useSelector((state: RootState) => state.sync.storageLimit);

  const available = isCloud && storageLimit > 0;
  if (!available && !editing) return null;

  const percent = available ? Math.round((storageUsed / storageLimit) * 100) : 0;
  const color = thresholdColor(percent);

  return (
    <div className="h-full flex flex-col justify-center gap-2 p-4 bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] shadow-sm">
      <div className="flex items-center gap-1.5 text-xs" style={{ color }}>
        <DriveIcon />
        <span className="truncate">
          {available
            ? `${formatSize(storageUsed)} / ${formatSize(storageLimit)}`
            : t('home.widgets.storageUnavailable', 'Quota indisponible')}
        </span>
      </div>
      {available && (
        <>
          <div
            className="h-1.5 rounded-full overflow-hidden bg-[var(--color-background-secondary)]"
            role="progressbar"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={t('home.widgets.storageQuota', 'Quota de stockage')}
          >
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${Math.min(percent, 100)}%`, backgroundColor: color }}
            />
          </div>
          <p className="m-0 text-xs text-[var(--color-text-tertiary)]">
            {t('home.widgets.storageUsed', '{{percent}} % du stockage utilisé', { percent })}
          </p>
        </>
      )}
    </div>
  );
});

export default StorageQuotaWidget;
