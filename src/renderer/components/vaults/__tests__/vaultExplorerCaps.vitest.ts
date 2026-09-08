/**
 * La matrice du menu d'un ÉLÉMENT de coffre (lot B, étape 6) et l'adaptateur
 * vers le panneau de détails.
 *
 * Ce que ces tests défendent : que « Gérer l'accès » (le dialogue unifié) est
 * bien ouvert à TOUT membre — lecteur compris — sauf sur un marqueur de
 * dossier ; que « Partager avec une personne » reste un raccourci d'ADMIN ; que
 * le panneau de détails existe pour tout contenu ; et que l'adaptateur vers
 * `FileDetailsPanel` tient les deux invariants des « deux mondes » : id
 * PRÉFIXÉ, jamais de clé `items`. Un booléen inversé ici compile très bien.
 */

import { describe, it, expect } from 'vitest';
import {
  canEditVault,
  canDeleteVaultItem,
  canRestoreVaultItem,
  vaultFileCaps,
  vaultFolderCaps,
  toVaultDetailsItem,
  eventsForVaultItem,
  VAULT_ITEM_PREFIX,
  type VaultItemLike,
  type VaultCapsContext,
} from '../vaultExplorerModel';

function item(extra: Partial<VaultItemLike['meta']> = {}, itemType = 'file'): VaultItemLike {
  return {
    id: 'it-1',
    ownerUserId: 'u1',
    itemType,
    sizeBytes: 1234,
    updatedAt: '2026-08-27T10:00:00Z',
    meta: { fileName: 'contrat.pdf', mime: 'application/pdf', path: 'Contrats', ...extra },
  };
}

function ctx(role: string, extra: Partial<VaultCapsContext> = {}): VaultCapsContext {
  return {
    role,
    myUserId: 'u1',
    restrictDownload: false,
    externalSharesDisabled: false,
    searching: false,
    ...extra,
  };
}

describe('vaultFileCaps — la porte « Gérer l’accès »', () => {
  it('est ouverte à tout membre, lecteur compris (le listing se consulte)', () => {
    for (const role of ['owner', 'admin', 'member', 'viewer']) {
      expect(vaultFileCaps(item(), ctx(role), false).manageAccess, role).toBe(true);
    }
  });

  it('est absente sur un marqueur de dossier (rien à partager, rien à lister)', () => {
    const marker = item({ folderMarker: true, title: 'Vide', fileName: undefined });
    const caps = vaultFileCaps(marker, ctx('owner'), false);
    expect(caps.manageAccess).toBe(false);
    expect(caps.shareWithPerson).toBe(false);
    expect(caps.details).toBe(false);
  });

  it('garde « Partager avec une personne » comme raccourci d’ADMIN seulement', () => {
    expect(vaultFileCaps(item(), ctx('admin'), false).shareWithPerson).toBe(true);
    expect(vaultFileCaps(item(), ctx('owner'), false).shareWithPerson).toBe(true);
    expect(vaultFileCaps(item(), ctx('member'), false).shareWithPerson).toBe(false);
    expect(vaultFileCaps(item(), ctx('viewer'), false).shareWithPerson).toBe(false);
  });

  it('propose le panneau de détails à tout membre, pour un fichier comme pour une note', () => {
    expect(vaultFileCaps(item(), ctx('viewer'), false).details).toBe(true);
    expect(vaultFileCaps(item({ title: 'Idées' }, 'note'), ctx('member'), false).details).toBe(
      true
    );
  });

  it('ne change pas la règle du lien public (fichier + rôle qui écrit + org qui l’autorise)', () => {
    expect(vaultFileCaps(item(), ctx('member'), false).share).toBe(true);
    expect(vaultFileCaps(item(), ctx('viewer'), false).share).toBe(false);
    expect(
      vaultFileCaps(item(), ctx('member', { externalSharesDisabled: true }), false).share
    ).toBe(false);
  });
});

