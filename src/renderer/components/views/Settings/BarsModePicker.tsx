/**
 * BarsModePicker
 *
 * Sélecteur du réglage « Affichage des barres » : une vignette par mode,
 * dessinée en divs avec les TOKENS du thème courant (aucun hex figé), pour
 * que l'utilisateur VOIE ce que chaque mode retire avant de le choisir.
 *
 * Accessibilité : role=radiogroup + role=radio, tabindex mouvant (seule
 * l'option cochée est dans l'ordre de tabulation), flèches/Début/Fin pour
 * naviguer — la sélection suit le focus, comme un groupe de radios natif.
 *
 * Le rendu reprend volontairement les classes du sélecteur de thèmes de
 * Settings (cadre 2px, --color-selected, pastille de coche) : ce sont deux
 * grilles de vignettes voisines dans la même page.
 */

import React, { useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useDispatch, useSelector } from 'react-redux';
import { BARS_MODES, setBarsMode } from '../../../../store/slices/uiSlice';
import type { BarsMode } from '../../../../store/slices/uiSlice';
import { selectBarsMode } from '../../../../store/selectors/uiSelectors';

const FRAME_HEIGHT = 64;
const HEADER_BAND_HEIGHT = 14;
const TAB_BAND_HEIGHT = 11;

/** Traits gris dérivés de la couleur de texte : lisibles sur tous les thèmes. */
const inkStyle = (opacity: number): React.CSSProperties => ({
  background: 'var(--color-text-tertiary)',
  opacity,
});

const CheckIcon: React.FC = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
    <polyline points="20 6 9 17 4 12" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** Bande du haut : pilule de recherche + rond de profil. */
const HeaderBand: React.FC = () => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: 3,
      height: HEADER_BAND_HEIGHT,
      flexShrink: 0,
      padding: '0 4px',
      background: 'var(--color-surface)',
      borderBottom: '1px solid var(--color-border-light)',
    }}
  >
    <div style={{ width: 5, height: 5, borderRadius: 1, ...inkStyle(0.45) }} />
    <div style={{ flex: 1, height: 6, borderRadius: 999, ...inkStyle(0.22) }} />
    <div
      style={{ width: 6, height: 6, borderRadius: 999, background: 'var(--color-primary-500)' }}
    />
  </div>
);

/*
 * Mode « flottante » : la même barre, en pilule détachée et centrée — et la
 * surface de la page qui monte jusqu'au bord haut de part et d'autre, en
 * s'écartant en courbe autour d'elle (« l'étagère », cf. Layout.css).
 *
 * La vignette REJOUE la construction, elle ne l'imite pas : chaque moitié
 * d'étagère est un rectangle dans lequel un disque de rayon la demi-hauteur de
 * bande est évidé sur son bord intérieur. Ce disque a le même centre que
 * l'extrémité de la pilule, donc le fossé y vaut exactement FLOAT_GAP, en
 * ligne droite comme dans la courbe. Une vignette dessinée « à peu près »
 * mentirait sur le seul détail que ce mode a de particulier.
 */
const FLOAT_GAP = 4;
const FLOAT_BAND = HEADER_BAND_HEIGHT + 2 * FLOAT_GAP;
const FLOAT_COVE = FLOAT_BAND / 2;
/** La pilule est bornée en largeur dans l'app : il reste de l'étagère de chaque côté. */
const FLOAT_PILL = '62%';
const FLOAT_NOTCH = `calc(${FLOAT_PILL} + ${2 * FLOAT_GAP}px)`;

/** Le bord intérieur de chaque moitié, au-delà du trou d'une anse. */
const FLOAT_INNER_EDGE = `calc(50% + ${FLOAT_NOTCH} / 2 - ${FLOAT_COVE}px)`;
const coveMask = (at: string): string =>
  `radial-gradient(circle ${FLOAT_COVE}px at ${at} 50%, transparent 99%, #000 100%)`;

const SHELF_BASE: React.CSSProperties = {
  position: 'absolute',
  top: 0,
  bottom: 0,
  background: 'var(--color-surface)',
};

const SHELF_LEFT: React.CSSProperties = {
  ...SHELF_BASE,
  left: 0,
  right: FLOAT_INNER_EDGE,
  WebkitMaskImage: coveMask('100%'),
  maskImage: coveMask('100%'),
};

const SHELF_RIGHT: React.CSSProperties = {
  ...SHELF_BASE,
  right: 0,
  left: FLOAT_INNER_EDGE,
  WebkitMaskImage: coveMask('0'),
  maskImage: coveMask('0'),
};

