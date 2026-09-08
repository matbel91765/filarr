/**
 * LE NETTOYAGE DES ORPHELINS — ce que le processus principal envoie au serveur.
 *
 * ── LA SEULE ERREUR QUI COMPTE ICI ──────────────────────────────────────────
 *
 * Le serveur supprime tout ce qui n'est PAS dans l'ensemble vivant qu'on lui
 * envoie. Oublier une entrée, c'est demander la suppression de ses octets.
 *
 * La tentation est de filtrer sur le statut — « n'envoie que ce qui est
 * `synced` ». Ce serait une perte de données : une entrée `pending_upload`,
 * `conflict` ou `local_only` désigne un fichier que le nuage porte peut-être
 * déjà, et les octets d'un conflit NON ARBITRÉ sont exactement ce qu'on ne peut
 * pas récupérer. On erre du côté qui CONSERVE, et ce fichier le vérifie.
 *
 * ── ET LA SUPPRESSION RESTE DEMANDÉE ────────────────────────────────────────
 *
 * `execute` ne part que sur un `true` explicite. Un appel sans argument, une
 * régression qui perd le paramètre, un appelant distrait : tous inventorient.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const lire = (...bouts: string[]): string =>
  fs.readFileSync(path.join(__dirname, '..', ...bouts), 'utf8');

/** Le corps du gestionnaire, borné par le suivant. */
function handler(): string {
  // Fins de ligne INDIFFÉRENTES : `main.ts` est en CRLF, et une garde qui en
  // dépend se casse au premier outil qui normalise le fichier.
  const s = lire('main.ts').replace(/\r\n/g, '\n');
  const debut = s.indexOf("ipcMain.handle(\n  'sync:gcProfile',");
  expect(debut, "gestionnaire `sync:gcProfile` introuvable").toBeGreaterThan(0);
  const fin = s.indexOf("ipcMain.handle('sync:getActivity'", debut);
  expect(fin).toBeGreaterThan(debut);
  return s.slice(debut, fin);
}

describe('L’ENSEMBLE VIVANT NE FILTRE RIEN', () => {
  it('envoie TOUTES les entrées du manifeste, sans regarder leur statut', () => {
    /*
      Filtrer sur `synced` supprimerait les octets des entrées bloquées — dont
      les conflits non arbitrés, qui sont précisément ce qu'on ne peut pas
      reconstituer.
    */
    const h = handler();
    expect(h).toContain('Object.keys(localManifest.files)');
    expect(h).not.toContain(".filter(");
    expect(h).not.toContain("'synced'");
  });

  it('n’agit pas du tout sans manifeste local', () => {
    // Sans manifeste, l'ensemble vivant serait VIDE — et un ensemble vide
    // désigne le profil entier comme orphelin. Le serveur refuse déjà, mais on
    // ne compte pas sur lui pour ça : on ne pose pas la question.
    const h = handler();
    const garde = h.indexOf('if (!localManifest)');
    const appel = h.indexOf('r2.gcProfile(');
    expect(garde).toBeGreaterThan(0);
    expect(garde).toBeLessThan(appel);
  });

  it('joint la VERSION du manifeste — c’est elle qui périme l’ensemble', () => {
    // Sans elle, un ensemble vivant lu il y a dix minutes ferait supprimer ce
    // qu'un autre appareil vient de référencer.
    expect(handler()).toContain('localManifest.version ?? 0');
  });
});

describe('LA SUPPRESSION SE DEMANDE', () => {
  it('`execute` n’est vrai que sur un `true` EXPLICITE', () => {
    // `execute === true` et non `!!execute` : la différence ne se voit pas à la
    // relecture, et c'est elle qui fait qu'un appel malformé inventorie au lieu
    // d'effacer.
    expect(handler()).toContain('execute === true');
  });

  it('l’écran COMPTE avant de proposer, et ne reboucle pas tout seul', () => {
    const vue = lire('..', 'src', 'renderer', 'components', 'settings', 'StorageCleanupRow.tsx');
    // Le premier appel est un inventaire ; le bouton de suppression n'apparaît
    // qu'après, et il porte le nombre d'octets.
    expect(vue).toContain("appeler(false)");
    expect(vue).toContain("appeler(true)");
    expect(vue).toContain('cleanup.free');
    // Un passage incomplet propose de RELANCER ; il ne relance pas seul.
    expect(vue).toContain('cleanup.again');
    expect(vue).not.toMatch(/setTimeout\([^)]*appeler/);
  });
});

describe('LE CANAL EST DÉCLARÉ PARTOUT', () => {
  it('le pont le laisse passer', () => {
    // Sans cette ligne l'appel est rejeté par le préchargement, et l'écran
    // affiche « analyse impossible » sans qu'on sache pourquoi.
    expect(lire('preload.ts')).toContain("'sync:gcProfile'");
  });

  it('il est classé comme un geste de BUREAU', () => {
    // Il s'appuie sur le manifeste LOCAL, que le web ne tient pas.
    const cls = lire('..', 'src', 'platform', 'web', 'channelClassification.ts');
    expect(cls).toMatch(/'sync:gcProfile':\s*\{\s*target:\s*'desktop'\s*\}/);
  });
});