describe('vaultFolderCaps — un dossier de coffre : ni accès, ni lien, mais le partage par personne (admin)', () => {
  it('ne propose ni « Gérer l’accès », ni détails, ni lien public', () => {
    const caps = vaultFolderCaps(ctx('owner'));
    expect(caps.manageAccess).toBeUndefined();
    expect(caps.details).toBeUndefined();
    expect(caps.share).toBeUndefined();
  });

  it('« Partager le dossier avec une personne » est un geste d’ADMIN — membre et lecteur ne le voient pas', () => {
    expect(vaultFolderCaps(ctx('owner')).shareWithPerson).toBe(true);
    expect(vaultFolderCaps(ctx('admin')).shareWithPerson).toBe(true);
    expect(vaultFolderCaps(ctx('member')).shareWithPerson).toBe(false);
    expect(vaultFolderCaps(ctx('viewer')).shareWithPerson).toBe(false);
  });
});

describe('toVaultDetailsItem — l’adaptateur vers FileDetailsPanel', () => {
  it('préfixe l’id et recopie nom, MIME, taille et dates', () => {
    const src = { ...item(), createdAt: '2026-08-01T08:00:00Z' };
    const out = toVaultDetailsItem(src, 'Sans titre');
    expect(out).toEqual({
      id: `${VAULT_ITEM_PREFIX}it-1`,
      name: 'contrat.pdf',
      type: 'application/pdf',
      size: 1234,
      createdAt: '2026-08-01T08:00:00Z',
      updatedAt: '2026-08-27T10:00:00Z',
    });
  });

  it('ne porte JAMAIS de clé `items` — sinon le panneau le prendrait pour un dossier', () => {
    const out = toVaultDetailsItem(item(), 'Sans titre');
    expect('items' in out).toBe(false);
  });

  it('nomme une note par son titre, et retombe sur « sans titre » quand rien n’est lisible', () => {
    expect(
      toVaultDetailsItem(item({ fileName: undefined, title: 'Idées' }, 'note'), 'x').name
    ).toBe('Idées');
    expect(
      toVaultDetailsItem(item({ fileName: undefined, title: undefined }), 'Sans titre').name
    ).toBe('Sans titre');
  });

  it('rend un MIME vide plutôt qu’undefined (le panneau affiche alors « Fichier »)', () => {
    expect(toVaultDetailsItem(item({ mime: undefined }), 'x').type).toBe('');
  });
});

describe('eventsForVaultItem — le journal condensé du panneau', () => {
  const ev = (id: number, meta: Record<string, unknown> | null) => ({ id, metadata: meta });
  const events = [
    ev(9, { item_id: 'it-1', kind: 'content' }),
    ev(8, { item_id: 'it-2' }),
    ev(7, null),
    ev(6, { item_id: 'it-1' }),
    ev(5, { vault_id: 'v', item_id: 'it-1' }),
    ev(4, { item_id: 'it-1' }),
  ];

  it('ne garde que les évènements de CET élément, dans l’ordre reçu, bornés à la limite', () => {
    expect(eventsForVaultItem(events, 'it-1', 3).map((e) => e.id)).toEqual([9, 6, 5]);
  });

  it('ignore targetId : pour un grant, c’est le destinataire, pas l’élément', () => {
    const grant = { id: 1, targetId: 'it-1', metadata: { item_id: 'it-9' } };
    expect(eventsForVaultItem([grant], 'it-1', 3)).toEqual([]);
  });

  it('rend vide pour une limite nulle ou un élément sans évènement', () => {
    expect(eventsForVaultItem(events, 'it-1', 0)).toEqual([]);
    expect(eventsForVaultItem(events, 'nope', 3)).toEqual([]);
  });
});

/**
 * F13 — « SUPPRIMER EST RÉSERVÉ AUX ADMINISTRATEURS », le réglage de coffre.
 *
 * Le serveur l'applique en UN point (`DELETE /:id/items/:itemId` → 403
 * `setting_forbidden`). Le client doit reproduire la même règle, sans quoi il
 * propose « Supprimer » avec sa confirmation à quelqu'un qui récoltera un refus
 * — exactement le défaut que le premier échelon de cette matrice avait déjà
 * fermé pour les lecteurs.
 *
 * MAIS IL NE DOIT PAS ÊTRE PLUS STRICT NON PLUS : le réglage par défaut, et
 * celui d'un coffre dont on n'a pas su lire les réglages, laisse le déposant
 * supprimer ce qu'il a déposé. Retirer ce bouton sur une panne réseau rendrait
 * introuvable un geste parfaitement légitime.
 */
