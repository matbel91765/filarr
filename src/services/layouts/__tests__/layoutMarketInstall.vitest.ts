/**
 * INSTALLER DEPUIS LE CATALOGUE — ce que le geste refuse, et ce qu'il range.
 *
 * Trois choses se prouvent ici, et aucune ne se voit à la relecture du code :
 *
 *   · ce qui est RANGÉ est le fichier RECONSTRUIT par le validateur, jamais
 *     l'objet du réseau — un serveur hostile qui sert un bloc fautif ne le fait
 *     pas entrer dans la bibliothèque ;
 *   · le CHANGEMENT DE CLÉ d'éditeur arrête l'installation, parce qu'aucune
 *     cryptographie ne tranche « est-ce toujours la même personne » ;
 *   · une mise à jour REMPLACE, elle n'empile pas — y compris quand l'auteur a
 *     régénéré son fichier et changé son identifiant.
 *
 * Environnement vitest `node` : pas de localStorage. On en pose un vrai faux
 * AVANT d'importer les modules, car `profileStorage` lit le pointeur de profil
 * à l'évaluation de son module (même idiome que `profileAppearance.vitest.ts`).
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { ed25519 } from '@noble/curves/ed25519.js';

// ==================== Faux localStorage ====================

class MemoryStorage {
  private map = new Map<string, string>();

  get length(): number {
    return this.map.size;
  }
  key(i: number): string | null {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(k: string): string | null {
    return this.map.has(k) ? (this.map.get(k) as string) : null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, v);
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
  clear(): void {
    this.map.clear();
  }
}

const store = new MemoryStorage();
const g = globalThis as unknown as Record<string, unknown>;
g.localStorage = store;

// ==================== Modules (après le faux stockage) ====================

import {
  clearUserKeypair,
  computeFingerprint,
  generateAndWrapKeypair,
  type GeneratedKeypair,
} from '../../auth/userKeypair';
import { LAYOUT_MANIFEST_DOMAIN, buildEnvelopeJson, signEnvelope } from '../layoutMarketSigning';
import {
  LAYOUT_MARKET_FORMAT_VERSION,
  LAYOUT_MARKET_KIND,
  LayoutMarketVerifyError,
  type LayoutMarketEnvelope,
} from '../layoutMarketTypes';
import {
  compareLayoutVersions,
  installLayoutTemplate,
  layoutEntryState,
  originsBySlug,
  PublisherKeyChangedError,
} from '../layoutMarketInstall';
import { listLayoutLibrary, saveToLayoutLibrary } from '../layoutLibrary';
import { LAYOUT_FILE_FORMAT_VERSION, LAYOUT_FILE_KIND } from '../layoutFormat';
import type { LayoutMarketEnvelopeDTO } from '../layoutMarketApi';

const KNOWN = new Set(['stat-tile', 'folder-grid']);
const TILE = { uid: 'w1', type: 'core:stat-tile', x: 0, y: 0, w: 3, h: 1 };

function layoutFile(over: Record<string, unknown> = {}, widgets: unknown[] = [TILE]): string {
  return JSON.stringify({
    kind: LAYOUT_FILE_KIND,
    formatVersion: LAYOUT_FILE_FORMAT_VERSION,
    id: 'lay-catalogue-1',
    name: 'Accueil du catalogue',
    description: 'Installé depuis le marché.',
    target: 'home',
    widgets,
    requires: [{ kind: 'core' }],
    version: 1,
    ...over,
  });
}

let kp: GeneratedKeypair;

/**
 * ⚠ UN SEUL `generateAndWrapKeypair` DANS TOUTE LA SUITE, et c'est structurel.
 *
 * Cette fonction CHARGE la paire dans l'état du module : en appeler une seconde
 * au milieu des tests remplace silencieusement la clé de signature, et tout ce
 * qui suit se met à rendre `bad_signature` — un échec qui accuse la crypto
 * alors que c'est le décor qui a bougé sous les pieds du test.
 *
 * Les AUTRES éditeurs sont donc simulés en signant à la main, exactement comme
 * le fait la suite du worker : mêmes octets, mêmes domaines, aucune trace dans
 * l'état du module.
 */
