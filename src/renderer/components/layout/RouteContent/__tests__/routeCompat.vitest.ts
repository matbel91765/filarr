/**
 * routeCompat — la normalisation des routes anciennes et la réécriture des
 * onglets persistés (lot A, C3).
 *
 *   npx vitest run src/renderer/components/layout/RouteContent/__tests__/routeCompat.vitest.ts
 */

import { describe, expect, it } from 'vitest';
import {
  isLegacyRoute,
  normalizeRoute,
  rewriteLegacyTabRoutes,
  vaultFolderRoute,
  vaultIdFromRoute,
  vaultTargetFromRoute,
  notesVaultNoteRoute,
  notesVaultNoteFromRoute,
  VAULT_FOCUS_QUERY_PARAM,
  VAULT_TAB_QUERY_PARAM,
  VAULT_VIEW_QUERY_PARAM,
} from '../routeCompat';

describe('normalizeRoute', () => {
  const table: Array<[string, string]> = [
    // Legacy → canonique
    ['/vaults', '/'],
    ['/vaults/', '/'],
    ['/vaults/abc', '/vault-folder/abc'],
    ['/vaults/8d1f-uuid-with-dashes', '/vault-folder/8d1f-uuid-with-dashes'],
    // C5 : « Partagé avec moi » vit dans le bandeau de l'accueil.
    ['/shared-with-me', '/'],
    ['/shared-with-me/', '/'],
    // Non legacy → INCHANGÉ
    ['/', '/'],
    ['/vault', '/vault'],
    ['/vaultsX', '/vaultsX'],
    ['/shared-with-meX', '/shared-with-meX'],
    ['/vault-folder/abc', '/vault-folder/abc'],
    ['/folder/vault:abc', '/folder/vault:abc'],
    ['/notes/42', '/notes/42'],
    ['/settings', '/settings'],
    ['', ''],
  ];

  it.each(table)('%s → %s', (input, expected) => {
    expect(normalizeRoute(input)).toBe(expected);
  });

  it('rend la MÊME référence quand rien ne change (les appelants testent l’égalité)', () => {
    const r = '/folder/abc';
    expect(normalizeRoute(r)).toBe(r);
  });

  it('isLegacyRoute ne reconnaît que ce que normalizeRoute réécrit', () => {
    expect(isLegacyRoute('/vaults')).toBe(true);
    expect(isLegacyRoute('/vaults/x')).toBe(true);
    expect(isLegacyRoute('/vault-folder/x')).toBe(false);
    expect(isLegacyRoute('/vault')).toBe(false);
    expect(isLegacyRoute('/')).toBe(false);
  });

  it('/shared-with-me se replie sur l’accueil (C5) et compte comme legacy', () => {
    expect(normalizeRoute('/shared-with-me')).toBe('/');
    expect(isLegacyRoute('/shared-with-me')).toBe(true);
    // Un onglet persisté sur l'ancienne page reprend le titre de l'accueil,
    // exactement comme `/vaults`.
    const out = rewriteLegacyTabRoutes({
      panels: [
        {
          tabs: [
            { id: 'home', title: 'Accueil', route: '/' },
            { id: 's', title: 'Shared with me', route: '/shared-with-me' },
          ],
        },
      ],
    });
    expect(out.panels![0].tabs![1].route).toBe('/');
    expect(out.panels![0].tabs![1].title).toBe('Accueil');
  });
});

describe('les entrées de barre latérale retirées (lot A, C5-C6)', () => {
  // Trois adresses ont perdu leur entrée et leur branche de rendu : « Coffres
  // partagés » (/vaults), « Partagé avec moi » (/shared-with-me) et l'ouverture
  // d'un coffre depuis l'ancienne page (/vaults/<id>). Un raccourci, un onglet
  // persisté ou un lien profond encore à l'ancienne orthographe doit atterrir
  // au bon endroit — RouteContent ne rend plus ces chemins, il ne fait que les
  // normaliser en tête.
  it.each([
    ['/vaults', '/'],
    ['/shared-with-me', '/'],
    ['/vaults/v-42', vaultFolderRoute('v-42')],
  ])('%s → %s', (legacy, canonical) => {
    expect(isLegacyRoute(legacy)).toBe(true);
    expect(normalizeRoute(legacy)).toBe(canonical);
    // La forme canonique est un point fixe : normaliser deux fois ne bouge plus.
    expect(normalizeRoute(canonical)).toBe(canonical);
    expect(isLegacyRoute(canonical)).toBe(false);
  });
});

