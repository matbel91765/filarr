/**
 * L'ORDRE DES OPÉRATIONS — la bascule ne peut pas précéder la preuve.
 *
 * C'est le cœur de [R1]. Ces tests verrouillent six choses :
 *  1. le graphe de transitions interdit tout raccourci vers la fin ;
 *  2. les trois verrous refusent la bascule tant qu'un élément, un blocage ou
 *     une preuve manque ;
 *  3. la séquence S0→S6 écrit TOUS les emplacements de clé, racine d'abord ;
 *  4. une mort simulée avant et après le PIVOT mène à deux conduites opposées,
 *     et les deux laissent un coffre utilisable ;
 *  5. [C2] l'ANCIENNE clé est retenue AVANT toute promotion, et un octet scellé
 *     sous elle se relit encore APRÈS la bascule ;
 *  6. [C4] la clé du compte est adoptée EN MÉMOIRE dans la même transaction que
 *     la promotion des fichiers — jamais après coup.
 */

import crypto from 'crypto';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  canSwitch,
  canTransition,
  createJournal,
  decideSwitchResume,
  exceedsDamageThreshold,
} from '../../../../electron/publish/journalMachine';
import {
  discardNextKeys,
  performSwitch,
  resumeSwitch,
  stageNextKeys,
  type KeyLocation,
} from '../../../../electron/publish/keySwitch';
import type { PublishJournal } from '../../../../electron/publish/types';
import { describe, it, expect } from 'vitest';

const OLD = Buffer.from('ANCIENNE-CLE-EMBALLEE', 'utf-8');
const OLD_SEALED = Buffer.from('ANCIEN-MIROIR', 'utf-8');
const NEW = Buffer.from('NOUVELLE-CLE-EMBALLEE', 'utf-8');
const NEW_SEALED = Buffer.from('NOUVEAU-MIROIR', 'utf-8');

function baseJournal(patch: Partial<PublishJournal> = {}): PublishJournal {
  return {
    ...createJournal({
      migrationId: 'mig-1',
      accountUserId: 'user-1',
      accountKeyDigest: 'digest',
      wrappedDigest: 'wrapped',
      now: '2026-08-11T10:00:00.000Z',
    }),
    ...patch,
  };
}

/** Journal d'une migration prouvée : tout est monté, rien ne bloque. */
function provenJournal(patch: Partial<PublishJournal> = {}): PublishJournal {
  const j = baseJournal({ state: 'VERIFYING', ...patch });
  j.counters = {
    totalItems: 10,
    doneItems: 9,
    damagedItems: 1,
    totalBytes: 1000,
    doneBytes: 900,
  };
  j.verify = { plan: ['a', 'b'], ok: 2, failed: [], full: false };
  return { ...j, ...patch };
}

async function makeVault(): Promise<{ root: string; locations: KeyLocation[] }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'filarr-switch-'));
  const p1 = path.join(root, 'profiles', 'p1');
  const p2 = path.join(root, 'profiles', 'p2');
  await fs.mkdir(p1, { recursive: true });
  await fs.mkdir(p2, { recursive: true });
  // La clé ACTIVE est répliquée N+1 fois — c'est exactement le piège que la
  // bascule doit fermer : `hybrid:loadFEK` lit le profil AVANT la racine.
  for (const dir of [root, p1, p2]) {
    await fs.writeFile(path.join(dir, 'wrapped_fek.json'), OLD);
    await fs.writeFile(path.join(dir, '.fek_safe'), OLD_SEALED);
  }
  return {
    root,
    locations: [
      { dir: root, label: 'root' },
      { dir: p1, label: 'profile:p1' },
      { dir: p2, label: 'profile:p2' },
    ],
  };
}

async function readAll(locations: KeyLocation[]): Promise<string[]> {
  return Promise.all(
    locations.map((l) => fs.readFile(path.join(l.dir, 'wrapped_fek.json'), 'utf-8'))
  );
}

/**
 * Un appareil-jouet : ses clés de LECTURE, sa clé d'ÉCRITURE, et un journal des
 * gestes dans l'ORDRE où ils surviennent. C'est ce journal qui permet de tester
 * l'ORDRE des effets, pas seulement leur existence.
 */
