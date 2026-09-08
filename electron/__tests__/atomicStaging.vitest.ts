/**
 * PERSONNE NE PARTAGE SON FICHIER DE STAGING.
 *
 * ── LE DÉFAUT, ET IL EST DÉJÀ ARRIVÉ DEUX FOIS ──────────────────────────────
 *
 * Écrire `X.tmp` puis le renommer en `X` rend l'écriture atomique pour le
 * lecteur. Mais `X.tmp` est le MÊME nom pour tous les écrivains : deux
 * écritures qui se croisent partagent leur fichier intermédiaire, et la
 * seconde échoue en `ENOENT` (son staging a déjà été consommé) ou en `EPERM`
 * (l'autre tient encore le descripteur) — quand elle ne publie pas simplement
 * un mélange des deux.
 *
 * `noteVersionService` et `fileVersionService` l'avaient trouvé, chacun de son
 * côté, et corrigé chacun dans son coin. Quatre autres écrivains ne l'avaient
 * pas, et ça s'est vu en production le 2026-09-07 :
 *
 *     Sync failed: ENOENT: no such file or directory,
 *     rename 'sync-manifest.json.tmp' -> 'sync-manifest.json'
 *
 * Cinq fois, chacune faisant échouer le CYCLE ENTIER de synchronisation, plus
 * cinq autres sur `sync-queue.json`.
 *
 * ── CE QUE CE FICHIER DÉFEND ────────────────────────────────────────────────
 *
 * Une règle qui vit en deux copies et manque à quatre endroits n'est pas une
 * règle. Ce test lit la SOURCE des écrivains connus et refuse le gabarit
 * fautif — c'est la seule façon d'empêcher le cinquième de réapparaître, parce
 * que `+ '.tmp'` se relit comme correct.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { cheminDeStaging } from '../atomicStaging';

describe('le nom de staging', () => {
  it('est DIFFÉRENT à chaque appel — c’est tout l’intérêt', () => {
    const cible = 'C:/profil/sync-manifest.json';
    const noms = new Set(Array.from({ length: 200 }, () => cheminDeStaging(cible)));
    expect(noms.size).toBe(200);
  });

  it('reste dans le même répertoire que sa cible', () => {
    // Un staging ailleurs ferait du `rename` une COPIE entre volumes — plus
    // atomique du tout, et lente sur un gros fichier.
    const cible = path.join('C:', 'profil', 'sync-manifest.json');
    expect(path.dirname(cheminDeStaging(cible))).toBe(path.dirname(cible));
  });

  it('se termine par `.tmp` — les observateurs filtrent là-dessus', () => {
    // `vaultWatcher` ignore l'extension `.tmp`. Un staging qui ne la porterait
    // pas déclencherait une synchronisation du fichier intermédiaire.
    expect(cheminDeStaging('/a/b.json').endsWith('.tmp')).toBe(true);
  });

  it('porte le PID — deux instances de Filarr sur la même machine', () => {
    // Le cas n'est pas théorique : la version publiée tourne à côté de celle
    // de développement, sur le même profil.
    expect(cheminDeStaging('/a/b.json')).toContain(`.${process.pid.toString(36)}.`);
  });
});

describe('AUCUN ÉCRIVAIN NE FABRIQUE SON `.tmp` À LA MAIN', () => {
  /**
   * Une lecture de source : ces modules tirent Electron et le disque, et ce
   * qu'on veut prouver est de toute façon structurel.
   */
  const lire = (...bouts: string[]) =>
    fs.readFileSync(path.join(__dirname, '..', ...bouts), 'utf8');

  const ECRIVAINS: Array<[string, string[]]> = [
    ['le manifeste de synchro', ['sync', 'syncManifest.ts']],
    ['la file de transferts', ['sync', 'syncQueue.ts']],
    ['la reprise multipart', ['sync', 'multipartTransfer.ts']],
    ['les jetons et le cache de politique', ['authService.ts']],
    ['les versions de notes', ['noteVersionService.ts']],
    ['les versions de fichiers', ['fileVersionService.ts']],
  ];

  for (const [quoi, chemin] of ECRIVAINS) {
    it(`${quoi} n’utilise pas un \`.tmp\` partagé`, () => {
      const source = lire(...chemin);
      /*
        LES DEUX GABARITS FAUTIFS, tels qu'ils étaient écrits. On les cherche
        littéralement plutôt que par une heuristique : un test qui refuserait
        toute occurrence de « .tmp » attraperait les commentaires, les filtres
        d'extension et les messages d'erreur, et finirait par être désactivé.
      */
      expect(source, `${quoi} : \`+ '.tmp'\``).not.toMatch(/\+\s*'\.tmp'/);
      expect(source, `${quoi} : gabarit \`\${…}.tmp\``).not.toMatch(/`\$\{[^}]+\}\.tmp`/);
    });
  }

  it('les six passent par le module partagé ou fabriquent leur propre suffixe', () => {
    // Les deux services de versions ont leur suffixe historique, écrit avant
    // que le module existe : ils sont corrects, et ce test le constate plutôt
    // que d'exiger une réécriture qui n'apporterait rien.
    for (const [quoi, chemin] of ECRIVAINS) {
      const source = lire(...chemin);
      const partage = source.includes('cheminDeStaging(');
      const propre = source.includes("crypto.randomBytes(6).toString('hex')}.tmp");
      expect(partage || propre, quoi).toBe(true);
    }
  });
});
