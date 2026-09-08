/**
 * Ce que le panneau d'activité a le droit d'afficher.
 *
 * Le défaut qui a motivé ce module n'était pas une faute de calcul : c'était
 * une perte d'information au `basename`. Les cas gardés ici sont donc ceux où
 * DEUX lignes différentes finissaient identiques, ou muettes.
 */

import { describe, it, expect } from 'vitest';
import type { TFunction } from 'i18next';
import { describeSyncItem, describeSyncItemContext } from '../syncActivityLabels';

/**
 * `t` bouchonné : rend la clé et ses variables, pour que l'assertion porte sur
 * le CHOIX de la clé — pas sur la traduction, qui vit dans les fichiers de
 * locale et que `npm run i18n:check` surveille déjà.
 */
const t = ((key: string, vars?: Record<string, unknown>) =>
  vars ? `${key}(${JSON.stringify(vars)})` : key) as unknown as TFunction;

const item = (fileId: string, localPath?: string, name?: string) => ({
  fileId,
  localPath,
  name: name ?? (localPath?.split('/').pop() || fileId),
});

const FOLDERS = { 'f-1': 'Photos', 'f-2': 'Impôts' };

describe('describeSyncItem', () => {
  it('nomme le paquet de notes par son identifiant méta', () => {
    expect(describeSyncItem(item('meta:notes', 'notes.enc'), FOLDERS, t)).toBe(
      'sync.activity.artifact.notes'
    );
  });

  it('nomme le paquet de notes même sans identifiant méta (manifeste ancien)', () => {
    expect(describeSyncItem(item('a1b2c3', 'notes.enc'), FOLDERS, t)).toBe(
      'sync.activity.artifact.notes'
    );
  });

  it('nomme la mise en page de l’accueil', () => {
    expect(describeSyncItem(item('meta:layout', 'layout.enc'), FOLDERS, t)).toBe(
      'sync.activity.artifact.layout'
    );
  });

  it('ne confond pas un fichier d’utilisateur appelé notes.enc avec le paquet', () => {
    // Dans un dossier : deux segments, donc pas un blob de profil.
    expect(describeSyncItem(item('x', 'f-1/notes.enc'), FOLDERS, t)).toBe('notes.enc');
  });

  it('range tout le répertoire de versions sous un seul libellé', () => {
    expect(describeSyncItem(item('h1', 'note-versions/hashes.enc'), FOLDERS, t)).toBe(
      'sync.activity.artifact.noteVersions'
    );
    expect(describeSyncItem(item('h2', 'note-versions/note-9/index.enc'), FOLDERS, t)).toBe(
      'sync.activity.artifact.noteVersions'
    );
    expect(describeSyncItem(item('h3', 'file-versions/f-1/v3.bin'), FOLDERS, t)).toBe(
      'sync.activity.artifact.fileVersions'
    );
  });

  it('DISTINGUE deux dossiers là où le basename les rendait identiques', () => {
    const a = describeSyncItem(item('m1', 'f-1/metadata.json'), FOLDERS, t);
    const b = describeSyncItem(item('m2', 'f-2/metadata.json'), FOLDERS, t);
    expect(a).toBe('sync.activity.artifact.folderMeta({"name":"Photos"})');
    expect(b).toBe('sync.activity.artifact.folderMeta({"name":"Impôts"})');
    expect(a).not.toBe(b);
  });

  it('retombe sur l’identifiant abrégé — jamais sur « metadata.json » — quand le dossier est inconnu', () => {
    const label = describeSyncItem(item('m3', '0123456789abcdef/metadata.json'), FOLDERS, t);
    expect(label).toBe('sync.activity.artifact.folderMetaUnknown({"id":"01234567…"})');
    expect(label).not.toContain('metadata.json');
  });

  it('laisse intact le nom d’un vrai fichier', () => {
    expect(describeSyncItem(item('r1', 'f-1/Rapport_Alternance.fdoc'), FOLDERS, t)).toBe(
      'Rapport_Alternance.fdoc'
    );
  });

  it('ne jette pas sur une entrée sans chemin local', () => {
    expect(describeSyncItem({ fileId: 'orphan', name: 'orphan' }, FOLDERS, t)).toBe('orphan');
  });
});

describe('describeSyncItemContext', () => {
  it('donne le dossier porteur d’un vrai fichier', () => {
    expect(describeSyncItemContext(item('r1', 'f-1/Rapport.fdoc'), FOLDERS)).toBe('Photos');
  });

  it('ne répète pas le dossier sur sa propre ligne de métadonnées', () => {
    expect(describeSyncItemContext(item('m1', 'f-1/metadata.json'), FOLDERS)).toBeUndefined();
  });

  it('ne donne rien pour un artefact de profil ou un dossier inconnu', () => {
    expect(describeSyncItemContext(item('meta:notes', 'notes.enc'), FOLDERS)).toBeUndefined();
    expect(
      describeSyncItemContext(item('h1', 'note-versions/hashes.enc'), FOLDERS)
    ).toBeUndefined();
    expect(describeSyncItemContext(item('z', 'inconnu/x.fdoc'), FOLDERS)).toBeUndefined();
  });
});
