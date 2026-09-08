import { describe, it, expect } from 'vitest';

/**
 * F11 — « À QUEL POINT SUIS-JE SÛR QUE C'EST BIEN CETTE PERSONNE ? »
 *
 * Le serveur est un COURTIER de clés publiques : c'est lui qui répond quand on
 * demande « quelle est la clé de Bob ? ». Deux défenses se superposent —
 * l'empreinte comparée hors bande (de vive voix) et le journal de clés chaîné
 * (`keyTransparency`). Ce modèle ne fait que TRADUIRE ce que ces deux défenses
 * ont répondu en un état affichable, et il n'a le droit d'en inventer aucun.
 *
 * TROIS RÈGLES SONT DES GARDE-FOUS, et chacune a son test :
 *
 *  1. UNE MARQUE NE VAUT QUE POUR L'EMPREINTE QU'ELLE NOMME. « J'ai comparé ce
 *     numéro » porte sur un numéro précis, à une date précise ; si la clé
 *     servie n'est plus celle-là, la marque est PÉRIMÉE et ne vaut plus
 *     vérification. C'est exactement la règle de `confirmedFingerprints` dans la
 *     rotation : sans elle, une confirmation devient un interrupteur qui ouvre
 *     tout ce qui suivra.
 *  2. AUCUNE MARQUE LOCALE NE LÈVE UNE SUBSTITUTION. Un journal qui ne
 *     recalcule pas (`tampered_log`) ou une clé servie qui n'est pas la
 *     dernière du journal (`served_not_latest`) sont des preuves côté SERVEUR :
 *     une case cochée sur cet appareil ne les efface pas — c'est déjà la règle
 *     d'`isBlockedStatus` dans la cérémonie d'invitation.
 *  3. UNE ABSENCE D'INFORMATION N'EST PAS UN VERDICT. Pas encore contrôlé, ou
 *     contrôle en échec, valent « on ne sait pas » — jamais « tout va bien »,
 *     jamais une alerte rouge. (« terminal ≠ jetable ».)
 *
 * ET LE COMPTEUR « N VÉRIFIÉS SUR M » NE COMPTE QUE DE VRAIES VÉRIFICATIONS
 * HORS BANDE : un « Vu » (TOFU) n'en est pas une, et le confondre transformerait
 * « personne n'a jamais comparé un numéro » en « tout le monde est vérifié ».
 */

import {
  alertingMembers,
  memberTrust,
  trustCounter,
  type MemberKeyFacts,
} from '../memberTrustModel';

const AVANT = 'FP_AVANT';
const APRES = 'FP_APRES';
const HIER = Date.UTC(2026, 7, 28);

function facts(over: Partial<MemberKeyFacts>): MemberKeyFacts {
  return {
    // `in`, pas `??` : `status: null` est un CAS du modèle (« pas encore
    // contrôlé »), et un `??` le remplacerait silencieusement par « ok ».
    status: 'status' in over ? (over.status as MemberKeyFacts['status']) : 'ok',
    served: over.served === undefined ? AVANT : over.served,
    pinned: over.pinned === undefined ? AVANT : over.pinned,
    mark: over.mark ?? null,
  };
}

describe('ce qu’on ne sait pas ne devient pas un verdict', () => {
  it('pas encore contrôlé : « inconnu », et aucune alerte', () => {
    const v = memberTrust(facts({ status: null, served: null, pinned: null }));
    expect(v.state).toBe('unknown');
    expect(v.reason).toBe('not_checked');
    expect(v.alerts).toBe(false);
  });

  it('contrôle en échec (réseau, 403) : « inconnu », toujours pas d’alerte', () => {
    // Un membre dont on n'a pas su lire la clé n'est pas un membre suspect :
    // peindre la ligne en rouge sur une panne apprendrait à ignorer le rouge.
    const v = memberTrust(facts({ status: 'unreadable', served: null }));
    expect(v.state).toBe('unknown');
    expect(v.reason).toBe('unreadable');
    expect(v.alerts).toBe(false);
  });

  it('aucune clé publiée : un état À PART, pas une alerte', () => {
    // Cette personne n'a pas encore ouvert l'application sur un appareil : on ne
    // peut rien lui sceller, mais rien n'est suspect. Le dire évite de chercher
    // une substitution là où il n'y a qu'une absence.
    const v = memberTrust(facts({ status: 'no_key', served: null, pinned: null }));
    expect(v.state).toBe('unpublished');
    expect(v.reason).toBe('no_published_key');
    expect(v.alerts).toBe(false);
  });
});

describe('« Vu » (TOFU) n’est pas « Vérifié »', () => {
  it('une clé stable et jamais comparée reste « vue »', () => {
    const v = memberTrust(facts({ status: 'ok' }));
    expect(v.state).toBe('seen');
    expect(v.reason).toBe('tofu_seen');
    expect(v.verifiedAt).toBeNull();
  });

  it('une première rencontre est « vue », et le dit', () => {
    const v = memberTrust(facts({ status: 'first_seen', pinned: AVANT }));
    expect(v.state).toBe('seen');
    expect(v.reason).toBe('first_seen');
  });

  it('un compte sans journal reste « vu » : la clé EST publiée', () => {
    // `no_log` ne veut pas dire « pas de clé » (c'est `unpublished`), mais
    // « pas de journal de transparence » : un compte d'avant cette brique.
    const v = memberTrust(facts({ status: 'no_log' }));
    expect(v.state).toBe('seen');
    expect(v.reason).toBe('no_log');
  });
});