const ENC = new TextEncoder();
const IDENTITY_SIG_DOMAIN = 'filarr.identity.sig.v1\n';
const b64 = (u: Uint8Array): string => btoa(String.fromCharCode(...u));

function signAs(sk: Uint8Array, envelopeJson: string): string {
  return b64(
    ed25519.sign(ENC.encode(IDENTITY_SIG_DOMAIN + LAYOUT_MANIFEST_DOMAIN + envelopeJson), sk)
  );
}

/** Un éditeur tiers : sa clé secrète, sa clé publique, son empreinte. */
async function makePublisher(): Promise<{ sk: Uint8Array; pk: string; fingerprint: string }> {
  const sk = ed25519.utils.randomSecretKey();
  const pub = ed25519.getPublicKey(sk);
  return { sk, pk: b64(pub), fingerprint: await computeFingerprint(pub) };
}

function envelope(over: Partial<LayoutMarketEnvelope> = {}): LayoutMarketEnvelope {
  return {
    kind: LAYOUT_MARKET_KIND,
    formatVersion: LAYOUT_MARKET_FORMAT_VERSION,
    slug: 'accueil-catalogue',
    version: '1.0.0',
    name: 'Accueil du catalogue',
    description: 'Installé depuis le marché.',
    category: 'work',
    target: 'home',
    publisherFingerprint: kp.fingerprint,
    layout: layoutFile(),
    ...over,
  };
}

/** Ce que le worker rendrait — signé par la clé courante, sauf demande contraire. */
async function served(over: Partial<LayoutMarketEnvelope> = {}): Promise<LayoutMarketEnvelopeDTO> {
  const envelopeJson = buildEnvelopeJson(envelope(over));
  return {
    envelopeJson,
    signature: await signEnvelope(envelopeJson),
    signPublicKey: kp.signPublicKey,
    sizeBytes: envelopeJson.length,
    createdAt: '2026-08-30 10:00:00',
  };
}

/** Ce que le worker rendrait si un AUTRE compte avait publié. */
async function servedBy(
  publisher: { sk: Uint8Array; pk: string; fingerprint: string },
  over: Partial<LayoutMarketEnvelope> = {}
): Promise<LayoutMarketEnvelopeDTO> {
  const envelopeJson = buildEnvelopeJson(
    envelope({ publisherFingerprint: publisher.fingerprint, ...over })
  );
  return {
    envelopeJson,
    signature: signAs(publisher.sk, envelopeJson),
    signPublicKey: publisher.pk,
    sizeBytes: envelopeJson.length,
    createdAt: '2026-08-31 10:00:00',
  };
}

const install = (dto: LayoutMarketEnvelopeDTO, over: Record<string, unknown> = {}) =>
  installLayoutTemplate({
    slug: 'accueil-catalogue',
    version: '1.0.0',
    knownTypes: KNOWN,
    fetchEnvelope: async () => dto,
    ...over,
  });

beforeAll(async () => {
  kp = await generateAndWrapKeypair('mot-de-passe-de-test');
});

afterAll(() => clearUserKeypair());

beforeEach(() => store.clear());

// ==================== 1. Le geste heureux ====================

