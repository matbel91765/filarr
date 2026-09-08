/**
 * Tests de la résolution des liens wiki — Filarr Notes.
 *
 * Enjeu : `linkResolutionKey` est le SEUL contrat qui répond à « [[cible]]
 * désigne-t-il cette note ? ». Deux consommateurs s'en servent :
 *   - `resolveLinks`, qui remplit linkedNoteIds (donc les arêtes du graphe,
 *     les rétroliens, la propagation de renommage) ;
 *   - la vue graphe, qui décide qu'une cible sans note est un « fantôme ».
 *
 * Si les deux normalisent différemment, un lien tombe dans l'angle mort :
 * non résolu par le service (pas d'arête) mais cru résolu par le graphe
 * (pas de fantôme) — il DISPARAÎT silencieusement. Ce fichier fige donc la
 * grammaire exacte de la clé ET l'invariant de complémentarité.
 */

import { buildNoteTitleIndex, createNote, linkResolutionKey, resolveLinks } from '../noteService';
import { parseWikiLinks } from '../noteLinkParser';
import type { Note } from '../../../types/notes';
import { describe, it, expect } from 'vitest';

// ── Fixtures ─────────────────────────────────────────────────────────────

function note(id: string, title: string, plainText = ''): Note {
  return createNote({ id, title, plainText });
}

function byId(...notes: Note[]): Record<string, Note> {
  const map: Record<string, Note> = {};
  for (const n of notes) map[n.id] = n;
  return map;
}

/** Résout des liens de note dans un texte, sans fichiers ni dossiers. */
function noteLinks(text: string, notes: Note[]): string[] {
  return resolveLinks(text, byId(...notes), {}, {}).linkedNoteIds;
}

/**
 * Réplique EXACTE du prédicat « fantôme » de GraphView (mêmes fonctions
 * partagées) : sert à vérifier la complémentarité avec resolveLinks.
 */
function ghostKeys(text: string, notes: Note[]): Set<string> {
  const index = buildNoteTitleIndex(notes);
  const ghosts = new Set<string>();
  for (const link of parseWikiLinks(text)) {
    if (link.type !== 'note' || link.isEmbed) continue;
    const key = linkResolutionKey(link.target);
    if (!key || index.has(key)) continue;
    ghosts.add(key);
  }
  return ghosts;
}

// ── linkResolutionKey ────────────────────────────────────────────────────

describe('linkResolutionKey', () => {
  it('ne normalise QUE la casse', () => {
    expect(linkResolutionKey('Ma Note')).toBe('ma note');
    expect(linkResolutionKey('MA NOTE')).toBe('ma note');
  });

  it('ne replie PAS les espaces internes (deux espaces restent deux espaces)', () => {
    expect(linkResolutionKey('Ma  Note')).toBe('ma  note');
    expect(linkResolutionKey('Ma  Note')).not.toBe(linkResolutionKey('Ma Note'));
  });

  it('ne retire PAS le fragment #ancre', () => {
    expect(linkResolutionKey('Ma Note#Section')).toBe('ma note#section');
    expect(linkResolutionKey('Ma Note#Section')).not.toBe(linkResolutionKey('Ma Note'));
  });
});

// ── buildNoteTitleIndex ──────────────────────────────────────────────────

describe('buildNoteTitleIndex', () => {
  it('indexe par clé canonique et retrouve la note quelle que soit la casse', () => {
    const index = buildNoteTitleIndex([note('n1', 'Ma Note')]);
    expect(index.get(linkResolutionKey('MA nOtE'))).toBe('n1');
  });

  it("n'indexe pas les notes sans titre (sinon [[ ]] résoudrait par accident)", () => {
    const index = buildNoteTitleIndex([note('n1', ''), note('n2', 'Ma Note')]);
    expect(index.has('')).toBe(false);
    expect(index.size).toBe(1);
  });
});

// ── resolveLinks : grammaire des cibles ──────────────────────────────────

