/**
 * Tabs — une barre d'onglets qui se pilote AUSSI au clavier.
 *
 * POURQUOI CE COMPOSANT EXISTE. Les consoles d'administration du produit
 * (`OrgDashboard`, et maintenant la page « Gérer le coffre ») dessinaient
 * chacune leur `role="tablist"` à la main : des `<button role="tab">` avec le
 * bon `aria-selected`, mais rien d'autre. Il manquait tout ce qui fait qu'une
 * barre d'onglets EST une barre d'onglets pour qui n'utilise pas la souris :
 *   - les flèches gauche/droite ne changeaient pas d'onglet (Tab passait de
 *     bouton en bouton, ce qui est le comportement d'une barre d'outils) ;
 *   - chaque onglet était un arrêt de tabulation, donc atteindre le contenu
 *     coûtait autant de Tab qu'il y avait d'onglets (« focus roving » : un
 *     seul arrêt pour toute la barre, celui de l'onglet actif) ;
 *   - aucun `aria-controls` ne reliait l'onglet à son panneau, si bien qu'un
 *     lecteur d'écran annonçait « onglet 3 sur 6 » sans jamais dire de quoi.
 *
 * L'ACTIVATION SUIT LE FOCUS (« automatic activation »), le mode recommandé
 * quand changer d'onglet ne coûte rien : ici chaque panneau lit des données
 * déjà chargées par un hôte unique, il n'y a pas de requête à déclencher par
 * inadvertance en traversant la barre.
 *
 * L'APPARENCE est celle des consoles (`ent-tabs` / `ent-tab`) : un deuxième
 * dessin d'onglets aurait fait deux langages visuels pour le même objet. La
 * feuille est importée ici plutôt que laissée à la charge de l'hôte — un
 * composant qui ne s'affiche correctement que si quelqu'un d'autre a pensé à
 * importer un fichier est une panne qui attend son écran.
 */

import React, { useCallback, useRef } from 'react';
import '../../settings/enterprise/enterprise.css';

export interface TabDescriptor {
  /** L'identifiant qui voyage dans l'URL (`?tab=…`) — jamais l'index. */
  id: string;
  label: string;
  icon?: React.ReactNode;
  /** Un compteur affiché en pastille. `undefined` = pas de pastille (≠ zéro). */
  count?: number;
}

export interface TabsProps {
  tabs: TabDescriptor[];
  activeId: string;
  onChange: (id: string) => void;
  /** Ce que la barre EST, pour un lecteur d'écran (« Sections du coffre »). */
  ariaLabel: string;
  /**
   * Préfixe des identifiants DOM. Deux barres d'onglets sur un même écran
   * (page + modale) ne doivent pas se voler leurs `aria-controls`.
   */
  idPrefix: string;
  className?: string;
}

/** L'identifiant DOM d'un onglet — l'hôte en a besoin pour son `aria-labelledby`. */
export const tabButtonId = (idPrefix: string, tabId: string): string => `${idPrefix}-tab-${tabId}`;
/** L'identifiant DOM du panneau associé. */
export const tabPanelId = (idPrefix: string, tabId: string): string => `${idPrefix}-panel-${tabId}`;

/**
 * Les attributs du panneau actif, pour que l'hôte n'ait pas à recomposer la
 * paire d'identifiants à la main (et à se tromper d'un côté seulement).
 *
 * `tabIndex={0}` : le panneau lui-même est focalisable, sinon un panneau dont
 * le premier élément n'est pas focalisable (du texte) serait inatteignable au
 * clavier depuis la barre.
 */
export function tabPanelProps(
  idPrefix: string,
  activeId: string
): { id: string; role: 'tabpanel'; 'aria-labelledby': string; tabIndex: number } {
  return {
    id: tabPanelId(idPrefix, activeId),
    role: 'tabpanel',
    'aria-labelledby': tabButtonId(idPrefix, activeId),
    tabIndex: 0,
  };
}

export const Tabs: React.FC<TabsProps> = ({
  tabs,
  activeId,
  onChange,
  ariaLabel,
  idPrefix,
  className = '',
}) => {
  const listRef = useRef<HTMLDivElement>(null);

  /**
   * Déplacer le focus ET la sélection. Le focus est posé à la main sur le
   * bouton d'arrivée : sans cela, le rendu suivant lui donnerait bien
   * `tabIndex=0`, mais le focus resterait sur un bouton devenu `tabIndex=-1`
   * — la flèche suivante repartirait alors du mauvais endroit.
   */
  const move = useCallback(
    (index: number) => {
      const target = tabs[index];
      if (!target) return;
      onChange(target.id);
      listRef.current
        ?.querySelector<HTMLButtonElement>(`#${CSS.escape(tabButtonId(idPrefix, target.id))}`)
        ?.focus();
    },
    [tabs, onChange, idPrefix]
  );

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const current = tabs.findIndex((x) => x.id === activeId);
    if (current === -1) return;
    // Les onglets bouclent : depuis le dernier, « droite » revient au premier.
    // C'est ce qu'attend le motif ARIA, et ça évite le cul-de-sac d'une barre
    // où une flèche ne fait soudain plus rien.
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      move((current + 1) % tabs.length);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      move((current - 1 + tabs.length) % tabs.length);
    } else if (e.key === 'Home') {
      e.preventDefault();
      move(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      move(tabs.length - 1);
    }
  };

  return (
    <div
      ref={listRef}
      className={`ent-tabs ${className}`}
      role="tablist"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
    >
      {tabs.map((x) => {
        const active = x.id === activeId;
        return (
          <button
            key={x.id}
            id={tabButtonId(idPrefix, x.id)}
            type="button"
            role="tab"
            aria-selected={active}
            aria-controls={tabPanelId(idPrefix, x.id)}
            // Focus roving : UN seul arrêt de tabulation pour toute la barre.
            tabIndex={active ? 0 : -1}
            className={`ent-tab ${active ? 'ent-tab--active' : ''}`}
            onClick={() => onChange(x.id)}
          >
            {x.icon}
            {x.label}
            {typeof x.count === 'number' && <span className="ent-tab__count">{x.count}</span>}
          </button>
        );
      })}
    </div>
  );
};

export default Tabs;
