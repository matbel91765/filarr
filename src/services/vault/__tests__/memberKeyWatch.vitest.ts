import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * LE CACHE DU CONTRÔLE DES CLÉS (F11) — ce qu'il a le droit de garder, et ce
 * qu'il n'a PAS le droit de garder.
 *
 * POURQUOI CETTE ÉPREUVE EXISTE. `watchVaultMemberKeys` s'épargne deux lectures
 * par membre quand le dernier contrôle est encore frais, et « frais » valait
 * vingt-quatre heures pour TOUT rapport rangé — y compris pour un rapport qui
 * n'avait rien constaté. Une page ouverte hors ligne, un 500 passager, un 403,
 * et la personne concernée était sautée pendant une journée entière : si sa clé
 * était substituée dans cette fenêtre, `memberTrust` rendait « inconnu », aucune
 * alerte n'était déposée, et ni le bandeau rouge de la page, ni le point rouge
 * du bouton « Gérer », ni le filtre « Clé changée » ne bougeaient. C'est-à-dire
 * que la seule chose que la fiche promet — voir la substitution AVANT de sceller
 * quoi que ce soit — était perdue par une panne de réseau, en silence.
 *
 * LA RÈGLE QUE CES TESTS TIENNENT est celle que le modèle énonce déjà en toutes
 * lettres (`memberTrustModel`, règle 3) : une absence d'information n'est pas un
 * verdict, donc elle ne se met pas en cache comme s'en était un. Un contrôle
 * ABOUTI tient la journée ; un contrôle en échec ne retient sa place que
 * quelques minutes — assez pour qu'une panne durable ne relance pas deux cents
 * lectures à chaque rendu, pas assez pour aveugler la page jusqu'au lendemain.
 *
 * TOUT PASSE PAR LE COMPORTEMENT, jamais par `isFresh` directement : ce qui
 * compte n'est pas la valeur d'un prédicat interne mais le nombre de lectures
 * que la page fait vraiment, et c'est ce que compte chaque assertion.
 */

const api = vi.hoisted(() => ({ publicKey: vi.fn(), keyLog: vi.fn() }));
const kt = vi.hoisted(() => ({ check: vi.fn(), tofu: vi.fn(), accept: vi.fn() }));

vi.mock('../vaultApi', () => ({
  apiGetMemberPublicKey: api.publicKey,
  apiGetKeyLog: api.keyLog,
}));

vi.mock('../keyTransparency', () => ({
  checkPeerKeyTransparency: kt.check,
  getTofuFingerprint: kt.tofu,
  acceptPeerKeyChange: kt.accept,
}));

import {
  KEY_WATCH_FAIL_TTL_MS,
  KEY_WATCH_TTL_MS,
  getMemberKeyReport,
  watchVaultMemberKeys,
} from '../memberKeyWatch';

/** L'instant de départ de chaque scénario — les tests avancent l'horloge. */
const T0 = Date.UTC(2026, 7, 29, 9, 0, 0);

/**
 * Un identifiant NEUF à chaque test. Le service garde ses rapports dans une
 * table de module (elle double le `localStorage`, absent en environnement
 * `node`) : deux tests qui parleraient de la même personne se transmettraient
 * leur cache, et l'un ferait passer l'autre pour vert.
 */
let n = 0;
const quelquun = () => `u-${++n}`;

/** La lecture qui réussit : une clé servie, un journal, un verdict. */
function laLectureRéussit(status = 'ok', fingerprint = 'AAAA-BBBB'): void {
  api.publicKey.mockResolvedValue({ encPublicKey: 'pk', fingerprint });
  api.keyLog.mockResolvedValue({ entries: [] });
  kt.check.mockResolvedValue(status);
}

