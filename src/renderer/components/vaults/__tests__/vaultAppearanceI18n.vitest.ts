/**
 * Une clé de traduction qui N'EXISTE PAS ne casse rien — elle affiche sa valeur
 * par défaut. C'est exactement ce qui rend le défaut invisible.
 *
 * CE QUI EST ARRIVÉ. La fenêtre « Icône et couleur du coffre » a recopié un
 * idiome de `ui/FolderStyleModal` : `t('folderStyle.preview', 'Aperçu')`. La clé
 * `folderStyle` n'existe dans AUCUNE des deux locales, donc i18next rendait le
 * second argument — du français — pour tout le monde, y compris dans l'interface
 * anglaise. Rien ne l'attrapait : `npm run i18n:check` compare la PARITÉ en/fr,
 * c'est-à-dire deux fichiers l'un à l'autre ; il ne sait pas ce que le code
 * DEMANDE, donc une clé demandée par personne et une clé demandée mais absente
 * lui sont également invisibles.
 *
 * D'OÙ CETTE GARDE, QUI PART DU CODE ET VA VERS L'AUTORITÉ. Elle lit le source
 * de l'écran, en extrait chaque clé littérale passée à `t(...)`, et exige
 * qu'elle existe dans les DEUX dictionnaires. Une valeur par défaut cesse alors
 * d'être un filet : ce que l'écran affiche est ce que les locales portent.
 *
 * ELLE NE COUVRE QUE LES ÉCRANS DE LA FICHE F14, volontairement : l'idiome
 * fautif traîne ailleurs dans le dépôt (`FolderStyleModal` le porte encore), et
 * une garde qui échoue dès le premier jour sur une dette d'avant ne garde rien —
 * on la désactiverait la semaine suivante.
 *
 *   npx vitest run src/renderer/components/vaults/__tests__/vaultAppearanceI18n.vitest.ts
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import en from '../../../../i18n/locales/en/translation.json';
import fr from '../../../../i18n/locales/fr/translation.json';
import { VAULT_APPEARANCE_ICONS } from '../../../../services/vault/vaultNameEnvelope';

/** Les écrans que cette garde couvre — ceux que la fiche F14 a ajoutés. */
const ECRANS = ['VaultAppearanceModal.tsx', 'VaultGlyph.tsx'];

function lookup(dict: unknown, key: string): unknown {
  return key.split('.').reduce<unknown>((acc, part) => {
    if (acc && typeof acc === 'object' && part in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[part];
    }
    return undefined;
  }, dict);
}

/**
 * Les clés LITTÉRALES passées à `t(...)`. Les clés construites (gabarits,
 * `vaultErrorKey(...)`) ne sont pas lisibles d'ici ; celles de la fiche ont leur
 * propre vérification, plus bas, à partir de l'énumération qui les engendre.
 */
function clesLitterales(fichier: string): string[] {
  const src = readFileSync(join(__dirname, '..', fichier), 'utf8');
  const trouvees = new Set<string>();
  for (const m of src.matchAll(/\bt\(\s*'([^']+)'/g)) trouvees.add(m[1]);
  return [...trouvees];
}

describe('les écrans d’apparence ne demandent que des clés qui existent', () => {
  for (const fichier of ECRANS) {
    it(`${fichier} — chaque clé littérale est traduite en EN et en FR`, () => {
      const cles = clesLitterales(fichier);
      const manquantes = cles.filter(
        (k) => typeof lookup(en, k) !== 'string' || typeof lookup(fr, k) !== 'string'
      );
      expect(manquantes).toEqual([]);
    });
  }

  it('la garde regarde bien quelque chose (sinon elle passerait à vide)', () => {
    // Une extraction qui ne trouve RIEN passerait le test précédent sans rien
    // vérifier : c'est la panne silencieuse classique d'une garde qui lit du
    // texte.
    expect(clesLitterales('VaultAppearanceModal.tsx').length).toBeGreaterThan(8);
  });

  it('chaque icône proposée par la fenêtre a son nom accessible, en EN et en FR', () => {
    // Ces clés-là sont construites (`teamVaults.appearance.icons.${i}`) : c'est
    // l'ÉNUMÉRATION qui fait autorité, pas le source de l'écran.
    for (const icone of VAULT_APPEARANCE_ICONS) {
      const k = `teamVaults.appearance.icons.${icone}`;
      expect(typeof lookup(en, k), `${k} (en)`).toBe('string');
      expect(typeof lookup(fr, k), `${k} (fr)`).toBe('string');
    }
  });
});