const FloatingBand: React.FC = () => (
  <div
    style={{
      position: 'relative',
      display: 'flex',
      justifyContent: 'center',
      flexShrink: 0,
      padding: `${FLOAT_GAP}px 0`,
    }}
  >
    <span style={SHELF_LEFT} />
    <span style={SHELF_RIGHT} />
    <div
      style={{
        position: 'relative',
        zIndex: 1,
        display: 'flex',
        alignItems: 'center',
        gap: 3,
        width: FLOAT_PILL,
        height: HEADER_BAND_HEIGHT,
        padding: '0 4px',
        borderRadius: 999,
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        boxShadow: 'var(--shadow-sm)',
      }}
    >
      <div style={{ width: 4, height: 4, borderRadius: 1, ...inkStyle(0.45) }} />
      <div style={{ flex: 1, height: 5, borderRadius: 999, ...inkStyle(0.22) }} />
      <div
        style={{ width: 5, height: 5, borderRadius: 999, background: 'var(--color-primary-500)' }}
      />
    </div>
  </div>
);

/** Mode « rail » : la barre pliée en colonne sur le bord gauche. */
const SideRail: React.FC = () => (
  <div
    style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 4,
      width: 13,
      flexShrink: 0,
      padding: '4px 0',
      background: 'var(--color-surface)',
      borderRight: '1px solid var(--color-border-light)',
    }}
  >
    <div style={{ width: 5, height: 5, borderRadius: 1, ...inkStyle(0.45) }} />
    <div style={{ width: 6, height: 6, borderRadius: 999, ...inkStyle(0.22) }} />
    <div style={{ flex: 1 }} />
    <div style={{ width: 5, height: 5, borderRadius: 999, ...inkStyle(0.22) }} />
    <div
      style={{ width: 6, height: 6, borderRadius: 999, background: 'var(--color-primary-500)' }}
    />
  </div>
);

/** Bande d'onglets : trois onglets, le premier actif et souligné. */
const TabBand: React.FC = () => (
  <div
    style={{
      display: 'flex',
      alignItems: 'stretch',
      gap: 2,
      height: TAB_BAND_HEIGHT,
      flexShrink: 0,
      padding: '0 3px',
      background: 'var(--color-surface)',
      borderBottom: '1px solid var(--color-border-light)',
    }}
  >
    {[0, 1, 2].map((index) => {
      const isActive = index === 0;
      return (
        <div
          key={index}
          style={{
            width: 20,
            borderRadius: '2px 2px 0 0',
            background: isActive ? 'var(--color-background)' : 'transparent',
            borderBottom: `2px solid ${isActive ? 'var(--color-primary-500)' : 'transparent'}`,
          }}
        >
          <div
            style={{
              height: 2,
              margin: '3px 3px 0',
              borderRadius: 1,
              ...inkStyle(isActive ? 0.5 : 0.25),
            }}
          />
        </div>
      );
    })}
  </div>
);

/** Corps de fenêtre : bande latérale + lignes de contenu. */
const WindowBody: React.FC<{ railed?: boolean }> = ({ railed = false }) => (
  <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
    {/* Avec le rail à gauche, une deuxième colonne rendrait la vignette
        illisible : c'est le rail qui tient ce bord. */}
    {!railed && <div style={{ width: '22%', ...inkStyle(0.1) }} />}
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
        padding: '6px 6px 0',
      }}
    >
      {['70%', '55%', '62%'].map((width) => (
        <div key={width} style={{ height: 3, width, borderRadius: 2, ...inkStyle(0.22) }} />
      ))}
    </div>
  </div>
);

