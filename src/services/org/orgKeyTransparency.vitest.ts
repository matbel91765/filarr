import { describe, it, expect, beforeEach } from 'vitest';
import { keyLogEntryHash, type KeyLogEntry } from '../vault/keyTransparency';
import {
  checkOrgKeyTransparency,
  isOrgKeyTrustedForEscrow,
  acceptOrgKeyChange,
} from './orgKeyTransparency';

const ORG = 'org-under-test';

// node has no localStorage; stub a Map-backed one so the org TOFU baseline transitions work.
const tofuStore = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => tofuStore.get(k) ?? null,
  setItem: (k: string, v: string) => void tofuStore.set(k, v),
  removeItem: (k: string) => void tofuStore.delete(k),
};
beforeEach(() => tofuStore.clear());

// Build a VALID org-key chain using the SAME canonical hash the worker uses (org id in the
// identity slot) — a tamper is then the only way to break it.
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
    e.entryHash = await keyLogEntryHash(ORG, e);
    entries.push(e);
    prev = e.entryHash;
  }
  return entries;
}

describe('E4-7 org key transparency gate', () => {
  it('first_seen then ok when the served key is the latest and the fingerprint is stable', async () => {
    const chain = await buildChain([{ enc: 'E1', sign: 'S1', fp: 'FP1', createdAt: '2026-01-01' }]);
    const served = { encPublicKey: 'E1', fingerprint: 'FP1' };
    expect(await checkOrgKeyTransparency(ORG, served, chain)).toBe('first_seen');
    expect(await checkOrgKeyTransparency(ORG, served, chain)).toBe('ok');
    expect(isOrgKeyTrustedForEscrow('ok')).toBe(true);
    expect(isOrgKeyTrustedForEscrow('first_seen')).toBe(true);
  });

  it('tampered_log when the chain does not recompute', async () => {
    const chain = await buildChain([{ enc: 'E1', sign: 'S1', fp: 'FP1', createdAt: '2026-01-01' }]);
    chain[0].entryHash = 'deadbeef'; // rewrite history
    const status = await checkOrgKeyTransparency(
      ORG,
      { encPublicKey: 'E1', fingerprint: 'FP1' },
      chain
    );
    expect(status).toBe('tampered_log');
    expect(isOrgKeyTrustedForEscrow(status)).toBe(false);
  });

  it('served_not_latest when the broker serves a key that is not the latest logged entry', async () => {
    const chain = await buildChain([{ enc: 'E1', sign: 'S1', fp: 'FP1', createdAt: '2026-01-01' }]);
    // The broker serves a DIFFERENT (substituted) key than what the log attests.
    const status = await checkOrgKeyTransparency(
      ORG,
      { encPublicKey: 'EVIL', fingerprint: 'FPEVIL' },
      chain
    );
    expect(status).toBe('served_not_latest');
    expect(isOrgKeyTrustedForEscrow(status)).toBe(false);
  });

  it('changed when the org fingerprint differs from the pinned baseline (until accepted OOB)', async () => {
    const chain1 = await buildChain([
      { enc: 'E1', sign: 'S1', fp: 'FP1', createdAt: '2026-01-01' },
    ]);
    expect(
      await checkOrgKeyTransparency(ORG, { encPublicKey: 'E1', fingerprint: 'FP1' }, chain1)
    ).toBe('first_seen');
    // The org key rotates (valid chain extends), but the member hasn't confirmed OOB yet.
    const chain2 = await buildChain([
      { enc: 'E1', sign: 'S1', fp: 'FP1', createdAt: '2026-01-01' },
      { enc: 'E2', sign: 'S2', fp: 'FP2', createdAt: '2026-02-01' },
    ]);
    const status = await checkOrgKeyTransparency(
      ORG,
      { encPublicKey: 'E2', fingerprint: 'FP2' },
      chain2
    );
    expect(status).toBe('changed');
    expect(isOrgKeyTrustedForEscrow(status)).toBe(false);
    // After out-of-band confirmation, the new fingerprint is pinned → ok.
    acceptOrgKeyChange(ORG, 'FP2');
    expect(
      await checkOrgKeyTransparency(ORG, { encPublicKey: 'E2', fingerprint: 'FP2' }, chain2)
    ).toBe('ok');
  });

  it('empty log on first contact PINS the served key (first_seen), closing the no_log downgrade', async () => {
    const status = await checkOrgKeyTransparency(
      ORG,
      { encPublicKey: 'E1', fingerprint: 'FP1' },
      []
    );
    expect(status).toBe('first_seen');
    expect(isOrgKeyTrustedForEscrow(status)).toBe(true);
    // Now pinned: a broker that keeps serving an empty log with a DIFFERENT key → 'changed'.
    expect(await checkOrgKeyTransparency(ORG, { encPublicKey: 'E2', fingerprint: 'FP2' }, [])).toBe(
      'changed'
    );
  });

  it("anti-truncation: an empty log for an ALREADY-pinned org is 'changed', not no_log", async () => {
    const chain = await buildChain([{ enc: 'E1', sign: 'S1', fp: 'FP1', createdAt: '2026-01-01' }]);
    expect(
      await checkOrgKeyTransparency(ORG, { encPublicKey: 'E1', fingerprint: 'FP1' }, chain)
    ).toBe('first_seen');
    // Server now serves an EMPTY log to suppress the key-change alert.
    expect(await checkOrgKeyTransparency(ORG, { encPublicKey: 'E1', fingerprint: 'FP1' }, [])).toBe(
      'changed'
    );
  });
});
