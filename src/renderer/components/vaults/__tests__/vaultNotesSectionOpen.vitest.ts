/**
 * LE FIL « une note de coffre s'ouvre dans le VRAI éditeur, à plusieurs, SANS
 * QUITTER L'ONGLET NOTES » — de la ligne cliquée jusqu'à la salle collaborative.
 *
 *   npx vitest run src/renderer/components/vaults/__tests__/vaultNotesSectionOpen.vitest.ts
 *
 * POURQUOI CE TEST LIT LA SOURCE. Ce qu'il garde n'est pas un calcul — le
 * calcul est éprouvé à côté (`vaultNotesSection`, `routeCompat`) — c'est une
 * CHAÎNE : cinq fichiers qui doivent se passer la même intention sans qu'aucun
 * ne la laisse tomber. Chaque maillon compile parfaitement s'il est rompu ; le
 * symptôme serait un clic qui dépose la personne devant un explorateur, ou pire,
 * un second éditeur « simplifié » qui s'installerait un jour parce que le
 * premier était jugé trop loin.
 *
 * ET SURTOUT — CE QUE LA CHAÎNE PROTÈGE. L'édition à plusieurs d'une note de
 * coffre ne tient qu'à une chose : que ce soit `VaultNoteEditor` qui s'ouvre.
 * C'est LUI qui monte la salle (`useVaultNoteCollab`), tient l'élection
 * d'enregistrement (`saveElection`), reçoit le veto de lecture seule du relais
 * (`serverReadOnly`) et allume la bannière de version plus récente
 * (`shouldAnnounceNewerVersion`). Un chemin d'ouverture qui court-circuiterait
 * ce composant — une modale d'aperçu, un rendu en lecture seule, une copie
 * locale — perdrait les quatre d'un coup, en silence, et personne ne s'en
 * apercevrait avant que deux membres n'écrasent mutuellement leur travail.
 *
 * C'est le même procédé que `vaultNoteCardKind.vitest.ts` : on confronte la
 * promesse au texte qui la tient, jamais à un second dérivé.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const vaults = join(__dirname, '..');
const notes = join(vaults, '..', 'notes');
const routes = join(vaults, '..', 'layout', 'RouteContent');

const lire = (p: string) => readFileSync(p, 'utf8');

const notesList = lire(join(notes, 'NotesList.tsx'));
const section = lire(join(notes, 'VaultNotesSection.tsx'));
const navigation = lire(join(notes, 'noteShareNavigation.ts'));
const routeCompat = lire(join(routes, 'routeCompat.ts'));
const notesView = lire(join(notes, 'NotesView.tsx'));
const notePane = lire(join(notes, 'VaultNotePane.tsx'));
const routeContent = lire(join(routes, 'RouteContent.tsx'));
const folderView = lire(join(vaults, 'VaultFolderView.tsx'));
const noteEditor = lire(join(vaults, 'VaultNoteEditor.tsx'));

describe('maillon 1 — l’onglet Notes émet une intention d’OUVERTURE', () => {
  it('l’onglet Notes monte bien la section', () => {
    expect(notesList).toMatch(/<VaultNotesSection \/>/);
    expect(notesList).toMatch(/from '\.\/VaultNotesSection'/);
  });

  it('la section n’écrit RIEN dans le magasin des notes', () => {
    // C'est ce qui la tient hors de la recherche globale, du graphe, des
    // modèles et des raccourcis : tous lisent `notesSlice`, et ce qui n'y
    // entre pas ne peut pas y être ramassé par accident. Un `addNote` /
    // `updateNote` glissé ici ouvrirait la porte sans que rien ne le dise.
    // On interroge le CODE, pas la prose : les commentaires de ce fichier
    // parlent justement de `notesSlice` pour expliquer qu'ils n'y touchent
    // pas, et un garde qui tomberait là-dessus punirait l'explication.
    const code = section.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/from '[^']*notesSlice'/);
    expect(code).not.toMatch(/\b(addNote|updateNote|setEditingNote|deleteNote)\s*\(/);
  });

  it('elle passe par `noteShareNavigation`, seul traducteur élément → route', () => {
    // Jamais une chaîne fabriquée sur place : le jour où la forme de l'adresse
    // changera, une expression régulière locale divergerait en silence.
    expect(section).toMatch(/vaultNoteDestination\(/);
    expect(section).toMatch(/from '\.\/noteShareNavigation'/);
  });

  it('ET CETTE ADRESSE RESTE DANS L’ONGLET NOTES — le défaut rapporté était là', () => {
    // « Pour les notes dans un coffre partagé, ça n'ouvre pas dans les notes de
    // base de l'app. » L'adresse menait à `/vault-folder/…?item=…&open=1` :
    // le clic emportait la personne dans un explorateur de fichiers, où une
    // fenêtre s'ouvrait par-dessus une grille. Un clic sur une ligne de notes
    // demande une chose et une seule — lire cette note, là où on est.
    expect(navigation).toMatch(
      /export function vaultNoteDestination[\s\S]{0,120}return notesVaultNoteRoute\(/
    );
  });

  it('l’adresse vit dans le CHEMIN, sans quoi un rechargement perdrait la note', () => {
    // `useTabNavigation` n'enregistre que `location.pathname`, et c'est
    // l'onglet que redux-persist conserve : une note portée par `?item=`
    // survivrait au clic et à rien d'autre.
    expect(routeCompat).toMatch(
      /export function notesVaultNoteRoute[\s\S]{0,300}NOTES_ROUTE_PREFIX/
    );
    expect(routeCompat).not.toMatch(/export function notesVaultNoteRoute[\s\S]{0,300}\?item=/);
  });

  it('le RETOUR vers l’explorateur du coffre existe toujours, en geste explicite', () => {
    // Rester dans l'onglet Notes ne doit pas emmurer : le dossier du coffre,
    // ses voisins et ses réglages restent à un clic.
    //
    // IL MONTRE, IL N'OUVRE PLUS. Il visait `?item=…&open=1` ; depuis que
    // l'explorateur TRANCHE cette intention selon le droit d'écrire
    // (`vaultNoteOpenTarget`), `open=1` renverrait un rédacteur au panneau qu'il
    // vient de quitter — un aller-retour infini entre deux onglets. Le détail est
    // gardé ici, et le cas est éprouvé dans `vaultNoteOpenTarget.vitest.ts`.
    expect(navigation).toMatch(
      /export function vaultNoteExplorerDestination[\s\S]{0,600}return vaultFolderRoute\(vaultId, \{ itemId \}\);/
    );
  });

  it('le badge « Partagée » d’une note personnelle, lui, MONTRE sans ouvrir', () => {
    // Deux gestes distincts, délibérément : ouvrir d'autorité un éditeur sur
    // une copie que la personne n'a pas demandé à modifier serait un geste
    // pris en son nom.
    expect(navigation).toMatch(
      /export function vaultShareDestination[\s\S]{0,200}return vaultFolderRoute\(ref\.vaultId\);/
    );
  });
});

describe('maillon 2 — la route dépose la note DANS le panneau de l’onglet Notes', () => {
  it('RouteContent lit l’adresse de coffre AVANT celle d’une note personnelle', () => {
    // `/notes/(.+)` est gourmand : lu en premier, il prendrait
    // `vault/<coffre>/<élément>` pour l'identifiant d'une note locale — qui
    // n'existe pas, donc un panneau vide sans un mot d'explication.
    expect(routeContent).toMatch(
      /const vaultNote =[\s\S]{0,120}notesVaultNoteFromRoute\(route\)[\s\S]{0,160}const noteMatch = vaultNote \? null :/
    );
    expect(routeContent).toMatch(/<LazyNotesView[\s\S]{0,120}vaultNote=/);
  });

  it('l’onglet Notes monte le panneau de coffre À LA PLACE de l’éditeur personnel', () => {
    expect(notesView).toMatch(/\{vaultNote \?[\s\S]{0,600}<VaultNotePane/);
    expect(notesView).toMatch(/from '\.\/VaultNotePane'/);
  });

  it('et une note PERSONNELLE passe toujours par `NoteEditor`, inchangée', () => {
    // La branche de coffre s'insère AVANT, sans rien retirer : le jour où elle
    // avalerait le cas ordinaire, c'est tout l'onglet Notes qui tomberait.
    expect(notesView).toMatch(/\) : editingNote \? \([\s\S]{0,400}<NoteEditor/);
  });

  it('le panneau n’écrit RIEN dans le magasin des notes', () => {
    // Même règle que la section, et pour la même raison : la persistance d'une
    // note de coffre (élément chiffré, garde de version, révisions, salle) n'a
    // rien de commun avec celle d'une note locale. On interroge le CODE, pas la
    // prose — l'en-tête de ce fichier PARLE justement de `notesSlice`.
    const code = notePane.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/from '[^']*notesSlice'/);
    expect(code).not.toMatch(/\b(addNote|updateNote|setEditingNote|deleteNote)\s*\(/);
  });

  it('le panneau monte le VRAI éditeur, dans son cadre « panneau »', () => {
    // Le seul moyen de ne pas perdre la salle, l'élection, le veto de lecture
    // seule et la bannière de version est de ne pas les réécrire : c'est le
    // MÊME composant, avec un contenant différent.
    expect(notePane).toMatch(/<VaultNoteEditor[\s\S]{0,300}variant="pane"/);
    expect(notePane).toMatch(/<VaultNoteEditor[\s\S]{0,300}canEdit=\{canEdit\}/);
    expect(notePane).toMatch(/<VaultNoteEditor[\s\S]{0,300}role=\{role\}/);
    // …et il offre la sortie vers l'explorateur du coffre.
    expect(notePane).toMatch(/onOpenInVault=/);
  });

  it('l’éditeur sait rendre les DEUX cadres depuis UN seul contenu', () => {
    // Deux constructions de JSX divergeraient en un mois. Une seule, posée soit
    // dans une fenêtre soit dans un bloc, ne le peut pas.
    //
    // LA FORME A CHANGÉ, PAS LA RÈGLE. Le contenu partagé portait le CORPS ET LE
    // PIED d'une boîte de dialogue, que le panneau recevait tels quels — d'où le
    // champ « Titre » encadré et le pied « Fermer / Enregistrer » plantés au
    // milieu de l'onglet Notes. Il est devenu un constructeur qui reçoit son
    // habillage (`CorpsHabillage`) et ne connaît plus la modale ; les deux
    // cadres l'appellent, et il n'y en a toujours qu'un.
    expect(noteEditor).toMatch(/const corps = \(\{ classeSurface, avantSurface, apresSurface \}/);
    expect(noteEditor).toMatch(/if \(variant === 'pane'\)/);
    expect(noteEditor.match(/corps\(\{/g)?.length).toBe(2);
    expect(noteEditor).toMatch(/<ModalBody>\s*\{corps\(\{/);
    // UN APPEL PAR CADRE, ET PAS DEUX DU MÊME CÔTÉ. Compter les appels sur tout
    // le fichier laissait passer un panneau qui appelle `corps` DEUX fois (ou
    // une fenêtre qui n'en appelle plus) tant que le total restait à deux.
    const panneau = noteEditor.slice(
      noteEditor.indexOf("if (variant === 'pane')"),
      noteEditor.indexOf('// ══ LA FENÊTRE')
    );
    expect(panneau.length).toBeGreaterThan(500);
    expect(panneau.match(/corps\(\{/g)?.length).toBe(1);
  });

  it('la bannière « version plus récente » a de quoi s’allumer dans le panneau', () => {
    // Elle se lit sur `item.version`, qui vient de la LISTE d'éléments. Un
    // panneau qui chargerait la liste une fois et l'oublierait ne l'allumerait
    // jamais : le coffre est déclaré au guetteur tant que la note est ouverte.
    expect(notePane).toMatch(/declareVaultsListed\(\[vaultId\]\)/);
  });
});

describe('maillon 2 bis — la route de l’explorateur, elle, n’a pas changé', () => {
  it('RouteContent lit l’intention de la cible et la passe à la vue', () => {
    expect(routeContent).toMatch(/openFocusedItem/);
    expect(routeContent).toMatch(/urlTarget\.open/);
  });

  it('l’intention et la cible viennent de la MÊME source', () => {
    // Les mélanger ferait ouvrir l'élément d'un raccourci avec l'intention d'un
    // autre — une modale d'édition sur un élément que personne n'a demandé.
    expect(routeContent).toMatch(
      /focusItemId !== undefined \? !!openFocusedItem : urlSpeaksOfThisVault && !!urlTarget\.open/
    );
  });
});

describe('maillon 3 — l’explorateur ouvre le VRAI éditeur', () => {
  it('l’intention aboutit à `openNote` — le chemin du double-clic, pas un second', () => {
    // `openNote` TRANCHE le cadre (fenêtre pour qui consulte, onglet Notes pour
    // qui rédige) puis monte le même `VaultNoteEditor`. C'était `setEditingId`
    // en direct ; le passage par la décision est justement ce qui garantit que
    // le lien profond ne se comporte pas autrement que le double-clic.
    expect(folderView).toMatch(/focus\.open &&[\s\S]{0,140}openNote\(item\.id\)/);
  });

  it('SEULE une note s’ouvre ainsi — jamais un fichier, jamais un marqueur de dossier', () => {
    expect(folderView).toMatch(/vaultItemKind\(item\) === 'note'/);
    expect(folderView).toMatch(/!item\.meta\.folderMarker/);
  });

  it('`setEditingId` monte bien `VaultNoteEditor`, et pas un aperçu', () => {
    expect(folderView).toMatch(/vb\.editingItem &&[\s\S]{0,200}<VaultNoteEditor/);
  });
});

describe('maillon 4 — l’éditeur monté est celui qui porte l’édition à plusieurs', () => {
  it('il ouvre une salle collaborative', () => {
    expect(noteEditor).toMatch(/useVaultNoteCollab\(/);
    expect(noteEditor).toMatch(/shouldOpenVaultRoom/);
  });

  it('il tient l’élection d’enregistrement : un seul pair écrit', () => {
    expect(noteEditor).toMatch(/responsible/);
    expect(noteEditor).toMatch(/shouldWriteBackVaultNote/);
  });

  it('il reçoit le veto de lecture seule du relais (coffre gelé)', () => {
    expect(noteEditor).toMatch(/serverReadOnly/);
  });

  it('il annonce une version plus récente au lieu de l’appliquer sous le curseur', () => {
    expect(noteEditor).toMatch(/shouldAnnounceNewerVersion/);
  });

  it('il reçoit le rôle et le droit d’écrire — sans quoi l’élection ne peut pas trancher', () => {
    // `canEdit` porte le gel, `role` porte le pouvoir : l'éditeur a besoin des
    // DEUX, et l'explorateur est le seul à les connaître.
    expect(folderView).toMatch(/<VaultNoteEditor[\s\S]{0,300}canEdit=\{vb\.canEdit\}/);
    expect(folderView).toMatch(/<VaultNoteEditor[\s\S]{0,300}role=\{vb\.role\}/);
  });
});

describe('la surface d’édition n’est PAS dupliquée', () => {
  it('l’éditeur de coffre dérive ses extensions de la source partagée', () => {
    // `buildSharedNoteExtensions` -> `buildNoteSchemaExtensions`, la même source
    // que NoteEditor. Une liste recopiée ici EFFACERAIT les attributs hors
    // schéma au premier aller-retour (ancres de bloc, taille de police,
    // espacement, largeur) — et en salle, l'effacement se propagerait aux
    // autres membres par le CRDT.
    expect(noteEditor).toMatch(/buildSharedNoteExtensions\(/);
    expect(noteEditor).not.toMatch(/from '@tiptap\/starter-kit'/);
  });

  it('les extensions d’INTERACTION viennent elles aussi d’un module partagé', () => {
    // Le menu slash, le placeholder, la poignée, le repli des titres et les
    // émojis existaient dans NoteEditor avec ~90 lignes de branchement React
    // chacun. Les recopier ici, ce serait deux copies qui divergeraient en un
    // mois — le contraire exact de ce que ce chantier cherche.
    expect(noteEditor).toMatch(/interactive:/);
    expect(noteEditor).not.toMatch(/new ReactRenderer\(SlashCommandMenu/);
    // Et le module partagé est bien celui que monte AUSSI l'éditeur personnel.
    const partage = lire(join(notes, 'interactiveNoteExtensions.ts'));
    expect(partage).toMatch(/export function buildInteractiveNoteExtensions/);
    expect(lire(join(notes, 'NoteEditor.tsx'))).toMatch(/from '\.\/interactiveNoteExtensions'/);
  });

  it('les commandes qui visent l’espace PERSONNEL sont écartées du coffre', () => {
    // Le pendant exact de « pas de recherche globale sur les notes de coffre » :
    // le mélange est aussi fautif dans l'autre sens. Un `[[` posé dans une note
    // partagée résoudrait vers une note du disque de CETTE machine.
    expect(noteEditor).toMatch(/excludeSlashIds: PERSONAL_ONLY_SLASH_IDS/);
    const slash = lire(join(notes, 'slashCommandExtension.ts'));
    for (const id of ['link-note', 'embed-note', 'sub-page', 'vault-embed', 'dataview']) {
      expect(slash).toMatch(new RegExp(`PERSONAL_ONLY_SLASH_IDS[\\s\\S]{0,300}'${id}'`));
    }
  });
});