const ChevronDown: React.FC = () => (
  <svg
    width="10"
    height="10"
    viewBox="0 0 24 24"
    fill="none"
    stroke="var(--color-text-tertiary)"
    strokeWidth="3"
  >
    <polyline points="6 9 12 15 18 9" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

interface ThumbnailProps {
  mode: BarsMode;
  shortcutLabel: string;
}

/** Maquette de fenêtre correspondant à un mode. */
const BarsThumbnail: React.FC<ThumbnailProps> = ({ mode, shortcutLabel }) => {
  const isRail = mode === 'side';

  // Empilement vertical commun. En mode rail il passe à DROITE de la colonne,
  // d'où l'extraction : le cadre devient alors une ligne.
  const stack = (
    <>
      {(mode === 'all' || mode === 'search-only') && <HeaderBand />}
      {mode === 'floating' && <FloatingBand />}
      {mode !== 'search-only' && mode !== 'none' && <TabBand />}
      {/* « Au survol » : la barre se déplie SOUS les onglets (elle ne peut pas
          les recouvrir sans leur voler leurs clics), ici à moitié sortie. */}
      {mode === 'autohide' && (
        <div
          style={{
            height: Math.round(HEADER_BAND_HEIGHT / 2),
            overflow: 'hidden',
            flexShrink: 0,
          }}
        >
          <HeaderBand />
        </div>
      )}
      <WindowBody railed={isRail} />
    </>
  );

  return (
    <div
      className="w-full rounded-lg overflow-hidden border"
      style={{
        position: 'relative',
        height: FRAME_HEIGHT,
        display: 'flex',
        flexDirection: isRail ? 'row' : 'column',
        background: 'var(--color-background)',
        borderColor: 'var(--color-border)',
      }}
    >
      {isRail && <SideRail />}
      {isRail ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          {stack}
        </div>
      ) : (
        stack
      )}

      {mode === 'autohide' && (
        <span style={{ position: 'absolute', top: 2, right: 3, lineHeight: 0 }}>
          <ChevronDown />
        </span>
      )}

      {mode === 'none' && (
        <span
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            padding: '2px 6px',
            borderRadius: 4,
            border: '1px solid var(--color-border)',
            background: 'var(--color-surface)',
            color: 'var(--color-text-secondary)',
            fontSize: 9,
            fontWeight: 600,
            whiteSpace: 'nowrap',
          }}
        >
          {shortcutLabel}
        </span>
      )}
    </div>
  );
};

const LABEL_KEYS: Record<BarsMode, string> = {
  all: 'settings.barsMode.all',
  floating: 'settings.barsMode.floating',
  side: 'settings.barsMode.side',
  autohide: 'settings.barsMode.autohide',
  'tabs-only': 'settings.barsMode.tabsOnly',
  'search-only': 'settings.barsMode.searchOnly',
  none: 'settings.barsMode.none',
};

const LABEL_FALLBACKS: Record<BarsMode, string> = {
  all: 'Toutes les barres',
  floating: 'Barre flottante',
  side: 'Rail latéral',
  autohide: 'Barre du haut au survol',
  'tabs-only': 'Onglets seuls',
  'search-only': 'Recherche seule',
  none: 'Aucune barre',
};

export const BarsModePicker: React.FC = () => {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const barsMode = useSelector(selectBarsMode);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const shortcutLabel = t('settings.barsMode.shortcut', 'Ctrl+Maj+B');

  const select = useCallback(
    (mode: BarsMode) => {
      dispatch(setBarsMode(mode));
    },
    [dispatch]
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
      const count = BARS_MODES.length;
      let target = -1;

      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
        target = (index + 1) % count;
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
        target = (index - 1 + count) % count;
      } else if (event.key === 'Home') {
        target = 0;
      } else if (event.key === 'End') {
        target = count - 1;
      } else {
        return;
      }

      event.preventDefault();
      select(BARS_MODES[target]);
      itemRefs.current[target]?.focus();
    },
    [select]
  );

  return (
    <div
      role="radiogroup"
      aria-label={t('settings.barsMode.label', 'Affichage des barres')}
      className="grid grid-cols-3 gap-3"
    >
      {BARS_MODES.map((mode, index) => {
        const isSelected = mode === barsMode;
        const label = t(LABEL_KEYS[mode], LABEL_FALLBACKS[mode]);
        return (
          <button
            key={mode}
            ref={(el) => {
              itemRefs.current[index] = el;
            }}
            type="button"
            role="radio"
            aria-checked={isSelected}
            tabIndex={isSelected ? 0 : -1}
            onClick={() => select(mode)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={`
              relative flex flex-col items-center gap-2 px-3 py-3 rounded-xl border-2 transition-all duration-200
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary-400)]
              ${
                isSelected
                  ? 'border-[var(--color-primary-400)] bg-[var(--color-selected)] shadow-sm'
                  : 'border-[var(--color-border)] bg-[var(--color-background-secondary)] hover:border-[var(--color-border-strong)] hover:shadow-sm'
              }
            `}
          >
            <BarsThumbnail mode={mode} shortcutLabel={shortcutLabel} />
            <span className="text-xs font-medium text-[var(--color-text-primary)] text-center">
              {label}
            </span>
            {isSelected && (
              <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-[var(--color-primary-500)] text-white flex items-center justify-center">
                <CheckIcon />
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
};

export default BarsModePicker;
