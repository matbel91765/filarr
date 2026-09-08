/**
 * MySecurityCard (F15) — « Vous », en tête de l'onglet Membres.
 *
 * LA CÉRÉMONIE ÉTAIT À MOITIÉ IMPOSSIBLE. `KeyVerification` montre à l'hôte
 * l'empreinte de son invité et lui demande de la comparer « par un autre
 * canal » — au téléphone, de vive voix. Seulement, aucun écran ne donnait à
 * l'invité SA propre empreinte : on demandait donc une comparaison que l'autre
 * bout ne pouvait pas faire, ce qui la réduit à un « oui » de politesse. Cette
 * carte est l'autre moitié : mon numéro, lisible, copiable, et affichable en
 * grand pour être lu à voix haute par blocs.
 *
 * ELLE AJOUTE UNE VÉRIFICATION QUE PERSONNE NE FAISAIT. Le serveur est un
 * courtier de clés publiques ; rien ne vérifiait que celle qu'il publie SOUS MON
 * NOM est bien la mienne. Une substitution ne se voyait que chez le pair (qui
 * verrait « la clé a changé » sans comprendre pourquoi), jamais chez la victime.
 * On compare donc ici la clé publiée à celle de cet appareil, et le verdict
 * `not_mine` est le plus grave après une chaîne falsifiée. Les verdicts sont
 * dans `mySecurityModel`, éprouvés ; ce fichier ne fait que lire et rendre.
 *
 * TROIS LECTURES, AUCUNE CRITIQUE. Clé publiée + journal (transparence),
 * scellés du coffre (ce que cet appareil peut ouvrir), clé de custody du compte.
 * Chacune peut échouer sans emporter les autres, et aucune absence ne se rend en
 * « tout va bien » : « on n'a pas su lire » est un état à part entière, et
 * l'état de la custody, lui, DISPARAÎT quand on l'ignore plutôt que d'annoncer
 * « aucune » à quelqu'un qui en a une.
 *
 * RIEN ICI N'EST SECRET. Une empreinte est un condensé de clé PUBLIQUE ; c'est
 * précisément ce qu'on est censé lire à voix haute.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Button, Modal } from '../../ui';
import { useNotification } from '../../ui/Notification';
import { StatusBadge, type BadgeTone } from '../../settings/enterprise/AdminPrimitives';
import { formatFingerprint } from '../../../utils/formatFingerprint';
import { getOwnPublicKey } from '../../../../services/auth/userKeypair';
import { verifyKeyLogChain } from '../../../../services/vault/keyTransparency';
import { isVaultUnlocked } from '../../../../services/vault/vaultKeyCache';
import {
  apiGetKeyLog,
  apiGetMemberPublicKey,
  apiGetVaultKeyWraps,
} from '../../../../services/vault/vaultApi';
import {
  custodyState,
  epochCoverage,
  fingerprintToShow,
  myKeyVerdict,
  summarizeMissingEpochs,
  type CustodyState,
  type EpochCoverage,
  type MyKeyVerdict,
  type PublishedKey,
} from './mySecurityModel';

interface Props {
  vaultId: string;
  /** Mon identifiant de compte cloud — sans lui, la carte n'a rien à dire. */
  myUserId: string | null;
  /** L'époque courante du coffre, telle que le résumé la connaît. */
  currentKeyEpoch: number;
}

/** Le ton de chaque verdict — aucun n'est neutre par défaut. */
const VERDICT_TONE: Record<MyKeyVerdict, BadgeTone> = {
  ok: 'success',
  not_mine: 'error',
  served_not_latest: 'error',
  tampered_log: 'error',
  no_log: 'info',
  no_local_key: 'warning',
  unavailable: 'warning',
};

const ShieldIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    <path d="m9 12 2 2 4-4" />
  </svg>
);

