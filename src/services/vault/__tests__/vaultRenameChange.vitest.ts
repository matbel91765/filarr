/**
 * REPEINDRE N'EST PAS RENOMMER — et seul le CLIENT peut le dire.
 *
 * ── CE QUI N'ALLAIT PAS ─────────────────────────────────────────────────────
 *
 * L'icône et la couleur PARTAGÉES d'un coffre voyagent dans la même enveloppe
 * scellée que son nom : côté serveur, les deux gestes sont exactement le même
 * couple opaque. Le fil d'activité annonçait donc « a renommé le coffre » à
 * chaque changement de couleur, sous les yeux de tous les membres. Le serveur
 * ne PEUT pas trancher — il ne déchiffre rien.
 *
 * `PATCH /vaults/:id` accepte désormais `change` (`'name'` par défaut) et écrit
 * `vault.rename` ou `vault.appearance`
 * (`infra/cloudflare-worker/docs/CHANGES-2026-09.md`, §2).
 *
 * ── CE QUE CES VECTEURS GARDENT ─────────────────────────────────────────────
 *
 * La COMPATIBILITÉ DANS LES DEUX SENS, qui est la seule chose qu'un test peut
 * protéger ici :
 *   · un renommage envoie EXACTEMENT le corps d'avant — un serveur qui n'a pas
 *     l'incrément reçoit ce qu'il a toujours reçu ;
 *   · une repeinte ajoute UN champ, que ce même serveur ignore comme n'importe
 *     quel champ inconnu : le geste aboutit, seul le récit reste celui d'avant.
 *
 *   npx vitest run src/services/vault/__tests__/vaultRenameChange.vitest.ts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const client = vi.hoisted(() => ({ patch: vi.fn() }));

vi.mock('../../network/apiClient', () => ({ default: client }));

import { apiRenameVault } from '../vaultApi';

beforeEach(() => {
  vi.clearAllMocks();
  client.patch.mockResolvedValue({ data: { success: true } });
});

describe('apiRenameVault — ce qui part sur le fil', () => {
  it('un RENOMMAGE envoie exactement le corps d’avant, sans `change`', async () => {
    await apiRenameVault('v1', 'ct', 'iv');
    expect(client.patch).toHaveBeenCalledWith('/vaults/v1', { nameEncrypted: 'ct', nameIv: 'iv' });
    // Pas seulement « pas égal à appearance » : la clé doit être ABSENTE.
    expect('change' in (client.patch.mock.calls[0][1] as object)).toBe(false);
  });

  it('`change: "name"` explicite est traité comme le défaut — même corps', async () => {
    await apiRenameVault('v1', 'ct', 'iv', 'name');
    expect(client.patch).toHaveBeenCalledWith('/vaults/v1', { nameEncrypted: 'ct', nameIv: 'iv' });
  });

  it('une REPEINTE ajoute `change: "appearance"`, et rien d’autre', async () => {
    await apiRenameVault('v1', 'ct', 'iv', 'appearance');
    expect(client.patch).toHaveBeenCalledWith('/vaults/v1', {
      nameEncrypted: 'ct',
      nameIv: 'iv',
      change: 'appearance',
    });
  });

  it('l’enveloppe SCELLÉE part entière dans les deux cas', async () => {
    // Le défaut voisin, déjà corrigé et qu'on ne veut pas rouvrir : n'écrire
    // que le nom effacerait l'apparence pour tout le monde. Le couple
    // (nameEncrypted, nameIv) est donc toujours là, quel que soit le geste.
    await apiRenameVault('v1', 'ct', 'iv', 'appearance');
    const body = client.patch.mock.calls[0][1] as Record<string, unknown>;
    expect(body.nameEncrypted).toBe('ct');
    expect(body.nameIv).toBe('iv');
  });

  it('un refus reste un `rename_failed` — le code d’erreur ne change pas', async () => {
    client.patch.mockRejectedValueOnce(new Error('boom'));
    await expect(apiRenameVault('v1', 'ct', 'iv', 'appearance')).rejects.toThrow();
  });
});
