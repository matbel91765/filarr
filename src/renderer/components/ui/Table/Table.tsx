import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import './Table.css';

export interface Column<T> {
  key: string;
  header: string;
  accessor: (item: T) => React.ReactNode;
  sortable?: boolean;
  width?: string;
  align?: 'left' | 'center' | 'right';
  headerClassName?: string;
  cellClassName?: string;
}

export interface TableProps<T> {
  columns: Column<T>[];
  data: T[];
  keyExtractor: (item: T) => string;
  onRowClick?: (item: T) => void;
  selectable?: boolean;
  selectedRows?: string[];
  onSelectionChange?: (selectedIds: string[]) => void;
  /**
   * QUELLES LIGNES UNE CASE À COCHER A LE DROIT D'ATTEINDRE.
   *
   * Sans ce prédicat, la table coche TOUT ce qu'elle affiche, et l'appelant doit
   * ensuite deviner ce que la sélection voulait dire : le trombinoscope d'un
   * coffre partagé, par exemple, ne peut ni retirer son propriétaire ni se
   * retirer soi-même, si bien que la case d'en-tête n'était JAMAIS « tout
   * cochée » — elle restait éternellement à moitié, et le clic qui aurait dû
   * tout décocher renvoyait la totalité, indiscernable d'un « tout
   * sélectionner ». Pire : cliquer la case d'une ligne interdite émettait la
   * même charge utile qu'un « tout sélectionner », juste avant un geste de lot.
   *
   * Le prédicat ferme les trois d'un coup : la ligne interdite n'a plus de case,
   * l'en-tête ne compte que les lignes atteignables, et « tout décocher » émet
   * un tableau VIDE, qui ne ressemble à rien d'autre.
   */
  isRowSelectable?: (item: T) => boolean;
  /**
   * Le libellé accessible de la case d'une ligne. Le repli numérote (« ligne
   * 3 »), ce qui ne dit à personne QUI on coche : dès que les lignes portent des
   * gens ou des fichiers, l'appelant doit les NOMMER ici.
   */
  rowSelectionLabel?: (item: T) => string;
  sortable?: boolean;
  sortBy?: string;
  sortDirection?: 'asc' | 'desc';
  onSort?: (column: string, direction: 'asc' | 'desc') => void;
  loading?: boolean;
  emptyMessage?: string;
  stickyHeader?: boolean;
  striped?: boolean;
  hoverable?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

/**
 * LA LARGEUR DÉCLARÉE D'UNE COLONNE, RENDUE RÉELLE — et le défaut que ce
 * détail de trois lignes a coûté.
 *
 * CE QU'ON VOYAIT. Dans le trombinoscope d'un coffre, la colonne d'actions
 * affichait « ransmettre » et le bouton rouge « Retirer » coupé au bord. Le
 * réflexe — rajouter un `overflow-x` — aurait caché la cause sans la toucher.
 *
 * LA CAUSE. `.table-cell` porte `flex: 1`, qui est le RACCOURCI de
 * `flex-grow: 1; flex-shrink: 1; flex-basis: 0%`. Dès qu'une base de flex est
 * DÉFINIE, la propriété `width` n'entre plus dans le calcul de la taille
 * principale : elle est purement et simplement ignorée. Le `width: '210px'` que
 * chaque colonne déclarait depuis toujours n'a donc JAMAIS rien dimensionné —
 * les six colonnes se partageaient la largeur à parts égales, et `overflow:
 * hidden` (posé sur la cellule pour l'ellipse) coupait ce qui dépassait, sans un
 * mot. Une colonne d'actions a besoin d'environ 210 px pour ses deux boutons ;
 * elle en recevait le sixième de la carte, soit ~185 px sur un grand écran et
 * moins ailleurs. Le défaut mordait donc à TOUTES les largeurs, y compris en
 * plein écran : ce n'était pas une affaire de repli.
 *
 * CE QUE CETTE FONCTION FAIT. Une largeur déclarée devient une base de flex
 * FIGÉE (`0 0 <largeur>`), c'est-à-dire ce que l'appelant croyait écrire depuis
 * le début ; les colonnes qui n'en déclarent pas gardent `flex: 1` et absorbent
 * le reste. `minWidth` reprend la même valeur plutôt que de s'en remettre au
 * plancher de la feuille de style : une colonne délibérément plus étroite que ce
 * plancher (90 px pour un drapeau de pays) serait sinon élargie par une règle
 * qui ne parle pas d'elle.
 *
 * UNE SEULE FONCTION POUR LES CINQ ENDROITS qui rendent une cellule (squelette,
 * état vide, en-tête, corps) : ils divergeaient déjà — trois posaient `width`
 * sans `textAlign` — et une largeur qui change selon qu'on charge ou non
 * décalerait les colonnes sous les doigts.
 */
export function cellStyle<T>(column: Column<T>): React.CSSProperties {
  if (!column.width) return { textAlign: column.align };
  return {
    flex: `0 0 ${column.width}`,
    width: column.width,
    minWidth: column.width,
    textAlign: column.align,
  };
}

export function Table<T>({
  columns,
  data,
  keyExtractor,
  onRowClick,
  selectable = false,
  selectedRows = [],
  onSelectionChange,
  isRowSelectable,
  rowSelectionLabel,
  sortable = false,
  sortBy,
  sortDirection = 'asc',
  onSort,
  loading = false,
  emptyMessage = 'No data available',
  stickyHeader = false,
  striped = false,
  hoverable = true,
  size = 'md',
  className = '',
}: TableProps<T>) {
  const [internalSort, setInternalSort] = useState<{
    column: string | null;
    direction: 'asc' | 'desc';
  }>({
    column: sortBy || null,
    direction: sortDirection,
  });

  const [focusedRowIndex, setFocusedRowIndex] = useState<number>(-1);
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number>(-1);
  const tableRef = useRef<HTMLDivElement>(null);

  const { t } = useTranslation();

  const isControlled = sortBy !== undefined && onSort !== undefined;
  const currentSortColumn = isControlled ? sortBy : internalSort.column;
  const currentSortDirection = isControlled ? sortDirection : internalSort.direction;

  /**
   * Sans prédicat, TOUTE ligne est atteignable — le comportement d'avant, à
   * l'identique pour les vingt tables qui ne passent rien.
   */
  const rowIsSelectable = (item: T): boolean => !isRowSelectable || isRowSelectable(item);
  /** Les identifiants qu'une case peut atteindre, dans l'ordre de `data`. */
  const selectableIds = selectable ? data.filter(rowIsSelectable).map(keyExtractor) : [];

  // Handle sort
  const handleSort = (columnKey: string) => {
    const column = columns.find((col) => col.key === columnKey);
    if (!column?.sortable && !sortable) return;

    const newDirection =
      currentSortColumn === columnKey && currentSortDirection === 'asc' ? 'desc' : 'asc';

    if (isControlled) {
      onSort?.(columnKey, newDirection);
    } else {
      setInternalSort({ column: columnKey, direction: newDirection });
    }
  };

  // Handle selection
  const handleRowSelect = (itemId: string, index: number, shiftKey: boolean) => {
    if (!selectable || !onSelectionChange) return;
    // Une ligne hors d'atteinte n'a pas de case ; la touche Espace, elle, passe
    // par la LIGNE et arriverait ici sans ce garde.
    if (!selectableIds.includes(itemId)) return;

    let newSelection: string[];

    if (shiftKey && lastSelectedIndex !== -1) {
      // Range selection with Shift
      const start = Math.min(lastSelectedIndex, index);
      const end = Math.max(lastSelectedIndex, index);
      // Une plage saute ce qu'elle n'a pas le droit de prendre, plutôt que de
      // s'arrêter à la première ligne interdite.
      const rangeIds = data
        .slice(start, end + 1)
        .filter(rowIsSelectable)
        .map((item) => keyExtractor(item));

      const combinedSet = new Set([...selectedRows, ...rangeIds]);
      newSelection = Array.from(combinedSet);
    } else {
      // Single selection toggle
      if (selectedRows.includes(itemId)) {
        newSelection = selectedRows.filter((id) => id !== itemId);
      } else {
        newSelection = [...selectedRows, itemId];
      }
      setLastSelectedIndex(index);
    }

    onSelectionChange(newSelection);
  };

  // Select all / deselect all
  const handleSelectAll = () => {
    if (!selectable || !onSelectionChange) return;

    // « Tout » veut dire tout ce qu'une case PEUT atteindre : compter les lignes
    // interdites laisserait la case d'en-tête éternellement à moitié cochée, et
    // son second clic renverrait la totalité au lieu du tableau vide qui dit
    // « je décoche ».
    const déjàTout =
      selectableIds.length > 0 && selectableIds.every((id) => selectedRows.includes(id));
    onSelectionChange(déjàTout ? [] : selectableIds);
  };

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent, item: T, index: number) => {
      /**
       * LA LIGNE NE PREND PAS LES TOUCHES D'UN CONTRÔLE QU'ELLE CONTIENT.
       *
       * Ce gestionnaire est posé sur la LIGNE, et il `preventDefault()` sans
       * condition sur Espace et Entrée. Une cellule qui porte un vrai contrôle —
       * la liste déroulante des rôles du trombinoscope, le badge « Confiance »,
       * un bouton d'action — voyait donc son activation avalée au clavier : on
       * tabulait jusqu'au bouton, on appuyait sur Espace, et au lieu du geste
       * attendu c'est la LIGNE qui se cochait. Sur un tableau dont la barre
       * flottante propose « Retirer », cela revient à désigner des gens pour une
       * rotation de clé sans l'avoir demandé et sans un mot.
       *
       * Les flèches étaient logées à la même enseigne : naviguer dans les options
       * d'une liste ouverte déplaçait le focus de ligne en ligne sous la main.
       *
       * `e.target !== e.currentTarget` rend les touches à leur propriétaire : la
       * ligne ne répond que lorsque c'est ELLE qui a le focus.
       */
      if (e.target !== e.currentTarget) return;

      const itemId = keyExtractor(item);

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          if (index < data.length - 1) {
            setFocusedRowIndex(index + 1);
          }
          break;
        case 'ArrowUp':
          e.preventDefault();
          if (index > 0) {
            setFocusedRowIndex(index - 1);
          }
          break;
        case ' ':
        case 'Enter':
          e.preventDefault();
          if (e.key === ' ' && selectable) {
            handleRowSelect(itemId, index, e.shiftKey);
          } else if (e.key === 'Enter' && onRowClick) {
            onRowClick(item);
          }
          break;
      }
    },
    [data, keyExtractor, selectable, onRowClick]
  );

  // Focus management
  useEffect(() => {
    if (focusedRowIndex >= 0 && tableRef.current) {
      const rows = tableRef.current.querySelectorAll('[role="row"]');
      const targetRow = rows[focusedRowIndex + 1]; // +1 to skip header row
      if (targetRow instanceof HTMLElement) {
        targetRow.focus();
      }
    }
  }, [focusedRowIndex]);

  // Sort data
  const sortedData = React.useMemo(() => {
    if (!currentSortColumn || isControlled) return data;

    const column = columns.find((col) => col.key === currentSortColumn);
    if (!column) return data;

    return [...data].sort((a, b) => {
      const aValue = column.accessor(a);
      const bValue = column.accessor(b);

      // Handle null/undefined
      if (aValue == null) return 1;
      if (bValue == null) return -1;

      // Convert to string for comparison
      const aStr = String(aValue);
      const bStr = String(bValue);

      const comparison = aStr.localeCompare(bStr, undefined, { numeric: true });
      return currentSortDirection === 'asc' ? comparison : -comparison;
    });
  }, [data, currentSortColumn, currentSortDirection, columns, isControlled]);

  // Render loading skeleton
  if (loading) {
    return (
      <div className={`table-container ${className}`} ref={tableRef}>
        <div className={`table table-${size}`}>
          <div className="table-header" role="rowgroup">
            <div className="table-row" role="row">
              {selectable && (
                <div className="table-cell table-cell-checkbox" role="columnheader"></div>
              )}
              {columns.map((column) => (
                <div
                  key={column.key}
                  className={`table-cell ${column.headerClassName || ''}`}
                  role="columnheader"
                  style={cellStyle(column)}
                >
                  {column.header}
                </div>
              ))}
            </div>
          </div>
          <div className="table-body" role="rowgroup">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="table-row table-row-loading" role="row">
                {selectable && (
                  <div className="table-cell table-cell-checkbox" role="cell">
                    <div className="skeleton skeleton-checkbox"></div>
                  </div>
                )}
                {columns.map((column) => (
                  <div
                    key={column.key}
                    className={`table-cell ${column.cellClassName || ''}`}
                    role="cell"
                    style={cellStyle(column)}
                  >
                    <div className="skeleton skeleton-text"></div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Render empty state
  if (data.length === 0) {
    return (
      <div className={`table-container ${className}`} ref={tableRef}>
        <div className={`table table-${size}`}>
          <div className="table-header" role="rowgroup">
            <div className="table-row" role="row">
              {selectable && (
                <div className="table-cell table-cell-checkbox" role="columnheader"></div>
              )}
              {columns.map((column) => (
                <div
                  key={column.key}
                  className={`table-cell ${column.headerClassName || ''}`}
                  role="columnheader"
                  style={cellStyle(column)}
                >
                  {column.header}
                </div>
              ))}
            </div>
          </div>
          <div className="table-body table-empty" role="rowgroup">
            <div className="table-empty-state">
              <p>{emptyMessage}</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Cochée quand tout ce qui est ATTEIGNABLE l'est — pas quand toutes les lignes
  // le sont : une table dont une ligne refuse la sélection ne pourrait alors
  // jamais montrer sa case d'en-tête autrement qu'à moitié.
  const sélectionnés = new Set(selectedRows);
  const isAllSelected =
    selectable && selectableIds.length > 0 && selectableIds.every((id) => sélectionnés.has(id));
  const isIndeterminate = selectable && selectedRows.length > 0 && !isAllSelected;

  return (
    <div className={`table-container ${className}`} ref={tableRef}>
      <div
        className={`table table-${size} ${stickyHeader ? 'table-sticky-header' : ''} ${
          striped ? 'table-striped' : ''
        } ${hoverable ? 'table-hoverable' : ''}`}
        role="table"
      >
        <div className="table-header" role="rowgroup">
          <div className="table-row" role="row">
            {selectable && (
              <div className="table-cell table-cell-checkbox" role="columnheader">
                <label className="table-checkbox">
                  <input
                    type="checkbox"
                    checked={isAllSelected}
                    ref={(input) => {
                      if (input) {
                        input.indeterminate = isIndeterminate;
                      }
                    }}
                    onChange={handleSelectAll}
                    aria-label={t('common.table.selectAll')}
                  />
                  <span className="table-checkbox-custom"></span>
                </label>
              </div>
            )}
            {columns.map((column) => {
              const isSortable = column.sortable !== undefined ? column.sortable : sortable;
              const isSorted = currentSortColumn === column.key;

              return (
                <div
                  key={column.key}
                  className={`table-cell ${column.headerClassName || ''} ${
                    isSortable ? 'table-cell-sortable' : ''
                  } ${isSorted ? 'table-cell-sorted' : ''}`}
                  role="columnheader"
                  aria-sort={
                    isSorted
                      ? currentSortDirection === 'asc'
                        ? 'ascending'
                        : 'descending'
                      : undefined
                  }
                  style={cellStyle(column)}
                  onClick={() => isSortable && handleSort(column.key)}
                  tabIndex={isSortable ? 0 : undefined}
                  onKeyDown={(e) => {
                    if (isSortable && (e.key === 'Enter' || e.key === ' ')) {
                      e.preventDefault();
                      handleSort(column.key);
                    }
                  }}
                >
                  <span className="table-cell-content">
                    {column.header}
                    {isSortable && (
                      <span className="table-sort-icon">
                        {isSorted ? (
                          currentSortDirection === 'asc' ? (
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                              <path d="M8 4l4 5H4l4-5z" />
                            </svg>
                          ) : (
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                              <path d="M8 12l-4-5h8l-4 5z" />
                            </svg>
                          )
                        ) : (
                          <svg
                            width="16"
                            height="16"
                            viewBox="0 0 16 16"
                            fill="currentColor"
                            opacity="0.3"
                          >
                            <path d="M8 4l3 4H5l3-4zM8 12l-3-4h6l-3 4z" />
                          </svg>
                        )}
                      </span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
        <div className="table-body" role="rowgroup">
          {sortedData.map((item, index) => {
            const itemId = keyExtractor(item);
            const isSelected = selectedRows.includes(itemId);

            return (
              <div
                key={itemId}
                className={`table-row ${isSelected ? 'table-row-selected' : ''} ${
                  onRowClick ? 'table-row-clickable' : ''
                }`}
                role="row"
                aria-selected={selectable ? isSelected : undefined}
                tabIndex={0}
                onClick={() => onRowClick?.(item)}
                onKeyDown={(e) => handleKeyDown(e, item, index)}
              >
                {selectable && (
                  <div className="table-cell table-cell-checkbox" role="cell">
                    {/* PAS DE CASE DU TOUT sur une ligne hors d'atteinte : une
                        case grisée dirait « pas maintenant » alors que la
                        réponse est « jamais », et une case active offrirait un
                        geste que le serveur refuse. La cellule reste, elle, pour
                        que les colonnes restent alignées. */}
                    {rowIsSelectable(item) && (
                      <label className="table-checkbox" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={(e) =>
                            handleRowSelect(itemId, index, (e.nativeEvent as MouseEvent).shiftKey)
                          }
                          aria-label={
                            rowSelectionLabel
                              ? rowSelectionLabel(item)
                              : t('common.table.selectRow', { index: index + 1 })
                          }
                        />
                        <span className="table-checkbox-custom"></span>
                      </label>
                    )}
                  </div>
                )}
                {columns.map((column) => (
                  <div
                    key={column.key}
                    className={`table-cell ${column.cellClassName || ''}`}
                    role="cell"
                    style={cellStyle(column)}
                  >
                    {column.accessor(item)}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
