/**
 * OrgCoverageNotice — « votre organisation ne vous couvre plus ».
 *
 * QUATRE CONSÉQUENCES, AU MÊME ENDROIT, UNE FOIS. Quitter (ou être retiré d')
 * une organisation Teams fait quatre choses d'un coup côté serveur : l'accès à
 * ses coffres est coupé sur-le-champ, le palier effectif retombe sur le
 * personnel (le compte peut se retrouver AU-DESSUS de son quota — rien n'est
 * supprimé, seuls les nouveaux envois sont refusés), le plafond d'appareils
 * peut baisser sans fermer les sessions vivantes, et la copie de récupération
 * que l'organisation gardait de ses clés est purgée. Sans cet écran, la
 * personne l'apprenait par un 413 muet, quelques jours plus tard.
 *
 * ═══ IL SE TAIT PRESQUE TOUJOURS ═══
 *
 * Il ne parle QUE sur la transition couvert → plus couvert, telle que cet
 * appareil l'a vue passer (`coverageTransition`). Un premier montage retient
 * et ne dit rien ; un compte jamais couvert ne verra jamais cet écran.
 *
 * ═══ IL NE COÛTE RIEN ═══
 *
 * Une requête au montage et au retour au premier plan — celle que l'écran
 * d'abonnement fait déjà. Aucune collecte nouvelle.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import type { RootState } from '../../../store';
import {
  coverageVerdict,
  fetchOrgCoverage,
  memoryOf,
  publishOrgCoverage,
  readLastCoverage,
  writeLastCoverage,
  type CoverageVerdict,
  type OrgCoverage,
} from '../../../services/account/orgCoverage';

export const OrgCoverageNotice: React.FC = () => {
  const { t } = useTranslation();
  const accountMode = useSelector((s: RootState) => s.auth.accountMode);
  const userId = useSelector((s: RootState) => s.auth.cloudUser?.id ?? null);
  const [perdu, setPerdu] = useState<{
    uid: string;
    verdict: Extract<CoverageVerdict, { kind: 'lost' }>;
    coverage: OrgCoverage;
  } | null>(null);

  const verifier = useCallback(async (uid: string): Promise<void> => {
    const c = await fetchOrgCoverage();
    if (!c) return; // hors ligne : on ne dit rien plutôt que quelque chose de faux
    // Les écrans qui décident d'après le palier (partage, dossiers actifs,
    // badge du compte) lisent le palier EFFECTIF ici — une seule lecture.
    publishOrgCoverage(c);
    const verdict = coverageVerdict(readLastCoverage(uid), c);
    if (verdict.kind === 'lost') {
      // On ne retient PAS encore le nouvel état : c'est le geste « J'ai compris »
      // qui le fait. Un rechargement avant ce geste remontre l'écran, et c'est
      // voulu — un écran fermé par un rechargement n'a pas été lu.
      setPerdu({ uid, verdict, coverage: c });
      return;
    }
    writeLastCoverage(uid, memoryOf(c));
  }, []);

  useEffect(() => {
    if (accountMode !== 'cloud' || !userId) return undefined;
    let annule = false;
    const lancer = () => {
      if (!annule) void verifier(userId);
    };
    lancer();
    const auReveil = () => {
      if (document.visibilityState === 'visible') lancer();
    };
    document.addEventListener('visibilitychange', auReveil);
    return () => {
      annule = true;
      document.removeEventListener('visibilitychange', auReveil);
    };
  }, [accountMode, userId, verifier]);

  if (accountMode !== 'cloud' || !userId || perdu?.uid !== userId) return null;

  const compris = (): void => {
    writeLastCoverage(userId, memoryOf(perdu.coverage));
    setPerdu(null);
  };

  /**
   * CHAQUE LIGNE N'EST DITE QUE SI ELLE A EU LIEU. Les coffres, toujours — mais
   * coupés (retiré) ou en lecture seule (l'organisation ne paie plus) ; le
   * quota et les appareils seulement s'ils ont baissé ; la récupération
   * seulement si la copie a bien été purgée, c'est-à-dire au retrait.
   */
  const { verdict } = perdu;
  const points: string[] = [verdict.reason === 'removed' ? 'vaultsRemoved' : 'vaultsLapsed'];
  if (verdict.quotaDropped) points.push('quota');
  if (verdict.rankDropped) points.push('devices');
  if (verdict.reason === 'removed') points.push('recovery');
  const body = verdict.reason === 'removed' ? 'bodyRemoved' : 'bodyLapsed';

  return (
    <div
      role="status"
      className="flex items-start gap-3 p-3 rounded-lg mx-4 mt-3"
      style={{
        backgroundColor: 'var(--color-background-secondary)',
        border: '1px solid color-mix(in srgb, var(--color-warning-500) 35%, transparent)',
      }}
    >
      <div
        className="flex items-center justify-center shrink-0 rounded-lg"
        style={{
          width: 34,
          height: 34,
          backgroundColor: 'color-mix(in srgb, var(--color-warning-500) 14%, transparent)',
          color: 'var(--color-warning-700)',
        }}
        aria-hidden="true"
      >
        <svg
          width="19"
          height="19"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6" />
          <path d="M16 3l5 5" />
        </svg>
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold m-0" style={{ color: 'var(--color-text-primary)' }}>
          {t('account.orgCoverage.title')}
        </p>
        <p
          className="text-sm mt-1 m-0"
          style={{ color: 'var(--color-text-secondary)', lineHeight: 1.6 }}
        >
          {t(`account.orgCoverage.${body}`)}
        </p>
        <ul
          className="text-sm mt-2 mb-0 pl-5"
          style={{ color: 'var(--color-text-secondary)', lineHeight: 1.6 }}
        >
          {points.map((p) => (
            <li key={p}>{t(`account.orgCoverage.${p}`)}</li>
          ))}
        </ul>
      </div>

      <button
        type="button"
        onClick={compris}
        className="shrink-0 self-start px-3 rounded-lg text-white border-none cursor-pointer"
        style={{ minHeight: 32, backgroundColor: 'var(--color-primary-500)' }}
      >
        {t('account.orgCoverage.dismiss')}
      </button>
    </div>
  );
};

export default OrgCoverageNotice;