interface FakeDevice {
  /** Candidates de lecture. La clé retenue s'y ajoute, jamais ne s'en retire. */
  readKeys: Buffer[];
  /** Clé d'ÉCRITURE en mémoire — c'est elle que C4 doit basculer. */
  writeKey: Buffer;
  events: string[];
}

const OLD_RAW = crypto.createHash('sha256').update('ancienne-cle-de-coffre').digest();
const NEW_RAW = crypto.createHash('sha256').update('cle-du-compte').digest();

function makeDevice(): FakeDevice {
  return { readKeys: [Buffer.from(OLD_RAW)], writeKey: Buffer.from(OLD_RAW), events: [] };
}

/** Scelle un octet sous une clé donnée (AES-256-GCM, comme le coffre). */
function seal(key: Buffer, plain: Buffer): Buffer {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([iv, body, cipher.getAuthTag()]);
}

/** Ouvre avec la PREMIÈRE clé qui authentifie — le repli à deux clés de C2. */
function openWithAny(keys: readonly Buffer[], blob: Buffer): Buffer | null {
  for (const key of keys) {
    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, blob.subarray(0, 12));
      decipher.setAuthTag(blob.subarray(blob.length - 16));
      return Buffer.concat([
        decipher.update(blob.subarray(12, blob.length - 16)),
        decipher.final(),
      ]);
    } catch {
      // Mauvaise clé (tag GCM) — candidate suivante.
    }
  }
  return null;
}

/** Les trois crochets obligatoires de la bascule, câblés sur l'appareil-jouet. */
function deviceHooks(device: FakeDevice, opts: { retainFails?: boolean } = {}) {
  return {
    retainOldKey: async (): Promise<void> => {
      if (opts.retainFails) {
        device.events.push('retain-failed');
        throw new Error('trousseau indisponible');
      }
      device.events.push('retain');
      const already = device.readKeys.some((k) => k.equals(OLD_RAW));
      if (!already) device.readKeys.push(Buffer.from(OLD_RAW));
    },
    adoptInMemory: async (): Promise<void> => {
      device.events.push('adopt');
      device.writeKey = Buffer.from(NEW_RAW);
      // La clé du compte devient AUSSI une candidate de lecture, en tête.
      device.readKeys.unshift(Buffer.from(NEW_RAW));
    },
    // OBLIGATOIRE depuis que le type l'exige (leçon du mobile : un crochet
    // optionnel jamais fourni = une bascule qui change la clé mais pas
    // l'identité). L'appareil-jouet n'a pas de profil renommé : no-op EXPLICITE.
    relocateProfiles: async (): Promise<void> => {
      device.events.push('relocate');
    },
  };
}

// ── 1. Le graphe ────────────────────────────────────────────────────────────

describe('transitions', () => {
  it('B1 — PUBLISHING ne mène PAS à DONE : aucune bascule sans preuve', () => {
    expect(canTransition('PUBLISHING', 'DONE')).toBe(false);
    expect(canTransition('PUBLISHING', 'VERIFYING')).toBe(true);
    expect(canTransition('VERIFYING', 'SWITCHING')).toBe(true);
    expect(canTransition('SWITCHING', 'DONE')).toBe(true);
  });

  it('READY est la PAUSE, pas l abandon — et elle repart vers PUBLISHING', () => {
    expect(canTransition('PUBLISHING', 'READY')).toBe(true);
    expect(canTransition('READY', 'PUBLISHING')).toBe(true);
  });

  it('DONE et ABANDONED sont terminaux', () => {
    expect(canTransition('DONE', 'PUBLISHING')).toBe(false);
    expect(canTransition('ABANDONED', 'PUBLISHING')).toBe(false);
  });
});

// ── 2. Les trois verrous ────────────────────────────────────────────────────

