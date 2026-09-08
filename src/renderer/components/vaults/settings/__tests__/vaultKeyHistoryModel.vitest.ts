/**
 * vaultKeyHistoryModel (F10) — la frise des clés du coffre, faite de deux
 * sources qui ne se recouvrent pas.
 *
 * CE QUE CHACUNE SAIT, ET CE QU'ELLE IGNORE :
 *   · `GET /:id/key-wraps` dit quelles époques le serveur me garde scellées —
 *     donc lesquelles CET appareil peut ouvrir. Il ne dit ni quand ni par qui
 *     une rotation a eu lieu.
 *   · le fil d'activité (`vault.rotate`) dit QUAND et PAR QUI, avec la nouvelle
 *     époque en métadonnée. Il est borné (une page), il peut être coupé
 *     (espace personnel, offre sans journal), et il ne dit rien de mes scellés.
 *
 * Les fondre en une frise, c'est donc accepter qu'une ligne puisse dire « je
 * peux l'ouvrir, mais j'ignore quand elle est née » — et le DIRE, plutôt que
 * d'inventer une date ou de cacher l'époque. Une frise qui n'affiche que ce
 * dont elle a la date raconterait une histoire à trous en la faisant passer
 * pour complète.
 *
 * ET L'ÉPOQUE 1 N'EST PAS UNE ROTATION : c'est la création du coffre. Lui
 * chercher un événement `vault.rotate` reviendrait à afficher « rotation
 * inconnue » sur un coffre qui n'a jamais tourné — c'est-à-dire à inquiéter
 * pour un fait normal.
 *
 *   npx vitest run src/renderer/components/vaults/settings/__tests__/vaultKeyHistoryModel.vitest.ts
 */

import { describe, it, expect } from 'vitest';
import {
  buildKeyTimeline,
  lastRotation,
  MAX_TIMELINE_EPOCHS,
  type BuildKeyTimelineInput,
} from '../vaultKeyHistoryModel';
import type { VaultActivityEventDTO } from '../../../../../services/vault/vaultApi';

/** La frise seule — la borne a son propre bloc de tests, plus bas. */
const frise = (input: BuildKeyTimelineInput) => buildKeyTimeline(input).entries;

const rotate = (
  epoch: number,
  occurredAt: number,
  actorUserId: string | null = 'admin1',
  removed = 0
): VaultActivityEventDTO => ({
  id: epoch,
  actorUserId,
  eventType: 'vault.rotate',
  targetId: 'v1',
  occurredAt,
  metadata: { new_epoch: epoch, removed },
});

