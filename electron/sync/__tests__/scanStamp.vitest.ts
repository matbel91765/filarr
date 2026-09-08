/**
 * scanStamp.vitest.ts — Tampon d'identite de fichier.
 *
 * Ce qui est defendu :
 *  1. LE TAMPON EVITE LE HACHAGE, IL NE LE REMPLACE PAS. Un tampon peut mentir,
 *     donc le rehachage periodique et le drapeau « sale » restent des portes
 *     ouvertes.
 *  2. UN TAMPON VENU DU FUTUR EST SUSPECT. Horloge reculee, fichier copie
 *     depuis une machine en avance : on jette plutot que de croire.
 *  3. UN FICHIER DE TAMPONS ABIME COUTE UN BALAYAGE, JAMAIS UNE PANNE.
 */

import { describe, it, expect } from 'vitest';
import {
  REHASH_INTERVAL_MS,
  StampRegistry,
  isStale,
  needsRehash,
  sameIdentity,
  stampOf,
  type StatLike,
} from '../scanStamp';

const T0 = 1_757_000_000_000;
const stat = (size: number, mtimeMs: number, ino?: number): StatLike => ({ size, mtimeMs, ino });

describe('identite', () => {
  it('reconnait un fichier inchange', () => {
    const s = stampOf(stat(1000, T0, 42), T0);
    expect(sameIdentity(s, stat(1000, T0, 42))).toBe(true);
  });

  it('voit un changement de taille', () => {
    const s = stampOf(stat(1000, T0, 42), T0);
    expect(sameIdentity(s, stat(1001, T0, 42))).toBe(false);
  });

  it('voit un changement de date', () => {
    const s = stampOf(stat(1000, T0, 42), T0);
    expect(sameIdentity(s, stat(1000, T0 + 1, 42))).toBe(false);
  });

  it('voit un fichier REMPLACE par un autre de meme taille et meme date', () => {
    // C est ce que l inode ajoute : sans lui, ce cas passerait inapercu.
    const s = stampOf(stat(1000, T0, 42), T0);
    expect(sameIdentity(s, stat(1000, T0, 43))).toBe(false);
  });

  it('tolere l absence d inode des deux cotes', () => {
    // Sous Windows `ino` vaut souvent 0. Le tampon perd une dimension et
    // devient (taille, mtime) : moins fort, jamais faux.
    const s = stampOf(stat(1000, T0), T0);
    expect(sameIdentity(s, stat(1000, T0))).toBe(true);
    expect(sameIdentity(s, stat(1000, T0, 0))).toBe(true);
  });

  it('ne conclut rien quand l inode manque d UN seul cote', () => {
    // Un tampon pris sur une plateforme qui expose l inode, relu sur une qui ne
    // l expose pas (ou l inverse) : on ne doit pas declarer le fichier
    // different pour cette seule raison.
    const avecIno = stampOf(stat(1000, T0, 42), T0);
    expect(sameIdentity(avecIno, stat(1000, T0, 0))).toBe(true);
    const sansIno = stampOf(stat(1000, T0, 0), T0);
    expect(sameIdentity(sansIno, stat(1000, T0, 42))).toBe(true);
  });

  it('sans tampon, rien n est identique', () => {
    expect(sameIdentity(undefined, stat(1000, T0, 42))).toBe(false);
  });
});

describe('decision de rehachage', () => {
  it('saute le hachage quand rien n a bouge', () => {
    const s = stampOf(stat(1000, T0, 42), T0);
    expect(needsRehash(s, stat(1000, T0, 42), T0 + 60_000)).toBe(false);
  });

  it('hache quand l identite a change', () => {
    const s = stampOf(stat(1000, T0, 42), T0);
    expect(needsRehash(s, stat(2000, T0, 42), T0 + 1000)).toBe(true);
  });

  it('hache quand il n y a pas de tampon', () => {
    expect(needsRehash(undefined, stat(1000, T0, 42), T0)).toBe(true);
  });

  it('hache quand l observateur a marque le fichier sale', () => {
    // Le drapeau est une PORTE OUVERTE : il force le hachage, il ne peut
    // jamais l empecher. C est ce qui rend l observateur inoffensif s il rate
    // un evenement.
    const s = stampOf(stat(1000, T0, 42), T0);
    expect(needsRehash(s, stat(1000, T0, 42), T0 + 1000, true)).toBe(true);
  });

  it('rehache periodiquement meme si le tampon dit « inchange »', () => {
    // Le filet contre un tampon menteur : horloge qui recule, systeme de
    // fichiers reseau a granularite grossiere, restauration qui repose les
    // metadonnees.
    const s = stampOf(stat(1000, T0, 42), T0);
    expect(needsRehash(s, stat(1000, T0, 42), T0 + REHASH_INTERVAL_MS - 1)).toBe(false);
    expect(needsRehash(s, stat(1000, T0, 42), T0 + REHASH_INTERVAL_MS)).toBe(true);
  });
});