describe('canSwitch — les trois verrous de [R1]', () => {
  it('accepte une migration prouvée', () => {
    expect(canSwitch(provenJournal())).toEqual({ ok: true });
  });

  it('D7 — REFUSE quand un élément n a pas été traité', () => {
    const j = provenJournal();
    j.counters.doneItems = 5;
    expect(canSwitch(j)).toEqual({ ok: false, reason: 'items-incomplete' });
  });

  it('D7 — REFUSE quand un blocage subsiste (le fichier est lisible, on ne le détruit pas)', () => {
    const j = provenJournal();
    j.blockers = [
      { kind: 'oversize', localProfileId: 'p1', itemKey: 'k', name: 'film.mkv', size: 1 },
    ];
    expect(canSwitch(j)).toEqual({ ok: false, reason: 'blockers' });
  });

  it('D7 — REFUSE quand une preuve a échoué', () => {
    const j = provenJournal();
    j.verify.failed = ['a'];
    expect(canSwitch(j)).toEqual({ ok: false, reason: 'verify-failed' });
  });

  it('REFUSE quand la preuve n a pas couru du tout', () => {
    const j = provenJournal();
    j.verify = { plan: [], ok: 0, failed: [], full: false };
    expect(canSwitch(j)).toEqual({ ok: false, reason: 'verify-not-run' });
  });

  it('C3 — un profil NON PUBLIÉ ne bloque pas la bascule : il reste local, il n est pas perdu', () => {
    // L'ancienne exigence — « migrer TOUS les profils ou perdre les autres » —
    // n'a plus lieu d'être depuis que l'ancienne clé est conservée (C2) : le
    // contenu d'un profil non publié continue de s'ouvrir sur cet appareil. Ce
    // qui reste, c'est une INFORMATION honnête (« ce profil reste sur cet
    // appareil seulement »), et l'écran la porte à partir de ces données.
    const j = provenJournal();
    j.abandonedProfiles = [
      {
        localProfileId: 'p9',
        name: 'Archives',
        itemCount: 42,
        byteCount: 1234,
        acceptedAt: '2026-08-11T10:00:00.000Z',
      },
    ];
    expect(canSwitch(j)).toEqual({ ok: true });
    // Et le profil reste NOMMÉ et COMPTÉ : sans cela l'écran ne pourrait rien
    // annoncer, et un silence vaudrait une perte silencieuse.
    expect(j.abandonedProfiles[0].name).toBe('Archives');
    expect(j.abandonedProfiles[0].itemCount).toBe(42);
  });

  it('REFUSE depuis PUBLISHING : l ordre des états n est pas contournable', () => {
    expect(canSwitch(provenJournal({ state: 'PUBLISHING' }))).toEqual({
      ok: false,
      reason: 'bad-state',
    });
  });
});

describe('exceedsDamageThreshold', () => {
  it('F6 — au-delà de 5 % ou de 50 éléments, ce n est plus un incident : c est la clé', () => {
    expect(exceedsDamageThreshold(3, 1000)).toBe(false);
    expect(exceedsDamageThreshold(60, 10_000)).toBe(true);
    expect(exceedsDamageThreshold(6, 100)).toBe(true);
  });
});

// ── 3. La séquence ──────────────────────────────────────────────────────────

describe('performSwitch — S1 → S6', () => {
  it('D5 — écrit la RACINE et CHAQUE profil : le piège de la copie périmée ne peut pas se reformer', async () => {
    const { locations } = await makeVault();
    const journal = provenJournal();
    const persisted: string[] = [];
    let cleared = false;

    await performSwitch({
      journal,
      locations,
      material: { wrapped: NEW, sealed: NEW_SEALED },
      persist: async (j) => {
        persisted.push(`${j.state}:${j.switch.staged}:${j.switch.promoted.join(',')}`);
      },
      clearIncoming: async () => {
        cleared = true;
      },
      ...deviceHooks(makeDevice()),
    });

    expect(await readAll(locations)).toEqual([NEW.toString(), NEW.toString(), NEW.toString()]);
    expect(journal.state).toBe('DONE');
    expect(journal.switch.promoted).toEqual(['root', 'profile:p1', 'profile:p2']);
    expect(cleared).toBe(true);

    // D6 — la clé entrante n'est effacée qu'APRÈS la promotion de TOUS les
    // emplacements : on ne se retrouve jamais sans aucune clé valide.
    const clearIndex = persisted.findIndex((s) => s.startsWith('DONE'));
    expect(clearIndex).toBe(persisted.length - 1);

    // Le pivot précède strictement toute promotion.
    expect(persisted[0]).toBe('SWITCHING:false:');
    expect(persisted[1]).toBe('SWITCHING:true:');
  });

  it('aucun `.next` ne subsiste après une bascule réussie', async () => {
    const { locations } = await makeVault();
    await performSwitch({
      journal: provenJournal(),
      locations,
      material: { wrapped: NEW, sealed: NEW_SEALED },
      persist: async () => undefined,
      clearIncoming: async () => undefined,
      ...deviceHooks(makeDevice()),
    });
    for (const loc of locations) {
      const files = await fs.readdir(loc.dir);
      expect(files.filter((f) => f.endsWith('.next'))).toEqual([]);
      // Ni fichier d'attente d'écriture atomique : chaque `.tmp` a été consommé
      // par son `rename`. Un `.tmp` résiduel signifierait une écriture de clé
      // dont on ne sait pas si elle a abouti.
      expect(files.filter((f) => f.endsWith('.tmp'))).toEqual([]);
    }
  });
});

