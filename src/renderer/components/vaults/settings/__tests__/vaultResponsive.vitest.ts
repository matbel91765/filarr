/**
 * F28 — les trois bandes de la page « Gérer le coffre », gardées SANS DOM.
 *
 * POURQUOI CE FICHIER EXISTE, ET CE QU'IL NE PEUT PAS FAIRE.
 *
 * La règle du dossier est « un modèle pur, testé ». Or « la page ne provoque
 * aucun défilement horizontal du corps » est une propriété de rendu : la
 * mesurer demanderait un vrai moteur de mise en page (jsdom ne dispose rien —
 * `getBoundingClientRect` y rend des zéros), donc un navigateur sans tête, qui
 * n'existe pas dans cette suite. On garde donc les DEUX moitiés qui, elles,
 * SONT décidables ici :
 *
 *  1. LES SEUILS. `breakpointForWidth` est l'unique autorité des trois bandes ;
 *     un test de bornes fermées à gauche empêche qu'une correction « à un pixel
 *     près » ne fasse diverger la page du reste du produit.
 *
 *  2. LA SOURCE. Le débordement horizontal ne vient pas de nulle part : il vient
 *     d'une largeur fixe, d'un tableau posé sans conteneur qui défile, ou d'une
 *     requête média qui ne tombe pas sur le même seuil que le TypeScript. Ces
 *     trois-là se lisent dans les fichiers, et c'est ce que les gardes
 *     ci-dessous font — à la manière de `grantOverviewModel.vitest.ts`, qui
 *     relit déjà `VaultSettingsView` pour vérifier que l'autorité qu'il
 *     construit est bien celle qu'il prétend.
 *
 * CE QUI REMPLACE LA MESURE : le smoke-test à la main reste dû (réduire la
 * fenêtre sous 840 et parcourir les six onglets). La garde de source attrape le
 * cas qui, lui, ne se voit PAS à l'œil — une divergence entre le seuil du CSS
 * et celui du TypeScript, qui ne se manifeste que sur une soixantaine de pixels
 * de largeur.
 *
 *   npx vitest run src/renderer/components/vaults/settings/__tests__/vaultResponsive.vitest.ts
 */

import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  BREAKPOINT_COMPACT,
  BREAKPOINT_WIDE,
  breakpointForWidth,
} from '../../../../styles/breakpoints';
import { cellStyle } from '../../../ui/Table/Table';

const RACINE = path.resolve(__dirname, '..', '..', '..', '..');
const lire = (rel: string): string => fs.readFileSync(path.join(RACINE, rel), 'utf8');

/**
 * Le CODE seul, commentaires retirés. Ces fichiers EXPLIQUENT pourquoi ils ne
 * mesurent pas la fenêtre, en nommant l'API qu'ils évitent : sans ce filtre, le
 * garde se déclencherait sur sa propre justification — et la seule façon de le
 * faire taire serait de retirer l'explication.
 */
const sansCommentaires = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('les trois bandes — les seuils ne bougent pas d’un pixel', () => {
  it('les bornes sont FERMÉES À GAUCHE, comme les `min-width` du CSS', () => {
    expect(breakpointForWidth(BREAKPOINT_COMPACT - 1)).toBe('compact');
    expect(breakpointForWidth(BREAKPOINT_COMPACT)).toBe('medium');
    expect(breakpointForWidth(BREAKPOINT_WIDE - 1)).toBe('medium');
    expect(breakpointForWidth(BREAKPOINT_WIDE)).toBe('wide');
  });

  it('une largeur pas encore mesurée retombe sur `compact` — jamais sur un débordement', () => {
    // C'est la seule disposition qui ne peut pas déborder : un conteneur dont le
    // `ResizeObserver` n'a pas encore parlé rend 0, et une grille de douze
    // colonnes posée sur zéro pixel déborderait au premier rendu.
    for (const w of [0, -1, Number.NaN, Number.POSITIVE_INFINITY * 0]) {
      expect(breakpointForWidth(w)).toBe('compact');
    }
  });

  it('les trois bandes existent, et il n’y en a que trois', () => {
    const vues = new Set([
      breakpointForWidth(320),
      breakpointForWidth(1000),
      breakpointForWidth(1600),
    ]);
    expect([...vues].sort()).toEqual(['compact', 'medium', 'wide']);
  });
});

