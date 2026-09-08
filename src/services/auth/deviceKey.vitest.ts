import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  generateAndWrapFEK,
  enrollDeviceKey,
  initFromDeviceKey,
  hasDeviceKeyWrap,
  clearDeviceKeyEnrollment,
  clearHybridCrypto,
  hasHybridKey,
  encryptFileContent,
  decryptFileContent,
  cloudPortableWrap,
} from './hybridCrypto';

// E5-4: real-crypto round-trip of the device-bound SSO unlock. The IPC is mocked with an in-memory
// store standing in for the OS keychain (.device_key_safe) + the on-disk wrapped_fek.json, so we
// exercise the actual AES-GCM/HKDF enrol → wipe-memory → password-less unlock path.

let store: { wrapped: any; deviceKey: number[] | null; fek: number[] | null };

const invoke = vi.fn(async (channel: string, payload?: any) => {
  switch (channel) {
    case 'hybrid:loadWrappedKey':
      return store.wrapped;
    case 'hybrid:saveWrappedKey':
      store.wrapped = payload;
      return true;
    case 'hybrid:storeDeviceKey':
      store.deviceKey = payload;
      return true;
    case 'hybrid:loadDeviceKey':
      return store.deviceKey;
    case 'hybrid:clearDeviceKey':
      store.deviceKey = null;
      return true;
    case 'hybrid:storeFEK':
      store.fek = payload;
      return true;
    case 'hybrid:loadFEK':
      return store.fek;
    default:
      return null;
  }
});

beforeEach(() => {
  store = { wrapped: null, deviceKey: null, fek: null };
  (globalThis as any).window = { electron: { ipcRenderer: { invoke } } };
  clearHybridCrypto();
  invoke.mockClear();
});

const enc = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer;

describe('E5-4 device-key unlock', () => {
  it('enrols then unlocks the FEK with NO password — the same FEK round-trips', async () => {
    store.wrapped = await generateAndWrapFEK('pw'); // FEK now in memory
    const ct = await encryptFileContent(enc('top-secret-bytes'), { compress: false });

    await enrollDeviceKey();
    expect(store.wrapped.deviceWrappedFek).toBeTruthy();
    expect(store.wrapped.deviceSalt).toBeTruthy();
    expect(store.deviceKey?.length).toBe(32); // 256-bit device key in the keychain

    clearHybridCrypto();
    expect(hasHybridKey()).toBe(false);

    await initFromDeviceKey(); // password-less, post-SSO
    expect(hasHybridKey()).toBe(true);
    const pt = await decryptFileContent(ct);
    expect(new TextDecoder().decode(pt)).toBe('top-secret-bytes'); // proves it's the SAME FEK
    expect(await hasDeviceKeyWrap()).toBe(true);
  });

  it('initFromDeviceKey fails on a device that was never enrolled', async () => {
    store.wrapped = await generateAndWrapFEK('pw');
    clearHybridCrypto();
    await expect(initFromDeviceKey()).rejects.toThrow(/device-key/i);
  });

  it('initFromDeviceKey fails if the keychain device key is gone (wrap alone is useless)', async () => {
    store.wrapped = await generateAndWrapFEK('pw');
    await enrollDeviceKey();
    store.deviceKey = null; // keychain wiped (e.g. OS reset) but the wrap remains
    clearHybridCrypto();
    expect(await hasDeviceKeyWrap()).toBe(false);
    await expect(initFromDeviceKey()).rejects.toThrow(/key not found/i);
  });

  it('clearDeviceKeyEnrollment wipes the key + strips the wrap (no more password-less unlock)', async () => {
    store.wrapped = await generateAndWrapFEK('pw');
    await enrollDeviceKey();
    await clearDeviceKeyEnrollment();
    expect(store.deviceKey).toBeNull();
    expect(store.wrapped.deviceWrappedFek).toBeUndefined();
    expect(await hasDeviceKeyWrap()).toBe(false);
    clearHybridCrypto();
    await expect(initFromDeviceKey()).rejects.toThrow();
  });

  it('the device wrap is added ALONGSIDE the password wrap (wrappedFek untouched, local-only)', async () => {
    store.wrapped = await generateAndWrapFEK('pw');
    const before = store.wrapped.wrappedFek;
    await enrollDeviceKey();
    expect(store.wrapped.wrappedFek).toBe(before); // the cloud-portable password wrap is unchanged
    expect(store.wrapped.deviceWrappedFek).toBeTruthy(); // device wrap sits beside it
  });

  it('F1: cloudPortableWrap strips EVERY local-only wrap (hw / decoy / device never leave)', () => {
    const out = cloudPortableWrap({
      wrappedFek: 'WF',
      kekSalt: 'KS',
      version: 1,
      recoveryWrappedFek: 'RWF',
      recoverySalt: 'RS',
      hwWrappedFek: 'HW',
      hwSalt: 'HS',
      hwCredentialId: 'HC',
      altWrappedFek: 'ALT',
      altKekSalt: 'AKS',
      altProfileId: 'AP',
      deviceWrappedFek: 'DW',
      deviceSalt: 'DS',
      deviceKeyId: 'DI',
    });
    expect(out).toEqual({
      wrappedFek: 'WF',
      kekSalt: 'KS',
      version: 1,
      recoveryWrappedFek: 'RWF',
      recoverySalt: 'RS',
    });
    const json = JSON.stringify(out);
    for (const leak of ['HW', 'HS', 'HC', 'ALT', 'AKS', 'AP', 'DW', 'DS', 'DI']) {
      expect(json).not.toContain(leak);
    }
  });
});
