/**
 * OÙ S'OUVRE UNE NOTE DE COFFRE — « ce que je peux en faire » décide du cadre.
 *
 *   npx vitest run src/renderer/components/vaults/__tests__/vaultNoteOpenTarget.vitest.ts
 *
 * LA RÈGLE. Depuis l'explorateur d'un coffre, un double-clic sur une note ne
 * mène plus toujours au même endroit :
 *   — je ne peux que LIRE  → la FENÊTRE, légère, qu'on referme d'un geste ;
 *   — je peux ÉCRIRE       → l'ÉDITEUR COMPLET, dans l'onglet Notes, exactement
 *                            la destination de la section « Coffres partagés ».
 *
 * ET LE DISCRIMINANT EST « PUIS-JE ÉCRIRE MAINTENANT », PAS LE RÔLE. C'est tout
 * l'objet de ce fichier : un coffre GELÉ (F23) met tout le monde en lecture
 * seule, propriétaire compris, et doit donc envoyer tout le monde à la fenêtre.
 * Un modèle qui ne lirait que le rôle compilerait parfaitement et promettrait un
 * éditeur complet à quelqu'un que le serveur refusera au premier enregistrement.
 *
 * LA MOITIÉ DES CAS TESTÉS ICI SONT DES IGNORANCES, et c'est délibéré : rôle
 * absent, rôle d'une version future, gel qu'on n'a pas su lire. Toutes mènent à
 * la FENÊTRE — le choix qui ne promet rien, et qui se trouve être exactement le
 * comportement d'avant ce chantier.
 *
 * LES TESTS DE CHAÎNE, EUX, LISENT LA SOURCE (même procédé que
 * `vaultNoteCardKind` / `vaultNotesSectionOpen`, et pour la même raison) : ce
 * qu'ils gardent n'est pas un calcul mais un BRANCHEMENT — quatre portes de
 * l'explorateur qui doivent toutes consulter LE MÊME modèle. Une porte oubliée
 * compile ; le symptôme serait une note qui s'ouvre dans une fenêtre au
 * double-clic et dans l'onglet Notes par le menu contextuel, sur le même coffre.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { vaultNoteOpenTarget, canEditVault } from '../vaultExplorerModel';

const vaults = join(__dirname, '..');
const lire = (p: string) => readFileSync(p, 'utf8');

const folderView = lire(join(vaults, 'VaultFolderView.tsx'));
const navigation = lire(join(vaults, '..', 'notes', 'noteShareNavigation.ts'));

describe('le modèle — qui peut écrire va au panneau, les autres à la fenêtre', () => {
  it('un lecteur consulte : la fenêtre', () => {
    expect(vaultNoteOpenTarget({ role: 'viewer', frozen: false })).toBe('modal');
  });

  it('un membre, un administrateur, un propriétaire écrivent : le panneau', () => {
    for (const role of ['member', 'admin', 'owner']) {
      expect(vaultNoteOpenTarget({ role, frozen: false })).toBe('pane');
    }
  });

  it('UN COFFRE GELÉ RENVOIE TOUT LE MONDE À LA FENÊTRE — propriétaire compris', () => {
    // C'est le cas qui justifie que le discriminant ne soit pas le rôle. Le
    // worker pose `blockWhenFrozen` sur les onze routes d'écriture de contenu :
    // un propriétaire de coffre gelé n'écrit pas plus qu'un lecteur.
    for (const role of ['viewer', 'member', 'admin', 'owner']) {
      expect(vaultNoteOpenTarget({ role, frozen: true })).toBe('modal');
    }
  });

  it('un rôle INCONNU mène à la fenêtre — on ne devine pas ce qu’il permet', () => {
    // `ROLE_RANK` du worker ne connaît que quatre rangs ; tout le reste y vaut
    // -1 et se fait refuser partout. Le client ne doit pas être plus généreux :
    // `canEditVault` seul rendrait `true` pour n'importe quelle chaîne qui n'est
    // pas 'viewer', et promettrait donc l'éditeur complet à un rang inventé.
    for (const role of ['editor', 'Owner', 'guest', 'security_admin', '']) {
      expect(vaultNoteOpenTarget({ role, frozen: false })).toBe('modal');
    }
  });

  it('un rôle ABSENT mène à la fenêtre', () => {
    expect(vaultNoteOpenTarget({ role: null, frozen: false })).toBe('modal');
    expect(vaultNoteOpenTarget({ role: undefined, frozen: false })).toBe('modal');
  });

  it('un GEL INDÉTERMINÉ mène à la fenêtre, même pour un propriétaire', () => {
    // Ailleurs dans la matrice, `frozen` vaut faux par défaut : un écran qui n'a
    // pas lu l'état du coffre s'y comporte comme avant la fiche, pour ne pas
    // rendre introuvable un geste légitime. Ici c'est l'inverse qui est prudent,
    // et le repli est le MÊME comportement qu'avant : la fenêtre existe toujours
    // et ne promet rien. Une capacité indéterminée ne doit pas ouvrir la porte
    // large.
    expect(vaultNoteOpenTarget({ role: 'owner', frozen: undefined })).toBe('modal');
    expect(vaultNoteOpenTarget({ role: 'owner', frozen: null })).toBe('modal');
  });

  it('L’AUTORITÉ EST `canEditVault`, pas une seconde règle recopiée', () => {
    // Confronter à l'autorité, jamais à un dérivé : pour les quatre rangs
    // connus, la destination SUIT le droit d'écrire, dans les deux états de gel.
    for (const role of ['viewer', 'member', 'admin', 'owner']) {
      for (const frozen of [false, true]) {
        expect(vaultNoteOpenTarget({ role, frozen })).toBe(
          canEditVault(role, frozen) ? 'pane' : 'modal'
        );
      }
    }
  });
});

describe('les portes de l’explorateur consultent TOUTES le même modèle', () => {
  it('l’explorateur n’écrit la décision qu’UNE fois', () => {
    // Deux appels, ce seraient deux conditions à maintenir — exactement ce que
    // ce chantier interdit. Le passage unique est `openNote`.
    expect(folderView.match(/vaultNoteOpenTarget\(/g)?.length).toBe(1);
    expect(folderView).toMatch(/const openNote = useCallback\(/);
  });

  it('…et `setEditingId` n’est plus atteint que PAR LUI', () => {
    // La fenêtre reste montée par `setEditingId` : c'est ce qui garantit que la
    // branche « lecture » n'a rigoureusement pas changé. Mais aucune autre porte
    // ne doit l'appeler directement, sans quoi elle court-circuiterait la
    // décision et ouvrirait une fenêtre à un rédacteur.
    const appels = folderView.match(/setEditingId\([^)]*\)/g) ?? [];
    // Un seul appel ouvrant (dans `openNote`) ; les autres FERMENT (`null`).
    expect(appels.filter((a) => !a.includes('null'))).toEqual(['setEditingId(itemId)']);
  });

  it('porte 1 — le CLIC et le DOUBLE-CLIC sur une carte', () => {
    // `openFile` sert le clic simple (préférence « ouvrir »), le double-clic
    // (toujours) et le bouton « Ouvrir » de la barre de sélection.
    expect(folderView).toMatch(
      /const openFile = useCallback\([\s\S]{0,400}itemType === 'note'\)\s*\{\s*openNote\(item\.id\);/
    );
  });

  it('porte 2 — le menu contextuel « Ouvrir »', () => {
    expect(folderView).toMatch(/onOpen: \(\) => openNote\(item\.id\)/);
  });

  it('porte 3 — le LIEN PROFOND `?item=…&open=1`', () => {
    expect(folderView).toMatch(/focus\.open &&[\s\S]{0,140}openNote\(item\.id\)/);
    // …et il reste réservé aux notes : un fichier ne s'ouvre pas au seul vu
    // d'une adresse, un marqueur de dossier n'a rien à ouvrir.
    expect(folderView).toMatch(/vaultItemKind\(item\) === 'note'/);
    expect(folderView).toMatch(/!item\.meta\.folderMarker/);
  });

  it('la destination d’écriture est celle de la section « Coffres partagés »', () => {
    // Le MÊME traducteur élément → route, jamais une chaîne fabriquée ici :
    // deux orthographes de la même adresse divergeraient au premier changement.
    expect(folderView).toMatch(/navigate\(vaultNoteDestination\(vaultId, itemId\)\)/);
    expect(folderView).toMatch(/from '\.\.\/notes\/noteShareNavigation'/);
  });
});

describe('le RETOUR depuis le panneau ne rebondit pas', () => {
  it('« ← nom du coffre » MONTRE la note, il ne la rouvre pas', () => {
    /**
     * LA BOUCLE QU'ON FERME ICI. Le retour visait
     * `/vault-folder/<id>?item=<itemId>&open=1`. Tant que `open=1` menait à une
     * fenêtre par-dessus l'explorateur, c'était seulement discutable. Depuis que
     * cette intention est TRANCHÉE par le modèle, elle renverrait un rédacteur
     * au panneau qu'il vient de quitter — un aller-retour infini, en boucle
     * serrée, entre deux onglets.
     *
     * Et c'est de toute façon ce que ce bouton veut dire : rejoindre le dossier
     * qui contient la note (ses voisins, ses réglages, son historique). `?item=`
     * seul fait exactement cela — il place, sélectionne et fait défiler.
     */
    expect(navigation).toMatch(
      /export function vaultNoteExplorerDestination[\s\S]{0,600}return vaultFolderRoute\(vaultId, \{ itemId \}\);/
    );
    const corps = navigation.slice(
      navigation.indexOf('export function vaultNoteExplorerDestination')
    );
    expect(corps).not.toMatch(/open: true/);
  });
});