// ── 3bis. [C2] La clé retenue, et [C4] l'adoption en mémoire ───────────────

describe('C2 / C4 — ce que la bascule conserve, et ce qu elle adopte', () => {
  it('C2 — un octet scellé sous l ANCIENNE clé se relit APRÈS la bascule', async () => {
    const { locations } = await makeVault();
    const device = makeDevice();
    // Un fichier écrit AVANT la migration : il dort sous l'ancienne clé, et la
    // migration ne l'a PAS rescellé (règle C1). C'est le cas nominal, pas un
    // cas limite : c'est l'état de 100 % du contenu local au moment de basculer.
    const before = seal(device.writeKey, Buffer.from('un document de l utilisateur'));

    await performSwitch({
      journal: provenJournal(),
      locations,
      material: { wrapped: NEW, sealed: NEW_SEALED },
      persist: async () => undefined,
      clearIncoming: async () => undefined,
      ...deviceHooks(device),
    });

    // La clé d'ÉCRITURE a changé…
    expect(device.writeKey.equals(NEW_RAW)).toBe(true);
    // …et pourtant l'octet d'avant s'ouvre encore. C'est TOUT l'objet de C2.
    const plain = openWithAny(device.readKeys, before);
    expect(plain?.toString()).toBe('un document de l utilisateur');
  });

  it('C2 — la rétention précède STRICTEMENT toute promotion', async () => {
    const { locations } = await makeVault();
    const device = makeDevice();
    const hooks = deviceHooks(device);

    await performSwitch({
      journal: provenJournal(),
      locations,
      material: { wrapped: NEW, sealed: NEW_SEALED },
      persist: async (j) => {
        device.events.push(`persist:${j.state}:${j.switch.staged}`);
      },
      clearIncoming: async () => {
        device.events.push('clear-incoming');
      },
      ...hooks,
    });

    // Rien — pas même l'écriture du journal en SWITCHING — ne précède la
    // rétention : une bascule ne doit jamais commencer sans filet.
    expect(device.events[0]).toBe('retain');
  });

  it('C4 — l adoption en mémoire suit la DERNIÈRE promotion et précède DONE', async () => {
    const { locations } = await makeVault();
    const device = makeDevice();

    await performSwitch({
      journal: provenJournal(),
      locations,
      material: { wrapped: NEW, sealed: NEW_SEALED },
      persist: async (j) => {
        device.events.push(`persist:${j.state}:${j.switch.promoted.length}`);
      },
      clearIncoming: async () => {
        device.events.push('clear-incoming');
      },
      ...deviceHooks(device),
    });

    const adoptAt = device.events.indexOf('adopt');
    const lastPromote = device.events.lastIndexOf('persist:SWITCHING:3');
    const doneAt = device.events.indexOf('persist:DONE:3');

    expect(adoptAt).toBeGreaterThan(lastPromote); // la mémoire ne devance pas le disque
    expect(adoptAt).toBeLessThan(doneAt); // et l'écran n'annonce pas avant elle

    // B-C — le déplacement d'identité court APRÈS la dernière promotion (la
    // copie de clé par-profil déjà promue voyage avec son répertoire) et AVANT
    // l'adoption en mémoire (l'identité doit être en place quand le renderer
    // recharge sa clé sur l'événement d'adoption).
    const relocateAt = device.events.indexOf('relocate');
    expect(relocateAt).toBeGreaterThan(lastPromote);
    expect(relocateAt).toBeLessThan(adoptAt);
  });

  it('B-C — si le déplacement d identité ÉCHOUE, la bascule ne conclut pas et le matériel entrant survit', async () => {
    const { locations } = await makeVault();
    const device = makeDevice();
    const journal = provenJournal();
    let cleared = false;

    await expect(
      performSwitch({
        journal,
        locations,
        material: { wrapped: NEW, sealed: NEW_SEALED },
        persist: async () => undefined,
        clearIncoming: async () => {
          cleared = true;
        },
        ...deviceHooks(device),
        relocateProfiles: async () => {
          throw new Error('EPERM: répertoire de profil verrouillé');
        },
      })
    ).rejects.toThrow('EPERM');

    // Pas de `DONE` avec une identité à moitié déplacée : le journal reste au
    // pivot, et la reprise au démarrage rejouera promotion ET déplacement.
    expect(journal.state).toBe('SWITCHING');
    expect(journal.switch.staged).toBe(true);
    // Le matériel entrant n'a PAS été effacé : la reprise en a besoin.
    expect(cleared).toBe(false);
    // Et l'écran n'a jamais été autorisé à croire la bascule finie : la clé
    // d'écriture en mémoire n'a pas été adoptée.
    expect(device.events).not.toContain('adopt');
  });

  it('C2 — si l ancienne clé ne peut PAS être retenue, rien n est promu', async () => {
    const { locations } = await makeVault();
    const device = makeDevice();

    await expect(
      performSwitch({
        journal: provenJournal(),
        locations,
        material: { wrapped: NEW, sealed: NEW_SEALED },
        persist: async () => undefined,
        clearIncoming: async () => undefined,
        ...deviceHooks(device, { retainFails: true }),
      })
    ).rejects.toThrow();

    // L'ancienne clé est encore partout, la clé d'écriture n'a pas bougé, et
    // aucun fichier de préparation n'a été semé. Le coffre fonctionne.
    expect(await readAll(locations)).toEqual([OLD.toString(), OLD.toString(), OLD.toString()]);
    expect(device.writeKey.equals(OLD_RAW)).toBe(true);
    for (const loc of locations) {
      const files = await fs.readdir(loc.dir);
      expect(files.filter((f) => f.endsWith('.next'))).toEqual([]);
    }
  });
});

