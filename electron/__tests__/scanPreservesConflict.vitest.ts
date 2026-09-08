/**
 * UN CONFLIT OUVERT SURVIT AU BALAYAGE.
 *
 * ── L'EMBALLEMENT QUE CE TEST FERME ─────────────────────────────────────────
 *
 * `scanLocalFiles` remplace l'entrée entière d'un fichier et n'épargnait que
 * les entrées `synced`. Une entrée passée en `conflict` par `handleConflict`
 * repartait donc en `pending_upload` au balayage suivant.
 *
 * La garde anti-boucle du fusionneur — « un conflit déjà ouvert attend
 * l'arbitrage de l'utilisateur, le reprendre referait une copie toutes les cinq
 * minutes sans jamais converger » — ne pouvait alors jamais s'armer : le statut
 * qu'elle guette était effacé avant qu'elle ne regarde.
 *
 * Résultat, observé en production le 2026-09-07 sur un compte ouvert depuis
 * deux postes : à chaque cycle, une nouvelle copie `_conflict_<horodatage>`
 * écrite sur le disque ET téléversée. Six copies du même fichier, 95 entrées en
 * attente, des centaines de kilo-octets dupliqués par tour.
 *
 * ── CE QUE CE TEST EXERCE ───────────────────────────────────────────────────
 *
 * La DÉCISION, pas le parcours de disque : « faut-il remplacer cette entrée ? »
 * La règle est la même que dans `scanLocalFiles` et elle tient en une ligne —
 * ce qui la rend testable sans monter un faux système de fichiers.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { keepsOpenConflict } from '../sync/syncService';

/*
  LA RÈGLE EST IMPORTÉE, PAS RECOPIÉE.

  Une garde qui reproduirait la condition resterait verte pendant qu'on la
  retire du balayage — c'est exactement ce qui est arrivé à la première version
  de la garde d'`ensureFolderId`, le même jour. `keepsOpenConflict` est sortie
  de `scanLocalFiles` pour que ce fichier exerce LE chemin réel.
*/

describe('LE BALAYAGE APPELLE BIEN LA RÈGLE', () => {
  /*
    POURQUOI UNE LECTURE DE SOURCE.

    Les tests ci-dessous exercent `keepsOpenConflict`, donc la DÉCISION. Ils
    restent verts si quelqu'un retire l'appel de `scanLocalFiles` — vérifié :
    la garde retirée, les cinq passaient encore. Une décision juste que
    personne n'appelle ne protège rien, et c'est exactement l'emballement
    qu'on vient de corriger.

    `scanLocalFiles` fait 200 lignes, ouvre des dossiers, chiffre et écrit :
    l'exercer demanderait un faux système de fichiers pour prouver une ligne.
    On lit donc la source. C'est grossier, et c'est le même geste que la garde
    des formulaires CSRF de la console — qui a attrapé un vrai défaut le même
    jour, là où la relecture humaine avait laissé passer une lettre.
  */
  it('l’appel existe dans `scanLocalFiles`, pas seulement l’export', () => {
    const source: string = readFileSync(
      fileURLToPath(new URL('../sync/syncService.ts', (import.meta as unknown as { url: string }).url)),
      'utf8'
    );
    const debut = source.indexOf('async function scanLocalFiles(');
    expect(debut, '`scanLocalFiles` introuvable — ce test doit suivre le renommage').toBeGreaterThan(0);
    // La fonction suivante borne la recherche : sans borne, un appel situé
    // ailleurs dans le fichier ferait passer ce test à tort.
    const fin = source.indexOf('async function findFileOnDisk', debut);
    const corps = source.slice(debut, fin > 0 ? fin : undefined);
    expect(corps).toContain('keepsOpenConflict(');
  });
});

describe('un conflit dont le fichier n’a pas bougé reste un conflit', () => {
  it('préserve l’entrée — c’est ce qui arme la garde anti-boucle', () => {
    expect(keepsOpenConflict({ status: 'conflict', checksum: 'abc' }, 'abc')).toBe(true);
  });

});

describe('ce qui doit RECOMMENCER l’arbitrage', () => {
  it('un fichier RÉÉDITÉ depuis la copie de conflit repart en attente d’envoi', () => {
    // L'utilisateur a retravaillé le fichier : c'est une vraie nouvelle version
    // locale. La figer en conflit l'empêcherait de partir, et l'arbitrage se
    // ferait sur un contenu périmé.
    expect(keepsOpenConflict({ status: 'conflict', checksum: 'abc' }, 'def')).toBe(false);
  });

  it('une entrée sans checksum ne se préserve pas — on ne sait pas si elle a bougé', () => {
    expect(keepsOpenConflict({ status: 'conflict' }, 'abc')).toBe(false);
  });
});

describe('les autres statuts ne sont pas touchés', () => {
  it('`pending_upload`, `synced`, `local_only` gardent leur comportement', () => {
    for (const status of ['pending_upload', 'synced', 'local_only', 'pending_download']) {
      expect(keepsOpenConflict({ status, checksum: 'abc' }, 'abc')).toBe(false);
    }
  });

  it('une entrée absente n’est pas préservée — c’est un fichier neuf', () => {
    expect(keepsOpenConflict(undefined, 'abc')).toBe(false);
  });
});
