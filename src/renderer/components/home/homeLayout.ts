/**
 * Accueil modulaire — LE PONT entre le document de mise en page et la grille.
 *
 * Deux vocabulaires se rencontrent ici, et un seul fichier a le droit de les
 * traduire l'un dans l'autre :
 *
 *   · `LayoutSlot` (chantier A) — ce qui est SCELLÉ dans `layout.enc`, fusionné
 *     entre appareils, et publié en gabarit. Il porte un rôle, un type, des
 *     options, des attaches locales, et une géométrie.
 *   · `GridPlacement` (chantier B) — ce que le moteur de grille manipule. Rien
 *     qu'un identifiant et un rectangle en cases.
 *
 * La traduction est délibérément TOTALE dans un sens et PARTIELLE dans l'autre :
 * un geste sur la grille ne rapporte QUE de la géométrie, et c'est `mergeGeometry`
 * qui la repose sur les emplacements existants. Écrire les emplacements à partir
 * des placements perdrait options, attaches et rôles — c'est-à-dire tout ce qui
 * fait qu'un bloc affiche quelque chose.
 */

import type { GridPlacement } from '../grid/gridTypes';
import type { LayoutSlot, LayoutView } from '../../../services/layout/layoutTypes';
import { ESSENTIAL_TEMPLATE } from './presets/homePresets';

/** La vue de l'accueil dans le document. Le préfixe dit la famille. */
export const HOME_VIEW_ID = 'home';

// ==================== Slot ⇄ Placement ====================

/** Les emplacements deviennent des rectangles. Le contenu reste à quai. */
export function toPlacements(slots: readonly LayoutSlot[]): GridPlacement[] {
  return slots.map((slot) => ({ id: slot.id, x: slot.x, y: slot.y, w: slot.w, h: slot.h }));
}

/**
 * Repose une géométrie venue de la grille sur les emplacements.
 *
 * Ce qui NE traverse PAS : tout le reste. Un emplacement absent de `placements`
 * garde sa géométrie d'avant — il n'est PAS supprimé. C'est ce qui permet de
 * masquer un bloc vide au repos sans que le prochain geste ne l'efface du
 * document de quelqu'un.
 */
export function mergeGeometry(
  slots: readonly LayoutSlot[],
  placements: readonly GridPlacement[]
): LayoutSlot[] {
  const byId = new Map(placements.map((p) => [p.id, p]));
  return slots.map((slot) => {
    const next = byId.get(slot.id);
    if (!next) return slot;
    if (next.x === slot.x && next.y === slot.y && next.w === slot.w && next.h === slot.h) {
      // Référence PRÉSERVÉE quand rien ne bouge : les widgets sont mémoïsés sur
      // `options` et `binding`, qui voyagent avec l'objet. Recréer l'objet à
      // chaque geste re-rendrait les blocs que le geste n'a pas touchés.
      return slot;
    }
    return { ...slot, x: next.x, y: next.y, w: next.w, h: next.h };
  });
}

// ==================== Le modèle « Essentiel » ====================

/**
 * Le rendu par défaut, quand AUCUN document ne dit ce que l'accueil doit être.
 *
 * ── IL A DÉMÉNAGÉ, ET IL A DEUX FRÈRES ──────────────────────────────────────
 *
 * Le gabarit lui-même vit désormais dans `presets/homePresets.ts`, avec les deux
 * autres modèles prêts à l'emploi (« Tableau de bord », « Atelier ») : les trois
 * décrivent la même chose, ils doivent se lire au même endroit, sinon le premier
 * qu'on modifie devient discrètement le seul à jour.
 *
 * Ce module continue d'en exporter le nom, parce que c'est ce nom que l'accueil
 * importe pour son REPLI et pour le panneau des modèles installés — le déplacer
 * aurait fait un renommage de plus, sans rien apporter.
 *
 * ⚠ Ce gabarit est un REPLI, pas un amorçage. L'amorçage (`seedLayoutDocument`,
 * côté principal) reste le seul à écrire, et il tient compte des préférences
 * déjà exprimées. Celui-ci ne s'écrit jamais tout seul : il n'est scellé que si
 * l'utilisateur range effectivement son accueil.
 */
export { ESSENTIAL_TEMPLATE };

/**
 * Le repli LOCAL : « Essentiel » posé sur la vue de l'accueil, en mémoire.
 *
 * Les identifiants d'emplacement sont DÉTERMINISTES (`essential:<type>:<rang>`)
 * et non des uuid, pour la même raison que ceux de l'amorçage : si deux
 * appareils finissent par sceller ce repli, la fusion doit y reconnaître une
 * seule et même disposition, pas deux jeux de blocs identiques empilés.
 *
 * ⚠ LE RANG N'EST PAS DÉCORATIF. Depuis que « Essentiel » pose QUATRE tuiles
 * `stat-tile` (fichiers, dossiers, stockage, notes), un identifiant tiré du seul
 * type en donnerait quatre fois le même — quatre blocs que la grille traiterait
 * comme un seul, et dont trois disparaîtraient sous les yeux de leur
 * utilisateur. Le rang est l'INDEX dans le gabarit : réordonner les
 * emplacements du gabarit renomme donc les blocs du repli, ce qui est sans
 * conséquence tant que le repli n'est pas scellé, et ce que la fusion traiterait
 * comme une disposition neuve s'il l'était.
 */
export function essentialHomeView(): LayoutView {
  const slots: LayoutSlot[] = ESSENTIAL_TEMPLATE.slots.map((slot, index) => ({
    id: `essential:${slot.type}:${index}`,
    role: slot.role,
    type: slot.type,
    x: slot.x,
    y: slot.y,
    w: slot.w,
    h: slot.h,
    ...(slot.options ? { options: { ...slot.options } } : {}),
  }));

  return {
    id: HOME_VIEW_ID,
    slots,
    // L'ÉPOQUE, comme les vues d'amorçage : un repli ne doit jamais pouvoir
    // gagner un arbitrage contre une disposition que quelqu'un a réellement
    // construite sur un autre appareil.
    updatedAt: '1970-01-01T00:00:00.000Z',
    templateId: ESSENTIAL_TEMPLATE.id,
  };
}