describe('canDeleteVaultItem — le réglage « suppression réservée aux admins »', () => {
  const mien = { ownerUserId: 'u1' };
  const autre = { ownerUserId: 'u2' };

  it('sans le réglage : le déposant supprime ce qu’il a déposé', () => {
    expect(canDeleteVaultItem(mien, 'member', 'u1')).toBe(true);
    expect(canDeleteVaultItem(autre, 'member', 'u1')).toBe(false);
    expect(canDeleteVaultItem(autre, 'admin', 'u1')).toBe(true);
  });

  it('avec le réglage : seul un administrateur supprime, même son propre dépôt', () => {
    expect(canDeleteVaultItem(mien, 'member', 'u1', true)).toBe(false);
    expect(canDeleteVaultItem(mien, 'admin', 'u1', true)).toBe(true);
    expect(canDeleteVaultItem(mien, 'owner', 'u1', true)).toBe(true);
  });

  it('le premier échelon reste le rôle : un lecteur ne supprime jamais', () => {
    expect(canDeleteVaultItem(mien, 'viewer', 'u1')).toBe(false);
    expect(canDeleteVaultItem(mien, 'viewer', 'u1', true)).toBe(false);
  });

  it('la matrice du menu suit le réglage, dossier compris', () => {
    // Un dossier de coffre n'est qu'un préfixe : sa suppression est RÉCURSIVE et
    // se décide élément par élément. La porte, elle, doit se fermer aussi —
    // sinon l'écran ouvre un plan qui n'a rien à faire.
    expect(vaultFileCaps(item(), ctx('member'), false).delete).toBe(true);
    expect(
      vaultFileCaps(item(), ctx('member', { itemDeleteRequiresAdmin: true }), false).delete
    ).toBe(false);
    expect(vaultFolderCaps(ctx('member')).delete).toBe(true);
    expect(vaultFolderCaps(ctx('member', { itemDeleteRequiresAdmin: true })).delete).toBe(false);
    expect(vaultFolderCaps(ctx('admin', { itemDeleteRequiresAdmin: true })).delete).toBe(true);
  });

  it('RESTAURER n’est PAS gardé par ce réglage — le serveur ne le garde pas', () => {
    // `POST /:id/items/:itemId/restore` s'arrête à « déposant OU admin » et ne
    // lit pas les réglages : le réglage s'appelle « suppression réservée aux
    // administrateurs », pas « corbeille réservée ». Le reproduire ici
    // retirerait un bouton qui, lui, aboutit — et un client plus strict que le
    // serveur rend introuvable un geste légitime. La signature à trois
    // arguments est ce qui empêche de le brancher par distraction.
    expect(canRestoreVaultItem(mien, 'member', 'u1')).toBe(true);
    expect(canRestoreVaultItem(autre, 'member', 'u1')).toBe(false);
    expect(canRestoreVaultItem(mien, 'viewer', 'u1')).toBe(false);
  });
});

/**
 * F23 — LE GEL DU COFFRE, DANS LA MATRICE DES MENUS.
 *
 * Le serveur refuse les écritures de CONTENU d'un coffre gelé avec un 409
 * `vault_frozen` — et RIEN d'autre : retirer quelqu'un, révoquer une invitation,
 * renouveler la clé, quitter, dégeler restent ouverts. Le client doit reproduire
 * exactement cette frontière-là.
 *
 * DEUX ERREURS SYMÉTRIQUES SONT POSSIBLES, ET AUCUNE NE SE COMPILE EN ROUGE :
 *  · trop PERMISSIF — proposer « Supprimer » et sa confirmation sur un coffre
 *    gelé, pour récolter un refus au dernier moment ;
 *  · trop STRICT — faire disparaître le TÉLÉCHARGEMENT, alors que geler veut
 *    précisément dire « ça reste lisible ». C'est le piège de `download`, dont
 *    la règle (politique d'org « les lecteurs ne téléchargent pas ») est une
 *    affaire de RÔLE et n'a rien à voir avec le gel.
 */
