/**
 * LA FICHE-RACCOURCI : ce qui reste dans le dossier personnel quand les octets
 * sont partis dans le coffre.
 *
 * Trois choses à prouver, et seulement celles-là :
 *   · AUCUN OCTET ne survit sur la fiche (`encryptedData`, `iv`, `content`) —
 *     un raccourci qui garderait un chiffré serait une seconde version, et le
 *     contrat dit qu'il n'y en a qu'une, celle du coffre ;
 *   · TOUT LE RESTE survit (identifiant, nom, type, taille, dates, description,
 *     tags) — la fiche garde sa place, ses rappels et ses liens ;
 *   · une référence incomplète est REFUSÉE avant tout — une fiche qui pointe
 *     vers nulle part est un fichier perdu, pas un raccourci.
 */

import { describe, expect, it } from 'vitest';

import { assertVaultShortcutRef, buildShortcutEntry, isVaultShortcut } from '../vaultShortcut';

const ref = { vaultId: 'v-1', itemId: 'it-9', movedAt: '2026-08-28T10:00:00.000Z' };

const fiche = {
  id: 'f-42',
  name: 'contrat.pdf',
  type: 'application/pdf',
  size: 1234,
  encryptedData: 'AAAA',
  iv: 'BBBB',
  content: 'clair',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
  description: 'le contrat signé',
  tags: ['juridique'],
};

describe('buildShortcutEntry', () => {
  it('retire les octets, pose vaultRef, garde tout le reste', () => {
    const entry = buildShortcutEntry(fiche, ref, '2026-08-28T10:00:01.000Z');
    expect(entry).not.toHaveProperty('encryptedData');
    expect(entry).not.toHaveProperty('iv');
    expect(entry).not.toHaveProperty('content');
    expect(entry.vaultRef).toEqual(ref);
    expect(entry.updatedAt).toBe('2026-08-28T10:00:01.000Z');
    expect(entry).toMatchObject({
      id: 'f-42',
      name: 'contrat.pdf',
      type: 'application/pdf',
      size: 1234,
      createdAt: '2026-01-01T00:00:00.000Z',
      description: 'le contrat signé',
      tags: ['juridique'],
    });
  });

  it('ne persiste que deux identifiants et une date — rien de plus dans vaultRef', () => {
    const entry = buildShortcutEntry(fiche, { ...ref, vaultName: 'Secret' } as typeof ref, 'now');
    expect(Object.keys(entry.vaultRef).sort()).toEqual(['itemId', 'movedAt', 'vaultId']);
  });

  it('ne mute pas la fiche reçue (le blob se lit encore par son nom après coup)', () => {
    const avant = JSON.stringify(fiche);
    buildShortcutEntry(fiche, ref);
    expect(JSON.stringify(fiche)).toBe(avant);
  });

  it('survit à un aller-retour JSON sans réapparition des octets', () => {
    const entry = JSON.parse(JSON.stringify(buildShortcutEntry(fiche, ref)));
    expect('encryptedData' in entry).toBe(false);
    expect('iv' in entry).toBe(false);
    expect(entry.vaultRef).toEqual(ref);
  });

  it('refuse un dossier', () => {
    expect(() => buildShortcutEntry({ id: 'd', name: 'Docs', type: 'folder' }, ref)).toThrow(
      /dossier/
    );
  });

  it('refuse une référence incomplète, sans rien produire', () => {
    expect(() => buildShortcutEntry(fiche, { ...ref, itemId: '' })).toThrow(/itemId/);
    expect(() => buildShortcutEntry(fiche, { ...ref, vaultId: '  ' })).toThrow(/vaultId/);
    expect(() => buildShortcutEntry(fiche, { ...ref, movedAt: 'hier' })).toThrow(/movedAt/);
    expect(() => assertVaultShortcutRef(null)).toThrow(/manquant/);
  });
});

describe('isVaultShortcut', () => {
  it('reconnaît un raccourci à sa référence, pas à l’absence d’octets', () => {
    expect(isVaultShortcut(buildShortcutEntry(fiche, ref))).toBe(true);
    const { encryptedData: _e, iv: _i, ...sansOctets } = fiche;
    // `isVaultShortcut` n'accepte qu'un objet portant `vaultRef` : une fiche
    // sans octets n'en a pas, ce qui est EXACTEMENT ce que le test verifie. Le
    // transtypage dit qu'on lui donne deliberement autre chose.
    expect(isVaultShortcut(sansOctets as unknown as { vaultRef?: unknown })).toBe(false);
    expect(isVaultShortcut(null)).toBe(false);
    expect(isVaultShortcut({ vaultRef: { vaultId: 'v' } })).toBe(false);
  });
});