describe('resolveLinks — cibles de notes', () => {
  const target = note('n1', 'Ma Note');

  it('résout un titre exact', () => {
    expect(noteLinks('voir [[Ma Note]] plus bas', [target])).toEqual(['n1']);
  });

  it('résout indépendamment de la casse', () => {
    expect(noteLinks('[[ma note]]', [target])).toEqual(['n1']);
    expect(noteLinks('[[MA NOTE]]', [target])).toEqual(['n1']);
  });

  it('résout malgré les espaces autour de la cible ([[ Titre ]])', () => {
    // parseWikiLinks trime déjà la cible : le service et le graphe voient
    // la même chaîne, donc le lien se résout des deux côtés.
    expect(noteLinks('[[  Ma Note  ]]', [target])).toEqual(['n1']);
  });

  it('résout une cible aliasée [[Titre|alias]]', () => {
    expect(noteLinks('[[Ma Note|autre libellé]]', [target])).toEqual(['n1']);
  });

  it('NE résout PAS un lien avec fragment [[Titre#Section]]', () => {
    // Comportement assumé : le fragment fait partie de la cible. Le graphe
    // doit donc afficher un fantôme (cf. invariant plus bas) plutôt que
    // de faire disparaître le lien.
    expect(noteLinks('[[Ma Note#Section]]', [target])).toEqual([]);
  });

  it('NE résout PAS un lien à espaces internes doublés [[Titre  Titre]]', () => {
    expect(noteLinks('[[Ma  Note]]', [target])).toEqual([]);
  });

  it('ignore les intégrations ![[Titre]] (ce ne sont pas des liens sortants)', () => {
    expect(noteLinks('![[Ma Note]]', [target])).toEqual([]);
  });

  it('dédoublonne les cibles répétées', () => {
    expect(noteLinks('[[Ma Note]] et encore [[ma note]]', [target])).toEqual(['n1']);
  });
});

// ── resolveLinks : fichiers et dossiers ──────────────────────────────────

describe('resolveLinks — fichiers et dossiers', () => {
  it('résout [[file:nom]] et [[folder:nom]] à la casse près', () => {
    const links = resolveLinks(
      '[[file:Rapport.PDF]] [[folder:projets]]',
      {},
      { f1: { id: 'f1', name: 'rapport.pdf' } },
      { d1: { id: 'd1', name: 'Projets' } }
    );
    expect(links.linkedFileIds).toEqual(['f1']);
    expect(links.linkedFolderIds).toEqual(['d1']);
    expect(links.linkedNoteIds).toEqual([]);
  });
});

// ── Invariant : arête OU fantôme, jamais rien ────────────────────────────

describe('invariant graphe : chaque [[lien]] produit une arête OU un fantôme', () => {
  const target = note('n1', 'Ma Note');

  const cases: Array<{ label: string; text: string; resolved: boolean }> = [
    { label: 'titre exact', text: '[[Ma Note]]', resolved: true },
    { label: 'casse différente', text: '[[MA note]]', resolved: true },
    { label: 'espaces autour', text: '[[  Ma Note  ]]', resolved: true },
    { label: 'alias', text: '[[Ma Note|alias]]', resolved: true },
    { label: 'fragment #ancre', text: '[[Ma Note#Section]]', resolved: false },
    { label: 'double espace interne', text: '[[Ma  Note]]', resolved: false },
    { label: 'cible inexistante', text: '[[Note Fantôme]]', resolved: false },
  ];

  it.each(cases)('$label : exactement un des deux', ({ text, resolved }) => {
    const edges = noteLinks(text, [target]);
    const ghosts = ghostKeys(text, [target]);
    expect(edges.length > 0).toBe(resolved);
    expect(ghosts.size > 0).toBe(!resolved);
    // Le lien n'est jamais perdu : une arête OU un fantôme, jamais zéro.
    expect(edges.length + ghosts.size).toBeGreaterThan(0);
  });

  it('un lien vers une note EN CORBEILLE devient un fantôme, pas un néant', () => {
    // Le graphe bâtit son index sur les notes VISIBLES : la cible supprimée
    // n'y est plus, donc elle réapparaît en fantôme. resolveLinks, lui,
    // travaille sur byId complet et la résout encore — mais le nœud
    // n'existe pas dans le graphe, donc aucune arête n'est dessinée.
    const trashed: Note = { ...note('n2', 'Note Supprimée'), deletedAt: new Date().toISOString() };
    const visible = [target]; // n2 exclu de la vue graphe
    const text = '[[Note Supprimée]]';
    expect(noteLinks(text, [target, trashed])).toEqual(['n2']);
    expect(ghostKeys(text, visible).has('note supprimée')).toBe(true);
  });
});
