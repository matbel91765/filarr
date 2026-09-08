/**
 * Les états « pas de contenu » — la moitié du travail d'un écran de catalogue.
 *
 * L'ancien écran avait UNE phrase grise pour trois situations opposées : le
 * catalogue réellement vide, la recherche sans résultat, et le filtre de
 * catégorie sans résultat. Aucune n'offrait de sortie, et le quatrième cas — le
 * chargement — n'était pas traité du tout : après une frappe dans la recherche,
 * la liste précédente restait affichée telle quelle et l'on ne savait pas si
 * c'était « en cours » ou « rien trouvé ».
 *
 * Trois composants ici, et une règle : un état vide qui n'offre AUCUNE action
 * est un cul-de-sac. Chacun porte donc sa sortie.
 */

import React from 'react';
import { Button } from '../ui';
import './marketplace.css';

export type NoticeTone = 'neutral' | 'info' | 'warn' | 'danger';

export interface NoticeAction {
  label: string;
  onClick: () => void;
  variant?: 'primary' | 'secondary' | 'tertiary' | 'ghost' | 'danger';
  loading?: boolean;
}

interface NoticeProps {
  tone?: NoticeTone;
  glyph?: React.ReactNode;
  title: string;
  text?: string;
  actions?: NoticeAction[];
  /**
   * `alert` pour ce qui vient d'échouer et exige une décision ; `status` pour un
   * fait ambiant (hors ligne, non connecté). Un bandeau permanent en `alert`
   * ferait relire l'information à chaque re-rendu du lecteur d'écran.
   */
  live?: 'alert' | 'status' | 'none';
}

export const Notice: React.FC<NoticeProps> = ({
  tone = 'neutral',
  glyph,
  title,
  text,
  actions,
  live = 'status',
}) => (
  <div
    className={`mkt-notice${tone === 'neutral' ? '' : ` mkt-notice--${tone}`}`}
    role={live === 'none' ? undefined : live}
  >
    {glyph && <span className="mkt-notice__glyph">{glyph}</span>}
    <div className="mkt-notice__body">
      <p className="mkt-notice__title">{title}</p>
      {text && <p className="mkt-notice__text">{text}</p>}
      {actions && actions.length > 0 && (
        <div className="mkt-notice__actions">
          {actions.map((a) => (
            <Button
              key={a.label}
              size="sm"
              variant={a.variant ?? 'secondary'}
              loading={a.loading}
              onClick={a.onClick}
            >
              {a.label}
            </Button>
          ))}
        </div>
      )}
    </div>
  </div>
);

interface EmptyProps {
  glyph: React.ReactNode;
  title: string;
  text?: string;
  actions?: NoticeAction[];
}

export const EmptyPanel: React.FC<EmptyProps> = ({ glyph, title, text, actions }) => (
  <div className="mkt-empty">
    <span className="mkt-empty__glyph">{glyph}</span>
    <p className="mkt-empty__title">{title}</p>
    {text && <p className="mkt-empty__text">{text}</p>}
    {actions && actions.length > 0 && (
      <div className="mkt-empty__actions">
        {actions.map((a) => (
          <Button key={a.label} size="sm" variant={a.variant ?? 'secondary'} onClick={a.onClick}>
            {a.label}
          </Button>
        ))}
      </div>
    )}
  </div>
);

/**
 * Les silhouettes de chargement. `aria-busy` sur la liste dit au lecteur d'écran
 * qu'il ne manque rien — les blocs eux-mêmes sont invisibles pour lui.
 */
export const ListSkeleton: React.FC<{ rows?: number; label: string }> = ({ rows = 4, label }) => (
  <div className="mkt-list" role="status" aria-busy="true" aria-label={label}>
    {Array.from({ length: rows }).map((_, i) => (
      <div className="mkt-skel" key={i} aria-hidden="true">
        <span className="mkt-skel__block" style={{ width: '2.25rem', height: '2.25rem' }} />
        <span style={{ flex: '1 1 auto' }}>
          <span
            className="mkt-skel__block"
            style={{ display: 'block', width: '38%', height: '0.75rem' }}
          />
          <span
            className="mkt-skel__block"
            style={{ display: 'block', width: '72%', height: '0.6rem', marginTop: '0.5rem' }}
          />
        </span>
        <span className="mkt-skel__block" style={{ width: '5rem', height: '1.75rem' }} />
      </div>
    ))}
  </div>
);
