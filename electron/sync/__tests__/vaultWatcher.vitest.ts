/**
 * vaultWatcher.vitest.ts — Observateur du coffre.
 *
 * Ce qui est defendu :
 *  1. LES TEMPORAIRES N ENTRENT PAS. Un fichier en cours d ecriture marque sale
 *     ferait entrer un temporaire dans le manifeste.
 *  2. UN AJOUT COMPTE AUTANT QU UNE MODIFICATION. Une restauration de
 *     sauvegarde arrive comme un ajout, et c est le cas que le balayage actuel
 *     ne voit jamais.
 *  3. UN LOT D EVENEMENTS NE PRODUIT QU UN CYCLE.
 *  4. L OBSERVATEUR NE SYNCHRONISE RIEN. Il marque ; le demon decide.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  DEFAULT_SETTLE_MS,
  META_BLOBS,
  VaultWatcher,
  classifyVaultPath,
  type WatcherLike,
} from '../vaultWatcher';

/** Un observateur bouchonne : on declenche les evenements a la main. */
function fakeWatcher() {
  const handlers = new Map<string, (p: string) => void>();
  let closed = false;
  const w: WatcherLike = {
    on(event, handler) {
      handlers.set(event, handler);
      return w;
    },
    async close() {
      closed = true;
    },
  };
  return {
    watcher: w,
    emit: (event: string, path: string) => handlers.get(event)?.(path),
    get closed() {
      return closed;
    },
    get events() {
      return [...handlers.keys()];
    },
  };
}

describe('classement des chemins', () => {
  it('reconnait les blobs de la racine', () => {
    expect(classifyVaultPath('notes.enc')).toEqual({ kind: 'meta', key: 'meta:notes' });
    expect(classifyVaultPath('layout.enc')).toEqual({ kind: 'meta', key: 'meta:layout' });
  });

  it('reconnait un fichier dans un dossier', () => {
    expect(classifyVaultPath('dossier-1/photo.enc')).toEqual({
      kind: 'file',
      folderId: 'dossier-1',
      fileName: 'photo.enc',
    });
  });

  it('IGNORE les temporaires — sinon un fichier a moitie ecrit entre au manifeste', () => {
    for (const p of [
      'dossier-1/photo.enc.v3tmp',
      'dossier-1/gros.enc.migrating',
      'dossier-1/telechargement.syncdl',
      'dossier-1/quelque.tmp',
      'notes.enc.v3tmp',
    ]) {
      expect(classifyVaultPath(p), p).toBeNull();
    }
  });

  it('ignore un fichier inconnu a la racine', () => {
    // Refuser par defaut : un chemin inattendu ne doit pas se retrouver dans le
    // manifeste parce que personne n y avait pense.
    expect(classifyVaultPath('journal.txt')).toBeNull();
    expect(classifyVaultPath('.fek_safe')).toBeNull();
  });

  it('ignore ce qui est trop profond', () => {
    expect(classifyVaultPath('a/b/c.enc')).toBeNull();
  });

  it('normalise les separateurs Windows', () => {
    expect(classifyVaultPath('dossier-1\\photo.enc')).toEqual({
      kind: 'file',
      folderId: 'dossier-1',
      fileName: 'photo.enc',
    });
  });

  it('suit metadata.json, qui porte le nom des dossiers', () => {
    expect(classifyVaultPath('dossier-1/metadata.json')).toEqual({
      kind: 'file',
      folderId: 'dossier-1',
      fileName: 'metadata.json',
    });
  });

  it('rend null sur du vide ou de l absolu', () => {
    expect(classifyVaultPath('')).toBeNull();
    expect(classifyVaultPath('/etc/passwd')).toBeNull();
  });
});

describe('cycle de vie', () => {
  it('demarre, s abonne aux trois evenements, et s arrete', async () => {
    const f = fakeWatcher();
    const w = new VaultWatcher({
      baseDir: '/coffre',
      onDirty: () => undefined,
      createWatcher: () => f.watcher,
    });
    expect(w.running).toBe(false);
    w.start();
    expect(w.running).toBe(true);
    expect(f.events.sort()).toEqual(['add', 'change', 'unlink']);
    await w.stop();
    expect(w.running).toBe(false);
    expect(f.closed).toBe(true);
  });

  it('demarrer deux fois ne cree qu un observateur', () => {
    let created = 0;
    const w = new VaultWatcher({
      baseDir: '/coffre',
      onDirty: () => undefined,
      createWatcher: () => {
        created++;
        return fakeWatcher().watcher;
      },
    });
    w.start();
    w.start();
    expect(created).toBe(1);
  });
});