export const MySecurityCard: React.FC<Props> = ({ vaultId, myUserId, currentKeyEpoch }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { info } = useNotification();

  const [localFingerprint, setLocalFingerprint] = useState<string | null>(null);
  const [served, setServed] = useState<PublishedKey | null>(null);
  const [chain, setChain] = useState<{ valid: boolean; latest: PublishedKey | null } | null>(null);
  const [coverage, setCoverage] = useState<EpochCoverage | null>(null);
  const [custody, setCustody] = useState<CustodyState>('unknown');
  const [zoom, setZoom] = useState(false);

  /**
   * LA CLÉ DE CET APPAREIL, PUIS CELLE DU SERVEUR — dans cet ordre, parce que la
   * seconde n'a de sens que confrontée à la première. `getOwnPublicKey` rend
   * `null` quand la paire n'est pas chargée (session verrouillée) : ce n'est pas
   * une panne, c'est l'état `no_local_key`.
   */
  useEffect(() => {
    if (!myUserId) return () => {};
    let vivant = true;
    void (async () => {
      try {
        const mine = await getOwnPublicKey();
        if (vivant) setLocalFingerprint(mine?.fingerprint ?? null);
      } catch {
        if (vivant) setLocalFingerprint(null);
      }
      try {
        const pub = await apiGetMemberPublicKey(myUserId);
        if (!vivant) return;
        setServed({ encPublicKey: pub.encPublicKey, fingerprint: pub.fingerprint });
        const entries = await apiGetKeyLog(myUserId);
        const v = await verifyKeyLogChain(myUserId, entries);
        if (!vivant) return;
        setChain({
          valid: v.valid,
          latest: v.latest
            ? { encPublicKey: v.latest.encPublicKey, fingerprint: v.latest.fingerprint }
            : null,
        });
      } catch {
        // `apiGetKeyLog` LÈVE sur une enveloppe malformée plutôt que de rendre
        // un journal vide : c'est délibéré, et ce catch garde donc l'état
        // « on n'a pas su lire », jamais « ce compte n'a pas de journal ».
        if (vivant) setChain(null);
      }
    })();
    return () => {
      vivant = false;
    };
  }, [myUserId]);

  /**
   * Ce que CET appareil sait ouvrir de CE coffre. Le serveur dit pour quelles
   * époques il me garde un scellé ; le cache mémoire dit lesquelles sont déjà
   * ouvertes. Les deux sont distincts à l'écran : une époque scellée s'ouvre
   * quand on en a besoin, une époque MANQUANTE ne s'ouvrira jamais.
   */
  useEffect(() => {
    // Rien à décrire sans identité de compte : la carte rend `null` plus bas, et
    // une lecture partie pour un écran qui ne s'affichera pas est une requête
    // pour rien (le `return null` est APRÈS les hooks, comme la règle l'exige).
    if (!myUserId) return () => {};
    let vivant = true;
    void (async () => {
      try {
        const wraps = await apiGetVaultKeyWraps(vaultId);
        if (!vivant) return;
        setCoverage(
          epochCoverage({
            wraps: wraps.map((w) => w.epoch),
            currentKeyEpoch,
            // `isVaultUnlocked`, pas `getVaultKey(...) !== null` : la seconde
            // fait passer la matière de K_vault (un Uint8Array vivant) par une
            // fermeture pour en tirer un booléen. Une manipulation de secret en
            // moins, pour exactement le même verdict.
            unlocked: (epoch) => isVaultUnlocked(vaultId, epoch),
          })
        );
      } catch {
        // On n'affirme rien : la section disparaît plutôt que d'annoncer
        // « aucune époque ouvrable », qui se lirait comme un coffre perdu.
        if (vivant) setCoverage(null);
      }
    })();
    return () => {
      vivant = false;
    };
  }, [vaultId, currentKeyEpoch, myUserId]);

  /**
   * La custody du compte. Le canal existe sur le bureau ET sur le web (il est
   * routé vers l'API) — mais on ne SUPPOSE rien : toute réponse qui n'est pas un
   * succès franc laisse l'état `unknown`, qui ne s'affiche pas du tout. Annoncer
   * « aucune clé de récupération » sur une panne enverrait configurer ce qui
   * existe déjà.
   */
  useEffect(() => {
    // Même garde que les deux autres : sans « vous », il n'y a pas de carte.
    if (!myUserId) return () => {};
    let vivant = true;
    void (async () => {
      try {
        const res = await window.electron?.ipcRenderer?.invoke('share:custodyKey');
        if (vivant) setCustody(custodyState(res as { success?: boolean; data?: string | null }));
      } catch {
        if (vivant) setCustody('unknown');
      }
    })();
    return () => {
      vivant = false;
    };
  }, [myUserId]);

  const verdict = useMemo(
    () => myKeyVerdict({ localFingerprint, served, chain }),
    [localFingerprint, served, chain]
  );
  const shown = useMemo(
    () => fingerprintToShow({ localFingerprint, served }),
    [localFingerprint, served]
  );

  const copy = useCallback(async () => {
    if (!shown) return;
    try {
      await navigator.clipboard.writeText(formatFingerprint(shown.value));
      info(t('common.copied', 'Copied'));
    } catch {
      /* presse-papiers indisponible : le numéro reste lisible à l'écran */
    }
  }, [shown, info, t]);

  // Sans identité de compte, il n'y a pas de « vous » à décrire.
  if (!myUserId) return null;

  return (
    <div className="ent-card">
      <p className="ent-card__title">
        <span
          aria-hidden="true"
          style={{ display: 'inline-flex', width: 16, height: 16, marginRight: 6 }}
        >
          <ShieldIcon />
        </span>
        {t('teamVaults.settings.mine.title')}
      </p>
      <p className="ent-card__hint">{t('teamVaults.settings.mine.hint')}</p>

      {shown ? (
        <>
          <p className="text-[10px] uppercase tracking-wide text-[var(--color-text-tertiary)] m-0 mb-1">
            {t(`teamVaults.settings.mine.source.${shown.source}`)}
          </p>
          <div
            className="ent-mono"
            style={{ fontSize: 13, letterSpacing: '0.06em', wordBreak: 'break-word' }}
          >
            {formatFingerprint(shown.value)}
          </div>
          <div
            className="flex flex-wrap items-center gap-2"
            style={{ marginTop: 'var(--spacing-2)' }}
          >
            <StatusBadge tone={VERDICT_TONE[verdict]} dot>
              {t(`teamVaults.settings.mine.status.${verdict}`)}
            </StatusBadge>
            <Button variant="ghost" size="sm" onClick={() => void copy()}>
              {t('teamVaults.settings.mine.copy')}
            </Button>
            {/* « En grand » n'est pas un confort : on lit ce numéro à voix haute,
                et un bloc de quatre caractères se dicte sans se perdre. */}
            <Button variant="ghost" size="sm" onClick={() => setZoom(true)}>
              {t('teamVaults.settings.mine.enlarge')}
            </Button>
          </div>
        </>
      ) : (
        <p className="ent-hint m-0">{t('teamVaults.settings.mine.status.unavailable')}</p>
      )}

      {/* CE QUE CET APPAREIL SAIT OUVRIR. Une époque manquante est nommée : les
          éléments scellés sous cette clé-là me resteront fermés, et le taire
          ferait croire à un coffre entièrement lisible. */}
      {coverage && coverage.totalEpochs > 0 && (
        <div style={{ marginTop: 'var(--spacing-3)' }}>
          <p className="text-xs text-[var(--color-text-secondary)] m-0">
            {/* LES COMPTES, PAS LA TAILLE DE LA FENÊTRE. `rows` est borné —
                son plafond vient du serveur, et une ligne par époque le
                laisserait geler la fenêtre. Ces deux nombres-là se calculent :
                ils restent exacts quand la liste, elle, s'arrête. */}
            {t('teamVaults.settings.mine.epochs', {
              sealed: coverage.sealedCount,
              total: coverage.totalEpochs,
            })}
          </p>
          <p className="ent-hint m-0">
            {t('teamVaults.settings.mine.epochsOpen', { count: coverage.unlockedCount })}
          </p>
          {/* L'ÉNUMÉRATION EST BORNÉE, LE COMPTE NE L'EST PAS. Un coffre
              longuement tourné dont cet appareil n'a que le dernier scellé
              alignait deux cents nombres, et la phrase qui dit ce que ça coûte
              (« les éléments chiffrés avec elles vous restent fermés ») se
              perdait derrière. On nomme les premières et on ANNONCE le reste :
              élider sans le dire serait la même faute, en plus discret. */}
          {coverage.missingCount > 0 &&
            (() => {
              // Le compte EXACT est passé à part : la liste reçue est elle-même
              // déjà bornée, et le reste annoncé doit être celui du coffre, pas
              // celui de la fenêtre.
              const resume = summarizeMissingEpochs(
                coverage.missing,
                undefined,
                coverage.missingCount
              );
              const liste = resume.shown.join(', ');
              return (
                <p className="ent-hint m-0" style={{ marginTop: 2 }}>
                  {t('teamVaults.settings.mine.epochsMissing', {
                    count: coverage.missingCount,
                    epochs:
                      resume.rest > 0
                        ? t('teamVaults.settings.mine.epochsMore', {
                            epochs: liste,
                            count: resume.rest,
                          })
                        : liste,
                  })}
                </p>
              );
            })()}
        </div>
      )}

      {/* La custody : dite seulement quand on la connaît (voir l'effet). */}
      {custody !== 'unknown' && (
        <p className="ent-hint m-0" style={{ marginTop: 'var(--spacing-2)' }}>
          {t(`teamVaults.settings.mine.custody.${custody}`)}
        </p>
      )}

      <div style={{ marginTop: 'var(--spacing-3)' }}>
        <Button variant="secondary" size="sm" onClick={() => navigate('/settings?cat=securite')}>
          {t('teamVaults.settings.mine.securitySettings')}
        </Button>
      </div>

      <Modal
        isOpen={zoom}
        onClose={() => setZoom(false)}
        title={t('teamVaults.settings.mine.zoomTitle')}
        size="lg"
      >
        <div style={{ padding: 'var(--spacing-4)' }}>
          <p className="text-sm text-[var(--color-text-secondary)] m-0 mb-3">
            {t('teamVaults.settings.mine.zoomHint')}
          </p>
          {/* Les blocs sont des ÉLÉMENTS séparés, pas une longue chaîne : on les
              dicte un par un, et l'œil retrouve sa place entre deux blocs. */}
          <div className="flex flex-wrap gap-2">
            {(shown ? formatFingerprint(shown.value).split(' ') : []).map((bloc, i) => (
              <span
                key={`${bloc}-${i}`}
                className="ent-mono"
                style={{
                  fontSize: 22,
                  letterSpacing: '0.12em',
                  padding: '4px 10px',
                  borderRadius: 6,
                  background: 'var(--color-background-secondary)',
                }}
              >
                {bloc}
              </span>
            ))}
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default MySecurityCard;
