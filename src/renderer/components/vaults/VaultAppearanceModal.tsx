/**
 * VaultAppearanceModal (F14) — choisir le signe d'un coffre, ET pour qui.
 *
 * POURQUOI PAS `FolderStyleModal` TEL QUEL. La modale des dossiers fait
 * exactement la moitié du travail (couleur + emoji, appliqués tout de suite),
 * et il lui manque la seule chose qui compte ici : la PORTÉE. Un dossier est à
 * soi ; un coffre est à plusieurs, et repeindre pour tout le monde n'est pas le
 * même geste que se poser un repère. Les deux tiennent dans la même fenêtre
 * parce que ce sont les mêmes réglages — mais la question « pour qui ? » se pose
 * AVANT, en haut, et pas en petits caractères après coup.
 *
 * L'ÉCRITURE PARTAGÉE COÛTE UNE ÉCRITURE CHIFFRÉE : elle rescelle l'enveloppe
 * entière de `name_encrypted` sous la clé de l'époque courante (donc le nom
 * repart avec). Elle est refusée quand le nom n'est pas lisible — un nom vide
 * signifie « je n'ai pas su déchiffrer », et sceller par-dessus détruirait ce
 * qu'un autre membre ouvre encore. La portée « pour moi », elle, n'écrit rien
 * au serveur : localStorage, cet appareil, ce compte.
 *
 * ON N'EFFACE PAS EN PARTANT : « Retirer » est un bouton, pas un effet de bord
 * de la fermeture. Les deux portées ont leur propre retrait, parce que retirer
 * son repère personnel et retirer la couleur de l'équipe sont deux décisions
 * différentes, et que la seconde se voit chez tout le monde.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDispatch } from 'react-redux';
import { Modal, ModalHeader, ModalBody, ModalFooter } from '../ui/Modal/Modal';
import { Button } from '../ui/Button/Button';
import { RadioGroup } from '../ui/Radio';
import { useNotification } from '../ui/Notification';
import { EmojiPicker } from '../notes/pickers/EmojiPicker';
import type { AppDispatch } from '../../../store';
import { setVaultAppearance, type VaultSummary } from '../../../store/slices/vaultsSlice';
import { errorText, vaultErrorKey } from '../../../services/vault/vaultErrorMessages';
import {
  VAULT_APPEARANCE_COLORS,
  VAULT_APPEARANCE_ICONS,
  type VaultAppearance,
  type VaultAppearanceColor,
  type VaultAppearanceIcon,
} from '../../../services/vault/vaultNameEnvelope';
import { VaultGlyph, vaultTintStyle } from './VaultGlyph';
import { useLocalVaultAppearance } from './useVaultAppearance';

type Scope = 'shared' | 'mine';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  vault: VaultSummary;
  /** Puis-je écrire l'apparence partagée ? (owner/admin — le serveur retranche.) */
  canManage: boolean;
}

