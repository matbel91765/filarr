/**
 * OrgGuideSection — l'onglet « Guide » de la console d'organisation.
 *
 * ── POURQUOI UN GUIDE DANS LE PRODUIT, ET PAS UNE PAGE D'AIDE ────────────────
 *
 * Une organisation Filarr se met en place en une dizaine de gestes qui se
 * conditionnent les uns les autres : sans abonnement on n'invite personne, sans
 * membre un coffre partagé n'a pas d'objet, sans clé d'organisation la
 * récupération d'un compte perdu est impossible — et cette dernière ne se
 * rattrape PAS après coup pour les données déjà chiffrées. Un administrateur qui
 * découvre l'ordre à ses dépens perd des données ; le lui dire dans une
 * documentation qu'il lira peut-être n'est pas suffisant.
 *
 * ── CE QUI DISTINGUE CE GUIDE D'UN TEXTE ─────────────────────────────────────
 *
 * Chaque étape connaît son propre état. « Ouvrir l'essai » se coche parce que la
 * facturation le dit, pas parce que quelqu'un a cliqué sur « suivant ». Un guide
 * qui se contenterait de raconter les étapes se désynchroniserait du produit dès
 * la première ; celui-ci ne peut pas, puisqu'il lit les mêmes sources que les
 * écrans qu'il commente. Et chaque étape emmène à l'onglet qui la réalise.
 *
 * ── DEUX LECTEURS, DEUX BESOINS ──────────────────────────────────────────────
 *
 * L'administrateur veut un ordre de marche. Le membre veut savoir ce que son
 * organisation voit de lui — c'est la première question que pose quelqu'un dont
 * l'employeur installe un outil chiffré, et y répondre franchement vaut mieux
 * que de la laisser sans réponse. Les deux parcours coexistent ici, celui de
 * l'autre rôle restant consultable : un administrateur gagne à lire ce que ses
 * membres lisent, ne serait-ce que pour savoir ce qui leur a été promis.
 */

import React, { FC, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AdminSection, InfoCallout, StatusBadge } from './enterprise/AdminPrimitives';
import { Button } from '../ui/Button';
import { apiGetOrgPolicy } from '../../../services/org/orgPolicyApi';
import type { OrgBillingStatus, OrgSummary } from '../../../types/org';
import './enterprise/enterprise.css';

/** Les onglets vers lesquels une étape peut emmener. Miroir de `TabId` (OrgDashboard). */
export type GuideTarget =
  | 'overview'
  | 'members'
  | 'invitations'
  | 'audit'
  | 'sinks'
  | 'governance'
  | 'workspace'
  | 'billing'
  | 'escrow'
  | 'settings';

interface Props {
  org: OrgSummary & { role: string };
  onNavigate: (tab: GuideTarget) => void;
}

/**
 * L'état d'une étape.
 *
 * `blocked` n'est pas `todo` : il dit que l'étape est hors d'atteinte TANT QU'UNE
 * AUTRE n'est pas faite. Les confondre enverrait l'administrateur cliquer sur une
 * action qui échouera, et lui ferait croire à une panne du produit là où il n'y a
 * qu'un ordre à respecter.
 */
type StepState = 'done' | 'todo' | 'blocked';

interface Step {
  id: string;
  title: string;
  /** Ce que l'étape fait, et surtout POURQUOI elle vient à ce moment-là. */
  body: string;
  state: StepState;
  /** L'onglet qui réalise l'étape, quand il y en a un. */
  target?: GuideTarget;
  targetLabel?: string;
  /** Une conséquence irréversible ou coûteuse à rattraper. */
  warning?: string;
}

const StepMark: FC<{ state: StepState; index: number }> = ({ state, index }) => (
  <span className={`ent-step__mark ent-step__mark--${state}`} aria-hidden="true">
    {state === 'done' ? (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
        <polyline points="20 6 9 17 4 12" />
      </svg>
    ) : (
      index + 1
    )}
  </span>
);