/** Un refus du serveur, façon axios (c'est la forme que `checkOne` inspecte). */
function refus(status: number, code?: string) {
  return Object.assign(new Error(`Request failed with status code ${status}`), {
    isAxiosError: true,
    response: { status, data: code ? { success: false, code } : { success: false } },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  kt.tofu.mockReturnValue(null);
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('un contrôle qui a ABOUTI tient la journée', () => {
  it('ne relit pas la même clé une heure plus tard', async () => {
    const id = quelquun();
    laLectureRéussit();

    await watchVaultMemberKeys([id]);
    expect(api.publicKey).toHaveBeenCalledTimes(1);

    // La page rouverte dans l'heure : le verdict d'hier vaut encore, et deux
    // lectures par membre à chaque ouverture sont exactement ce que le cache
    // existe pour éviter (§7, amplification de lecture).
    vi.setSystemTime(T0 + 60 * 60 * 1000);
    await watchVaultMemberKeys([id]);
    expect(api.publicKey).toHaveBeenCalledTimes(1);
  });

  it('regarde à nouveau passé les vingt-quatre heures', async () => {
    const id = quelquun();
    laLectureRéussit();

    await watchVaultMemberKeys([id]);
    vi.setSystemTime(T0 + KEY_WATCH_TTL_MS + 1);
    await watchVaultMemberKeys([id]);

    expect(api.publicKey).toHaveBeenCalledTimes(2);
  });
});

describe('un contrôle EN ÉCHEC ne prend pas la place d’un verdict', () => {
  it('une lecture de clé en panne est reprise à la page suivante, pas le lendemain', async () => {
    const id = quelquun();
    api.publicKey.mockRejectedValue(new Error('Network Error'));

    await watchVaultMemberKeys([id]);
    expect(getMemberKeyReport(id)?.status).toBe('unreadable');
    expect(api.publicKey).toHaveBeenCalledTimes(1);

    // Une panne DURABLE ne doit pas relancer deux lectures par membre à chaque
    // rendu : dans les cinq minutes, on ne repasse pas.
    vi.setSystemTime(T0 + 60 * 1000);
    await watchVaultMemberKeys([id]);
    expect(api.publicKey).toHaveBeenCalledTimes(1);

    // Passé ce délai — et TRÈS loin des vingt-quatre heures : c'est là que la
    // règle d'avant aveuglait la page — on regarde pour de bon, et le verdict
    // remplace enfin l'ignorance.
    vi.setSystemTime(T0 + KEY_WATCH_FAIL_TTL_MS + 1);
    laLectureRéussit('changed');
    await watchVaultMemberKeys([id]);

    expect(api.publicKey).toHaveBeenCalledTimes(2);
    expect(getMemberKeyReport(id)?.status).toBe('changed');
  });

  it('un journal illisible non plus — la clé a été lue, mais rien n’a été conclu', async () => {
    const id = quelquun();
    api.publicKey.mockResolvedValue({ encPublicKey: 'pk', fingerprint: 'AAAA' });
    api.keyLog.mockRejectedValue(refus(500));

    await watchVaultMemberKeys([id]);
    expect(getMemberKeyReport(id)?.status).toBe('unreadable');

    vi.setSystemTime(T0 + KEY_WATCH_FAIL_TTL_MS + 1);
    laLectureRéussit();
    await watchVaultMemberKeys([id]);

    expect(api.keyLog).toHaveBeenCalledTimes(2);
    expect(getMemberKeyReport(id)?.status).toBe('ok');
  });

  it('« pas de clé publiée » non plus : elle peut arriver dans la journée', async () => {
    const id = quelquun();
    api.publicKey.mockRejectedValue(refus(404, 'no_public_key'));

    await watchVaultMemberKeys([id]);
    expect(getMemberKeyReport(id)?.status).toBe('no_key');

    // Un compte qui génère enfin sa paire (création paresseuse) : la colonne
    // dirait « non publiée » jusqu'au lendemain, et surtout la PREMIÈRE clé de
    // cette personne ne serait épinglée qu'un jour trop tard.
    vi.setSystemTime(T0 + KEY_WATCH_FAIL_TTL_MS + 1);
    laLectureRéussit('first_seen');
    await watchVaultMemberKeys([id]);

    expect(api.publicKey).toHaveBeenCalledTimes(2);
    expect(getMemberKeyReport(id)?.status).toBe('first_seen');
  });
});

describe('« Revérifier » ne consulte aucun des deux caches', () => {
  it('relit une seconde après un contrôle abouti', async () => {
    const id = quelquun();
    laLectureRéussit();

    await watchVaultMemberKeys([id]);
    vi.setSystemTime(T0 + 1000);
    await watchVaultMemberKeys([id], { force: true });

    expect(api.publicKey).toHaveBeenCalledTimes(2);
  });
});