describe('installer — ce qui est rangé, et sous quelle identité', () => {
  it('range le modèle avec son origine, et rend le récapitulatif', async () => {
    const result = await install(await served());
    expect(result.envelope.slug).toBe('accueil-catalogue');
    expect(result.summary.applied).toBe(1);

    const [entry] = listLayoutLibrary(KNOWN);
    expect(entry.origin).toEqual({
      slug: 'accueil-catalogue',
      version: '1.0.0',
      publisherFingerprint: kp.fingerprint,
    });
  });

  it('N’APPLIQUE RIEN : installer range, appliquer est un autre geste', async () => {
    // Rien dans ce module ne touche à la mise en page. Le seul effet observable
    // est l'entrée de bibliothèque — si un jour quelqu'un branche `setView` ici,
    // ce test ne le verra pas, mais l'en-tête du module dit pourquoi il ne faut
    // pas : télécharger et voir son écran changer fait qu'on n'essaie plus rien.
    await install(await served());
    expect(listLayoutLibrary(KNOWN)).toHaveLength(1);
  });

  it('LE FICHIER RANGÉ EST CELUI DU VALIDATEUR, pas celui du réseau', async () => {
    // Le worker refuse ce modèle à la publication. Mais un serveur compromis, ou
    // une fiche publiée avant que cette règle existe, peut encore le servir :
    // le bloc fautif ne doit pas entrer dans la bibliothèque pour autant.
    const leaky = layoutFile({}, [
      TILE,
      {
        uid: 'w2',
        type: 'core:folder-grid',
        x: 0,
        y: 1,
        w: 12,
        h: 4,
        bindings: {
          folder: { slot: { label: '3f2a9c17-6b4e-4f1a-9d3c-1e5a7b9c0d2f', accepts: 'folder' } },
        },
      },
    ]);
    const result = await install(await served({ layout: leaky }));

    expect(result.summary.ignored).toBe(1);
    expect(result.file.widgets.map((w) => w.uid)).toEqual(['w1']);

    const [entry] = listLayoutLibrary(KNOWN);
    // L'identifiant de dossier de l'auteur n'a survécu nulle part.
    expect(JSON.stringify(entry.file)).not.toContain('3f2a9c17');
  });
});

// ==================== 2. Ce que l'installation refuse ====================

describe('installer — les refus', () => {
  it('une signature d’une AUTRE clé est refusée', async () => {
    const dto = await served();
    const autre = await makePublisher();
    // Les octets et leur signature sont ceux de l'auteur, mais la clé servie est
    // celle d'un tiers : c'est la substitution de clé, et elle ne vérifie plus.
    await expect(install({ ...dto, signPublicKey: autre.pk })).rejects.toBeInstanceOf(
      LayoutMarketVerifyError
    );
    expect(listLayoutLibrary(KNOWN)).toHaveLength(0);
  });

  it('une enveloppe qui désigne un AUTRE modèle est refusée', async () => {
    const dto = await served({ slug: 'autre-modele' });
    await expect(install(dto)).rejects.toMatchObject({ code: 'envelope_mismatch' });
    expect(listLayoutLibrary(KNOWN)).toHaveLength(0);
  });

  it('une ANCIENNE version servie sous le nom d’une neuve est refusée', async () => {
    const dto = await served({ version: '1.0.0' });
    await expect(install(dto, { version: '2.0.0' })).rejects.toMatchObject({
      code: 'envelope_mismatch',
    });
  });
});

// ==================== 3. Le changement de clé d'éditeur ====================

describe('changement de clé — la question qu’aucune crypto ne tranche', () => {
  it('une mise à jour signée par une AUTRE clé s’arrête, et dit les deux empreintes', async () => {
    await install(await served());

    // Même slug, signature valide, empreinte cohérente avec la clé qui signe —
    // et pourtant ce n'est plus la même personne. C'est le seul scénario
    // d'usurpation qui reste ouvert quand tout le reste est fermé.
    const usurper = await makePublisher();
    const dto = await servedBy(usurper, { version: '2.0.0' });

    const boom = install(dto, { version: '2.0.0' }).catch((e) => e);
    const err = await boom;
    expect(err).toBeInstanceOf(PublisherKeyChangedError);
    expect(err.knownFingerprint).toBe(kp.fingerprint);
    expect(err.newFingerprint).toBe(usurper.fingerprint);

    // RIEN n'a été écrit : la version installée est toujours la première.
    expect(listLayoutLibrary(KNOWN)[0].origin?.version).toBe('1.0.0');

    // Et quand l'utilisateur a pu vérifier, il passe outre EXPLICITEMENT.
    await install(dto, { version: '2.0.0', acceptKeyChange: true });
    const [entry] = listLayoutLibrary(KNOWN);
    expect(entry.origin?.version).toBe('2.0.0');
    expect(entry.origin?.publisherFingerprint).toBe(usurper.fingerprint);
  });

  it('la MÊME clé sur une nouvelle version passe sans rien demander', async () => {
    await install(await served());
    await install(await served({ version: '1.1.0' }), { version: '1.1.0' });
    expect(listLayoutLibrary(KNOWN)[0].origin?.version).toBe('1.1.0');
  });
});

