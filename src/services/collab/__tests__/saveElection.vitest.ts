/**
 * Élection du pair qui enregistre.
 *
 * La règle complète est en tête de `saveElection.ts` ; ce que ces tests
 * vérifient, c'est qu'elle tient les trois promesses sur lesquelles repose
 * l'absence de tempête de conflits : elle est déterministe, elle se reprend
 * toute seule quand le responsable part, et un lecteur n'y gagne jamais.
 */

import { describe, it, expect } from 'vitest';
import {
  electSaveResponsible,
  isSaveResponsible,
  roleCanWrite,
  SAVE_ELECTION_SETTLE_MS,
  type SaveCandidate,
} from '../saveElection';

const writer = (clientId: number): SaveCandidate => ({ clientId, canWrite: true });
const reader = (clientId: number): SaveCandidate => ({ clientId, canWrite: false });

describe('rôles', () => {
  it('seul un lecteur ne peut pas écrire', () => {
    expect(roleCanWrite('owner')).toBe(true);
    expect(roleCanWrite('admin')).toBe(true);
    expect(roleCanWrite('member')).toBe(true);
    expect(roleCanWrite('viewer')).toBe(false);
  });

  it('un rôle inconnu, absent ou inventé est traité comme un lecteur', () => {
    expect(roleCanWrite(undefined)).toBe(false);
    expect(roleCanWrite(null)).toBe(false);
    expect(roleCanWrite('')).toBe(false);
    expect(roleCanWrite('superadmin')).toBe(false);
  });
});

describe('élection — déterminisme', () => {
  it('désigne le plus petit identifiant parmi ceux qui peuvent écrire', () => {
    expect(electSaveResponsible([writer(70), writer(12), writer(45)])).toBe(12);
  });

  it('ne dépend PAS de l’ordre dans lequel la présence est arrivée', () => {
    const roster = [writer(70), reader(3), writer(12), writer(45)];
    const shuffled = [writer(45), writer(12), writer(70), reader(3)];
    expect(electSaveResponsible(roster)).toBe(12);
    expect(electSaveResponsible(shuffled)).toBe(12);
    // C'est LA propriété qui rend l'élection utilisable sans négociation : tous
    // les pairs voient la même salle et calculent le même vainqueur.
    expect(electSaveResponsible(roster)).toBe(electSaveResponsible(shuffled));
  });

  it('ignore un identifiant qui n’est pas un nombre fini', () => {
    expect(electSaveResponsible([{ clientId: Number.NaN, canWrite: true }, writer(9)])).toBe(9);
  });
});

describe('élection — un lecteur n’enregistre jamais', () => {
  it('ne gagne pas, même avec le plus petit identifiant de la salle', () => {
    expect(electSaveResponsible([reader(1), writer(500)])).toBe(500);
  });

  it('une salle de lecteurs seuls n’a AUCUN responsable', () => {
    // Pas de repli sur « le plus petit quand même » : le serveur refuserait
    // l'écriture (403), donc élire un lecteur, c'est ne plus jamais enregistrer.
    expect(electSaveResponsible([reader(1), reader(2)])).toBeNull();
    expect(electSaveResponsible([])).toBeNull();
  });

  it('notre propre rôle prime sur tout ce que dit la salle', () => {
    // Salle vide de concurrents, identifiant gagnant : et pourtant non, parce
    // que NOUS sommes en lecture seule. C'est la garde locale, celle qui ne
    // dépend d'aucune donnée venue du réseau.
    expect(
      isSaveResponsible({
        localClientId: 5,
        candidates: [writer(5)],
        localCanWrite: false,
        settled: true,
      })
    ).toBe(false);
  });
});

describe('élection — stabilisation', () => {
  it('personne n’écrit tant que la salle n’est pas stabilisée', () => {
    expect(
      isSaveResponsible({
        localClientId: 5,
        candidates: [writer(5)],
        localCanWrite: true,
        settled: false,
      })
    ).toBe(false);
  });

  it('le délai de stabilisation existe et laisse à la présence le temps d’arriver', () => {
    expect(SAVE_ELECTION_SETTLE_MS).toBeGreaterThan(0);
  });
});

describe('élection — reprise au départ du responsable', () => {
  it('le suivant prend la main sans négociation, dès que la présence du parti disparaît', () => {
    const moi = 42;
    const responsable = 7;

    // 1. Le responsable est là : nous ne sommes pas celui qui écrit.
    const avec = [writer(responsable), writer(moi), writer(99)];
    expect(electSaveResponsible(avec)).toBe(responsable);
    expect(
      isSaveResponsible({
        localClientId: moi,
        candidates: avec,
        localCanWrite: true,
        settled: true,
      })
    ).toBe(false);

    // 2. Il ferme la note : sa présence quitte la salle. Aucun message n'est
    //    échangé, aucun verrou n'est rendu — la liste change, le vainqueur aussi.
    const sans = avec.filter((c) => c.clientId !== responsable);
    expect(electSaveResponsible(sans)).toBe(moi);
    expect(
      isSaveResponsible({
        localClientId: moi,
        candidates: sans,
        localCanWrite: true,
        settled: true,
      })
    ).toBe(true);
  });

  it('la reprise saute par-dessus les lecteurs restants', () => {
    const moi = 42;
    const apresDepart = [reader(1), reader(8), writer(moi)];
    expect(electSaveResponsible(apresDepart)).toBe(moi);
    expect(
      isSaveResponsible({
        localClientId: moi,
        candidates: apresDepart,
        localCanWrite: true,
        settled: true,
      })
    ).toBe(true);
  });

  it('si le responsable part et que seuls des lecteurs restent, plus personne n’écrit', () => {
    const apresDepart = [reader(1), reader(8)];
    expect(electSaveResponsible(apresDepart)).toBeNull();
    expect(
      isSaveResponsible({
        localClientId: 1,
        candidates: apresDepart,
        localCanWrite: false,
        settled: true,
      })
    ).toBe(false);
  });

  it('un pair SEUL est son propre responsable — le repli hors ligne', () => {
    // Sans réseau, la salle se réduit à nous : refuser d'écrire reviendrait à
    // perdre la frappe, alors que c'est exactement le cas où il faut écrire.
    expect(
      isSaveResponsible({
        localClientId: 3,
        candidates: [writer(3)],
        localCanWrite: true,
        settled: true,
      })
    ).toBe(true);
  });
});
