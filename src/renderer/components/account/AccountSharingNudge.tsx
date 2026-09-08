/**
 * AccountSharingNudge — « ce compte est utilisé depuis plusieurs appareils ».
 *
 * Le levier 1 des garde-fous de partage de compte, et le seul qui agisse
 * vraiment : rendre le chemin légitime visible. Un compte partagé marche —
 * jusqu'au jour où quelqu'un part, où une note disparaît sans qu'on sache qui
 * l'a supprimée, ou où il faut changer le mot de passe de tout le monde d'un
 * coup. La plupart des gens qui le font ne savent pas ce qu'ils y perdent.
 *
 * ═══ CE COMPOSANT NE BLOQUE RIEN ═══
 *
 * Aucun refus, aucun décompte opposé à qui que ce soit, aucune suspicion.
 * Partager un compte reste possible : la FEK dérive du mot de passe, le serveur
 * ne voit que du chiffré, et aucun garde-fou technique n'existera jamais. Ceci
 * n'est qu'une phrase et deux boutons.
 *
 * ═══ IL SE TAIT PLUS SOUVENT QU'IL NE PARLE ═══
 *
 * Hors mode nuage, avant cinq appareils actifs, après un écartement — voir
 * `shouldShowSharingNudge`, qui porte la règle et ses contrats. Un bandeau
 * qu'on a trouvé injuste une fois n'est plus jamais lu.
 *
 * ═══ IL NE COÛTE RIEN QUAND IL SE TAIT ═══
 *
 * Une seule requête, au montage, celle que l'écran des appareils fait déjà. Pas
 * de sondage, pas de minuteur, aucune collecte nouvelle : le décompte des
 * sessions vivantes existe déjà côté serveur.
 */

import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import type { RootState } from '../../../store';
import * as authApi from '../../../services/auth/authApi';
import {
  shouldShowSharingNudge,
  type NudgeDismissal,
} from '../../../services/features/accountSharingNudge';
import { SharedVaultComparison } from './SharedVaultComparison';

/** Où l'écartement est mémorisé. Par appareil : c'est une préférence d'affichage. */
const DISMISS_KEY = 'filarr.sharingNudge.dismissedAtCount';

function readDismissal(): NudgeDismissal | null {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? { atCount: n } : null;
  } catch {
    // Stockage indisponible (navigation privée, politique du navigateur) : on
    // n'a alors aucune mémoire, et le bandeau se comporte comme au premier jour.
    return null;
  }
}

export const AccountSharingNudge: React.FC = () => {
  const { t } = useTranslation();
  const accountMode = useSelector((s: RootState) => s.auth.accountMode);
  const [activeCount, setActiveCount] = useState(0);
  const [dismissal, setDismissal] = useState<NudgeDismissal | null>(() => readDismissal());
  /** Le comparatif : c'est lui qui dit ce qu'un compte partagé coûte. */
  const [comparerOuvert, setComparerOuvert] = useState(false);

  useEffect(() => {
    // Un compte local n'a ni sessions ni appareils : il n'y a rien à dire.
    if (accountMode !== 'cloud') return;
    let annule = false;
    authApi
      .getDevices()
      .then((res) => {
        if (annule) return;
        const data = res.data as { activeCount?: number } | undefined;
        if (res.success && typeof data?.activeCount === 'number') setActiveCount(data.activeCount);
      })
      .catch(() => {
        /* réseau : on ne dit rien plutôt que de dire quelque chose de faux */
      });
    return () => {
      annule = true;
    };
  }, [accountMode]);

  if (accountMode !== 'cloud') return null;
  if (!shouldShowSharingNudge({ activeCount, dismissal })) return null;

  const ecarter = (): void => {
    try {
      localStorage.setItem(DISMISS_KEY, String(activeCount));
    } catch {
      /* sans mémoire, il reviendra au prochain montage — acceptable */
    }
    setDismissal({ atCount: activeCount });
  };

  return (
    <div
      role="status"
      className="flex items-start gap-3 p-3 rounded-lg mx-4 mt-3"
      style={{
        backgroundColor: 'var(--color-background-secondary)',
        border: '1px solid color-mix(in srgb, var(--color-info-500) 28%, transparent)',
      }}
    >
      <div
        className="flex items-center justify-center shrink-0 rounded-lg"
        style={{
          width: 34,
          height: 34,
          backgroundColor: 'color-mix(in srgb, var(--color-info-500) 12%, transparent)',
          color: 'var(--color-info-on-background)',
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
          <path d="M16 19a4 4 0 0 0-8 0" />
          <circle cx="12" cy="10" r="3" />
          <path d="M20.5 18a6.5 6.5 0 0 0-3.2-4.4M3.5 18a6.5 6.5 0 0 1 3.2-4.4" />
        </svg>
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
          {t('account.sharingNudge.title', 'Ce compte est utilisé depuis {{count}} appareils', {
            count: activeCount,
          })}
        </p>
        <p
          className="text-sm mt-1"
          style={{ color: 'var(--color-text-secondary)', lineHeight: 1.6 }}
        >
          {t(
            'account.sharingNudge.body',
            "Si vous travaillez à plusieurs, un coffre partagé donne à chacun son accès : on voit qui a écrit quoi, on retire quelqu'un sans changer le mot de passe de tout le monde, et personne ne se fait déconnecter."
          )}
        </p>
      </div>

      {/*
        LE BANDEAU DOIT MENER QUELQUE PART. Sans ce bouton il énonçait un
        constat et s'arrêtait là — or ce qui manque à quelqu'un qui partage un
        compte, ce n'est pas de savoir qu'il le fait, c'est de savoir ce que ça
        lui coûte.
      */}
      <button
        type="button"
        onClick={() => setComparerOuvert(true)}
        className="shrink-0 self-start px-3 rounded-lg text-white"
        style={{
          minHeight: 32,
          border: 'none',
          backgroundColor: 'var(--color-primary-600)',
          fontSize: 13,
          fontWeight: 500,
          cursor: 'pointer',
          whiteSpace: 'nowrap',
        }}
      >
        {t('account.sharingNudge.compare', 'Comparer')}
      </button>

      <SharedVaultComparison isOpen={comparerOuvert} onClose={() => setComparerOuvert(false)} />

      <button
        type="button"
        onClick={ecarter}
        aria-label={t('common.dismiss', 'Masquer')}
        className="shrink-0 flex items-center justify-center rounded-lg"
        style={{
          width: 28,
          height: 28,
          border: 'none',
          background: 'transparent',
          color: 'var(--color-text-tertiary)',
          cursor: 'pointer',
        }}
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        >
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
};

export default AccountSharingNudge;
