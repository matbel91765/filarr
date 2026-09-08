/**
 * OrgWorkspacePolicySection — l'onglet « Poste de travail » de la console
 * d'organisation.
 *
 * ── CE QUE CET ÉCRAN RÈGLE ───────────────────────────────────────────────────
 *
 * La gouvernance existante répond à « qui entre, depuis où, et pour combien de
 * temps ». Celui-ci répond à une question que les responsables informatiques
 * posent en premier et à laquelle le produit ne savait pas répondre : « une fois
 * entré, que propose l'application ? » Une place de marché d'extensions ouverte
 * sur un poste qui traite des dossiers clients est une surface d'exécution
 * tierce dans un produit vendu pour sa discrétion.
 *
 * ── LA DISTINCTION QUE CET ÉCRAN DOIT FAIRE VOIR ─────────────────────────────
 *
 * Deux réglages voisins n'ont pas du tout la même valeur, et un administrateur
 * qui les confond prendra une décision de sécurité sur une illusion :
 *
 *   · TENU PAR LE SERVEUR. Le catalogue, le téléchargement d'un paquet
 *     d'extension et la publication passent tous par le Worker. Un refus y est un
 *     refus, quel que soit l'état du poste.
 *   · APPLIQUÉ PAR L'APPLICATION, AU MIEUX. Masquer une entrée, poser un thème,
 *     refuser de charger une extension déjà installée. Un poste modifié le
 *     contourne.
 *
 * L'écran le DIT, par un bandeau et par une pastille sur chaque bloc. C'est la
 * règle anti-faux-verrou d'E9 : un interrupteur qui promet plus qu'il ne tient
 * est pire que son absence, parce qu'on cesse de chercher la vraie protection.
 *
 * ── DÉFAUT ET VERROU ─────────────────────────────────────────────────────────
 *
 * Poser un thème sans le verrouiller pose une valeur de DÉPART que le membre
 * reste libre de changer — c'est le cas courant. Le verrou, lui, retire le choix
 * de ses réglages. Les deux gestes sont séparés à l'écran, parce qu'ils ne se
 * disent pas la même chose à celui qui les subit.
 */

import React, { FC, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AdminSection, InfoCallout, StatusBadge } from './enterprise/AdminPrimitives';
import { Button } from '../ui/Button';
import { Textarea } from '../ui/Input';
import { Radio } from '../ui/Radio';
import { Toggle } from '../ui/Toggle';
import { useNotification } from '../ui/Notification';
import {
  apiGetOrgPolicy,
  apiUpdateOrgPolicy,
  OPEN_WORKSPACE_POLICY,
  ORG_FONT_IDS,
  ORG_THEME_IDS,
  type PluginPolicyMode,
  type WorkspacePolicy,
} from '../../../services/org/orgPolicyApi';
import './enterprise/enterprise.css';

interface Props {
  orgId: string;
}

const errMsg = (e: unknown, fallback: string): string =>
  (e as { response?: { data?: { error?: string } }; message?: string })?.response?.data?.error ||
  (e as { message?: string })?.message ||
  fallback;

/** Forme d'un identifiant d'extension — miroir de `SLUG_RE` côté Worker, qui refusera le reste. */
const PLUGIN_ID_RE = /^[a-z][a-z0-9-]{1,63}$/;

// ── Petits blocs d'écriture (composants du design system, jamais d'input natif) ──

const Row: FC<{
  label: string;
  desc?: string;
  /** Pastille « tenu par le serveur » vs « appliqué au mieux ». */
  enforcement: 'server' | 'client';
  children: React.ReactNode;
}> = ({ label, desc, enforcement, children }) => {
  const { t } = useTranslation();
  return (
    <div className="ent-row">
      <div className="ent-row__main">
        <div className="ent-row__label">
          <span>{label}</span>
          <StatusBadge tone={enforcement === 'server' ? 'success' : 'neutral'}>
            {enforcement === 'server'
              ? t('org.workspace.enforcedServer', 'tenu par le serveur')
              : t('org.workspace.enforcedClient', 'appliqué au mieux')}
          </StatusBadge>
        </div>
        {desc && <div className="ent-row__desc">{desc}</div>}
      </div>
      <div className="ent-row__control">{children}</div>
    </div>
  );
};

const Heading: FC<{ children: React.ReactNode }> = ({ children }) => (
  <h4 className="ent-subhead">{children}</h4>
);