describe('peremption', () => {
  it('un tampon absent est perime', () => {
    expect(isStale(undefined, T0)).toBe(true);
  });

  it('un tampon VENU DU FUTUR est suspect', () => {
    // Horloge reculee, ou fichier copie depuis une machine en avance. On jette
    // plutot que de croire : un tampon qu on ne peut pas dater ne protege rien.
    const s = stampOf(stat(1000, T0, 42), T0 + 10_000);
    expect(isStale(s, T0)).toBe(true);
  });

  it('un tampon recent est bon', () => {
    const s = stampOf(stat(1000, T0, 42), T0);
    expect(isStale(s, T0 + 1000)).toBe(false);
  });
});

describe('registre', () => {
  it('enregistre, relit et lave le drapeau', () => {
    const r = new StampRegistry();
    r.markDirty('a');
    expect(r.isDirty('a')).toBe(true);
    r.record('a', stat(100, T0, 1), T0);
    expect(r.isDirty('a')).toBe(false);
    expect(r.get('a')?.size).toBe(100);
    expect(r.size).toBe(1);
  });

  it('decide de hacher ou non', () => {
    const r = new StampRegistry();
    expect(r.shouldHash('a', stat(100, T0, 1), T0)).toBe(true);
    r.record('a', stat(100, T0, 1), T0);
    expect(r.shouldHash('a', stat(100, T0, 1), T0 + 1000)).toBe(false);
    r.markDirty('a');
    expect(r.shouldHash('a', stat(100, T0, 1), T0 + 1000)).toBe(true);
  });

  it('oublie un fichier supprime', () => {
    const r = new StampRegistry();
    r.record('a', stat(100, T0, 1), T0);
    r.markDirty('a');
    r.forget('a');
    expect(r.get('a')).toBeUndefined();
    expect(r.isDirty('a')).toBe(false);
  });

  it('un changement de profil ne laisse rien derriere lui', () => {
    const r = new StampRegistry();
    r.record('a', stat(100, T0, 1), T0);
    r.markDirty('b');
    r.clear();
    expect(r.size).toBe(0);
    expect(r.dirtyCount).toBe(0);
  });
});

describe('persistance', () => {
  it('fait l aller-retour', () => {
    const r = new StampRegistry();
    r.record('a', stat(100, T0, 1), T0);
    r.record('b', stat(200, T0 + 5, 2), T0);
    const back = StampRegistry.fromJSON(JSON.parse(JSON.stringify(r.toJSON())));
    expect(back.size).toBe(2);
    expect(back.get('b')?.mtimeMs).toBe(T0 + 5);
  });

  it('un fichier de tampons ABIME coute un balayage, jamais une panne', () => {
    // Le pire comportement possible serait d empecher la synchronisation de
    // demarrer parce qu un fichier de cache est corrompu.
    for (const mauvais of [null, undefined, 42, 'texte', [], { a: null }, { a: { size: 'x' } }]) {
      expect(() => StampRegistry.fromJSON(mauvais)).not.toThrow();
    }
    const r = StampRegistry.fromJSON({
      bon: { size: 1, mtimeMs: 2, ino: 3, hashedAt: 4 },
      incomplet: { size: 1 },
      pasUnObjet: 5,
    });
    expect(r.size).toBe(1);
    expect(r.get('bon')).toBeDefined();
  });

  it('les tampons rechargesnes sont pas sales', () => {
    // Un redemarrage ne doit pas tout marquer sale : ce serait annuler le gain
    // du tampon au premier cycle apres chaque lancement.
    const r = new StampRegistry();
    r.record('a', stat(100, T0, 1), T0);
    r.markDirty('a');
    const back = StampRegistry.fromJSON(r.toJSON());
    expect(back.isDirty('a')).toBe(false);
  });
});

describe('le gain, chiffre', () => {
  it('un cycle en regime etabli ne hache plus rien', () => {
    // Le constat n 2 du dossier : notes.enc relu entierement 288 fois par jour.
    // En regime etabli, aucun de ces hachages n est necessaire.
    const r = new StampRegistry();
    const fichiers = ['meta:notes', 'meta:layout', 'meta:reminders-1', 'meta:reminders-2'];
    for (const f of fichiers) r.record(f, stat(50_000_000, T0, 1), T0);

    let haches = 0;
    for (let cycle = 1; cycle <= 288; cycle++) {
      const now = T0 + cycle * 5 * 60_000;
      for (const f of fichiers) if (r.shouldHash(f, stat(50_000_000, T0, 1), now)) haches++;
    }
    // 288 cycles x 4 fichiers = 1 152 hachages evites, sauf ceux que le
    // rehachage periodique impose (l intervalle est de sept jours, on couvre
    // ici une seule journee).
    expect(haches).toBe(0);
  });

  it('mais une modification reelle est toujours vue', () => {
    const r = new StampRegistry();
    r.record('meta:notes', stat(50_000_000, T0, 1), T0);
    expect(r.shouldHash('meta:notes', stat(50_000_001, T0 + 1, 1), T0 + 60_000)).toBe(true);
  });
});
