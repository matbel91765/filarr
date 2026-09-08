/**
 * orphanedMembers — « cette personne détient encore la clé de ce coffre, mais
 * elle n'est plus dans l'espace » (F08), et la seule chose qu'il ne faut PAS
 * faire : la déduire d'un silence.
 *
 * CE QUE CES TESTS GARDENT :
 *
 *  · `inSpace` ABSENT N'EST PAS « HORS ». Le champ n'existe que depuis P2 : un
 *    worker d'avant ne l'envoie pas, et une app qui lirait `!m.inSpace`
 *    accuserait TOUT LE MONDE d'être sorti de l'espace — puis proposerait de
 *    faire tourner la clé du coffre pour chacun. C'est le défaut le plus cher
 *    possible ici : le geste réparateur est destructeur (rotation, wraps
 *    refaits, révisions passées laissées sous l'ancienne clé), et il serait
 *    déclenché par une absence d'information. « Terminal ≠ jetable » s'applique
 *    mot pour mot.
 *  · LE BOUTON NE S'AFFICHE QUE LÀ OÙ LE SERVEUR DIRAIT OUI. Un administrateur
 *    ne retire pas un propriétaire, et personne ne se retire soi-même par ce
 *    bouton (« Quitter » est le geste, il vit dans l'onglet Danger) : la liste
 *    « à retirer » n'est donc pas la liste « hors de l'espace ». Un bouton qui
 *    échoue à tous les coups est pire qu'un bouton absent.
 *  · L'INDEX « À TRAITER » COMPTE LA MÊME CHOSE QUE LE BANDEAU. Deux calculs
 *    finiraient par afficher « 1 personne hors de l'espace » au-dessus d'un
 *    onglet Membres qui n'en montre aucune.
 *
 *   npx vitest run src/renderer/components/vaults/settings/__tests__/orphanedMembers.vitest.ts
 */

import { describe, expect, it } from 'vitest';
import { orphanedMembers } from '../orphanedMembers';
import type { VaultMemberRow } from '../vaultManagementModel';

const ligne = (over: Partial<VaultMemberRow> & { userId: string }): VaultMemberRow => ({
  role: 'member',
  joinedAt: '2026-08-01T10:00:00.000Z',
  label: over.userId,
  isSelf: false,
  removable: true,
  canChangeRole: true,
  transferable: false,
  ...over,
});

describe('orphanedMembers — ce que le serveur AFFIRME, et rien de plus', () => {
  it('ne retient que les membres dont le serveur a dit `inSpace: false`', () => {
    const v = orphanedMembers([
      ligne({ userId: 'u-dedans', label: 'a@x.tld', inSpace: true }),
      ligne({ userId: 'u-dehors', label: 'b@x.tld', inSpace: false }),
    ]);
    expect(v.rows.map((r) => r.userId)).toEqual(['u-dehors']);
    expect(v.count).toBe(1);
  });

  it('un `inSpace` ABSENT ne vaut pas « hors » — il vaut « on ne sait pas »', () => {
    const v = orphanedMembers([
      ligne({ userId: 'u-muet', label: 'c@x.tld' }),
      ligne({ userId: 'u-muet2', label: 'd@x.tld' }),
    ]);
    expect(v.rows).toEqual([]);
    expect(v.count).toBe(0);
  });

  it('un coffre entièrement muet (vieux worker) ne déclenche AUCUN bandeau', () => {
    const v = orphanedMembers([
      ligne({ userId: 'u1' }),
      ligne({ userId: 'u2' }),
      ligne({ userId: 'u3', role: 'owner', removable: false }),
    ]);
    expect(v.count).toBe(0);
    expect(v.removable).toEqual([]);
  });

  it('trie par libellé, comme le tableau juste en dessous', () => {
    const v = orphanedMembers([
      ligne({ userId: 'u-z', label: 'zoe@x.tld', inSpace: false }),
      ligne({ userId: 'u-a', label: 'alice@x.tld', inSpace: false }),
    ]);
    expect(v.rows.map((r) => r.label)).toEqual(['alice@x.tld', 'zoe@x.tld']);
  });
});