const OrgWorkspacePolicySection: FC<Props> = ({ orgId }) => {
  const { t } = useTranslation();
  const { success, error: notifyError } = useNotification();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  const [saved, setSaved] = useState<WorkspacePolicy | null>(null);
  const [draft, setDraft] = useState<WorkspacePolicy | null>(null);
  /**
   * La liste blanche s'édite comme du TEXTE et ne devient un tableau qu'à
   * l'enregistrement. Convertir à chaque frappe rendrait impossible de taper une
   * virgule : l'entrée en cours disparaîtrait sous les doigts de l'administrateur.
   */
  const [allowDraft, setAllowDraft] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiGetOrgPolicy(orgId);
      // Une organisation dont la politique précède cette section n'a pas le champ :
      // on part du défaut du produit, pas d'une erreur.
      const w = res.policy.workspace ?? OPEN_WORKSPACE_POLICY;
      setSaved(w);
      setDraft(w);
      setAllowDraft(w.allowedPluginIds.join(', '));
      setVersion(res.version);
    } catch (e) {
      notifyError(errMsg(e, t('org.workspace.loadFailed', 'Impossible de charger la politique')));
    } finally {
      setLoading(false);
    }
  }, [orgId, t, notifyError]);

  useEffect(() => {
    void load();
  }, [load]);

  const set = (patch: Partial<WorkspacePolicy>) => setDraft((d) => (d ? { ...d, ...patch } : d));

  /** Le texte de la zone de liste, découpé et nettoyé — virgules ET retours à la ligne. */
  const parsedAllowlist = useMemo(
    () => [
      ...new Set(
        allowDraft
          .split(/[\s,]+/)
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean)
      ),
    ],
    [allowDraft]
  );
  const invalidIds = useMemo(
    () => parsedAllowlist.filter((id) => !PLUGIN_ID_RE.test(id)),
    [parsedAllowlist]
  );

  const candidate: WorkspacePolicy | null = draft
    ? { ...draft, allowedPluginIds: parsedAllowlist }
    : null;
  const dirty = !!candidate && !!saved && JSON.stringify(candidate) !== JSON.stringify(saved);

  /**
   * Ce que le Worker refuserait, dit ICI et tout de suite.
   *
   * Ces trois règles existent côté serveur et y sont l'autorité ; les répéter à
   * l'écran ne les rend pas plus vraies, cela évite seulement à l'administrateur
   * de découvrir son erreur par un message d'échec après avoir tout saisi.
   */
  const blocking: string | null = (() => {
    if (!candidate) return null;
    if (invalidIds.length > 0) {
      return t('org.workspace.err.badIds', 'Identifiants invalides : {{ids}}', {
        ids: invalidIds.join(', '),
      });
    }
    if (candidate.pluginPolicy === 'allowlist' && candidate.allowedPluginIds.length === 0) {
      return t(
        'org.workspace.err.emptyAllowlist',
        "Une liste blanche vide n'autorise aucune extension. Nommez-en au moins une, ou choisissez « Aucune extension » qui dit la même chose sans ambiguïté."
      );
    }
    if (candidate.themeLocked && !candidate.defaultTheme) {
      return t('org.workspace.err.themeLock', 'Choisissez un thème avant de l’imposer.');
    }
    if (candidate.fontLocked && !candidate.defaultFontId) {
      return t('org.workspace.err.fontLock', 'Choisissez une police avant de l’imposer.');
    }
    return null;
  })();

  const save = async () => {
    if (!candidate || !dirty || blocking) return;
    setBusy(true);
    try {
      // Patch d'UNE section : le serveur préserve les autres, qu'on n'envoie pas.
      const res = await apiUpdateOrgPolicy(orgId, { workspace: candidate }, version);
      const w = res.policy.workspace ?? OPEN_WORKSPACE_POLICY;
      setSaved(w);
      setDraft(w);
      setAllowDraft(w.allowedPluginIds.join(', '));
      setVersion(res.version);
      success(t('org.workspace.saved', 'Politique du poste de travail enregistrée'));
    } catch (e) {
      // Conflit de version (quelqu'un d'autre a édité) ou refus de validation :
      // on recharge pour que l'administrateur voie l'état réel avant de réessayer.
      notifyError(errMsg(e, t('org.workspace.saveFailed', 'Enregistrement impossible')));
      void load();
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setDraft(saved);
    setAllowDraft(saved?.allowedPluginIds.join(', ') ?? '');
  };

  if (loading || !draft || !candidate) {
    return (
      <AdminSection title={t('org.workspace.title', 'Poste de travail')}>
        <p className="ent-hint">{t('common.loading', '…')}</p>
      </AdminSection>
    );
  }

  const modes: { id: PluginPolicyMode; label: string; desc: string }[] = [
    {
      id: 'open',
      label: t('org.workspace.mode.open', 'Toutes les extensions'),
      desc: t('org.workspace.mode.openDesc', 'Chacun installe ce qu’il veut depuis le catalogue.'),
    },
    {
      id: 'allowlist',
      label: t('org.workspace.mode.allowlist', 'Liste d’extensions autorisées'),
      desc: t(
        'org.workspace.mode.allowlistDesc',
        'Seules les extensions que vous nommez peuvent être installées et chargées.'
      ),
    },
    {
      id: 'blocked',
      label: t('org.workspace.mode.blocked', 'Aucune extension'),
      desc: t(
        'org.workspace.mode.blockedDesc',
        'Aucune extension tierce. Celles déjà installées cessent de se charger.'
      ),
    },
  ];

  return (
    <AdminSection
      title={t('org.workspace.title', 'Poste de travail')}
      description={t(
        'org.workspace.desc',
        'Ce que l’application propose aux membres de votre organisation : place de marché, extensions, apparence.'
      )}
      actions={
        <div className="ent-actions">
          {dirty && (
            <Button variant="secondary" onClick={reset} disabled={busy}>
              {t('common.reset', 'Annuler')}
            </Button>
          )}
          <Button onClick={save} disabled={busy || !dirty || !!blocking}>
            {busy ? t('common.saving', 'Enregistrement…') : t('common.save', 'Enregistrer')}
          </Button>
        </div>
      }
    >
      {/* La distinction serveur / client, dite une fois en haut puis rappelée par
          une pastille sur chaque ligne. */}
      <InfoCallout>
        {t(
          'org.workspace.honesty',
          'Les réglages marqués « tenu par le serveur » sont appliqués par Filarr quel que soit l’état du poste : le catalogue, l’installation d’une extension et la publication passent tous par nos serveurs, et un refus y est définitif. Les réglages marqués « appliqué au mieux » sont posés par l’application elle-même — un poste modifié par un utilisateur déterminé peut les contourner. Nous préférons vous le dire plutôt que de vous laisser croire à une protection que nous ne tenons pas.'
        )}
      </InfoCallout>

      <Heading>{t('org.workspace.marketHeading', 'Place de marché')}</Heading>

      <Row
        label={t('org.workspace.marketplaceDisabled', 'Couper la place de marché')}
        desc={t(
          'org.workspace.marketplaceDisabledDesc',
          'Ni extensions ni modèles de mise en page. L’entrée disparaît de la barre latérale et le serveur refuse le catalogue.'
        )}
        enforcement="server"
      >
        <Toggle
          checked={draft.marketplaceDisabled}
          onChange={(e) => set({ marketplaceDisabled: e.target.checked })}
        />
      </Row>

      <Row
        label={t('org.workspace.layoutMarketDisabled', 'Couper le marché de modèles')}
        desc={t(
          'org.workspace.layoutMarketDisabledDesc',
          'Les modèles de mise en page seulement — les extensions restent accessibles.'
        )}
        enforcement="server"
      >
        <Toggle
          checked={draft.layoutMarketDisabled}
          disabled={draft.marketplaceDisabled}
          onChange={(e) => set({ layoutMarketDisabled: e.target.checked })}
        />
      </Row>

      <Row
        label={t('org.workspace.publishingDisabled', 'Interdire la publication')}
        desc={t(
          'org.workspace.publishingDisabledDesc',
          'Vos membres peuvent installer, mais pas publier d’extension ni de modèle sous leur compte.'
        )}
        enforcement="server"
      >
        <Toggle
          checked={draft.publishingDisabled}
          onChange={(e) => set({ publishingDisabled: e.target.checked })}
        />
      </Row>

      <Heading>{t('org.workspace.pluginsHeading', 'Extensions')}</Heading>

      <div className="ent-choices">
        {modes.map((m) => (
          <div
            key={m.id}
            className="ent-choice"
            style={{ opacity: draft.marketplaceDisabled ? 0.5 : 1 }}
          >
            <Radio
              name="pluginPolicy"
              label={m.label}
              checked={draft.pluginPolicy === m.id}
              disabled={draft.marketplaceDisabled}
              onChange={() => set({ pluginPolicy: m.id })}
            />
            {/* La description sous l'étiquette, alignée sur elle : chacun de ces
                trois modes a des conséquences différentes pour les membres, et
                l'étiquette seule ne les dit pas. */}
            <p className="ent-choice__desc">{m.desc}</p>
          </div>
        ))}
      </div>

      {draft.pluginPolicy === 'allowlist' && !draft.marketplaceDisabled && (
        <div className="ent-field">
          <div className="ent-field__label">
            {t('org.workspace.allowedIds', 'Extensions autorisées')}
          </div>
          <div className="ent-field__desc">
            {t(
              'org.workspace.allowedIdsDesc',
              'Un identifiant par ligne, ou séparés par des virgules. L’identifiant est celui qui apparaît dans l’adresse de la fiche sur la place de marché.'
            )}
          </div>
          <Textarea
            rows={4}
            value={allowDraft}
            onChange={(e) => setAllowDraft(e.target.value)}
            placeholder="acme-notes, zen-mode"
            error={invalidIds.length > 0 ? invalidIds.join(', ') : undefined}
          />
          <div className="ent-field__hint">
            {t('org.workspace.allowedIdsCount', '{{n}} extension(s) autorisée(s)', {
              n: parsedAllowlist.length,
            })}
          </div>
        </div>
      )}

      <Heading>{t('org.workspace.appearanceHeading', 'Apparence')}</Heading>

      <Row
        label={t('org.workspace.defaultTheme', 'Thème de l’organisation')}
        desc={t(
          'org.workspace.defaultThemeDesc',
          'Posé sur les postes de vos membres. Sans verrou, chacun reste libre d’en changer ensuite.'
        )}
        enforcement="client"
      >
        <select
          className="ent-select"
          value={draft.defaultTheme ?? ''}
          onChange={(e) =>
            set({
              defaultTheme: e.target.value || null,
              // Le verrou tombe avec sa valeur : le serveur refuserait l'autre état,
              // autant ne jamais laisser l'écran l'atteindre.
              themeLocked: e.target.value ? draft.themeLocked : false,
            })
          }
        >
          <option value="">{t('org.workspace.noPreference', 'Aucun (au choix du membre)')}</option>
          {ORG_THEME_IDS.map((id) => (
            <option key={id} value={id}>
              {/* Les mêmes libellés que l'écran des réglages : l'administrateur
                  choisit dans la liste que ses membres verront, avec les mots
                  qu'ils y liront. */}
              {t(`settings.theme_${id}`, id)}
            </option>
          ))}
        </select>
      </Row>

      <Row
        label={t('org.workspace.themeLocked', 'Imposer ce thème')}
        desc={t(
          'org.workspace.themeLockedDesc',
          'Le choix du thème disparaît des réglages de vos membres, avec la mention de votre organisation.'
        )}
        enforcement="client"
      >
        <Toggle
          checked={draft.themeLocked}
          disabled={!draft.defaultTheme}
          onChange={(e) => set({ themeLocked: e.target.checked })}
        />
      </Row>

      <Row
        label={t('org.workspace.defaultFont', 'Police de l’organisation')}
        desc={t(
          'org.workspace.defaultFontDesc',
          'Même principe que le thème : un défaut, ou un choix imposé.'
        )}
        enforcement="client"
      >
        <select
          className="ent-select"
          value={draft.defaultFontId ?? ''}
          onChange={(e) =>
            set({
              defaultFontId: e.target.value || null,
              fontLocked: e.target.value ? draft.fontLocked : false,
            })
          }
        >
          <option value="">{t('org.workspace.noPreference', 'Aucune (au choix du membre)')}</option>
          {ORG_FONT_IDS.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>
      </Row>

      <Row
        label={t('org.workspace.fontLocked', 'Imposer cette police')}
        desc={t(
          'org.workspace.fontLockedDesc',
          'Le choix de la police disparaît des réglages de vos membres.'
        )}
        enforcement="client"
      >
        <Toggle
          checked={draft.fontLocked}
          disabled={!draft.defaultFontId}
          onChange={(e) => set({ fontLocked: e.target.checked })}
        />
      </Row>

      {blocking && (
        <div style={{ marginTop: 'var(--spacing-3)' }}>
          <InfoCallout tone="warning">{blocking}</InfoCallout>
        </div>
      )}

      <p className="ent-hint" style={{ marginTop: 'var(--spacing-4)' }}>
        {t(
          'org.workspace.propagation',
          'Vos membres reçoivent la nouvelle politique à leur prochaine synchronisation, au plus tard quelques minutes après l’enregistrement. Une application hors ligne applique la dernière politique qu’elle a reçue.'
        )}
      </p>
    </AdminSection>
  );
};

export default OrgWorkspacePolicySection;