describe('vaultFolderRoute / vaultIdFromRoute', () => {
  it('aller-retour', () => {
    expect(vaultFolderRoute('abc')).toBe('/vault-folder/abc');
    expect(vaultIdFromRoute(vaultFolderRoute('abc'))).toBe('abc');
  });

  it('ne lit pas un identifiant dans une route étrangère', () => {
    expect(vaultIdFromRoute('/vaults/abc')).toBeNull();
    expect(vaultIdFromRoute('/vault-folder/')).toBeNull();
    expect(vaultIdFromRoute('/vault-folder')).toBeNull();
    expect(vaultIdFromRoute('/folder/abc')).toBeNull();
  });
});

describe('rewriteLegacyTabRoutes (transform de persistance, côté sortant)', () => {
  const persisted = {
    panels: [
      {
        id: 'panel-main',
        activeTabId: 't2',
        tabs: [
          { id: 'home', title: 'Accueil', route: '/', closable: false },
          { id: 't2', title: 'Mon coffre', route: '/vaults/v-42', closable: true },
          { id: 't3', title: 'Team Vaults', route: '/vaults', closable: true },
          { id: 't4', title: 'Docs', route: '/folder/f-1', closable: true, folderId: 'f-1' },
        ],
      },
    ],
    focusedPanelId: 'panel-main',
    splitDirection: 'none',
    splitRatio: 0.5,
    maxTabs: 15,
  };

  it('réécrit un onglet /vaults/<id> persisté en /vault-folder/<id>, titre conservé', () => {
    const out = rewriteLegacyTabRoutes(persisted);
    const t2 = out.panels![0].tabs!.find((t) => (t as { id: string }).id === 't2')!;
    expect(t2.route).toBe('/vault-folder/v-42');
    expect(t2.title).toBe('Mon coffre');
    expect((t2 as { closable: boolean }).closable).toBe(true);
  });

  it('réécrit /vaults en / et lui donne le titre de l’onglet d’accueil', () => {
    const out = rewriteLegacyTabRoutes(persisted);
    const t3 = out.panels![0].tabs!.find((t) => (t as { id: string }).id === 't3')!;
    expect(t3.route).toBe('/');
    expect(t3.title).toBe('Accueil');
  });

  it('laisse les autres onglets et le reste de l’état intacts', () => {
    const out = rewriteLegacyTabRoutes(persisted);
    const t4 = out.panels![0].tabs!.find((t) => (t as { id: string }).id === 't4')!;
    expect(t4).toBe(persisted.panels[0].tabs[3]);
    expect(out.focusedPanelId).toBe('panel-main');
    expect(out.panels![0].activeTabId).toBe('t2');
    expect(out.maxTabs).toBe(15);
    // L'entrée n'est jamais mutée.
    expect(persisted.panels[0].tabs[1].route).toBe('/vaults/v-42');
  });

  it('rend la MÊME référence quand aucun onglet n’est legacy', () => {
    const clean = {
      panels: [
        {
          id: 'panel-main',
          activeTabId: 'home',
          tabs: [
            { id: 'home', title: 'Accueil', route: '/', closable: false },
            { id: 'v', title: 'Mon coffre', route: '/vault-folder/v-42', closable: true },
          ],
        },
      ],
      focusedPanelId: 'panel-main',
    };
    expect(rewriteLegacyTabRoutes(clean)).toBe(clean);
  });

  it('tolère un état absent ou sans panneaux', () => {
    expect(rewriteLegacyTabRoutes(undefined as unknown as { panels?: [] })).toBeUndefined();
    const noPanels = { foo: 1 };
    expect(rewriteLegacyTabRoutes(noPanels)).toBe(noPanels);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// La CIBLE d'un raccourci : `/vault-folder/<id>?item=<itemId>`
// ─────────────────────────────────────────────────────────────────────────────

describe('vaultFolderRoute avec cible (?item=)', () => {
  it('sans opts, la chaîne est INCHANGÉE (rétro-compatible)', () => {
    expect(vaultFolderRoute('abc')).toBe('/vault-folder/abc');
    expect(vaultFolderRoute('abc', {})).toBe('/vault-folder/abc');
    expect(vaultFolderRoute('abc', { itemId: undefined })).toBe('/vault-folder/abc');
    expect(vaultFolderRoute('abc', { itemId: '' })).toBe('/vault-folder/abc');
  });

  it('avec itemId, pose la requête', () => {
    expect(vaultFolderRoute('abc', { itemId: 'it-1' })).toBe('/vault-folder/abc?item=it-1');
  });

  it('aller-retour, avec et sans élément', () => {
    expect(vaultTargetFromRoute(vaultFolderRoute('abc'))).toEqual({ vaultId: 'abc' });
    expect(vaultTargetFromRoute(vaultFolderRoute('abc', { itemId: 'it-1' }))).toEqual({
      vaultId: 'abc',
      itemId: 'it-1',
    });
    // Un identifiant qui a besoin d'être encodé survit à l'aller-retour.
    const exotique = 'a b&c=d/é';
    expect(vaultTargetFromRoute(vaultFolderRoute('abc', { itemId: exotique }))).toEqual({
      vaultId: 'abc',
      itemId: exotique,
    });
  });

  it('vaultIdFromRoute IGNORE la requête : l identité du coffre ne la contient pas', () => {
    expect(vaultIdFromRoute('/vault-folder/abc?item=it-1')).toBe('abc');
    expect(vaultIdFromRoute('/vault-folder/abc?autre=1')).toBe('abc');
  });

  it('tolère une requête étrangère, vide ou malformée', () => {
    expect(vaultTargetFromRoute('/vault-folder/abc?autre=1')).toEqual({ vaultId: 'abc' });
    expect(vaultTargetFromRoute('/vault-folder/abc?')).toEqual({ vaultId: 'abc' });
    expect(vaultTargetFromRoute('/vault-folder/abc?item=')).toEqual({ vaultId: 'abc' });
    expect(vaultTargetFromRoute('/vault-folder/abc?item')).toEqual({ vaultId: 'abc' });
    expect(vaultTargetFromRoute('/vault-folder/abc?x=1&item=it-2&y=2')).toEqual({
      vaultId: 'abc',
      itemId: 'it-2',
    });
    // Une séquence % cassée ne perd pas la cible : valeur brute conservée.
    expect(vaultTargetFromRoute('/vault-folder/abc?item=%E0%A4%A')).toEqual({
      vaultId: 'abc',
      itemId: '%E0%A4%A',
    });
  });

  it('rend null pour toute route étrangère', () => {
    expect(vaultTargetFromRoute('/vaults/abc?item=x')).toBeNull();
    expect(vaultTargetFromRoute('/folder/abc?item=x')).toBeNull();
    expect(vaultTargetFromRoute('/vault-folder/?item=x')).toBeNull();
    expect(vaultTargetFromRoute('/vault-folder')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// La PAGE « Gérer le coffre » : `?view=settings[&tab=…][&focus=…]` (F01)
// ─────────────────────────────────────────────────────────────────────────────

describe('la page de gestion : ?view / ?tab / ?focus', () => {
  it('les noms des paramètres sont exportés (personne ne les réécrit à la main)', () => {
    expect(VAULT_VIEW_QUERY_PARAM).toBe('view');
    expect(VAULT_TAB_QUERY_PARAM).toBe('tab');
    expect(VAULT_FOCUS_QUERY_PARAM).toBe('focus');
  });

  it('vaultFolderRoute pose la vue, l’onglet et la mise au point', () => {
    expect(vaultFolderRoute('abc', { view: 'settings' })).toBe('/vault-folder/abc?view=settings');
    expect(vaultFolderRoute('abc', { view: 'settings', tab: 'members' })).toBe(
      '/vault-folder/abc?view=settings&tab=members'
    );
    expect(vaultFolderRoute('abc', { view: 'settings', tab: 'invitations', focus: 'u-1' })).toBe(
      '/vault-folder/abc?view=settings&tab=invitations&focus=u-1'
    );
  });

  it('une cible d’élément et la vue cohabitent, dans les DEUX sens de lecture', () => {
    expect(vaultFolderRoute('abc', { itemId: 'it-1', view: 'settings' })).toBe(
      '/vault-folder/abc?item=it-1&view=settings'
    );
    // La boucle de lecture ne s'arrête plus au premier paramètre reconnu :
    // l'ordre dans la requête ne décide de rien.
    expect(vaultTargetFromRoute('/vault-folder/abc?item=it-1&view=settings')).toEqual({
      vaultId: 'abc',
      itemId: 'it-1',
      view: 'settings',
    });
    expect(vaultTargetFromRoute('/vault-folder/abc?view=settings&item=it-1')).toEqual({
      vaultId: 'abc',
      itemId: 'it-1',
      view: 'settings',
    });
  });

  it('aller-retour complet', () => {
    const route = vaultFolderRoute('v-42', {
      view: 'settings',
      tab: 'invitations',
      focus: 'u-7',
    });
    expect(vaultTargetFromRoute(route)).toEqual({
      vaultId: 'v-42',
      view: 'settings',
      tab: 'invitations',
      focus: 'u-7',
    });
  });

  it('une valeur de `view` inconnue est IGNORÉE (jamais un écran deviné)', () => {
    expect(vaultTargetFromRoute('/vault-folder/abc?view=danger')).toEqual({ vaultId: 'abc' });
    expect(vaultTargetFromRoute('/vault-folder/abc?view=')).toEqual({ vaultId: 'abc' });
    expect(vaultTargetFromRoute('/vault-folder/abc?view')).toEqual({ vaultId: 'abc' });
    // …mais ce qui l'accompagne reste lisible : l'onglet n'est pas perdu avec elle.
    expect(vaultTargetFromRoute('/vault-folder/abc?view=nope&tab=members')).toEqual({
      vaultId: 'abc',
      tab: 'members',
    });
  });

  it('`tab` et `focus` sont rendus tels quels, décodés', () => {
    expect(vaultTargetFromRoute('/vault-folder/abc?view=settings&tab=activite')).toEqual({
      vaultId: 'abc',
      view: 'settings',
      tab: 'activite',
    });
    const exotique = 'a b&c=d/é';
    expect(vaultTargetFromRoute(vaultFolderRoute('abc', { focus: exotique }))).toEqual({
      vaultId: 'abc',
      focus: exotique,
    });
  });

  it('vaultIdFromRoute IGNORE toujours la requête, vue comprise', () => {
    expect(vaultIdFromRoute('/vault-folder/abc?view=settings&tab=members')).toBe('abc');
  });

  it('la forme canonique reste un point fixe de normalizeRoute', () => {
    const r = vaultFolderRoute('abc', { view: 'settings', tab: 'members' });
    expect(normalizeRoute(r)).toBe(r);
    expect(isLegacyRoute(r)).toBe(false);
    // Et une route ancienne garde sa vue en traversant la normalisation.
    expect(normalizeRoute('/vaults/abc?view=settings&tab=members')).toBe(r);
  });

  it('sans opts, la chaîne ne bouge pas (rétro-compatibilité)', () => {
    expect(vaultFolderRoute('abc', { view: undefined, tab: '', focus: '' })).toBe(
      '/vault-folder/abc'
    );
  });
});

describe('normalizeRoute laisse passer la requête', () => {
  it('/vaults/<id>?item=x → /vault-folder/<id>?item=x', () => {
    expect(normalizeRoute('/vaults/abc?item=it-1')).toBe('/vault-folder/abc?item=it-1');
    expect(isLegacyRoute('/vaults/abc?item=it-1')).toBe(true);
    expect(vaultTargetFromRoute(normalizeRoute('/vaults/abc?item=it-1'))).toEqual({
      vaultId: 'abc',
      itemId: 'it-1',
    });
  });

  it('la forme canonique avec requête est un point fixe (même référence)', () => {
    const r = '/vault-folder/abc?item=it-1';
    expect(normalizeRoute(r)).toBe(r);
    expect(isLegacyRoute(r)).toBe(false);
  });

  it('un onglet persisté avec cible est réécrit en gardant la cible', () => {
    const out = rewriteLegacyTabRoutes({
      panels: [
        {
          tabs: [
            { id: 'home', title: 'Accueil', route: '/' },
            { id: 'v', title: 'Mon coffre', route: '/vaults/v-42?item=it-9' },
          ],
        },
      ],
    });
    expect(out.panels![0].tabs![1].route).toBe('/vault-folder/v-42?item=it-9');
    expect(out.panels![0].tabs![1].title).toBe('Mon coffre');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// L'INTENTION D'OUVRIR (`?open=1`) — la section « Coffres partagés » des Notes
// ─────────────────────────────────────────────────────────────────────────────

describe('vaultFolderRoute avec intention d ouverture (?open=1)', () => {
  it('sans intention, la chaine est INCHANGEE : aucun appelant existant ne bouge', () => {
    expect(vaultFolderRoute('abc', { itemId: 'it-1' })).toBe('/vault-folder/abc?item=it-1');
    expect(vaultFolderRoute('abc', { itemId: 'it-1', open: false })).toBe(
      '/vault-folder/abc?item=it-1'
    );
  });

  it('avec intention, la requete la porte apres la cible', () => {
    expect(vaultFolderRoute('abc', { itemId: 'it-1', open: true })).toBe(
      '/vault-folder/abc?item=it-1&open=1'
    );
  });

  it('aller-retour', () => {
    expect(vaultTargetFromRoute(vaultFolderRoute('abc', { itemId: 'it-1', open: true }))).toEqual({
      vaultId: 'abc',
      itemId: 'it-1',
      open: true,
    });
  });

  it('une intention SANS cible ne veut rien dire : elle est jetee', () => {
    // Ouvrir « quoi » ? Sans element vise, la route ouvrirait l'explorateur en
    // promettant un editeur. On ne devine pas un element.
    expect(vaultFolderRoute('abc', { open: true })).toBe('/vault-folder/abc');
    expect(vaultTargetFromRoute('/vault-folder/abc?open=1')).toEqual({ vaultId: 'abc' });
  });

  it('toute valeur autre que 1 n ouvre RIEN', () => {
    // Meme discipline que la vue inconnue : on ne devine pas un ecran. Un
    // `open=0` herite d'un vieil onglet ne doit pas ouvrir une modale.
    expect(vaultTargetFromRoute('/vault-folder/abc?item=it-1&open=0')).toEqual({
      vaultId: 'abc',
      itemId: 'it-1',
    });
    expect(vaultTargetFromRoute('/vault-folder/abc?item=it-1&open=true')).toEqual({
      vaultId: 'abc',
      itemId: 'it-1',
    });
  });

  it('l identite du coffre ignore l intention', () => {
    expect(vaultIdFromRoute('/vault-folder/abc?item=it-1&open=1')).toBe('abc');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// UNE NOTE DE COFFRE OUVERTE DANS L'ONGLET NOTES
// ─────────────────────────────────────────────────────────────────────────────

describe('notesVaultNoteRoute — l adresse d une note de coffre DANS l onglet Notes', () => {
  it('aller-retour : ce qu on ecrit est ce qu on relit', () => {
    const route = notesVaultNoteRoute('coffre-1', 'element-1');
    expect(route).toBe('/notes/vault/coffre-1/element-1');
    expect(notesVaultNoteFromRoute(route)).toEqual({ vaultId: 'coffre-1', itemId: 'element-1' });
  });

  it('L ADRESSE EST DANS LE CHEMIN, PAS DANS LA REQUETE — et c est la raison d etre', () => {
    // `useTabNavigation` n'enregistre que `location.pathname` dans l'onglet, et
    // c'est l'onglet que redux-persist conserve. Une note portee par `?item=`
    // survivrait a un clic mais PAS a un rechargement ni a un aller-retour entre
    // onglets : on rouvrirait un panneau de notes vide. Le chemin, lui, survit.
    expect(notesVaultNoteRoute('c', 'i')).not.toContain('?');
  });

  it('elle ne se confond avec AUCUNE note personnelle', () => {
    // `/notes/<id>` reste la note personnelle : la forme de coffre a trois
    // segments et commence par `vault`, qu'aucun identifiant de note ne peut
    // prendre (un segment ne contient pas de barre oblique).
    expect(notesVaultNoteFromRoute('/notes/8d1f-uuid')).toBeNull();
    expect(notesVaultNoteFromRoute('/notes')).toBeNull();
    expect(notesVaultNoteFromRoute('/notes/vault')).toBeNull();
    expect(notesVaultNoteFromRoute('/notes/vault/coffre-1')).toBeNull();
    expect(notesVaultNoteFromRoute('/vault-folder/coffre-1')).toBeNull();
  });

  it('un segment de trop n est pas devine — mieux vaut rien qu une cible fausse', () => {
    expect(notesVaultNoteFromRoute('/notes/vault/c/i/en-plus')).toBeNull();
  });

  it('les identifiants sont encodes, et relus decodes', () => {
    const route = notesVaultNoteRoute('cof fre', 'el/ement');
    expect(route).toBe('/notes/vault/cof%20fre/el%2Fement');
    expect(notesVaultNoteFromRoute(route)).toEqual({ vaultId: 'cof fre', itemId: 'el/ement' });
  });

  it('un identifiant vide ne fabrique pas une adresse boiteuse', () => {
    expect(notesVaultNoteFromRoute('/notes/vault//i')).toBeNull();
    expect(notesVaultNoteFromRoute('/notes/vault/c/')).toBeNull();
  });
});
