/**
 * L'ATELIER DE THÈME — composer ses couleurs, et les voir tout de suite.
 *
 * ── L'APERÇU N'EST PAS UNE MAQUETTE ─────────────────────────────────────────
 *
 * Il est peint par `deriveThemeTokens`, EXACTEMENT la fonction qui peindra
 * l'application. Les jetons sont posés en variables CSS sur le conteneur de
 * l'aperçu, et les éléments qu'il contient les lisent comme n'importe quel
 * écran. Il n'y a donc aucun chemin par lequel l'aperçu pourrait montrer autre
 * chose que le résultat — ce qui est la seule façon de rendre un choix de
 * couleur honnête.
 *
 * ── ON NE PART JAMAIS D'UNE PAGE BLANCHE ────────────────────────────────────
 *
 * Devant deux sélecteurs de couleur vides, on compose un thème laid, on se dit
 * que la fonction ne marche pas, et on n'y revient plus. Les points de départ
 * ne sont donc pas une commodité : ce sont eux qui rendent la fonction
 * utilisable. Chacun est un couple (fond, accent) déjà accordé.
 *
 * ── CE QUE L'ATELIER NE DEMANDE PAS ─────────────────────────────────────────
 *
 * Ni les contours, ni les survols, ni les cinq nuances de texte, ni l'anneau de
 * focus : quarante des quarante-deux jetons se déduisent. Demander la liste
 * complète serait la façon sûre de n'obtenir aucun thème.
 */

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button, ColorPickerModal, Modal, ModalBody, ModalFooter, ModalHeader } from '../ui';
import { contrast, parseHex } from '../../../services/theme/color';
import { findAppFont } from '../../../services/platform/appFonts';
import {
  BACKDROP_MAX_BLUR,
  DEFAULT_CUSTOM_THEME,
  deriveThemeTokens,
  isDarkGround,
  type CustomThemeSpec,
  type LivingBackdrop,
  type ThemeAppearance,
} from '../../../services/theme/customTheme';
import {
  BACKDROP_MAX_BYTES,
  BackdropFailure,
  readBackdropFile,
} from '../../../services/theme/backdropImage';
import './ThemeStudio.css';

/**
 * Les points de départ.
 *
 * Volontairement PEU nombreux et franchement différents les uns des autres :
 * huit propositions qu'on distingue valent mieux que vingt variations d'un même
 * bleu, qui donnent l'impression de n'avoir aucun choix.
 */
const STARTERS: readonly { key: string; ground: string; accent: string }[] = [
  { key: 'encre', ground: '#0f1115', accent: '#87ceeb' },
  { key: 'nuit', ground: '#0a0f1e', accent: '#e2ab55' },
  { key: 'foret', ground: '#0f1d15', accent: '#6bbe7d' },
  { key: 'prune', ground: '#17101f', accent: '#c084fc' },
  { key: 'papier', ground: '#ffffff', accent: '#536878' },
  { key: 'sable', ground: '#faf6ef', accent: '#b45309' },
  { key: 'brume', ground: '#eef2f6', accent: '#2563eb' },
  { key: 'rose', ground: '#fff7f8', accent: '#be3455' },
];

type Slot = 'ground' | 'accent' | 'text';

/**
 * CE QU'UN THÈME PEUT EMPORTER EN PLUS DE SES COULEURS.
 *
 * Décrit une fois, en données : chaque entrée sait lire la valeur COURANTE de
 * l'écran et l'inscrire dans le thème. Quatre blocs de JSX auraient donné
 * quatre façons de dire « inclure », et l'un d'eux aurait fini par lire le
 * mauvais réglage.
 *
 * ── LA CASE DIT « INCLURE », PAS « ACTIVER » ────────────────────────────────
 *
 * Décochée, le champ est ABSENT du thème — « ce thème n'a pas d'avis
 * là-dessus », et l'installer ne touchera pas au réglage de la personne.
 * Cochée, la valeur ACTUELLE de l'écran est figée dans le thème. C'est la
 * distinction que `normalizeSpec` protège, et elle se voit ici.
 */