// ==================== 4. Mettre à jour remplace ====================

describe('mise à jour — remplacer, jamais empiler', () => {
  it('une nouvelle version du MÊME slug remplace, même si l’auteur a changé son id de fichier', async () => {
    // Le piège : dédoublonner par l'identifiant de FICHIER seul laisserait deux
    // entrées pour un seul modèle publié, et la seconde masquerait la première
    // dans toutes les listes triées par date.
    await install(await served());
    await install(await served({ version: '2.0.0', layout: layoutFile({ id: 'lay-refait-9' }) }), {
      version: '2.0.0',
    });

    const entries = listLayoutLibrary(KNOWN);
    expect(entries).toHaveLength(1);
    expect(entries[0].file.id).toBe('lay-refait-9');
    expect(entries[0].origin?.version).toBe('2.0.0');
  });

  it('un modèle venu par FICHIER et un modèle du catalogue coexistent', async () => {
    // Le second n'a pas d'origine : rien ne permet de dire que c'est le même, et
    // rien ne doit le supposer.
    await install(await served());
    const parFichier = JSON.parse(layoutFile({ id: 'lay-recu-par-courriel', name: 'Reçu' }));
    saveToLayoutLibrary(parFichier, KNOWN, 'accueil.filarrlayout');
    expect(listLayoutLibrary(KNOWN)).toHaveLength(2);
  });
});

// ==================== 5. L'état d'une ligne ====================

describe('état d’une ligne du catalogue', () => {
  it('les trois verdicts', () => {
    expect(layoutEntryState('1.0.0', undefined).state).toBe('available');
    const origin = { slug: 's', version: '1.0.0', publisherFingerprint: 'f' };
    expect(layoutEntryState('1.0.0', origin).state).toBe('installed');
    expect(layoutEntryState('1.2.0', origin).state).toBe('update');
    // Une version SERVIE plus ancienne que l'installée n'est pas une mise à
    // jour : un serveur qui régresse ne doit pas provoquer de réinstallation.
    expect(layoutEntryState('0.9.0', origin).state).toBe('installed');
  });

  it('l’index se fait sur le SLUG, pas sur l’identifiant de fichier', async () => {
    await install(await served());
    const index = originsBySlug(listLayoutLibrary(KNOWN));
    expect(index.has('accueil-catalogue')).toBe(true);
    expect(index.has('lay-catalogue-1')).toBe(false);
  });

  it('compareLayoutVersions ordonne par champ, pas par texte', () => {
    // « 10 » < « 9 » en comparaison de chaînes : l'erreur classique, et elle ne
    // se voit qu'à la dixième version.
    expect(compareLayoutVersions('1.10.0', '1.9.0')).toBeGreaterThan(0);
    expect(compareLayoutVersions('2.0.0', '10.0.0')).toBeLessThan(0);
    expect(compareLayoutVersions('1.2.3', '1.2.3')).toBe(0);
  });
});

// ==================== 6. L'origine relue du stockage ====================

describe('origine — relue défensivement', () => {
  it('une origine incomplète est ignorée en bloc', async () => {
    await install(await served());
    // Le stockage n'est pas une frontière de confiance : n'importe quelle XSS,
    // ou n'importe qui devant la machine, peut le réécrire. Une origine à
    // moitié lue ferait un « mise à jour disponible » calculé contre une
    // version indéfinie.
    const raw = JSON.parse(store.getItem('filarr.layouts.library') as string);
    delete raw[0].origin.version;
    store.setItem('filarr.layouts.library', JSON.stringify(raw));

    const [entry] = listLayoutLibrary(KNOWN);
    expect(entry.origin).toBeUndefined();
    // Le modèle, lui, reste là : c'est son étiquette qui est perdue, pas lui.
    expect(entry.file.name).toBe('Accueil du catalogue');
  });
});