describe('la page mesure son CONTENEUR, jamais la fenêtre', () => {
  const vue = lire('components/vaults/settings/VaultSettingsView.tsx');

  it('elle passe par le hook partagé, pas par un `window.innerWidth`', () => {
    const code = sansCommentaires(vue);
    // L'application ne défile PAS dans la fenêtre (`body { overflow: hidden }`) :
    // la largeur de la fenêtre ne dit rien de la surface réellement offerte à
    // cette page, qui vit à côté d'une barre latérale rétractable. C'est le
    // piège exact qui avait faussé l'ancrage de la liste de suggestions.
    expect(code).toContain('useContainerBreakpoint');
    expect(code).not.toContain('window.innerWidth');
    expect(code).not.toContain('matchMedia');
  });

  it('le hook s’appuie sur `ResizeObserver` et sur l’autorité des seuils', () => {
    const hook = lire('styles/useContainerBreakpoint.ts');
    expect(hook).toContain('ResizeObserver');
    expect(hook).toContain('breakpointForWidth');
    // Une première mesure synchrone : sans elle, la page s'affiche une frame en
    // `compact` puis saute — un clignotement à chaque montage.
    expect(hook).toContain('clientWidth');
  });

  /**
   * LES DEUX MESURES DOIVENT MESURER LA MÊME CHOSE, ET `getBoundingClientRect`
   * NE LE FAIT PAS.
   *
   * L'en-tête du hook promet « `contentRect` des deux côtés » : c'est la raison
   * même de son existence, deux écrans le recopiaient à la main et tombaient de
   * part et d'autre du seuil. Or la première mesure faisait
   * `getBoundingClientRect().width` moins les marges et les bordures — une
   * largeur qui inclut ENCORE la barre de défilement du conteneur, là où
   * `ResizeObserver.contentRect` l'exclut. Sur la surface que mesure
   * `VaultSettingsView` (`overflowY: auto`, donc une barre présente), les deux
   * diffèrent d'une quinzaine de pixels : au ras de 840, la page montait le
   * `<Table>` puis le démontait à la frame suivante.
   *
   * `clientWidth` EST la boîte de contenu barre de défilement comprise — la
   * même que `contentRect`, aux marges intérieures près, qu'on retranche.
   */
  it('la première mesure exclut la barre de défilement, comme `contentRect`', () => {
    const hook = sansCommentaires(lire('styles/useContainerBreakpoint.ts'));
    expect(hook).not.toContain('getBoundingClientRect');
  });
});