describe('la frise', () => {
  it('descend de l’époque courante à la première, sans trou', () => {
    const t = frise({ wraps: [3, 2, 1], events: [], currentKeyEpoch: 3 });
    expect(t.map((e) => e.epoch)).toEqual([3, 2, 1]);
    expect(t[0].current).toBe(true);
    expect(t.slice(1).every((e) => !e.current)).toBe(true);
  });

  it('dit pour chaque époque si CET appareil la détient', () => {
    const t = frise({ wraps: [3, 1], events: [], currentKeyEpoch: 3 });
    expect(t.map((e) => [e.epoch, e.mine])).toEqual([
      [3, true],
      [2, false],
      [1, true],
    ]);
  });

  it('l’époque 1 est la CRÉATION, jamais une rotation manquante', () => {
    const t = frise({ wraps: [1], events: [], currentKeyEpoch: 1 });
    expect(t).toHaveLength(1);
    expect(t[0].origin).toBe('creation');
    expect(t[0].atMs).toBeNull();
  });

  it('accroche la date et l’acteur venus du fil, et laisse le reste « inconnu »', () => {
    const t = frise({
      wraps: [3, 2, 1],
      events: [rotate(3, 3000, 'alice', 1)],
      currentKeyEpoch: 3,
    });
    expect(t[0]).toMatchObject({
      epoch: 3,
      origin: 'rotation',
      atMs: 3000,
      actorUserId: 'alice',
      removed: 1,
    });
    // L'époque 2 a bien eu lieu — le fil ne l'a simplement pas (page bornée,
    // journal coupé). On l'affiche SANS date, on ne la cache pas.
    expect(t[1]).toMatchObject({ epoch: 2, origin: 'rotation', atMs: null, actorUserId: null });
  });

  it('un scellé PLUS RÉCENT que l’époque connue de l’écran étend la frise', () => {
    // Une rotation vient d'avoir lieu ; le résumé en mémoire est en retard. La
    // ligne existe : l'oublier ferait disparaître une clé réellement détenue.
    const t = frise({ wraps: [4, 3], events: [], currentKeyEpoch: 3 });
    expect(t.map((e) => e.epoch)).toEqual([4, 3, 2, 1]);
    expect(t[0].mine).toBe(true);
  });

  it('ne fabrique aucune ligne quand on ne sait rien', () => {
    expect(frise({ wraps: [], events: [], currentKeyEpoch: 0 })).toEqual([]);
  });

  it('ignore les événements dont la métadonnée n’est pas une époque', () => {
    const bruit: VaultActivityEventDTO[] = [
      { ...rotate(2, 2000), metadata: { new_epoch: 'deux' } },
      { ...rotate(2, 2000), metadata: null },
      { ...rotate(2, 2000), eventType: 'member.remove' },
    ];
    const t = frise({ wraps: [2, 1], events: bruit, currentKeyEpoch: 2 });
    expect(t[0].atMs).toBeNull();
    expect(t[0].actorUserId).toBeNull();
  });

  it('à deux événements pour la même époque, garde le PLUS ANCIEN', () => {
    // Une époque naît une fois. Deux lignes pour le même numéro ne peuvent
    // venir que d'un doublon de journal ; la première est celle qui l'a créée.
    const t = frise({
      wraps: [2],
      events: [rotate(2, 5000, 'bob'), rotate(2, 2000, 'alice')],
      currentKeyEpoch: 2,
    });
    expect(t[0]).toMatchObject({ atMs: 2000, actorUserId: 'alice' });
  });
});

describe('la dernière rotation', () => {
  it('est la ligne de plus haute époque qui en porte une date', () => {
    const t = frise({
      wraps: [3, 2, 1],
      events: [rotate(2, 2000, 'alice'), rotate(3, 3000, 'bob', 2)],
      currentKeyEpoch: 3,
    });
    expect(lastRotation(t)).toMatchObject({ epoch: 3, atMs: 3000, actorUserId: 'bob', removed: 2 });
  });

  it('est INCONNUE quand le fil n’a rien, même si le coffre a tourné', () => {
    const t = frise({ wraps: [3], events: [], currentKeyEpoch: 3 });
    expect(lastRotation(t)).toBeNull();
  });

  it('n’existe pas sur un coffre qui n’a jamais tourné', () => {
    const t = frise({ wraps: [1], events: [], currentKeyEpoch: 1 });
    expect(lastRotation(t)).toBeNull();
  });

  it('retombe sur la dernière DATÉE quand la plus récente n’a pas de date', () => {
    const t = frise({
      wraps: [3, 2, 1],
      events: [rotate(2, 2000, 'alice')],
      currentKeyEpoch: 3,
    });
    expect(lastRotation(t)).toMatchObject({ epoch: 2, atMs: 2000 });
  });
});

/**
 * LE PLAFOND VIENT DU SERVEUR, ET LE SERVEUR EST L'ADVERSAIRE DU MODÈLE.
 * `currentKeyEpoch` est recopié tel quel du DTO, et les époques de
 * `/key-wraps` ne sont filtrées que par « fini et positif ». Un seul entier
 * corrompu ou hostile (1e9) faisait tourner la boucle descendante un milliard
 * de fois, puis `VaultKeySection` rendait un `<li>` par ligne : gel du
 * renderer. La frise est donc BORNÉE — et le reste est ANNONCÉ, jamais tu, ce
 * qui est la règle de tout le lot.
 */