const CARRIED: readonly {
  key: keyof ThemeAppearance;
  labelKey: string;
  read: (ctx: CarriedContext) => ThemeAppearance[keyof ThemeAppearance];
  describe: (ctx: CarriedContext) => string;
}[] = [
  {
    key: 'fontId',
    labelKey: 'settings.themeStudio.carry.font',
    read: (c) => c.fontId,
    describe: (c) => findAppFont(c.fontId)?.label ?? c.fontId,
  },
  {
    key: 'accentColor',
    labelKey: 'settings.themeStudio.carry.accent',
    read: (c) => c.accentColor,
    describe: (c) => c.accentColor ?? '—',
  },
  {
    key: 'barsMode',
    labelKey: 'settings.themeStudio.carry.bars',
    read: (c) => c.barsMode,
    describe: (c) => c.barsMode,
  },
  {
    key: 'notesPanelsHover',
    labelKey: 'settings.themeStudio.carry.panels',
    read: (c) => c.notesPanelsHover,
    describe: (c) => (c.notesPanelsHover ? '✓' : '×'),
  },
  {
    key: 'animatedBackground',
    labelKey: 'settings.themeStudio.carry.animated',
    read: (c) => c.animatedBackground,
    describe: (c) => (c.animatedBackground ? '✓' : '×'),
  },
];

export interface CarriedContext {
  fontId: string;
  accentColor: string | null;
  barsMode: string;
  notesPanelsHover: boolean;
  animatedBackground: boolean;
}

/**
 * Les decors vivants proposes.
 *
 * L'ordre n'est pas alphabetique : « aucun » d'abord, puis les deux qui
 * REPONDENT au curseur, puis les deux qui vivent seuls. C'est l'ordre dans
 * lequel on les essaie quand on decouvre la fonction.
 */
const LIVING: readonly LivingBackdrop[] = ['none', 'glow', 'constellation', 'aurora', 'clock'];

export interface ThemeStudioProps {
  isOpen: boolean;
  initial: CustomThemeSpec | null;
  /** L'état COURANT de l'écran — ce que les cases proposent de figer. */
  current: CarriedContext;
  onClose: () => void;
  onApply: (spec: CustomThemeSpec) => void;
}

