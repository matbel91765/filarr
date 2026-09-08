import { describe, it, expect, beforeEach } from 'vitest';
import {
  keyLogEntryHash,
  verifyKeyLogChain,
  checkPeerKeyTransparency,
  type KeyLogEntry,
} from './keyTransparency';

const USER = 'victim-user-id';

// node has no localStorage; stub a Map-backed one so the TOFU baseline (and thus
// the first_seen → changed → ok transitions) can be exercised.
const tofuStore = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => tofuStore.get(k) ?? null,
  setItem: (k: string, v: string) => void tofuStore.set(k, v),
  removeItem: (k: string) => void tofuStore.delete(k),
};
beforeEach(() => tofuStore.clear());

// Build a VALID chain using the module's own canonical hash (so a tamper is the
// only way to break it). Mirrors how the worker appends entries.
async function buildChain(
  keys: Array<{ enc: string; sign: string; fp: string; createdAt: string }>
): Promise<KeyLogEntry[]> {
  const entries: KeyLogEntry[] = [];
  let prev = '';
  for (const k of keys) {
    const e: KeyLogEntry = {
      encPublicKey: k.enc,
      signPublicKey: k.sign,
      fingerprint: k.fp,
      prevHash: prev,
      entryHash: '',
      createdAt: k.createdAt,
    };
    e.entryHash = await keyLogEntryHash(USER, e);
    entries.push(e);
    prev = e.entryHash;
  }
  return entries;
}

describe('keyTransparency — chain verification (E3-7)', () => {
  it('accepts a well-formed chain and returns the latest entry', async () => {
    const chain = await buildChain([
      { enc: 'E1', sign: 'S1', fp: 'FP1', createdAt: '2026-01-01T00:00:00Z' },
      { enc: 'E2', sign: 'S2', fp: 'FP2', createdAt: '2026-02-01T00:00:00Z' },
    ]);
    const r = await verifyKeyLogChain(USER, chain);
    expect(r.valid).toBe(true);
    expect(r.latest?.encPublicKey).toBe('E2');
  });

  it('an empty log is trivially consistent (valid, no latest)', async () => {
    expect(await verifyKeyLogChain(USER, [])).toEqual({ valid: true, latest: null });
  });

  it('rejects a chain where a past entry was rewritten (entry_hash no longer matches)', async () => {
    const chain = await buildChain([
      { enc: 'E1', sign: 'S1', fp: 'FP1', createdAt: '2026-01-01T00:00:00Z' },
      { enc: 'E2', sign: 'S2', fp: 'FP2', createdAt: '2026-02-01T00:00:00Z' },
    ]);
    chain[0] = { ...chain[0], encPublicKey: 'E1-TAMPERED' }; // hash not recomputed
    expect((await verifyKeyLogChain(USER, chain)).valid).toBe(false);
  });

  it('rejects a broken prev_hash linkage', async () => {
    const chain = await buildChain([
      { enc: 'E1', sign: 'S1', fp: 'FP1', createdAt: '2026-01-01T00:00:00Z' },
      { enc: 'E2', sign: 'S2', fp: 'FP2', createdAt: '2026-02-01T00:00:00Z' },
    ]);
    chain[1] = { ...chain[1], prevHash: 'not-the-previous-hash' };
    expect((await verifyKeyLogChain(USER, chain)).valid).toBe(false);
  });

  it('rejects a chain verified under the WRONG user id (hash binds the user)', async () => {
    const chain = await buildChain([
      { enc: 'E1', sign: 'S1', fp: 'FP1', createdAt: '2026-01-01T00:00:00Z' },
    ]);
    expect((await verifyKeyLogChain('someone-else', chain)).valid).toBe(false);
  });
});

