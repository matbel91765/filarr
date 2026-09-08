/**
 * EntryBadge — l'état d'installation, en un mot et une couleur.
 *
 * Une pastille, jamais une couleur seule : un liseré vert et un liseré rouge
 * sont le même liseré gris pour une partie des utilisateurs, et rien du tout
 * pour un lecteur d'écran. Le mot porte l'information, la couleur l'accélère.
 *
 * `available` (jamais installée) n'a délibérément PAS de pastille : marquer
 * l'état par défaut, c'est ajouter du bruit à chaque ligne pour ne rien dire.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { ENTRY_LABEL_KEY, ENTRY_TONE, type EntryState } from './entryState';
import './marketplace.css';

export const EntryBadge: React.FC<{ state: EntryState }> = ({ state }) => {
  const { t } = useTranslation();
  const key = ENTRY_LABEL_KEY[state];
  if (!key) return null;
  const tone = ENTRY_TONE[state];
  return (
    <span className={`mkt-badge mkt-badge--${tone === 'none' ? 'muted' : tone}`}>
      <span className="mkt-badge__dot" aria-hidden="true" />
      {t(key)}
    </span>
  );
};

/**
 * Les types de fichiers servis — CE QUE FAIT l'extension.
 *
 * L'information la plus utile de tout l'écran, et la seule qui n'apparaissait
 * nulle part dans l'ancien catalogue. Un `.md` se reconnaît instantanément ; il
 * fait plus pour comprendre une extension que sa description marketing.
 */
export const CapabilityList: React.FC<{ extensions: string[]; max?: number }> = ({
  extensions,
  max = 6,
}) => {
  const { t } = useTranslation();
  if (extensions.length === 0) return null;
  const shown = extensions.slice(0, max);
  const rest = extensions.length - shown.length;
  return (
    <span className="mkt-caps">
      {shown.map((ext) => (
        <span className="mkt-cap" key={ext}>
          .{ext}
        </span>
      ))}
      {rest > 0 && (
        <span className="mkt-meta">{t('marketplace.detail.moreTypes', { count: rest })}</span>
      )}
    </span>
  );
};