describe('signalement', () => {
  it('marque sale sur ajout, modification ET suppression', () => {
    // L ajout compte autant que la modification : une restauration de
    // sauvegarde arrive comme un ajout, et c est exactement le cas que le
    // balayage actuel ne voit jamais.
    const vus: string[] = [];
    const f = fakeWatcher();
    const w = new VaultWatcher({
      baseDir: '/coffre',
      onDirty: (rel) => vus.push(rel),
      createWatcher: () => f.watcher,
    });
    w.start();
    f.emit('add', '/coffre/dossier-1/a.enc');
    f.emit('change', '/coffre/notes.enc');
    f.emit('unlink', '/coffre/dossier-1/b.enc');
    expect(vus).toEqual(['dossier-1/a.enc', 'notes.enc', 'dossier-1/b.enc']);
  });

  it('transmet la cible classee, pas seulement le chemin', () => {
    const cibles: unknown[] = [];
    const f = fakeWatcher();
    const w = new VaultWatcher({
      baseDir: '/coffre',
      onDirty: (_rel, target) => cibles.push(target),
      createWatcher: () => f.watcher,
    });
    w.start();
    f.emit('change', '/coffre/notes.enc');
    expect(cibles).toEqual([{ kind: 'meta', key: 'meta:notes' }]);
  });

  it('ne signale RIEN pour un temporaire', () => {
    const vus: string[] = [];
    const f = fakeWatcher();
    const w = new VaultWatcher({
      baseDir: '/coffre',
      onDirty: (rel) => vus.push(rel),
      createWatcher: () => f.watcher,
    });
    w.start();
    f.emit('change', '/coffre/dossier-1/gros.enc.v3tmp');
    f.emit('add', '/coffre/dossier-1/x.syncdl');
    expect(vus).toEqual([]);
  });

  it('gere un chemin deja relatif', () => {
    const vus: string[] = [];
    const f = fakeWatcher();
    const w = new VaultWatcher({
      baseDir: '/coffre',
      onDirty: (rel) => vus.push(rel),
      createWatcher: () => f.watcher,
    });
    w.start();
    f.emit('change', 'notes.enc');
    expect(vus).toEqual(['notes.enc']);
  });

  it('gere une racine Windows', () => {
    const vus: string[] = [];
    const f = fakeWatcher();
    const w = new VaultWatcher({
      baseDir: 'C:\\Users\\M\\FilarData',
      onDirty: (rel) => vus.push(rel),
      createWatcher: () => f.watcher,
    });
    w.start();
    f.emit('change', 'C:\\Users\\M\\FilarData\\dossier-1\\a.enc');
    expect(vus).toEqual(['dossier-1/a.enc']);
  });
});

describe('apaisement', () => {
  it('un lot d evenements ne produit QU UN cycle', () => {
    // Enregistrer dix fichiers en dix secondes ne doit declencher qu une
    // synchronisation. Sans anti-rebond, l observateur serait pire que le
    // sondage qu il complete.
    vi.useFakeTimers();
    try {
      const settled = vi.fn();
      const f = fakeWatcher();
      const w = new VaultWatcher({
        baseDir: '/coffre',
        onDirty: () => undefined,
        onSettled: settled,
        createWatcher: () => f.watcher,
        settleMs: 1000,
      });
      w.start();
      for (let i = 0; i < 10; i++) {
        f.emit('change', `/coffre/dossier-1/f${i}.enc`);
        vi.advanceTimersByTime(100);
      }
      expect(settled).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1000);
      expect(settled).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('deux lots separes produisent deux cycles', () => {
    vi.useFakeTimers();
    try {
      const settled = vi.fn();
      const f = fakeWatcher();
      const w = new VaultWatcher({
        baseDir: '/coffre',
        onDirty: () => undefined,
        onSettled: settled,
        createWatcher: () => f.watcher,
        settleMs: 1000,
      });
      w.start();
      f.emit('change', '/coffre/notes.enc');
      vi.advanceTimersByTime(1500);
      f.emit('change', '/coffre/layout.enc');
      vi.advanceTimersByTime(1500);
      expect(settled).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('l arret annule le cycle en attente', () => {
    vi.useFakeTimers();
    try {
      const settled = vi.fn();
      const f = fakeWatcher();
      const w = new VaultWatcher({
        baseDir: '/coffre',
        onDirty: () => undefined,
        onSettled: settled,
        createWatcher: () => f.watcher,
        settleMs: 1000,
      });
      w.start();
      f.emit('change', '/coffre/notes.enc');
      void w.stop();
      vi.advanceTimersByTime(5000);
      expect(settled).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('l anti-rebond par defaut vaut celui du demon', () => {
    // Deux horloges qui se contredisent sur le meme sujet finissent toujours
    // par produire un comportement que personne n avait prevu.
    expect(DEFAULT_SETTLE_MS).toBe(10_000);
  });
});

describe('les blobs surveilles', () => {
  it('couvrent exactement ceux que le balayage rehache a chaque cycle', () => {
    expect([...META_BLOBS.keys()].sort()).toEqual(['layout.enc', 'notes.enc']);
    expect(META_BLOBS.get('notes.enc')).toBe('meta:notes');
    expect(META_BLOBS.get('layout.enc')).toBe('meta:layout');
  });
});