describe('orphanedMembers — qui peut réellement être retiré d’ici', () => {
  it('laisse le propriétaire hors des retraits, tout en le NOMMANT', () => {
    const v = orphanedMembers([
      ligne({
        userId: 'u-owner',
        label: 'o@x.tld',
        role: 'owner',
        inSpace: false,
        removable: false,
      }),
      ligne({ userId: 'u-m', label: 'm@x.tld', inSpace: false }),
    ]);
    expect(v.rows.map((r) => r.userId)).toEqual(['u-m', 'u-owner']);
    expect(v.removable.map((r) => r.userId)).toEqual(['u-m']);
  });

  it('ne propose jamais de se retirer soi-même — « Quitter » est un autre geste', () => {
    const v = orphanedMembers([
      ligne({
        userId: 'u-moi',
        label: 'moi@x.tld',
        inSpace: false,
        isSelf: true,
        removable: false,
      }),
    ]);
    // Sa situation reste DITE : mon propre accès tient à un fil, et le taire
    // serait la seule information vraiment utile qu'on cacherait.
    expect(v.count).toBe(1);
    expect(v.removable).toEqual([]);
  });

  it('un lecteur ou un membre simple voit le fait sans bouton (rien n’est retirable pour lui)', () => {
    const v = orphanedMembers([
      ligne({ userId: 'u-x', label: 'x@x.tld', inSpace: false, removable: false }),
    ]);
    expect(v.count).toBe(1);
    expect(v.removable).toEqual([]);
  });
});

describe('orphanedMembers — un retrait qui laisse un hors-espace derrière ne s’exécute PAS', () => {
  /**
   * LE FAIT QUE CES TESTS GARDENT, ET IL VIENT DU SERVEUR. Faire tourner la clé
   * exige de la resceller à CHAQUE membre restant, donc d'aller chercher sa clé
   * publique — et `GET /account/public-key/:userId` répond 403 `org_forbidden`
   * sur EXACTEMENT le prédicat qui allume ce bandeau (appartenance à l'org non
   * `active`). Retirer A en laissant B dehors échoue donc sur B, et retirer B en
   * laissant A échoue sur A : deux boutons, deux culs-de-sac, précisément dans
   * la situation que le bandeau existe pour montrer.
   *
   * Le seul geste qui aboutit les emporte TOUS d'un coup, en une rotation — le
   * serveur l'accepte déjà (`removeUserIds` est un tableau et ne valide que la
   * couverture des RESTANTS). Le modèle ne propose donc jamais un retrait
   * partiel : ou bien le groupe entier part, ou bien aucun bouton n'est offert.
   */
  it('deux personnes dehors ⇒ un seul geste, qui les emporte toutes', () => {
    const v = orphanedMembers([
      ligne({ userId: 'u-a', label: 'a@x.tld', inSpace: false }),
      ligne({ userId: 'u-b', label: 'b@x.tld', inSpace: false }),
      ligne({ userId: 'u-dedans', label: 'c@x.tld', inSpace: true }),
    ]);
    expect(v.removeTogether.map((r) => r.userId)).toEqual(['u-a', 'u-b']);
    expect(v.blockers).toEqual([]);
  });

  it('une seule personne dehors ⇒ le même geste, sur un seul nom', () => {
    const v = orphanedMembers([ligne({ userId: 'u-a', label: 'a@x.tld', inSpace: false })]);
    expect(v.removeTogether.map((r) => r.userId)).toEqual(['u-a']);
  });

  it('un hors-espace que je ne peux pas retirer FERME le geste pour tous les autres', () => {
    // Le propriétaire resterait derrière, et c'est à LUI qu'il faudrait
    // resceller K_vault' — la lecture de sa clé publique est refusée. Proposer
    // de retirer l'autre serait promettre une rotation qui échouera.
    const v = orphanedMembers([
      ligne({
        userId: 'u-owner',
        label: 'o@x.tld',
        role: 'owner',
        inSpace: false,
        removable: false,
      }),
      ligne({ userId: 'u-m', label: 'm@x.tld', inSpace: false }),
    ]);
    expect(v.removable.map((r) => r.userId)).toEqual(['u-m']);
    expect(v.removeTogether).toEqual([]);
    expect(v.blockers.map((r) => r.userId)).toEqual(['u-owner']);
  });

  it('moi-même dehors ferme aussi le geste — « Quitter » est l’autre porte', () => {
    const v = orphanedMembers([
      ligne({
        userId: 'u-moi',
        label: 'moi@x.tld',
        inSpace: false,
        isSelf: true,
        removable: false,
      }),
      ligne({ userId: 'u-b', label: 'b@x.tld', inSpace: false }),
    ]);
    expect(v.removeTogether).toEqual([]);
    expect(v.blockers.map((r) => r.userId)).toEqual(['u-moi']);
  });

  it('un silence ne propose rien du tout', () => {
    const v = orphanedMembers([ligne({ userId: 'u1' }), ligne({ userId: 'u2' })]);
    expect(v.removeTogether).toEqual([]);
    expect(v.blockers).toEqual([]);
  });
});