export const ThemeStudio: React.FC<ThemeStudioProps> = ({
  isOpen,
  initial,
  current,
  onClose,
  onApply,
}) => {
  const { t } = useTranslation();
  const [spec, setSpec] = useState<CustomThemeSpec>(initial ?? DEFAULT_CUSTOM_THEME);
  const [picking, setPicking] = useState<Slot | null>(null);
  const [backdropError, setBackdropError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const tokens = useMemo(() => deriveThemeTokens(spec), [spec]);
  const dark = isDarkGround(spec.ground);

  /**
   * Le contraste RÉELLEMENT obtenu, montré à l'utilisateur.
   *
   * Ce n'est pas de la décoration : la dérivation RAMÈNE les teintes illisibles,
   * donc la couleur appliquée n'est pas toujours celle qu'on a demandée. Sans
   * ce chiffre, la personne croit que l'atelier ignore ses choix. Avec, elle
   * comprend qu'il la protège — et sur quel fond ce n'est pas possible.
   */
  const readability = useMemo(() => {
    const bg = parseHex(tokens['--color-background']);
    const fg = parseHex(tokens['--color-text-primary']);
    return bg && fg ? contrast(fg, bg) : 0;
  }, [tokens]);

  const set = useCallback((patch: Partial<CustomThemeSpec>) => {
    setSpec((s) => ({ ...s, ...patch }));
  }, []);

  const chooseFile = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      setBackdropError(null);
      try {
        const image = await readBackdropFile(file);
        // Un décor qu'on vient de choisir s'affiche À FOND : le poser à demi
        // ferait croire qu'il n'a pas été pris. C'est l'utilisateur qui le
        // recule ensuite, s'il le veut.
        set({ backdrop: { image, opacity: 1, blur: 0 } });
      } catch (error) {
        const code = error instanceof BackdropFailure ? error.code : 'unreadable';
        setBackdropError(
          t(`settings.themeStudio.backdropError.${code}`, {
            max: Math.round(BACKDROP_MAX_BYTES / (1024 * 1024)),
          })
        );
      }
    },
    [set, t]
  );

  const swatch = (slot: Slot, value: string | null): React.ReactNode => (
    <button
      type="button"
      className="theme-studio__swatch"
      style={{ background: value ?? 'transparent' }}
      onClick={() => setPicking(slot)}
      aria-label={t(`settings.themeStudio.pick.${slot}`)}
    >
      {!value && <span className="theme-studio__swatch-auto">A</span>}
    </button>
  );

  return (
    <>
      <Modal isOpen={isOpen} onClose={onClose} size="xl">
        <ModalHeader onClose={onClose}>{t('settings.themeStudio.title')}</ModalHeader>
        <ModalBody>
          <div className="theme-studio">
            {/* ---------- Les commandes ---------- */}
            <div className="theme-studio__panel">
              <section className="theme-studio__group">
                <h3 className="theme-studio__label">{t('settings.themeStudio.starters')}</h3>
                <div className="theme-studio__starters">
                  {STARTERS.map((s) => (
                    <button
                      key={s.key}
                      type="button"
                      className={`theme-studio__starter${
                        spec.ground.toLowerCase() === s.ground ? ' is-current' : ''
                      }`}
                      onClick={() => set({ ground: s.ground, accent: s.accent, text: null })}
                      style={{ background: s.ground, borderColor: s.accent }}
                      title={t(`settings.themeStudio.starter.${s.key}`)}
                    >
                      <span style={{ background: s.accent }} />
                    </button>
                  ))}
                </div>
              </section>

              <section className="theme-studio__group">
                <h3 className="theme-studio__label">{t('settings.themeStudio.colors')}</h3>

                <div className="theme-studio__row">
                  {swatch('ground', spec.ground)}
                  <div className="theme-studio__row-text">
                    <strong>{t('settings.themeStudio.ground')}</strong>
                    <span>
                      {t(
                        dark ? 'settings.themeStudio.readsDark' : 'settings.themeStudio.readsLight'
                      )}
                    </span>
                  </div>
                  <code>{spec.ground}</code>
                </div>

                <div className="theme-studio__row">
                  {swatch('accent', spec.accent)}
                  <div className="theme-studio__row-text">
                    <strong>{t('settings.themeStudio.accent')}</strong>
                    <span>{t('settings.themeStudio.accentHelp')}</span>
                  </div>
                  <code>{spec.accent}</code>
                </div>

                <div className="theme-studio__row">
                  {swatch('text', spec.text ?? null)}
                  <div className="theme-studio__row-text">
                    <strong>{t('settings.themeStudio.text')}</strong>
                    <span>{t('settings.themeStudio.textHelp')}</span>
                  </div>
                  {spec.text ? (
                    <Button size="sm" variant="ghost" onClick={() => set({ text: null })}>
                      {t('settings.themeStudio.textAuto')}
                    </Button>
                  ) : (
                    <code>{t('settings.themeStudio.auto')}</code>
                  )}
                </div>

                {/* Le chiffre que la dérivation a réellement atteint. */}
                <p className={`theme-studio__readability${readability < 4.5 ? ' is-limited' : ''}`}>
                  {readability < 4.5
                    ? t('settings.themeStudio.readabilityLimited', {
                        ratio: readability.toFixed(1),
                      })
                    : t('settings.themeStudio.readabilityOk', { ratio: readability.toFixed(1) })}
                </p>
              </section>

              <section className="theme-studio__group">
                <h3 className="theme-studio__label">{t('settings.themeStudio.backdrop')}</h3>
                <p className="theme-studio__hint">{t('settings.themeStudio.backdropHelp')}</p>

                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/gif,image/webp,image/avif"
                  className="theme-studio__file"
                  onChange={(e) => {
                    void chooseFile(e.target.files?.[0]);
                    // Le champ est remis à zéro pour que RECHOISIR LE MÊME
                    // FICHIER déclenche encore un changement — sinon, corriger
                    // une image et la reprendre ne fait rien du tout.
                    e.target.value = '';
                  }}
                />
                <div className="theme-studio__backdrop-actions">
                  <Button size="sm" variant="secondary" onClick={() => fileRef.current?.click()}>
                    {t(
                      spec.backdrop
                        ? 'settings.themeStudio.backdropReplace'
                        : 'settings.themeStudio.backdropChoose'
                    )}
                  </Button>
                  {spec.backdrop && (
                    <Button size="sm" variant="ghost" onClick={() => set({ backdrop: null })}>
                      {t('settings.themeStudio.backdropRemove')}
                    </Button>
                  )}
                </div>
                {backdropError && <p className="theme-studio__error">{backdropError}</p>}

                {/* LE DECOR VIVANT. Il se combine avec l'image : on peut avoir
                    sa photo ET une lueur qui suit la souris. Ce sont deux
                    couches distinctes, pas un choix exclusif. */}
                <div className="theme-studio__living">
                  {LIVING.map((kind) => (
                    <button
                      key={kind}
                      type="button"
                      className={`theme-studio__living-btn${
                        (spec.living ?? 'none') === kind ? ' is-current' : ''
                      }`}
                      onClick={() => set({ living: kind })}
                    >
                      {t(`settings.themeStudio.living.${kind}`)}
                    </button>
                  ))}
                </div>
                <p className="theme-studio__hint">{t('settings.themeStudio.livingHelp')}</p>

                {spec.backdrop && (
                  <div className="theme-studio__sliders">
                    <label>
                      <span>
                        {t('settings.themeStudio.opacity')}
                        <em>{Math.round(spec.backdrop.opacity * 100)}%</em>
                      </span>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={Math.round(spec.backdrop.opacity * 100)}
                        onChange={(e) =>
                          set({
                            backdrop: spec.backdrop
                              ? { ...spec.backdrop, opacity: Number(e.target.value) / 100 }
                              : null,
                          })
                        }
                      />
                    </label>
                    <label>
                      <span>
                        {t('settings.themeStudio.blur')}
                        <em>{spec.backdrop.blur} px</em>
                      </span>
                      <input
                        type="range"
                        min={0}
                        max={BACKDROP_MAX_BLUR}
                        value={spec.backdrop.blur}
                        onChange={(e) =>
                          set({
                            backdrop: spec.backdrop
                              ? { ...spec.backdrop, blur: Number(e.target.value) }
                              : null,
                          })
                        }
                      />
                    </label>
                  </div>
                )}
              </section>

              <section className="theme-studio__group">
                <h3 className="theme-studio__label">{t('settings.themeStudio.carries')}</h3>
                <p className="theme-studio__hint">{t('settings.themeStudio.carriesHelp')}</p>
                <div className="theme-studio__carry">
                  {CARRIED.map((field) => {
                    // ⚠ `in` et non une valeur véridique : un réglage inclus ET
                    // éteint (`false`) est un choix, pas une absence.
                    const included = !!spec.appearance && field.key in spec.appearance;
                    return (
                      <label key={field.key} className="theme-studio__carry-row">
                        <input
                          type="checkbox"
                          checked={included}
                          onChange={() => {
                            const next: ThemeAppearance = { ...(spec.appearance ?? {}) };
                            if (included) delete next[field.key];
                            else {
                              (next as Record<string, unknown>)[field.key] = field.read(current);
                            }
                            set({
                              appearance: Object.keys(next).length > 0 ? next : undefined,
                            });
                          }}
                        />
                        <span>{t(field.labelKey)}</span>
                        <code>{field.describe(current)}</code>
                      </label>
                    );
                  })}
                </div>
              </section>
            </div>

            {/* ---------- L'aperçu ---------- */}
            <div className="theme-studio__preview" style={tokens as React.CSSProperties}>
              {spec.backdrop && spec.backdrop.opacity > 0 && (
                <div
                  className="theme-studio__preview-backdrop"
                  aria-hidden="true"
                  style={{
                    backgroundImage: `url("${spec.backdrop.image}")`,
                    opacity: spec.backdrop.opacity,
                    filter: spec.backdrop.blur ? `blur(${spec.backdrop.blur}px)` : undefined,
                    transform: spec.backdrop.blur
                      ? `scale(${1 + spec.backdrop.blur / 200})`
                      : undefined,
                  }}
                />
              )}
              {/* Le decor vivant dans l'apercu : MEMES classes que celles posees
                  sur la page, donc meme rendu. Les regles sont en `position:
                  fixed` ; `theme-studio__preview` les ramene dans son cadre par
                  une surcharge en `absolute` -- sinon l'apercu peindrait la
                  lueur sur tout l'ecran, par-dessus les paramtres. */}
              {(spec.living ?? 'none') !== 'none' && (
                <div
                  className={`theme-studio__preview-living filarr-living filarr-living--${spec.living}`}
                  aria-hidden="true"
                />
              )}
              <div className="theme-studio__preview-inner">
                <aside className="tsp-rail">
                  <span className="tsp-rail__item is-active">
                    {t('settings.themeStudio.demo.home')}
                  </span>
                  <span className="tsp-rail__item">{t('settings.themeStudio.demo.notes')}</span>
                  <span className="tsp-rail__item">{t('settings.themeStudio.demo.vaults')}</span>
                </aside>
                <div className="tsp-main">
                  <header className="tsp-head">
                    <h4>{t('settings.themeStudio.demo.title')}</h4>
                    <span className="tsp-btn tsp-btn--primary">
                      {t('settings.themeStudio.demo.action')}
                    </span>
                  </header>
                  <div className="tsp-card">
                    <span className="tsp-card__label">{t('settings.themeStudio.demo.label')}</span>
                    <p className="tsp-card__body">{t('settings.themeStudio.demo.body')}</p>
                    <p className="tsp-card__meta">{t('settings.themeStudio.demo.meta')}</p>
                    <a className="tsp-link">{t('settings.themeStudio.demo.link')}</a>
                  </div>
                  <div className="tsp-tiles">
                    <div className="tsp-tile">
                      <strong>128</strong>
                      <span>{t('settings.themeStudio.demo.notes')}</span>
                    </div>
                    <div className="tsp-tile">
                      <strong>12</strong>
                      <span>{t('settings.themeStudio.demo.vaults')}</span>
                    </div>
                    <div className="tsp-tile tsp-tile--muted">
                      <strong>0</strong>
                      <span>{t('settings.themeStudio.demo.disabled')}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" onClick={() => onApply(spec)}>
            {t('settings.themeStudio.apply')}
          </Button>
        </ModalFooter>
      </Modal>

      <ColorPickerModal
        isOpen={picking !== null}
        onClose={() => setPicking(null)}
        defaultColor={
          picking === 'text'
            ? (spec.text ?? tokens['--color-text-primary'])
            : picking
              ? spec[picking]
              : '#000000'
        }
        title={picking ? t(`settings.themeStudio.pick.${picking}`) : ''}
        onSubmit={(color) => {
          if (picking) set({ [picking]: color } as Partial<CustomThemeSpec>);
          setPicking(null);
        }}
      />
    </>
  );
};

export default ThemeStudio;