const StepList: FC<{ steps: Step[]; onNavigate: (t: GuideTarget) => void }> = ({
  steps,
  onNavigate,
}) => {
  const { t } = useTranslation();
  return (
    <ol className="ent-steps">
      {steps.map((s, i) => (
        <li key={s.id} className={`ent-step ent-step--${s.state}`}>
          <StepMark state={s.state} index={i} />
          <div className="ent-step__body">
            <div className="ent-step__head">
              <span className="ent-step__title">{s.title}</span>
              {s.state === 'done' && (
                <StatusBadge tone="success">{t('org.guide.state.done', 'fait')}</StatusBadge>
              )}
              {s.state === 'blocked' && (
                <StatusBadge tone="neutral">
                  {t('org.guide.state.blocked', 'étape précédente requise')}
                </StatusBadge>
              )}
            </div>
            <p className="ent-step__text">{s.body}</p>
            {s.warning && (
              <p className="ent-step__warning">
                <strong>{t('org.guide.warning', 'À savoir : ')}</strong>
                {s.warning}
              </p>
            )}
            {s.target && s.state !== 'blocked' && (
              <div className="ent-step__action">
                <Button
                  variant={s.state === 'done' ? 'ghost' : 'secondary'}
                  size="sm"
                  onClick={() => onNavigate(s.target!)}
                >
                  {s.targetLabel ?? t('org.guide.goThere', 'Ouvrir')}
                </Button>
              </div>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
};

const OrgGuideSection: FC<Props> = ({ org, onNavigate }) => {
  const { t } = useTranslation();
  const isAdmin = org.role === 'owner' || org.role === 'admin';
  /** Le rôle décide du parcours OUVERT, jamais du parcours DISPONIBLE : les deux se lisent. */
  const [view, setView] = useState<'admin' | 'member'>(isAdmin ? 'admin' : 'member');
  const [billing, setBilling] = useState<OrgBillingStatus | null>(null);
  const [memberCount, setMemberCount] = useState<number | null>(null);
  const [policyVersion, setPolicyVersion] = useState<number | null>(null);

  const ipc = window.electron?.ipcRenderer;

  /**
   * L'état réel, lu aux mêmes sources que les écrans commentés.
   *
   * Tout est au MIEUX : sur le web, plusieurs de ces canaux ne sont pas portés et
   * lèvent. Un guide qui tomberait en panne parce qu'un compteur manque serait
   * pire qu'un guide dont une case reste à cocher — dans le doute, l'étape reste
   * « à faire », ce qui est faux au plus dans le sens inoffensif : on propose une
   * action déjà effectuée, on n'en cache jamais une qui reste à faire.
   */
  const load = useCallback(async () => {
    if (!ipc) return;
    try {
      const res = await ipc.invoke('org:billing:status', org.id);
      if (res?.success) setBilling(res.data ?? null);
    } catch {
      /* au mieux */
    }
    try {
      const res = await ipc.invoke('org:members:list', org.id);
      if (res?.success && Array.isArray(res.data?.members)) setMemberCount(res.data.members.length);
    } catch {
      /* au mieux */
    }
    try {
      // La politique passe par HTTP (apiClient + X-Org-Id), pas par un canal IPC :
      // c'est déjà par là que l'écran de gouvernance la lit.
      const { version } = await apiGetOrgPolicy(org.id);
      setPolicyVersion(version);
    } catch {
      /* au mieux */
    }
  }, [ipc, org.id]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * L'organisation est-elle abonnée ?
   *
   * On croit d'abord le SERVEUR (`entitled`), qui répond avec le prédicat même
   * qui garde les fonctions. Le repli local n'existe que pour un Worker plus
   * ancien, et il reproduit sciemment la règle plutôt que d'en inventer une plus
   * indulgente : mieux vaut afficher « à faire » sur une organisation en règle
   * que « fait » sur une organisation qui va se voir refuser ses invitations.
   */
  const entitled =
    billing?.entitled ??
    (billing
      ? (billing.tier === 'teams' || billing.tier === 'enterprise') &&
        billing.status === 'active' &&
        billing.billingStatus !== 'canceled' &&
        billing.billingStatus !== 'suspended'
      : false);

  const hasTeammates = (memberCount ?? 1) > 1;
  const hasPolicy = (policyVersion ?? 0) >= 1;

  const adminSteps: Step[] = useMemo(() => {
    const st = (done: boolean, blockedBy?: boolean): StepState =>
      done ? 'done' : blockedBy ? 'blocked' : 'todo';
    return [
      {
        id: 'name',
        title: t('org.guide.admin.name.title', 'Nommer votre organisation'),
        body: t(
          'org.guide.admin.name.body',
          'Le nom apparaît à vos membres, dans les invitations que vous envoyez et sur les pages de dépôt à votre marque. Vous pourrez le changer à tout moment.'
        ),
        state: 'done',
        target: 'settings',
        targetLabel: t('org.guide.admin.name.cta', 'Réglages de l’organisation'),
      },
      {
        id: 'subscribe',
        title: entitled
          ? t('org.guide.admin.subscribe.titleDone', 'Abonnement actif')
          : t('org.guide.admin.subscribe.title', 'Souscrire l’abonnement'),
        body: entitled
          ? t(
              'org.guide.admin.subscribe.bodyDone',
              'Votre organisation a accès à l’ensemble du plan : coffres d’équipe, demandes de fichiers, marque, journal d’audit, politiques et récupération par clé d’organisation.'
            )
          : t(
              'org.guide.admin.subscribe.body',
              'Tant que l’abonnement n’est pas souscrit, votre organisation existe mais ne donne accès à rien : ni invitations, ni coffres d’équipe, ni marque. C’est la première chose à faire. La facturation est au siège, avec un minimum de trois, et les lecteurs ne comptent pas.'
            ),
        state: st(entitled),
        target: 'billing',
        targetLabel: entitled
          ? t('org.guide.admin.subscribe.ctaDone', 'Voir la facturation')
          : t('org.guide.admin.subscribe.cta', 'Souscrire'),
        warning: entitled
          ? undefined
          : t(
              'org.guide.admin.subscribe.warning',
              'Résiliable à tout moment. À l’arrêt de l’abonnement, le plan se met en pause : vos données restent intactes et deviennent consultables en lecture seule. Rien n’est supprimé, et un réabonnement rend l’écriture immédiatement.'
            ),
      },
      {
        id: 'escrow',
        title: t('org.guide.admin.escrow.title', 'Créer la clé de votre organisation'),
        body: t(
          'org.guide.admin.escrow.body',
          'C’est elle qui permettra de rendre l’accès à un membre qui a perdu son mot de passe. Elle ne nous donne aucun accès à vos contenus : nous n’en détenons que des copies chiffrées, inutilisables sans les vôtres.'
        ),
        state: st(false, !entitled),
        target: 'escrow',
        targetLabel: t('org.guide.admin.escrow.cta', 'Clés et récupération'),
        warning: t(
          'org.guide.admin.escrow.warning',
          'À faire AVANT d’inviter vos membres. La récupération ne s’applique qu’aux coffres scellés après la mise en place de la clé : un coffre créé avant elle restera irrécupérable si son propriétaire perd son mot de passe.'
        ),
      },
      {
        id: 'invite',
        title: t('org.guide.admin.invite.title', 'Inviter votre équipe'),
        body: t(
          'org.guide.admin.invite.body',
          'Chaque invitation porte un rôle. Les lecteurs ne comptent pas dans votre facturation : vous pouvez en inviter autant que nécessaire. Les autres rôles occupent un siège, avec un minimum de trois.'
        ),
        state: st(hasTeammates, !entitled),
        target: 'invitations',
        targetLabel: t('org.guide.admin.invite.cta', 'Envoyer une invitation'),
      },
      {
        id: 'roles',
        title: t('org.guide.admin.roles.title', 'Comprendre les rôles'),
        body: t(
          'org.guide.admin.roles.body',
          'Propriétaire : tout, y compris la suppression de l’organisation et le transfert de propriété. Admin : membres, rôles, facturation, réglages. Admin sécurité : journal d’audit et diffusion SIEM, sans aucun pouvoir sur les membres ni la facturation. Éditeur et lecteur : aucun pouvoir d’administration, seulement l’accès aux coffres qu’on leur partage.'
        ),
        state: 'done',
        target: 'members',
        targetLabel: t('org.guide.admin.roles.cta', 'Voir les membres'),
        warning: t(
          'org.guide.admin.roles.warning',
          'Aucun rôle, pas même le vôtre, ne permet de lire les fichiers d’un membre. L’administration gouverne les accès, jamais le déchiffrement : celui-ci dépend de clés qui ne quittent pas les appareils.'
        ),
      },
      {
        id: 'policies',
        title: t('org.guide.admin.policies.title', 'Poser vos politiques'),
        body: t(
          'org.guide.admin.policies.body',
          'Durée des sessions, plages d’adresses IP autorisées, double authentification obligatoire, règles de partage, rétention. Chaque réglage indique s’il est tenu par nos serveurs ou appliqué au mieux par l’application.'
        ),
        state: st(hasPolicy, !entitled),
        target: 'governance',
        targetLabel: t('org.guide.admin.policies.cta', 'Gouvernance'),
      },
      {
        id: 'workspace',
        title: t('org.guide.admin.workspace.title', 'Régler le poste de travail'),
        body: t(
          'org.guide.admin.workspace.body',
          'Couper la place de marché, n’autoriser que certaines extensions, poser — ou imposer — un thème et une police. Le catalogue et l’installation passant par nos serveurs, un refus y est définitif.'
        ),
        state: st(false, !entitled),
        target: 'workspace',
        targetLabel: t('org.guide.admin.workspace.cta', 'Poste de travail'),
      },
      {
        id: 'audit',
        title: t('org.guide.admin.audit.title', 'Savoir ce que le journal contient'),
        body: t(
          'org.guide.admin.audit.body',
          'Connexions, changements de rôle, partages créés ou révoqués, actions d’administration. Des métadonnées uniquement : jamais le contenu d’un fichier ni le nom d’une note. Le journal est chaîné — une ligne retirée ou modifiée se voit — et s’exporte en CSV.'
        ),
        state: 'done',
        target: 'audit',
        targetLabel: t('org.guide.admin.audit.cta', 'Ouvrir le journal'),
      },
    ];
  }, [t, entitled, hasTeammates, hasPolicy]);

  const memberSteps: Step[] = useMemo(
    () => [
      {
        id: 'joined',
        title: t('org.guide.member.joined.title', 'Vous avez rejoint {{org}}', { org: org.name }),
        body: t(
          'org.guide.member.joined.body',
          'Votre compte d’organisation est distinct d’un éventuel compte personnel Filarr : ce que vous rangez ici appartient au cadre professionnel, ce que vous rangez là-bas n’en fait pas partie et n’est pas visible depuis cette organisation.'
        ),
        state: 'done',
      },
      {
        id: 'privacy',
        title: t(
          'org.guide.member.privacy.title',
          'Ce que votre organisation voit — et ne voit pas'
        ),
        body: t(
          'org.guide.member.privacy.body',
          'Elle voit des métadonnées d’administration : votre adresse e-mail, votre rôle, vos connexions, les partages que vous créez, les appareils que vous enregistrez. Elle NE VOIT PAS le contenu de vos fichiers ni de vos notes, y compris dans les coffres partagés : ils sont chiffrés sur votre appareil et personne — ni vos administrateurs, ni Filarr — ne détient de clé maîtresse permettant de les ouvrir.'
        ),
        state: 'done',
        warning: t(
          'org.guide.member.privacy.warning',
          'Une exception qui se mérite d’être connue : si votre organisation a mis en place une clé de récupération, une copie chiffrée de vos clés de coffres D’ORGANISATION lui est confiée, pour vous rendre l’accès si vous perdez votre mot de passe. Cela ne concerne jamais votre espace personnel.'
        ),
      },
      {
        id: 'vaults',
        title: t('org.guide.member.vaults.title', 'Les coffres d’équipe'),
        body: t(
          'org.guide.member.vaults.body',
          'Un coffre partagé se comporte comme un dossier : fichiers, notes, historique. La différence est invisible et tient à la clé — chaque membre reçoit sa propre copie de la clé du coffre, chiffrée pour lui seul. Retirer quelqu’un du coffre lui retire réellement la capacité de le déchiffrer.'
        ),
        state: 'done',
      },
      {
        id: 'settings',
        title: t(
          'org.guide.member.settings.title',
          'Ce que votre organisation peut régler à votre place'
        ),
        body: t(
          'org.guide.member.settings.body',
          'Elle peut imposer une durée de session, exiger la double authentification, restreindre les partages vers l’extérieur, couper la place de marché ou limiter les extensions, et poser un thème. Quand un réglage vous est imposé, l’application vous le dit à l’endroit où le choix aurait dû se trouver, plutôt que de le faire disparaître sans explication.'
        ),
        state: 'done',
      },
      {
        id: 'offline',
        title: t('org.guide.member.offline.title', 'Hors ligne'),
        body: t(
          'org.guide.member.offline.body',
          'L’application continue de fonctionner sans réseau avec les dernières règles reçues. Si votre organisation a fixé une durée maximale hors ligne et qu’elle est dépassée, l’application se verrouille jusqu’à la prochaine connexion — vos données ne sont pas perdues, seulement inaccessibles jusque-là.'
        ),
        state: 'done',
      },
      {
        id: 'leaving',
        title: t('org.guide.member.leaving.title', 'Si vous quittez l’organisation'),
        body: t(
          'org.guide.member.leaving.body',
          'Vous perdez l’accès aux coffres partagés, et votre siège est libéré pour quelqu’un d’autre. Un abonnement d’organisation n’est pas un abonnement personnel : il ne vous suit pas et ne vous est pas retiré non plus, puisqu’il ne vous a jamais appartenu.'
        ),
        state: 'done',
      },
    ],
    [t, org.name]
  );

  const steps = view === 'admin' ? adminSteps : memberSteps;
  const remaining = steps.filter((s) => s.state !== 'done').length;

  return (
    <AdminSection
      title={t('org.guide.title', 'Guide')}
      description={
        view === 'admin'
          ? t(
              'org.guide.adminDesc',
              'L’ordre de mise en place, et ce que chaque étape engage. Les étapes se cochent d’elles-mêmes à partir de l’état réel de votre organisation.'
            )
          : t(
              'org.guide.memberDesc',
              'Ce que rejoindre une organisation change pour vous, et ce que votre organisation peut — ou ne peut pas — voir.'
            )
      }
      actions={
        <div className="ent-segmented" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={view === 'admin'}
            className={`ent-segmented__btn ${view === 'admin' ? 'ent-segmented__btn--active' : ''}`}
            onClick={() => setView('admin')}
          >
            {t('org.guide.view.admin', 'Administrateur')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === 'member'}
            className={`ent-segmented__btn ${view === 'member' ? 'ent-segmented__btn--active' : ''}`}
            onClick={() => setView('member')}
          >
            {t('org.guide.view.member', 'Membre')}
          </button>
        </div>
      }
    >
      {view === 'admin' && !isAdmin && (
        <InfoCallout>
          {t(
            'org.guide.notAdmin',
            'Vous lisez le parcours d’un administrateur. Votre rôle ne vous permet pas d’effectuer ces étapes, mais savoir ce qui a été réglé pour vous en fait partie.'
          )}
        </InfoCallout>
      )}

      {view === 'admin' && remaining > 0 && (
        <InfoCallout tone="warning">
          {t(
            'org.guide.remaining',
            'Il reste {{n}} étape(s) à faire pour que votre organisation soit opérationnelle.',
            {
              n: remaining,
            }
          )}
        </InfoCallout>
      )}

      <StepList steps={steps} onNavigate={onNavigate} />

      {/* La question de confiance, posée une bonne fois et répondue sans détour —
          quel que soit le parcours affiché. C'est ce que les deux rôles viennent
          vérifier, et une réponse vague ici coûte plus cher qu'une absence. */}
      <div className="ent-guide__footer">
        <h4 className="ent-guide__footerTitle">
          {t('org.guide.zk.title', 'Ce que Filarr ne peut pas faire')}
        </h4>
        <p className="ent-guide__footerText">
          {t(
            'org.guide.zk.body',
            'Nous ne détenons aucune clé maîtresse. Vos fichiers et vos notes sont chiffrés sur vos appareils avant d’être envoyés ; nous ne stockons que des blocs illisibles et des copies de clés elles-mêmes chiffrées par vos mots de passe. Une réquisition judiciaire ne nous permettrait de remettre que cela. Ce n’est pas un engagement commercial que nous pourrions changer d’avis : c’est une propriété de l’architecture, et elle a un prix — si un membre perd son mot de passe ET sa phrase de récupération, seule la clé de récupération de votre organisation peut encore lui rendre ses coffres d’organisation. Personne d’autre ne le peut, nous compris.'
          )}
        </p>
      </div>
    </AdminSection>
  );
};

export default OrgGuideSection;