describe('canEditVault / vaultFileCaps — le gel (F23)', () => {
  it('canEditVault : le gel retire l’écriture à tout le monde, le rôle reste le premier échelon', () => {
    expect(canEditVault('member')).toBe(true);
    expect(canEditVault('member', false)).toBe(true);
    expect(canEditVault('member', true)).toBe(false);
    expect(canEditVault('owner', true)).toBe(false);
    // Un lecteur n'écrivait déjà pas : le gel ne change rien pour lui.
    expect(canEditVault('viewer', true)).toBe(false);
  });

  it('les gestes d’ÉCRITURE disparaissent sur un coffre gelé', () => {
    const gele = vaultFileCaps(item(), ctx('owner', { frozen: true }), false);
    expect(gele.rename).toBe(false);
    expect(gele.replace).toBe(false);
    expect(gele.move).toBe(false);
    expect(gele.delete).toBe(false);
    // Le partage par personne SCELLE un accès : c'est une écriture, refusée par
    // `blockWhenFrozen` sur la route des grants.
    expect(gele.shareWithPerson).toBe(false);
    expect(gele.share).toBe(false);
  });

  it('les gestes de LECTURE restent — c’est toute la différence entre geler et fermer', () => {
    const gele = vaultFileCaps(item(), ctx('owner', { frozen: true }), false);
    expect(gele.preview).toBe(true);
    expect(gele.details).toBe(true);
    expect(gele.versions).toBe(true);
    expect(gele.manageAccess).toBe(true);
    expect(gele.download).toBe(true);
  });

  it('LE PIÈGE : la politique « les lecteurs ne téléchargent pas » suit le RÔLE, jamais le gel', () => {
    // Sans cette garde, un coffre gelé dans un espace qui restreint le
    // téléchargement rendrait son contenu illisible à ses propres membres —
    // c'est-à-dire l'inverse exact de ce que le gel promet.
    const restreint = { restrictDownload: true };
    expect(vaultFileCaps(item(), ctx('member', restreint), false).download).toBe(true);
    expect(
      vaultFileCaps(item(), ctx('member', { ...restreint, frozen: true }), false).download
    ).toBe(true);
    // Un LECTEUR, lui, reste privé de téléchargement — gel ou pas.
    expect(vaultFileCaps(item(), ctx('viewer', restreint), false).download).toBe(false);
    expect(
      vaultFileCaps(item(), ctx('viewer', { ...restreint, frozen: true }), false).download
    ).toBe(false);
  });

  it('un dossier gelé ne se renomme, ne se déplace, ne se supprime ni ne se partage plus', () => {
    const gele = vaultFolderCaps(ctx('owner', { frozen: true }));
    expect(gele.open).toBe(true);
    expect(gele.rename).toBe(false);
    expect(gele.move).toBe(false);
    expect(gele.delete).toBe(false);
    expect(gele.shareWithPerson).toBe(false);
  });

  it('le gel ABSENT du contexte ne gèle rien — un écran qui l’ignore se comporte comme avant', () => {
    // Même discipline que `itemDeleteRequiresAdmin` : ne jamais retirer un geste
    // sur une ignorance. Un `frozen` absent vaut « pas gelé », et le serveur
    // garde le dernier mot avec sa phrase (`vault_frozen`, déjà traduite).
    expect(vaultFileCaps(item(), ctx('member'), false).delete).toBe(true);
    expect(vaultFolderCaps(ctx('member')).delete).toBe(true);
  });

  it('RESTAURER de la corbeille est bien fermé par le gel — la route le refuse aussi', () => {
    // `POST /:id/items/:itemId/restore` porte `blockWhenFrozen` : sortir un
    // élément de la corbeille RÉÉCRIT le coffre.
    expect(canRestoreVaultItem({ ownerUserId: 'u1' }, 'member', 'u1', true)).toBe(false);
    expect(canRestoreVaultItem({ ownerUserId: 'u1' }, 'member', 'u1', false)).toBe(true);
  });
});
