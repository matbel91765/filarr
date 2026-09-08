/**
 * artifactKinds — LA COUTURE D'EXTENSION de la place de marché.
 *
 * La place de marché ne distribue aujourd'hui qu'un seul type d'objet : des
 * EXTENSIONS (des éditeurs de fichiers signés, exécutés en bac à sable). Un
 * second type est annoncé — les MODÈLES DE MISE EN PAGE — et l'erreur à ne pas
 * commettre serait de le découvrir le jour où il arrive.
 *
 * D'où cette table. La barre du haut, les sections, les compteurs et le panneau
 * « bientôt » se DÉRIVENT d'elle : ajouter un type = ajouter une entrée ici et
 * brancher ses panneaux, sans toucher à la coquille, aux filtres ni à la
 * navigation. Le jour venu, `available` passe à `true` et le panneau « bientôt »
 * disparaît de lui-même.
 *
 * Ce module est PUR : aucun import React, aucun accès au store — il se teste et
 * se lit d'un coup d'œil.
 */

/** Les types d'objets distribuables. `layouts` existe déjà comme promesse. */
export type ArtifactKindId = 'extensions' | 'layouts';

/** Les trois moments d'un visiteur : découvrir, gérer ce qu'il a, publier. */
export type MarketplaceSectionId = 'discover' | 'mine' | 'publish';

export interface ArtifactKind {
  id: ArtifactKindId;
  /** Clé i18n du libellé d'onglet (deux mots au plus — c'est un onglet). */
  labelKey: string;
  /** Clé i18n de la phrase qui dit CE QUE C'EST, sous le titre. */
  taglineKey: string;
  /**
   * Libellés de sections PROPRES à ce type, quand les libellés communs
   * mentiraient. « Mes extensions » sous l'onglet des modèles de mise en page
   * nommerait autre chose que ce que la section contient — et un onglet qui se
   * trompe de mot fait douter de tout l'écran.
   */
  sectionLabelKeys?: Partial<Record<MarketplaceSectionId, string>>;
  /**
   * `false` ⇒ l'onglet reste VISIBLE mais mène à un panneau « bientôt ».
   * Montrer la case vide vaut mieux que la cacher : le visiteur apprend que la
   * place de marché a deux étages, et la structure est déjà éprouvée quand le
   * second s'ouvre.
   */
  available: boolean;
  /** Les sections servies par ce type, dans l'ordre d'affichage. */
  sections: readonly MarketplaceSectionId[];
}

export const ARTIFACT_KINDS: readonly ArtifactKind[] = [
  {
    id: 'extensions',
    labelKey: 'marketplace.kinds.extensions.label',
    taglineKey: 'marketplace.kinds.extensions.tagline',
    available: true,
    sections: ['discover', 'mine', 'publish'],
  },
  {
    id: 'layouts',
    labelKey: 'marketplace.kinds.layouts.label',
    taglineKey: 'marketplace.kinds.layouts.tagline',
    // LES TROIS SECTIONS, depuis que l'assistant existe. `discover` sert le
    // catalogue signé (worker `/layout-market`), `mine` la bibliothèque LOCALE —
    // celle-ci contient aussi bien ce qu'on a installé du catalogue que ce qu'on
    // a reçu par fichier, et c'est voulu : de son point de vue, un modèle est un
    // modèle. `publish` porte à la fois mes fiches en ligne et l'assistant.
    available: true,
    sections: ['discover', 'mine', 'publish'],
    sectionLabelKeys: { mine: 'layouts.market.section' },
  },
] as const;

export function artifactKind(id: ArtifactKindId): ArtifactKind {
  return ARTIFACT_KINDS.find((k) => k.id === id) ?? ARTIFACT_KINDS[0];
}

/** Le libellé d'une section — une seule table, jamais un ternaire dans le JSX. */
export const SECTION_LABEL_KEYS: Record<MarketplaceSectionId, string> = {
  discover: 'marketplace.sections.discover',
  mine: 'marketplace.sections.mine',
  publish: 'marketplace.sections.publish',
};