describe('la frise est bornée, et le dit', () => {
  it('un entier hostile ne fabrique pas un million de lignes', () => {
    const debut = Date.now();
    // L'entier vient ici de l'ANNONCE du coffre (`currentKeyEpoch`) ; un scellé
    // qui dépasserait l'annonce a sa propre règle, plus bas.
    const t = buildKeyTimeline({ wraps: [1e9], events: [], currentKeyEpoch: 1e9 });
    expect(t.entries).toHaveLength(MAX_TIMELINE_EPOCHS);
    expect(t.entries[0].epoch).toBe(1e9);
    expect(t.truncatedBefore).toBe(1e9 - MAX_TIMELINE_EPOCHS);
    // Le vrai symptôme était le TEMPS : un milliard de tours de boucle.
    expect(Date.now() - debut).toBeLessThan(1000);
  });

  it('une frise courte n’annonce AUCUN reste', () => {
    const t = buildKeyTimeline({ wraps: [3, 2, 1], events: [], currentKeyEpoch: 3 });
    expect(t.truncatedBefore).toBe(0);
    expect(t.entries.map((e) => e.epoch)).toEqual([3, 2, 1]);
  });

  it('exactement à la borne, rien n’est coupé', () => {
    const t = buildKeyTimeline({
      wraps: [],
      events: [],
      currentKeyEpoch: MAX_TIMELINE_EPOCHS,
    });
    expect(t.entries).toHaveLength(MAX_TIMELINE_EPOCHS);
    expect(t.truncatedBefore).toBe(0);
    expect(t.entries[t.entries.length - 1].epoch).toBe(1);
  });

  it('une époque non finie ne devient pas un plafond', () => {
    const t = buildKeyTimeline({
      wraps: [Number.POSITIVE_INFINITY, Number.NaN, 2],
      events: [],
      currentKeyEpoch: 2,
    });
    expect(t.entries.map((e) => e.epoch)).toEqual([2, 1]);
    expect(t.truncatedBefore).toBe(0);
  });
});

/**
 * LE TABLEAU DE `/key-wraps` EST HOSTILE PAR SA TAILLE AUTANT QUE PAR SES
 * VALEURS. La route ne pagine pas (une ligne par époque, sans limite) :
 * `Math.max(annonce, ...scelles)` étalait ce tableau en arguments, et au-delà
 * d'environ cent mille le moteur lève `RangeError` — pendant le rendu, donc
 * écran blanc. Et une seule valeur aberrante emportait le plafond : la frise
 * d'un coffre jamais tourné annonçait « 999 999 800 époques plus anciennes »
 * sans jamais montrer l'époque 1, la seule qui existe.
 */
describe('la frise ne se laisse ni étaler ni entraîner par le tableau du serveur', () => {
  it('deux cent mille scellés ne font pas exploser la pile', () => {
    const wraps = Array.from({ length: 200_000 }, (_, i) => i + 1);
    const t = buildKeyTimeline({ wraps, events: [], currentKeyEpoch: 200_000 });
    expect(t.entries).toHaveLength(MAX_TIMELINE_EPOCHS);
    expect(t.entries[0].epoch).toBe(200_000);
  });

  it('un scellé d’époque aberrante n’entraîne pas le plafond avec lui', () => {
    const t = buildKeyTimeline({ wraps: [1, 1e9], events: [], currentKeyEpoch: 1 });
    expect(t.entries.map((e) => e.epoch)).toEqual([1]);
    expect(t.truncatedBefore).toBe(0);
  });

  it('un scellé d’UNE rotation d’avance reste dans la frise', () => {
    // Le résumé en mémoire peut être en retard d'une rotation : cette ligne est
    // réelle, et la jeter ferait disparaître une clé réellement détenue.
    const t = buildKeyTimeline({ wraps: [1, 2, 3], events: [], currentKeyEpoch: 2 });
    expect(t.entries.map((e) => e.epoch)).toEqual([3, 2, 1]);
    expect(t.entries[0].mine).toBe(true);
  });
});
