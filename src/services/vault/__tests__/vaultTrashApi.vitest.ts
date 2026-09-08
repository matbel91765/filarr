/**
 * L'IRRÉVERSIBLE DOIT SURVIVRE AU TRANSPORT (F20).
 *
 * CE QUI ÉTAIT CASSÉ, ET CE QUE ÇA COÛTAIT. `POST /:id/trash/empty` relit la
 * conservation légale DANS sa boucle de destruction : un hold posé pendant la
 * passe l'ARRÊTE, et la route répond alors `409 { code: 'legal_hold_active',
 * purged: N }` — après avoir détruit N éléments POUR DE BON. Or `throwWithCode`
 * réduit tout refus à son code canonique et jette la réponse axios avec :
 * le compte disparaissait entre le serveur et l'écran. Sur un hold posé pendant
 * la PREMIÈRE passe, l'écran n'avait donc rien à additionner et n'affichait que
 * « une conservation légale est en cours » — c'est-à-dire « rien n'a bougé »,
 * alors que jusqu'à quarante-neuf documents et toutes leurs versions
 * n'existaient plus. Sur un geste sans retour, c'est le pire des malentendus :
 * on va ensuite chercher ce qui n'est plus là.
 *
 * La sortie est la même que pour `retention_over_policy` : une CLASSE d'erreur
 * qui porte le chiffre, avec le code canonique en guise de message — pour que
 * `vaultErrorKey` et `errorText` continuent de fonctionner sans rien savoir
 * d'elle.
 *
 *   npx vitest run src/services/vault/__tests__/vaultTrashApi.vitest.ts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const client = vi.hoisted(() => ({ post: vi.fn() }));

vi.mock('../../network/apiClient', () => ({ default: client }));

import { apiEmptyVaultTrash, apiPurgeVault, VaultTrashPartialError } from '../vaultApi';
import { errorText } from '../vaultErrorMessages';

/** Un rejet façon axios : le serveur a répondu, avec son code et son corps. */
function httpError(status: number, data: Record<string, unknown>) {
  return Object.assign(new Error(`Request failed with status code ${status}`), {
    isAxiosError: true,
    response: { status, data: { success: false, ...data } },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('apiEmptyVaultTrash — un refus qui a DÉJÀ détruit doit le dire', () => {
  it('rend le compte de destruction joint au 409, dans une classe qui le porte', async () => {
    client.post.mockRejectedValueOnce(httpError(409, { code: 'legal_hold_active', purged: 12 }));
    await expect(apiEmptyVaultTrash('v1')).rejects.toBeInstanceOf(VaultTrashPartialError);

    client.post.mockRejectedValueOnce(httpError(409, { code: 'legal_hold_active', purged: 12 }));
    const e = await apiEmptyVaultTrash('v1').catch((err: unknown) => err);
    expect((e as VaultTrashPartialError).purged).toBe(12);
    // Le message reste le CODE : sans cela, la table de traduction perdrait la
    // phrase de la conservation légale et l'écran retomberait sur « échec ».
    expect(errorText(e)).toBe('legal_hold_active');
  });

  it('un refus qui n’a RIEN détruit reste un refus nu', async () => {
    // `purged: 0` veut dire ce qu'il dit : rien n'a bougé. L'envelopper ferait
    // afficher « le vidage s'est arrêté après 0 élément détruit », une phrase
    // qui invente un demi-geste là où il n'y en a pas eu.
    client.post.mockRejectedValueOnce(httpError(409, { code: 'legal_hold_active', purged: 0 }));
    const zero = await apiEmptyVaultTrash('v1').catch((err: unknown) => err);
    expect(zero).not.toBeInstanceOf(VaultTrashPartialError);
    expect(errorText(zero)).toBe('legal_hold_active');

    // Un 429 du seau ne porte aucun compte : rien à additionner, rien à dire.
    client.post.mockRejectedValueOnce(httpError(429, { code: 'rate_limited' }));
    const seau = await apiEmptyVaultTrash('v1').catch((err: unknown) => err);
    expect(seau).not.toBeInstanceOf(VaultTrashPartialError);
    expect(errorText(seau)).toBe('rate_limited');
  });

  it('un compte ABERRANT n’est pas cru', async () => {
    // Un « purged » non numérique ou négatif ne vient d'aucun contrat : on ne
    // construit pas une phrase chiffrée sur ce qu'on ne comprend pas.
    for (const purged of ['douze', -3, Number.NaN]) {
      client.post.mockRejectedValueOnce(httpError(409, { code: 'legal_hold_active', purged }));
      const e = await apiEmptyVaultTrash('v1').catch((err: unknown) => err);
      expect(e, String(purged)).not.toBeInstanceOf(VaultTrashPartialError);
    }
  });

  it('le chemin normal rend toujours la passe telle quelle', async () => {
    client.post.mockResolvedValueOnce({
      data: { success: true, data: { purged: 50, remaining: 120 } },
    });
    await expect(apiEmptyVaultTrash('v1')).resolves.toEqual({ purged: 50, remaining: 120 });
    expect(client.post).toHaveBeenCalledWith('/vaults/v1/trash/empty', {});
  });

  it('une enveloppe SANS compte n’est pas « rien à faire »', async () => {
    client.post.mockResolvedValueOnce({ data: { success: true, data: {} } });
    await expect(apiEmptyVaultTrash('v1')).rejects.toThrow('trash_empty_malformed');
  });
});

describe('apiPurgeVault — le contrat de la route, pas une dérivation', () => {
  it('lit l’état SERVI plutôt que de le recalculer', async () => {
    client.post.mockResolvedValueOnce({
      data: { success: true, data: { purged: false, inProgress: true } },
    });
    await expect(apiPurgeVault('v1')).resolves.toEqual({ purged: false, inProgress: true });

    client.post.mockResolvedValueOnce({
      data: { success: true, data: { purged: true, inProgress: false } },
    });
    await expect(apiPurgeVault('v1')).resolves.toEqual({ purged: true, inProgress: false });
  });

  /**
   * LE CAS QUI SÉPARE LA LECTURE DE LA DÉRIVATION, et le seul qui garde vraiment
   * quelque chose. Les trois retours actuels de la route vérifient
   * `inProgress === !purged`, si bien qu'un client qui RECALCULE tombe juste par
   * accident. Le jour où la route sert un état « ni purgé ni en cours » — un
   * refus mou, une passe reportée —, la dérivation annoncerait « purge engagée »
   * à tort : sur un geste sans retour, c'est promettre une destruction que
   * personne n'a lancée.
   */
  it('« ni purgé ni en cours » ne devient pas « engagée »', async () => {
    client.post.mockResolvedValueOnce({
      data: { success: true, data: { purged: false, inProgress: false } },
    });
    await expect(apiPurgeVault('v1')).resolves.toEqual({ purged: false, inProgress: false });
  });

  it('sans le champ, l’ignorance penche du côté qui ne promet rien', async () => {
    // Une enveloppe muette se lit « engagée », jamais « terminée » : c'est le
    // repli, pas le contrat.
    client.post.mockResolvedValueOnce({ data: { success: true, data: {} } });
    await expect(apiPurgeVault('v1')).resolves.toEqual({ purged: false, inProgress: true });
  });
});
