import { describe, it, expect } from 'vitest';
import { markKnown, resolveNewVaults } from '../newVaultAccessModel';

/**
 * « CE COFFRE EST NOUVEAU POUR MOI » — décidé SANS RIEN DEMANDER AU SERVEUR.
 *
 * Depuis l'ajout direct (F06), on peut se retrouver membre d'un coffre sans
 * avoir rien accepté : l'hôte a tout fait, il n'y a ni jeton, ni invitation en
 * attente, ni événement à lire. Le seul fait disponible côté client est donc la
 * DIFFÉRENCE entre ce que le serveur liste et ce que cet appareil avait déjà
 * vu — un registre local d'identifiants, par profil.
 *
 * LE PIÈGE QUE CE MODÈLE EXISTE POUR FERMER, et qui est la moitié du sujet :
 * un compte qui ouvre l'application pour la PREMIÈRE fois a un registre vide.
 * Sans précaution, « tout ce qui n'est pas dans le registre » annoncerait ses
 * quinze coffres d'un coup, tous « nouveaux », le jour de son arrivée. Le
 * premier chargement ne fait donc que SEMER, en silence.
 */

describe('resolveNewVaults — le premier semis ne montre rien', () => {
  it('registre jamais semé : rien de neuf, et le registre part avec tout', () => {
    const r = resolveNewVaults(['v1', 'v2', 'v3'], null);
    expect(r.seeded).toBe(true);
    expect(r.newVaultIds).toEqual([]);
    expect(r.nextKnownIds).toEqual(['v1', 'v2', 'v3']);
  });

  it('registre présent mais NON semé : traité comme jamais vu', () => {
    // Un registre écrit par une version antérieure, ou tronqué : ne pas savoir
    // ne doit jamais produire une salve d'annonces.
    const r = resolveNewVaults(['v1', 'v2'], { ids: [], seeded: false });
    expect(r.seeded).toBe(true);
    expect(r.newVaultIds).toEqual([]);
    expect(r.nextKnownIds).toEqual(['v1', 'v2']);
  });

  it('un compte sans aucun coffre sème quand même : le semis suivant sera un vrai neuf', () => {
    const r = resolveNewVaults([], null);
    expect(r.seeded).toBe(true);
    expect(r.newVaultIds).toEqual([]);
    expect(r.nextKnownIds).toEqual([]);

    const apres = resolveNewVaults(['v1'], { ids: [], seeded: true });
    expect(apres.seeded).toBe(false);
    expect(apres.newVaultIds).toEqual(['v1']);
  });
});

describe('resolveNewVaults — ce qui est neuf une fois le registre semé', () => {
  const semé = (ids: string[]) => ({ ids, seeded: true });

  it('ne rend QUE ce que le registre ignore, dans l’ordre du serveur', () => {
    const r = resolveNewVaults(['v1', 'v2', 'v3'], semé(['v2']));
    expect(r.newVaultIds).toEqual(['v1', 'v3']);
  });

  it('rien de neuf : aucune écriture à faire', () => {
    // `null` et pas « le même tableau » : le registre ne doit pas être réécrit à
    // chaque chargement de la liste — c'est du bruit dans localStorage, et un
    // observateur du stockage se réveillerait pour rien.
    const r = resolveNewVaults(['v1', 'v2'], semé(['v1', 'v2']));
    expect(r.newVaultIds).toEqual([]);
    expect(r.nextKnownIds).toBeNull();
  });

  it('LE NEUF N’ENTRE PAS TOUT SEUL DANS LE REGISTRE', () => {
    // Sinon le bandeau vivrait un seul rendu : le chargement suivant le
    // trouverait « déjà vu » et l'annonce disparaîtrait sans que personne ne
    // l'ait lue. Seul un geste (ouvrir, ou écarter) marque le coffre comme vu.
    const r = resolveNewVaults(['v1', 'v2'], semé(['v1']));
    expect(r.newVaultIds).toEqual(['v2']);
    expect(r.nextKnownIds).toBeNull();
  });

  it('un coffre qu’on a quitté sort du registre — et redeviendrait neuf s’il revenait', () => {
    // Un registre qui n'oublie jamais grossit sans borne, et le retour d'un
    // coffre auquel on nous redonne accès est une nouvelle qui mérite d'être
    // dite : c'est exactement le geste de l'hôte qu'on veut annoncer.
    const r = resolveNewVaults(['v1'], semé(['v1', 'parti']));
    expect(r.newVaultIds).toEqual([]);
    expect(r.nextKnownIds).toEqual(['v1']);
  });

  it('les doublons du serveur ne produisent qu’une annonce', () => {
    // La liste est la concaténation de PLUSIEURS espaces (`loadVaults`) : rien
    // ne garantit qu'un identifiant n'y figure qu'une fois.
    const r = resolveNewVaults(['v1', 'v1'], semé([]));
    expect(r.newVaultIds).toEqual(['v1']);
  });
});

describe('markKnown — écarter (ou ouvrir), c’est se souvenir', () => {
  it('ajoute l’identifiant sans écraser les autres', () => {
    const apres = markKnown({ ids: ['v1'], seeded: true }, 'v2');
    expect(apres.ids).toEqual(['v1', 'v2']);
    expect(apres.seeded).toBe(true);
    // Et le coffre écarté cesse d'être annoncé.
    expect(resolveNewVaults(['v1', 'v2'], apres).newVaultIds).toEqual([]);
  });

  it('ne double pas un identifiant déjà connu', () => {
    expect(markKnown({ ids: ['v1'], seeded: true }, 'v1').ids).toEqual(['v1']);
  });

  it('sur un registre jamais semé, écarter SÈME : le geste vaut première visite', () => {
    // Écarter une annonce qu'on n'a pas pu voir est impossible ; mais si le
    // registre disparaissait entre-temps (stockage vidé), il faut qu'il
    // reparte semé, pas vierge — un registre vierge rejouerait la salve.
    const apres = markKnown(null, 'v1');
    expect(apres).toEqual({ ids: ['v1'], seeded: true });
  });
});
