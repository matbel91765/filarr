/**
 * Gestionnaire de documents CRDT — propriété du document et cloisonnement.
 *
 * Deux pannes verrouillées ici :
 *  - la FUITE : un document (et sa persistance IndexedDB) restait en mémoire à
 *    chaque changement de note, parce que la libération était conditionnée à
 *    une option qu'aucun appelant ne passait ;
 *  - le MÉLANGE DES PROFILS : le registre était indexé par le seul noteId, donc
 *    après un changement de profil la même note rendait le document du profil
 *    précédent.
 */

import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import yDocManager, { docKey } from '../yDocManager';

afterEach(() => yDocManager.destroyAll());

describe('registre des documents — cloisonnement par profil', () => {
  it('deux profils, même note : deux documents distincts', () => {
    const un = yDocManager.getDoc('note-1', { profileId: 'p1' });
    const deux = yDocManager.getDoc('note-1', { profileId: 'p2' });

    expect(deux.yDoc).not.toBe(un.yDoc);
    expect(un.profileId).toBe('p1');
    expect(deux.profileId).toBe('p2');
    expect(yDocManager.size).toBe(2);
  });

  it('la clé porte le profil ET la note', () => {
    expect(docKey('note-1', 'p1')).not.toBe(docKey('note-1', 'p2'));
    expect(docKey('note-1', 'p1')).toBe(docKey('note-1', 'p1'));
  });

  it('rend le MÊME document pour le même couple', () => {
    const un = yDocManager.getDoc('note-1', { profileId: 'p1' });
    const encore = yDocManager.getDoc('note-1', { profileId: 'p1' });
    expect(encore.yDoc).toBe(un.yDoc);
    expect(yDocManager.size).toBe(1);
  });

  it('la lecture d’un profil ne voit pas le contenu de l’autre', () => {
    const un = yDocManager.getDoc('note-1', { profileId: 'p1' });
    const paragraphe = new Y.XmlElement('paragraph');
    const texte = new Y.XmlText();
    texte.insert(0, 'écrit dans le profil 1');
    paragraphe.insert(0, [texte]);
    un.fragment.insert(0, [paragraphe]);

    expect(yDocManager.getContentJSON('note-1', 'p1')).toContain('écrit dans le profil 1');
    expect(yDocManager.getPlainText('note-1', 'p1')).toContain('écrit dans le profil 1');
    // Le profil 2 n'a pas encore de document pour cette note : rien à rendre.
    expect(yDocManager.getContentJSON('note-1', 'p2')).toBeNull();
    expect(yDocManager.getPlainText('note-1', 'p2')).toBe('');
  });
});

describe('registre des documents — comptage des références', () => {
  it('libère au DERNIER relâchement, jamais au premier', () => {
    yDocManager.getDoc('note-1', { profileId: 'p1' });
    yDocManager.getDoc('note-1', { profileId: 'p1' });
    expect(yDocManager.refCount('note-1', 'p1')).toBe(2);

    yDocManager.releaseDoc('note-1', 'p1');
    // Le second panneau tient encore le document : le détruire ici lui
    // arracherait son éditeur.
    expect(yDocManager.hasDoc('note-1', 'p1')).toBe(true);

    yDocManager.releaseDoc('note-1', 'p1');
    expect(yDocManager.hasDoc('note-1', 'p1')).toBe(false);
    expect(yDocManager.size).toBe(0);
  });

  it('un relâchement de trop ne casse rien', () => {
    yDocManager.getDoc('note-1', { profileId: 'p1' });
    yDocManager.releaseDoc('note-1', 'p1');
    expect(() => yDocManager.releaseDoc('note-1', 'p1')).not.toThrow();
    expect(yDocManager.refCount('note-1', 'p1')).toBe(0);
  });

  it('la destruction explicite passe outre les références (verrouillage du coffre)', () => {
    yDocManager.getDoc('note-1', { profileId: 'p1' });
    yDocManager.getDoc('note-1', { profileId: 'p1' });
    yDocManager.destroyDoc('note-1', 'p1');
    expect(yDocManager.hasDoc('note-1', 'p1')).toBe(false);
  });

  it('`destroyAll` ne laisse rien, quel que soit le nombre de détenteurs', () => {
    yDocManager.getDoc('note-1', { profileId: 'p1' });
    yDocManager.getDoc('note-1', { profileId: 'p1' });
    yDocManager.getDoc('note-2', { profileId: 'p2' });
    yDocManager.destroyAll();
    expect(yDocManager.size).toBe(0);
  });

  it('relâcher un document inconnu est sans effet', () => {
    expect(() => yDocManager.releaseDoc('jamais-ouverte', 'p1')).not.toThrow();
  });
});