describe('la marque locale « j’ai comparé ce numéro »', () => {
  it('rend « vérifié », avec sa date', () => {
    const v = memberTrust(facts({ status: 'ok', mark: { fingerprint: AVANT, at: HIER } }));
    expect(v.state).toBe('verified');
    expect(v.reason).toBe('verified_out_of_band');
    expect(v.verifiedAt).toBe(HIER);
  });

  it('vaut dès l’acquittement, avant même le prochain contrôle', () => {
    // La cérémonie pose la marque ET ré-épingle (`acceptPeerKeyChange`) ; le
    // rapport en mémoire, lui, dit encore « changed » jusqu'au contrôle
    // suivant. L'écran doit refléter le geste qu'on vient de faire, sinon la
    // ligne reste rouge et on la vérifie une seconde fois pour rien.
    const v = memberTrust(
      facts({
        status: 'changed',
        served: APRES,
        pinned: APRES,
        mark: { fingerprint: APRES, at: HIER },
      })
    );
    expect(v.state).toBe('verified');
  });

  it('PÉRIME dès que la clé servie n’est plus celle qui a été comparée', () => {
    // LE garde-fou : sans lui, « j'ai comparé » deviendrait un interrupteur —
    // vérifié une fois, ouvert pour n'importe quelle clé servie ensuite, y
    // compris celle qu'un courtier glisse juste après.
    const v = memberTrust(
      facts({
        status: 'changed',
        served: APRES,
        pinned: AVANT,
        mark: { fingerprint: AVANT, at: HIER },
      })
    );
    expect(v.state).toBe('changed');
    expect(v.reason).toBe('fingerprint_changed');
    expect(v.alerts).toBe(true);
    expect(v.verifiedAt).toBeNull();
  });

  it('une marque périmée sur une clé redevenue stable ne rend pas « vérifié »', () => {
    // L'épinglage a suivi la nouvelle clé (par un autre chemin), donc rien
    // n'alerte ; mais personne n'a jamais comparé CE numéro-là de vive voix.
    const v = memberTrust(
      facts({ status: 'ok', served: APRES, pinned: APRES, mark: { fingerprint: AVANT, at: HIER } })
    );
    expect(v.state).toBe('seen');
    expect(v.reason).toBe('stale_mark');
    expect(v.alerts).toBe(false);
  });
});

describe('le numéro d’AVANT accompagne un changement', () => {
  it('donne les deux empreintes quand la clé a tourné', () => {
    // Sans le numéro précédent, « la clé a changé » ne se vérifie contre rien :
    // la personne au bout du fil ne peut confirmer « oui, j'ai changé
    // d'appareil » que si elle voit de quoi vers quoi.
    const v = memberTrust(facts({ status: 'changed', served: APRES, pinned: AVANT }));
    expect(v.fingerprint).toBe(APRES);
    expect(v.previousFingerprint).toBe(AVANT);
  });

  it('n’invente pas un « avant » quand rien n’a bougé', () => {
    expect(memberTrust(facts({ status: 'ok' })).previousFingerprint).toBeNull();
  });
});

describe('aucune marque locale ne lève une substitution', () => {
  it('un journal réécrit reste « clé changée », marque ou pas', () => {
    const v = memberTrust(
      facts({ status: 'tampered_log', mark: { fingerprint: AVANT, at: HIER } })
    );
    expect(v.state).toBe('changed');
    expect(v.reason).toBe('chain_broken');
    expect(v.alerts).toBe(true);
  });

  it('une clé servie qui n’est pas la dernière du journal, non plus', () => {
    const v = memberTrust(
      facts({ status: 'served_not_latest', mark: { fingerprint: AVANT, at: HIER } })
    );
    expect(v.state).toBe('changed');
    expect(v.reason).toBe('served_not_latest');
    expect(v.alerts).toBe(true);
  });
});

describe('le compteur et le bandeau', () => {
  const roster: Record<string, MemberKeyFacts> = {
    anne: facts({ status: 'ok', mark: { fingerprint: AVANT, at: HIER } }),
    bob: facts({ status: 'ok' }),
    carl: facts({ status: 'changed', served: APRES, pinned: AVANT }),
    dora: facts({ status: null, served: null, pinned: null }),
    eve: facts({ status: 'no_key', served: null, pinned: null }),
  };
  const verdicts = Object.fromEntries(
    Object.entries(roster).map(([id, f]) => [id, memberTrust(f)])
  );

  it('« N vérifiés sur M » ne compte QUE les vérifications hors bande', () => {
    expect(trustCounter(verdicts)).toEqual({ verified: 1, total: 5 });
  });

  it('le bandeau ne nomme que ceux qui alertent vraiment', () => {
    // Ni « vu », ni « inconnu », ni « clé non publiée » : un bandeau rouge qui
    // se lève sur un membre en règle finit par ne plus être lu.
    expect(alertingMembers(verdicts)).toEqual(['carl']);
  });

  it('un trombinoscope vide ne compte rien et n’alerte pas', () => {
    expect(trustCounter({})).toEqual({ verified: 0, total: 0 });
    expect(alertingMembers({})).toEqual([]);
  });
});