describe('keyTransparency — peer-key status (E3-7)', () => {
  const latestKeys = {
    enc: 'ENC_LATEST',
    sign: 'SIGN_LATEST',
    fp: 'FP_LATEST',
    createdAt: '2026-03-01T00:00:00Z',
  };

  it('ok/first_seen when the served key IS the latest logged entry', async () => {
    const chain = await buildChain([latestKeys]);
    // node has no localStorage → TOFU baseline is null → first_seen.
    const status = await checkPeerKeyTransparency(
      USER,
      { encPublicKey: 'ENC_LATEST', fingerprint: 'FP_LATEST' },
      chain
    );
    expect(status).toBe('first_seen');
  });

  it('served_not_latest when the broker serves a key absent from the log (substitution)', async () => {
    const chain = await buildChain([latestKeys]);
    const status = await checkPeerKeyTransparency(
      USER,
      { encPublicKey: 'ENC_ATTACKER', fingerprint: 'FP_LATEST' },
      chain
    );
    expect(status).toBe('served_not_latest');
  });

  it('tampered_log when the chain does not recompute', async () => {
    const chain = await buildChain([latestKeys]);
    chain[0] = { ...chain[0], entryHash: 'forged' };
    const status = await checkPeerKeyTransparency(
      USER,
      { encPublicKey: 'ENC_LATEST', fingerprint: 'FP_LATEST' },
      chain
    );
    expect(status).toBe('tampered_log');
  });

  it('no_log for a NEVER-PINNED peer with an empty log (genuine legacy account)', async () => {
    const status = await checkPeerKeyTransparency(
      USER,
      { encPublicKey: 'ENC', fingerprint: 'FP' },
      []
    );
    expect(status).toBe('no_log');
  });

  it('un pair SANS journal est tout de même épinglé — sinon le courtier peut servir une clé par appel', async () => {
    // `no_log` était le seul état où l'on ne retenait RIEN. Un courtier pouvait
    // donc servir une clé différente à chaque requête, indéfiniment, sans jamais
    // franchir un seul contrôle : il n'y avait aucune mémoire à contredire. Le
    // journal manque (compte ancien) ; la mémoire, non.
    expect(
      await checkPeerKeyTransparency(USER, { encPublicKey: 'ENC', fingerprint: 'FP' }, [])
    ).toBe('no_log');
    // Le même pair, même absence de journal, une AUTRE clé : ça ressort.
    expect(
      await checkPeerKeyTransparency(
        USER,
        { encPublicKey: 'ENC_AUTRE', fingerprint: 'FP_AUTRE' },
        []
      )
    ).toBe('changed');
    // Et la même clé qu'au premier passage reste paisible.
    expect(
      await checkPeerKeyTransparency(USER, { encPublicKey: 'ENC', fingerprint: 'FP' }, [])
    ).toBe('no_log');
  });

  it("ANTI-TRUNCATION: an empty log for an ALREADY-PINNED peer is 'changed', not no_log", async () => {
    const chain = await buildChain([latestKeys]);
    // pin the peer (first_seen sets the TOFU baseline)
    expect(
      await checkPeerKeyTransparency(
        USER,
        { encPublicKey: 'ENC_LATEST', fingerprint: 'FP_LATEST' },
        chain
      )
    ).toBe('first_seen');
    // a malicious broker now serves an attacker key + an EMPTY log to suppress the alert
    expect(
      await checkPeerKeyTransparency(
        USER,
        { encPublicKey: 'ENC_ATTACKER', fingerprint: 'FP_ATTACKER' },
        []
      )
    ).toBe('changed');
  });

  it("TOFU: 'changed' when the peer fingerprint differs from the pinned baseline, 'ok' when it matches", async () => {
    const chain1 = await buildChain([latestKeys]);
    await checkPeerKeyTransparency(
      USER,
      { encPublicKey: 'ENC_LATEST', fingerprint: 'FP_LATEST' },
      chain1
    ); // pins FP_LATEST
    expect(
      await checkPeerKeyTransparency(
        USER,
        { encPublicKey: 'ENC_LATEST', fingerprint: 'FP_LATEST' },
        chain1
      )
    ).toBe('ok');

    const chain2 = await buildChain([
      { enc: 'ENC_NEW', sign: 'SIGN_NEW', fp: 'FP_NEW', createdAt: '2026-04-01T00:00:00Z' },
    ]);
    expect(
      await checkPeerKeyTransparency(
        USER,
        { encPublicKey: 'ENC_NEW', fingerprint: 'FP_NEW' },
        chain2
      )
    ).toBe('changed');
  });
});