export const VaultAppearanceModal: React.FC<Props> = ({ isOpen, onClose, vault, canManage }) => {
  const { t } = useTranslation();
  const dispatch = useDispatch<AppDispatch>();
  const { success, error } = useNotification();
  const { local, setLocal } = useLocalVaultAppearance(vault.id);

  /**
   * La portée par défaut est « pour moi » dès qu'on ne peut pas écrire pour
   * tout le monde — sans quoi la fenêtre s'ouvrirait sur un formulaire dont le
   * bouton est fermé, ce qui se lit comme une panne.
   */
  const [scope, setScope] = useState<Scope>(canManage ? 'shared' : 'mine');
  const [draft, setDraft] = useState<VaultAppearance>({});
  const [busy, setBusy] = useState(false);

  /**
   * REPARTIR DE CE QUI EST ENREGISTRÉ, à chaque ouverture ET à chaque
   * changement de portée : les deux portées ont leurs propres valeurs, et
   * garder le brouillon de l'une en passant à l'autre ferait recopier
   * silencieusement le choix de l'équipe dans son repère personnel (ou pire,
   * l'inverse).
   */
  const enregistre = scope === 'shared' ? vault.appearance : local;
  useEffect(() => {
    if (isOpen) setDraft(enregistre ?? {});
    // `enregistre` change quand la portée change : c'est exactement le moment
    // où le brouillon doit repartir de zéro.
  }, [isOpen, scope, enregistre]);

  const apercu = useMemo<VaultAppearance>(() => draft, [draft]);

  const setColor = (c: VaultAppearanceColor) =>
    setDraft((d) => (d.color === c ? { ...d, color: undefined } : { ...d, color: c }));
  const setIcon = (i: VaultAppearanceIcon) =>
    setDraft((d) => (d.icon === i ? { ...d, icon: undefined } : { ...d, icon: i }));

  /** Ce qu'on enregistre : `undefined` quand plus rien n'est choisi. */
  const aPoser = (a: VaultAppearance): VaultAppearance | undefined => {
    const propre: VaultAppearance = {};
    if (a.emoji) propre.emoji = a.emoji;
    if (a.color) propre.color = a.color;
    if (a.icon) propre.icon = a.icon;
    return Object.keys(propre).length > 0 ? propre : undefined;
  };

  const appliquer = async (valeur: VaultAppearance | undefined) => {
    if (scope === 'mine') {
      setLocal(valeur);
      onClose();
      return;
    }
    setBusy(true);
    try {
      await dispatch(setVaultAppearance({ vaultId: vault.id, appearance: valeur })).unwrap();
      success(t('teamVaults.appearance.saved'));
      onClose();
    } catch (e) {
      // `vault_name_unreadable` a sa propre phrase : elle dit pourquoi on refuse
      // d'écrire, là où « échec » enverrait réessayer indéfiniment.
      error(t(vaultErrorKey(errorText(e), 'teamVaults.appearance.failed')));
    } finally {
      setBusy(false);
    }
  };

  const nom = vault.name || t('teamVaults.locked');

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="md">
      <ModalHeader onClose={onClose}>{t('teamVaults.appearance.title')}</ModalHeader>
      <ModalBody>
        <div className="flex flex-col gap-5">
          {/* La portée D'ABORD : c'est elle qui change la nature du geste. */}
          <RadioGroup
            name="vault-appearance-scope"
            label={t('teamVaults.appearance.scope.label')}
            value={scope}
            onChange={(v) => setScope(v as Scope)}
            options={[
              {
                value: 'shared',
                label: t('teamVaults.appearance.scope.shared'),
                // Le serveur refuserait de toute façon ; le dire ici évite un
                // aller-retour dont le refus ne s'expliquerait pas.
                disabled: !canManage,
              },
              { value: 'mine', label: t('teamVaults.appearance.scope.mine') },
            ]}
            size="sm"
          />
          <p className="ent-hint m-0" style={{ marginTop: -12 }}>
            {scope === 'shared'
              ? t('teamVaults.appearance.scope.sharedHint')
              : t('teamVaults.appearance.scope.mineHint')}
          </p>
          {/* LA FUSION EST CHAMP PAR CHAMP, ET C'EST UN CUL-DE-SAC QU'IL FAUT
              DIRE. `resolveVaultAppearance` recouvre l'apparence de l'équipe
              valeur par valeur : un repère personnel peut REMPLACER l'emoji
              imposé, jamais le masquer, et « Retirer » en portée « pour moi »
              efface le sien — donc fait REVENIR celui de l'équipe. Tant qu'il
              n'y a pas de geste pour dire « rien, chez moi », l'écran doit au
              moins annoncer ce qu'il fera, au lieu de laisser quelqu'un
              chercher un bouton qui n'existe pas. */}
          {scope === 'mine' && vault.appearance && (
            <p className="ent-hint m-0" style={{ marginTop: -8 }}>
              {t('teamVaults.appearance.scope.mineOverTeam')}
            </p>
          )}

          {/* Aperçu — la vignette telle qu'elle sera dans les cartes. */}
          <div className="flex items-center gap-3">
            <div
              className="flex items-center justify-center w-11 h-11 rounded-xl shrink-0 bg-[var(--color-primary-50)] text-[var(--color-primary-500)]"
              style={vaultTintStyle(apercu)}
            >
              <VaultGlyph appearance={apercu} className="w-6 h-6 text-2xl" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-[var(--color-text-primary)] truncate m-0">
                {nom}
              </p>
              {/* LE MOT DU DESIGN SYSTEM, PAS UNE VALEUR PAR DÉFAUT. L'idiome
                  recopié de `FolderStyleModal` interpolait une clé `folderStyle.*`
                  qui n'existe dans AUCUNE des deux locales : i18next rendait donc
                  le repli — du français — jusque dans l'interface anglaise, et la
                  parité en/fr ne pouvait pas l'attraper puisqu'elle ne compare que
                  ce qui EST écrit. `colorPicker.preview` est le même mot au même
                  endroit, et il est traduit. */}
              <p className="text-xs text-[var(--color-text-tertiary)] m-0">
                {t('colorPicker.preview')}
              </p>
            </div>
          </div>

          {/* Couleur — la palette du design system, et RIEN d'autre : cette
              valeur finit dans du CSS rendu chez les autres membres. */}
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)] mb-2.5">
              {t('colorPicker.presetColors')}
            </div>
            <div className="flex flex-wrap items-center gap-2.5">
              {VAULT_APPEARANCE_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  /* LE MÊME LIBELLÉ QUE LE DESIGN SYSTEM (`ui/ColorPickerModal`).
                     Un code hexadécimal nu comme nom accessible se lit
                     « dièse trois b huit deux f six » : le mot qui dit CE QUE
                     c'est manquait, et c'est lui qui rend la pastille
                     annonçable. */
                  aria-label={`${t('colorPicker.color')} ${c}`}
                  aria-pressed={draft.color === c}
                  /* L'ANNEAU DE SÉLECTION EST UN `boxShadow` POSÉ SUR L'ÉTAT, pas
                     sur le focus : au clavier, la pastille survolée n'avait donc
                     AUCUNE marque — et `border-none` retire ce qui aurait pu en
                     tenir lieu. D'où un anneau de focus propre, celui des autres
                     pastilles de couleur de l'application. */
                  className="w-6 h-6 rounded-full border-none cursor-pointer transition-transform hover:scale-110
                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--color-primary-400)]"
                  style={{
                    backgroundColor: c,
                    boxShadow:
                      draft.color === c
                        ? '0 0 0 2px var(--color-surface), 0 0 0 4px var(--color-text-primary)'
                        : 'none',
                  }}
                />
              ))}
            </div>
          </div>

          {/* Icône — une liste fermée, parce qu'un nom inconnu ne dessinerait
              rien et qu'un trou se lit comme un coffre cassé. */}
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)] mb-2.5">
              {t('teamVaults.appearance.icon')}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {VAULT_APPEARANCE_ICONS.map((i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setIcon(i)}
                  aria-label={t(`teamVaults.appearance.icons.${i}`, i)}
                  title={t(`teamVaults.appearance.icons.${i}`, i)}
                  aria-pressed={draft.icon === i}
                  className={`w-9 h-9 rounded-lg flex items-center justify-center cursor-pointer bg-[var(--color-surface)]
                    ${
                      draft.icon === i
                        ? 'border-2 border-[var(--color-primary-500)]'
                        : 'border border-[var(--color-border)]'
                    }`}
                  style={draft.color ? { color: draft.color } : undefined}
                >
                  <VaultGlyph appearance={{ icon: i, color: draft.color }} className="w-5 h-5" />
                </button>
              ))}
            </div>
            <p className="ent-hint m-0 mt-2">{t('teamVaults.appearance.emojiWins')}</p>
          </div>

          {/* Emoji — le même sélecteur que les dossiers, dans une boîte bornée
              pour que la liste défile au lieu d'étirer la fenêtre. */}
          <div>
            {/* `teamVaults.appearance.emoji`, à côté de `icon` et `emojiWins` :
                une clé de la fiche, traduite des deux côtés. La valeur par
                défaut d'avant n'était pas un filet de sécurité, c'était la seule
                chose que l'écran affichait — en français, pour tout le monde. */}
            <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)] mb-2.5">
              {t('teamVaults.appearance.emoji')}
            </div>
            <div className="flex flex-col h-[220px] rounded-lg border border-[var(--color-border)] overflow-hidden bg-[var(--color-surface)]">
              <EmojiPicker
                selected={draft.emoji}
                onSelect={(e) => setDraft((d) => ({ ...d, emoji: e }))}
                onRemove={() => setDraft((d) => ({ ...d, emoji: undefined }))}
              />
            </div>
          </div>
        </div>
      </ModalBody>
      <ModalFooter>
        {/* Retirer est un GESTE, pas la fermeture de la fenêtre. */}
        {enregistre && (
          <Button variant="ghost" onClick={() => void appliquer(undefined)} disabled={busy}>
            {t('teamVaults.appearance.clear')}
          </Button>
        )}
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          {t('common.cancel')}
        </Button>
        <Button
          variant="primary"
          loading={busy}
          disabled={busy}
          onClick={() => void appliquer(aPoser(draft))}
        >
          {t('common.apply')}
        </Button>
      </ModalFooter>
    </Modal>
  );
};

export default VaultAppearanceModal;