describe('rien ne peut pousser le corps horizontalement', () => {
  it('le TABLEAU des membres n’existe qu’au-dessus de 840 — en dessous, des cartes', () => {
    const onglet = lire('components/vaults/settings/MembersTab.tsx');
    // Un tableau de six colonnes dans 380 pixels ne se replie pas : il pousse.
    // La bande compacte rend donc une carte par ligne, et le tableau n'est pas
    // monté du tout (le cacher en CSS le laisserait mesurer, donc déborder).
    expect(onglet).toContain("band === 'compact'");
    expect(onglet).toContain('MemberCardList');
  });

  /**
   * LA BANDE COMPACTE PORTE LES MÊMES REPLIS QUE LE TABLEAU.
   *
   * Le `<Table>` distinguait trois vides — chargement, filtre stérile, coffre où
   * l'on est seul ; les cartes n'en rendaient AUCUN. Sous 840 px, les trois
   * donnaient la même surface blanche. La phrase est désormais choisie UNE fois
   * (`rosterPlaceholderKey`, testé à part) et passée aux DEUX surfaces : c'est
   * la même expression, pas deux `if` jumeaux.
   */
  it('un trombinoscope vide DIT pourquoi, en cartes comme en tableau', () => {
    const onglet = sansCommentaires(lire('components/vaults/settings/MembersTab.tsx'));
    expect(onglet).toContain('rosterPlaceholderKey');
    // La même valeur part aux deux branches — la table et les cartes.
    expect([...onglet.matchAll(/emptyMessage=\{rosterEmpty\}/g)].length).toBe(2);
    const cartes = lire('components/vaults/settings/MemberCardList.tsx');
    expect(cartes).toContain('emptyMessage');
    expect(cartes).toContain('rows.length === 0');
  });

  /**
   * LE MENU DE RÔLE DE LA CARTE LIT L'AUTORITÉ, IL NE LA RECOPIE PAS.
   *
   * `InviteRow` porte en en-tête la règle, écrite après le défaut : « les deux
   * écrans les listaient différemment (member/viewer/admin ici,
   * admin/member/viewer là) : le même menu ne doit pas changer d'ordre selon la
   * porte par laquelle on est entré ». La carte compacte l'avait réintroduit tel
   * quel, avec un troisième littéral — dans le fichier dont l'en-tête promet
   * « aucune seconde implémentation ». Un quatrième rôle ajouté demain
   * n'apparaîtrait pas du tout sous 840 px.
   */
  it('les rôles de la carte compacte viennent de `ASSIGNABLE_VAULT_ROLES`', () => {
    const cartes = sansCommentaires(lire('components/vaults/settings/MemberCardList.tsx'));
    expect(cartes).toContain('ASSIGNABLE_VAULT_ROLES');
    expect(cartes).not.toMatch(/\[\s*'(admin|member|viewer)'\s*,/);
  });

  it('le tableau qui RESTE défile dans son propre conteneur', () => {
    // Au-dessus de 840, le tableau peut encore être plus large que la colonne :
    // il défile alors DANS sa carte, jamais dans le corps de la page.
    //
    // ON VISE LE CONTENEUR RÉEL, ET C'EST TOUT L'INTÉRÊT. Une recherche
    // d'`overflow-x: auto` dans la feuille des consoles était satisfaite par
    // `.ent-tabs`, qui existait bien avant cette fiche : le garde portait le
    // titre du tableau et ne gardait rien du tableau. La règle qui compte vit
    // dans `Table.css`, sur le conteneur que `<Table>` pose lui-même autour de
    // son `<table>` (`className="table-container"`).
    const css = lire('components/ui/Table/Table.css');
    const bloc = css.split('.table-container {')[1];
    expect(bloc).toBeDefined();
    expect(bloc.split('}')[0]).toContain('overflow-x: auto');
    expect(lire('components/ui/Table/Table.tsx')).toContain('table-container');
  });

  /**
   * LE REPLI SANS MESURE NE DOIT JAMAIS SE REPLIER PLUS TARD QUE LA BANDE.
   *
   * Deux mécanismes cohabitent, et c'est voulu : les consoles MESURÉES posent
   * une classe de bande (`.ent-console--band-*`, décidée par un
   * `ResizeObserver`), les autres n'ont que la requête média — qui, elle, ne
   * connaît que la FENÊTRE. Aligner la seconde sur le seuil de la première
   * paraissait propre et faisait une RÉGRESSION : entre 840 et 899 px de
   * fenêtre, `OrgDashboard` et les écrans admin (aucune classe de bande) ont
   * gardé leur grille à deux colonnes alors qu'elle se repliait avant.
   *
   * La bonne règle n'est donc pas l'égalité, c'est le SENS : le repli aveugle
   * doit couvrir au moins tout ce que la bande compacte couvre, quitte à se
   * replier plus tôt. Un `max-width` PLUS GRAND se replie plus tôt ; un plus
   * petit laisse un trou. Sur une console mesurée, la classe de bande donne de
   * toute façon le même `1fr` : la requête plus large ne lui coûte rien.
   */
  it('le repli SANS mesure garde SON seuil, et couvre la bande compacte', () => {
    const css = lire('components/settings/enterprise/enterprise.css');
    // Le seuil de 900 px précède cette fiche et ne lui appartient pas : c'est le
    // repli des consoles non migrées. Le descendre à 839 « pour aligner les
    // chiffres » leur a coûté soixante pixels de mise en page.
    expect(css).toContain('@media (max-width: 900px)');
    const seuils = [...css.matchAll(/@media \(max-width: (\d+)px\)/g)].map((m) => Number(m[1]));
    expect(seuils.length).toBeGreaterThan(0);
    // … et aucun repli aveugle ne doit laisser de trou sous la bande compacte.
    for (const seuil of seuils) expect(seuil).toBeGreaterThanOrEqual(BREAKPOINT_COMPACT - 1);
  });

  /**
   * LE VOILE DE LA BARRE D'ONGLETS EST UNE COULEUR DEVINÉE — donc il ne se pose
   * pas partout.
   *
   * L'ombre de défilement de `.ent-tabs` marche par deux voiles OPAQUES peints
   * dans la couleur du fond. Posée sur `.ent-tabs` tout court, la règle
   * s'appliquait à TOUTES les consoles (`OrgDashboard`, les écrans admin) avec
   * `var(--color-background)` codé en dur : partout où la barre est posée sur
   * une surface (`--color-surface`), les deux voiles se voient comme deux bandes
   * de la mauvaise couleur — un défaut d'affichage introduit chez des écrans qui
   * n'avaient rien demandé.
   *
   * Le voile est donc derrière un MODIFICATEUR, et sa couleur est une variable
   * que l'hôte peut redéclarer : on ne peint que là où l'on sait sur quoi.
   */
  it('la barre d’onglets PASSE À LA LIGNE : plus rien à faire défiler, plus de voile', () => {
    const css = lire('components/settings/enterprise/enterprise.css');
    const base = css.split('.ent-tabs {')[1].split('}')[0];
    // Le voile (`.ent-tabs--fade`, `--ent-tabs-veil`) annonçait un défilement
    // horizontal : sur six onglets dans 360 px, les derniers étaient invisibles
    // et rien à l'écran ne le disait. Les onglets passent désormais À LA LIGNE
    // — il n'y a plus rien à faire défiler, donc plus rien à voiler. Ce test
    // garde la nouvelle règle, et interdit le retour d'un voile sans son
    // défilement : les deux vont ensemble ou pas du tout.
    expect(base).toContain('flex-wrap: wrap');
    expect(base).not.toContain('overflow-x');
    expect(css).not.toContain('.ent-tabs--fade');
    // La règle de base reste sans fond : aucune console ne reçoit de voile.
    expect(base).not.toContain('background:');
  });

  it('les bandes de la page sont posées en CLASSES, décidées par la mesure', () => {
    const css = lire('components/settings/enterprise/enterprise.css');
    // `medium` = une colonne, `wide` = la grille à deux. La règle vit dans le
    // CSS mais la DÉCISION vient du conteneur mesuré : une requête média ne
    // pourrait pas la prendre (la fenêtre est plus large que la page).
    expect(css).toContain('.ent-console--band-medium .ent-grid-2');
    expect(css).toContain('.ent-console--band-compact');
  });
});

describe('la barre de sélection remonte au-dessus du clavier virtuel', () => {
  it('elle lit `visualViewport`, et survit à son absence', () => {
    const barre = sansCommentaires(lire('components/vaults/settings/MemberSelectionBar.tsx'));
    expect(barre).toContain('window.visualViewport');
    // Electron n'a pas de clavier virtuel : l'API peut manquer, et la barre doit
    // alors rester exactement où elle était — d'où la sortie anticipée, qui rend
    // quand même son cleanup (TS7030).
    expect(barre).toMatch(/if\s*\(!vv\)\s*return/);
    // Le décalage est BORNÉ à zéro : pendant l'élan d'un défilement, le
    // navigateur rend des valeurs négatives, et une barre qui descendrait sous le
    // bord serait pire que le défaut qu'on corrige.
    expect(barre).toContain('Math.max(0,');
  });
});

/**
 * LA LARGEUR D'UNE COLONNE ÉTAIT UNE DÉCORATION — et personne ne pouvait le voir.
 *
 * LE DÉFAUT, RAPPORTÉ SUR CAPTURE. Dans le trombinoscope, la colonne d'actions
 * affichait « ransmettre » et le bouton rouge « Retirer » coupé au bord droit.
 *
 * LA CAUSE, ET POURQUOI ELLE EST INVISIBLE À LA LECTURE. `.table-cell` porte
 * `flex: 1`, raccourci de `flex-grow:1; flex-shrink:1; flex-basis:0%`. Une base
 * de flex DÉFINIE évince la propriété `width` du calcul de la taille principale :
 * le `width: '210px'` que chaque colonne déclarait depuis toujours n'a jamais
 * rien dimensionné. Les six colonnes se partageaient la ligne à parts égales, et
 * l'`overflow: hidden` de la cellule coupait le reste, sans un mot. Le défaut
 * mordait à TOUTES les largeurs, plein écran compris : ce n'était pas un défaut
 * de repli, et aucun `overflow-x` de plus ne l'aurait touché.
 *
 * CE QUI SE GARDE ICI, ET CE QUI NE SE GARDE PAS. Qu'un bouton tienne dans sa
 * cellule est une propriété de RENDU : la mesurer demanderait un vrai moteur de
 * mise en page, absent de cette suite (cf. l'en-tête de ce fichier). Ce qui est
 * décidable, c'est (1) que la largeur déclarée produise bien une base de flex
 * figée, (2) qu'aucune cellule ne retombe sur l'ancien style inerte, et (3) que
 * l'ADDITION des colonnes montrées tienne dans la bande où le tableau est monté
 * — l'arithmétique que personne n'avait jamais pu poser, faute de largeurs
 * réelles.
 */
describe('la largeur déclarée d’une colonne est une VRAIE largeur', () => {
  it('une largeur déclarée devient une base de flex FIGÉE, pas un partage à parts égales', () => {
    const style = cellStyle({ key: 'actions', header: '', width: '240px', accessor: () => null });
    expect(style.flex).toBe('0 0 240px');
    expect(style.width).toBe('240px');
    // `min-width` reprend la MÊME valeur plutôt que le plancher de la feuille de
    // style : une colonne délibérément plus étroite que lui (90 px pour un
    // drapeau de pays) serait sinon élargie par une règle qui ne parle pas d'elle.
    expect(style.minWidth).toBe('240px');
  });

  it('une colonne SANS largeur garde le partage — c’est elle qui absorbe le reste', () => {
    const style = cellStyle({ key: 'member', header: 'Membre', accessor: () => null });
    expect(style.flex).toBeUndefined();
    expect(style.width).toBeUndefined();
  });

  it('aucune cellule ne retombe sur l’ancien style inerte', () => {
    // Les cinq endroits qui rendent une cellule (squelette, état vide, en-tête,
    // corps) passent tous par `cellStyle`. Ils divergeaient déjà — trois posaient
    // `width` sans `textAlign` — et une largeur qui change selon qu'on charge ou
    // non décalerait les colonnes sous les doigts.
    const src = sansCommentaires(lire('components/ui/Table/Table.tsx'));
    expect(src).not.toContain('style={{ width: column.width }}');
    expect(src).not.toContain('style={{ width: column.width, textAlign: column.align }}');
    expect([...src.matchAll(/style=\{cellStyle\(column\)\}/g)].length).toBe(5);
  });

  it('la colonne SOUPLE a un plancher, et la case à cocher garde le SIEN', () => {
    const css = lire('components/ui/Table/Table.css');
    const cellule = css.split('.table-cell {')[1].split('}')[0];
    // Sans plancher, la colonne du nom tombait à quelques pixels dès que les
    // colonnes figées consommaient la ligne : l'ellipse ne montrait plus une
    // seule lettre, ce qui est pire qu'un défilement.
    expect(cellule).toMatch(/min-width:\s*(\d+)px/);
    // Et la case à cocher ne doit PAS hériter de ce plancher : elle n'a que 18 px
    // à loger, et 120 lui feraient voler cette place à la colonne du nom.
    const case_ = css.split('.table-cell-checkbox {')[1].split('}')[0];
    expect(case_).toContain('min-width: 48px');
  });
});

/**
 * L'ADDITION QUI N'AVAIT JAMAIS PU ÊTRE POSÉE.
 *
 * Tant que les largeurs étaient inertes, écrire `width: '210px'` ne coûtait rien
 * et ne garantissait rien : le chiffre n'a jamais été confronté à son contenu ni
 * à la place disponible. Maintenant qu'il dimensionne vraiment, la somme des
 * colonnes MONTRÉES doit tenir dans la bande où le tableau est monté — sinon la
 * carte se met à défiler horizontalement, ce que la fiche F28 s'emploie
 * précisément à éviter.
 *
 * LA BANDE QUI COMMANDE EST LA MOYENNE, parce que c'est la plus étroite où le
 * tableau existe : sous 840, ce sont des cartes. C'est aussi pour tenir cette
 * addition que la colonne « Identifiant » est retirée hors de la bande large.
 */
describe('les colonnes du trombinoscope tiennent dans la bande où elles s’affichent', () => {
  const onglet = lire('components/vaults/settings/MembersTab.tsx');

  /** Les colonnes déclarées, lues CHEZ ELLES — jamais recopiées dans le test. */
  function colonnes(): Array<{ key: string; width: number }> {
    const bloc = onglet.split('const columns: Column<VaultMemberRow>[] = [')[1];
    if (!bloc) throw new Error('bloc `columns` introuvable — le test ne garde plus rien');
    const entête = bloc.split('\n  ];')[0];
    const trouvées: Array<{ key: string; width: number }> = [];
    for (const m of entête.matchAll(/key: '([a-zA-Z]+)',[\s\S]*?(?=\n {4}\{|$)/g)) {
      const largeur = m[0].match(/width: '(\d+)px'/);
      trouvées.push({ key: m[1], width: largeur ? Number(largeur[1]) : 0 });
    }
    return trouvées;
  }

  /** Le plancher d'une colonne souple et la case à cocher, lus dans la feuille. */
  function planchers(): { souple: number; caseÀCocher: number } {
    const css = lire('components/ui/Table/Table.css');
    const souple = css
      .split('.table-cell {')[1]
      .split('}')[0]
      .match(/min-width:\s*(\d+)px/);
    const boîte = css
      .split('.table-cell-checkbox {')[1]
      .split('}')[0]
      .match(/width:\s*(\d+)px/);
    if (!souple || !boîte) throw new Error('planchers introuvables — le test ne garde plus rien');
    return { souple: Number(souple[1]), caseÀCocher: Number(boîte[1]) };
  }

  it('la lecture des colonnes marche encore — sinon ce garde-fou ne garde rien', () => {
    const noms = colonnes().map((c) => c.key);
    expect(noms).toContain('member');
    expect(noms).toContain('actions');
    expect(colonnes().find((c) => c.key === 'actions')!.width).toBeGreaterThan(0);
    // La colonne « Membre » est la SOUPLE : elle ne déclare pas de largeur, et
    // c'est ce qui lui permet d'absorber ce qui reste.
    expect(colonnes().find((c) => c.key === 'member')!.width).toBe(0);
  });

  it('en bande MOYENNE, l’identifiant est retiré et le reste tient dans 840', () => {
    // La règle est écrite dans l'onglet ; on la lit plutôt que de la deviner.
    expect(sansCommentaires(onglet)).toContain("c.key !== 'userId' || band === 'wide'");

    const { souple, caseÀCocher } = planchers();
    const montrées = colonnes().filter((c) => c.key !== 'userId');
    const figées = montrées.reduce((n, c) => n + c.width, 0);
    // Case à cocher (le rang admin, donc le pire cas) + colonnes figées + le
    // plancher de la colonne souple.
    expect(caseÀCocher + figées + souple).toBeLessThanOrEqual(BREAKPOINT_COMPACT);
  });

  it('en bande LARGE, tout tient — identifiant compris', () => {
    const { souple, caseÀCocher } = planchers();
    const figées = colonnes().reduce((n, c) => n + c.width, 0);
    expect(caseÀCocher + figées + souple).toBeLessThanOrEqual(BREAKPOINT_WIDE);
  });

  it('la colonne d’actions a de quoi loger SES DEUX BOUTONS, dans la langue la plus longue', () => {
    /**
     * POURQUOI UNE ESTIMATION ET PAS UNE MESURE. Aucun moteur de mise en page ici
     * (cf. l'en-tête) ; ce qu'on peut faire, c'est refuser un chiffre dont on sait
     * qu'il est trop petit. « Transmettre » et « Retirer » sont les libellés
     * français, les plus longs des deux langues.
     *
     * LES CONSTANTES SONT CELLES DE LA FEUILLE : `--font-size-sm` vaut 14 px et un
     * caractère y occupe ~0,54 em en moyenne dans cette famille ; un bouton `sm`
     * ajoute 2 × `--spacing-3` (12 px) ; la cellule ajoute 2 × `--table-padding-x`,
     * soit 2 × 12 en taille `sm` ; l'espace entre les deux boutons vaut 6 px.
     * L'estimation est VOLONTAIREMENT basse — elle ne doit attraper que le cas
     * franchement faux, pas discuter du pixel.
     */
    const bouton = (mot: string) => Math.ceil(mot.length * 14 * 0.54) + 24;
    const besoin = bouton('Transmettre') + bouton('Retirer') + 6 + 24;
    const actions = colonnes().find((c) => c.key === 'actions')!;
    expect(actions.width).toBeGreaterThanOrEqual(besoin);
  });
});