// ── 4. Les deux conduites autour du PIVOT ──────────────────────────────────

describe('decideSwitchResume — le pivot décide, et rien d autre', () => {
  it('avant le pivot ⇒ retour en arrière', () => {
    expect(
      decideSwitchResume({ staged: false, incomingKeyPresent: true, rootHoldsIncoming: false })
    ).toBe('rollback');
  });

  it('après le pivot ⇒ marche avant', () => {
    expect(
      decideSwitchResume({ staged: true, incomingKeyPresent: true, rootHoldsIncoming: false })
    ).toBe('forward');
  });

  it('après le pivot, clé entrante disparue, RACINE à jour ⇒ la racine fait autorité', () => {
    expect(
      decideSwitchResume({ staged: true, incomingKeyPresent: false, rootHoldsIncoming: true })
    ).toBe('promote-from-root');
  });

  it('D9 — après le pivot, clé entrante disparue, RACINE ancienne ⇒ échec, rien n est promu', () => {
    expect(
      decideSwitchResume({ staged: true, incomingKeyPresent: false, rootHoldsIncoming: false })
    ).toBe('fail');
  });
});

describe('resumeSwitch — morts simulées', () => {
  it('D3 — mort AVANT le pivot : tous les `.next` supprimés, clé active INTACTE', async () => {
    const { locations } = await makeVault();
    await stageNextKeys(locations, { wrapped: NEW, sealed: NEW_SEALED });
    const journal = provenJournal({ state: 'SWITCHING' });
    journal.switch = { plannedAt: '2026-08-11T10:00:00.000Z', staged: false, promoted: [] };

    const outcome = await resumeSwitch({
      journal,
      locations,
      material: { wrapped: NEW, sealed: NEW_SEALED },
      persist: async () => undefined,
      clearIncoming: async () => undefined,
      ...deviceHooks(makeDevice()),
      incomingKeyPresent: true,
      rootHoldsIncoming: false,
    });

    expect(outcome).toBe('rolled-back');
    expect(journal.state).toBe('PUBLISHING');
    expect(await readAll(locations)).toEqual([OLD.toString(), OLD.toString(), OLD.toString()]);
    for (const loc of locations) {
      const files = await fs.readdir(loc.dir);
      expect(files.filter((f) => f.endsWith('.next'))).toEqual([]);
    }
  });

  it('D4 — mort APRÈS le pivot, promotion PARTIELLE : la reprise fait converger tous les emplacements', async () => {
    const { locations } = await makeVault();
    await stageNextKeys(locations, { wrapped: NEW, sealed: NEW_SEALED });
    // La racine a été promue, les deux profils non — l'état le plus dangereux :
    // `hybrid:loadFEK` lirait le profil, donc l'ANCIENNE clé.
    await fs.rename(
      path.join(locations[0].dir, 'wrapped_fek.json.next'),
      path.join(locations[0].dir, 'wrapped_fek.json')
    );
    await fs.rename(
      path.join(locations[0].dir, '.fek_safe.next'),
      path.join(locations[0].dir, '.fek_safe')
    );

    const journal = provenJournal({ state: 'SWITCHING' });
    journal.switch = { plannedAt: '2026-08-11T10:00:00.000Z', staged: true, promoted: ['root'] };

    const outcome = await resumeSwitch({
      journal,
      locations,
      material: { wrapped: NEW, sealed: NEW_SEALED },
      persist: async () => undefined,
      clearIncoming: async () => undefined,
      ...deviceHooks(makeDevice()),
      incomingKeyPresent: true,
      rootHoldsIncoming: true,
    });

    expect(outcome).toBe('completed');
    expect(journal.state).toBe('DONE');
    expect(await readAll(locations)).toEqual([NEW.toString(), NEW.toString(), NEW.toString()]);
  });

  it('D4 — la marche avant est IDEMPOTENTE : la rejouer ne casse rien', async () => {
    const { locations } = await makeVault();
    const journal = provenJournal({ state: 'SWITCHING' });
    journal.switch = { plannedAt: '2026-08-11T10:00:00.000Z', staged: true, promoted: [] };
    const params = {
      journal,
      locations,
      material: { wrapped: NEW, sealed: NEW_SEALED },
      persist: async (): Promise<void> => undefined,
      clearIncoming: async (): Promise<void> => undefined,
      ...deviceHooks(makeDevice()),
      incomingKeyPresent: true,
      rootHoldsIncoming: false,
    };

    await resumeSwitch(params);
    await resumeSwitch({ ...params, journal: { ...journal, state: 'SWITCHING' } });
    expect(await readAll(locations)).toEqual([NEW.toString(), NEW.toString(), NEW.toString()]);
  });

  it('D9 — clé entrante disparue et racine ANCIENNE : FAILED, l ancienne clé reste partout', async () => {
    const { locations } = await makeVault();
    await stageNextKeys(locations, { wrapped: NEW, sealed: NEW_SEALED });
    const journal = provenJournal({ state: 'SWITCHING' });
    journal.switch = { plannedAt: '2026-08-11T10:00:00.000Z', staged: true, promoted: [] };

    const outcome = await resumeSwitch({
      journal,
      locations,
      material: { wrapped: Buffer.alloc(0), sealed: null },
      persist: async () => undefined,
      clearIncoming: async () => undefined,
      ...deviceHooks(makeDevice()),
      incomingKeyPresent: false,
      rootHoldsIncoming: false,
    });

    expect(outcome).toBe('failed');
    expect(journal.state).toBe('FAILED');
    expect(journal.lastError).toEqual({ code: 'internal', itemKey: null });
    expect(await readAll(locations)).toEqual([OLD.toString(), OLD.toString(), OLD.toString()]);
  });

  it('D8 — un `.next` trouvé sans journal est supprimé : le journal fait foi, jamais le disque', async () => {
    const { locations } = await makeVault();
    await stageNextKeys(locations, { wrapped: NEW, sealed: NEW_SEALED });
    await discardNextKeys(locations);

    expect(await readAll(locations)).toEqual([OLD.toString(), OLD.toString(), OLD.toString()]);
    for (const loc of locations) {
      const files = await fs.readdir(loc.dir);
      expect(files.filter((f) => f.endsWith('.next'))).toEqual([]);
    }
  });
});
