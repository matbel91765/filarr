/**
 * CE QU'ON PUBLIE SUR LE MARCHÉ — la suite qui saigne en premier.
 *
 * Un modèle de mise en page est un objet PLUS dangereux qu'il n'en a l'air. Il
 * ne s'exécute pas, donc on est tenté de le traiter comme du texte — mais il
 * transporte trois choses qui font mal :
 *
 *   · la STRUCTURE DU COFFRE de son auteur, s'il reste une liaison dedans ;
 *   · des CHAÎNES rendues à l'écran chez tous ceux qui l'installent ;
 *   · une IDENTITÉ D'ÉDITEUR, qu'on peut chercher à usurper.
 *
 * Chaque `describe` ci-dessous répond à « qu'est-ce qui se passe si le serveur
 * ment ». La réponse doit toujours être « on refuse », jamais « on affiche ».
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import {
  clearUserKeypair,
  generateAndWrapKeypair,
  signWithIdentity,
  type GeneratedKeypair,
} from '../../auth/userKeypair';
import { PLUGIN_MANIFEST_DOMAIN } from '../../plugins/pluginSigning';
import {
  LAYOUT_MANIFEST_DOMAIN,
  buildEnvelopeJson,
  signEnvelope,
  verifyPublishedLayout,
} from '../layoutMarketSigning';
import {
  LAYOUT_MARKET_FORMAT_VERSION,
  LAYOUT_MARKET_KIND,
  LAYOUT_MARKET_MAX_ENVELOPE_BYTES,
  LayoutMarketVerifyError,
  inspectEnvelope,
  isEmojiOnly,
  normalizeLayoutCategory,
  readEnvelope,
  type LayoutMarketEnvelope,
} from '../layoutMarketTypes';
import { LAYOUT_FILE_FORMAT_VERSION, LAYOUT_FILE_KIND } from '../layoutFormat';

// ==================== Le décor ====================

/** Ce que CE binaire sait rendre. Le worker, lui, passera un ensemble VIDE. */
const KNOWN = new Set(['stat-tile', 'folder-grid', 'recent-notes']);

/** Une disposition honnête : deux blocs, aucune liaison, rien à cacher. */
function layoutFile(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    kind: LAYOUT_FILE_KIND,
    formatVersion: LAYOUT_FILE_FORMAT_VERSION,
    id: 'lay-demo-0001',
    name: 'Accueil — Atelier',
    description: 'Quatre chiffres et la grille des dossiers.',
    target: 'home',
    widgets: [
      { uid: 'w1', type: 'core:stat-tile', x: 0, y: 0, w: 3, h: 1, options: { metric: 'files' } },
      { uid: 'w2', type: 'core:folder-grid', x: 0, y: 1, w: 12, h: 4 },
    ],
    requires: [{ kind: 'core', minAppVersion: '2.21.0' }],
    version: 1,
    ...over,
  });
}

/** Une disposition dont UN bloc porte ce qu'on lui demande de porter. */
function layoutWithWidget(widget: Record<string, unknown>): string {
  return JSON.stringify({
    kind: LAYOUT_FILE_KIND,
    formatVersion: LAYOUT_FILE_FORMAT_VERSION,
    id: 'lay-demo-0002',
    name: 'Piège',
    description: '',
    target: 'home',
    widgets: [
      { uid: 'w1', type: 'core:stat-tile', x: 0, y: 0, w: 3, h: 1, options: { metric: 'files' } },
      widget,
    ],
    requires: [{ kind: 'core' }],
    version: 1,
  });
}

let kp: GeneratedKeypair;

function envelope(over: Partial<LayoutMarketEnvelope> = {}): LayoutMarketEnvelope {
  return {
    kind: LAYOUT_MARKET_KIND,
    formatVersion: LAYOUT_MARKET_FORMAT_VERSION,
    slug: 'accueil-atelier',
    version: '1.0.0',
    name: 'Accueil — Atelier',
    description: 'Une base sobre.',
    icon: '🗂️',
    category: 'work',
    target: 'home',
    publisherFingerprint: kp.fingerprint,
    layout: layoutFile(),
    ...over,
  };
}

/** Publie : construit, signe, et rend ce que le serveur stockerait. */
async function publish(over: Partial<LayoutMarketEnvelope> = {}) {
  const envelopeJson = buildEnvelopeJson(envelope(over));
  return { envelopeJson, signature: await signEnvelope(envelopeJson) };
}

/** Installe : ce que le client fait de ce que le serveur lui rend. */
function install(
  p: { envelopeJson: string; signature: string },
  expected = { slug: 'accueil-atelier', version: '1.0.0' }
) {
  return verifyPublishedLayout({
    ...p,
    signPublicKey: kp.signPublicKey,
    expected,
    knownTypes: KNOWN,
  });
}

/** Le code de refus, ou l'échec du test si rien n'a été refusé. */
async function refusal(promise: Promise<unknown>): Promise<{ code: string; detail?: string }> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(LayoutMarketVerifyError);
    const e = err as LayoutMarketVerifyError;
    return { code: e.code, detail: e.detail };
  }
  throw new Error('AUCUN REFUS — la vérification a laissé passer ce qu’elle devait refuser');
}

beforeAll(async () => {
  kp = await generateAndWrapKeypair('mot-de-passe-de-test');
});

afterAll(() => clearUserKeypair());

// ==================== 1. L'aller-retour, et les octets ====================

describe('signer puis vérifier — sur les octets, jamais sur l’objet', () => {
  it('une enveloppe honnête traverse, et rend la disposition reconstruite', async () => {
    const { validation, envelope: read } = await install(await publish());
    expect(read.slug).toBe('accueil-atelier');
    expect(validation.ok).toHaveLength(2);
    expect(validation.rejected).toHaveLength(0);
  });

  it('LE PIÈGE : le MÊME contenu re-sérialisé dans un autre ordre est REFUSÉ', async () => {
    const { envelopeJson, signature } = await publish();
    // Un intermédiaire « bien intentionné » qui reformate le JSON casse la
    // signature. C'est voulu : sans ça, il existerait deux suites d'octets
    // valides pour un seul objet, et la vérification cesserait d'être exacte.
    const reordered = JSON.stringify(
      JSON.parse(envelopeJson),
      Object.keys(JSON.parse(envelopeJson)).sort()
    );
    expect(reordered).not.toBe(envelopeJson);
    expect((await refusal(install({ envelopeJson: reordered, signature }))).code).toBe(
      'bad_signature'
    );
  });

  it('un seul octet retourné DANS la disposition casse la signature', async () => {
    const { envelopeJson, signature } = await publish();
    // Le contenu du fichier est DANS l'enveloppe signée : le modifier, même au
    // fond d'un réglage de bloc, doit se voir. C'est ce qui remplace le hash de
    // paquet des greffons.
    const tampered = envelopeJson.replace('"metric\\":\\"files', '"metric\\":\\"notes');
    expect(tampered).not.toBe(envelopeJson);
    expect((await refusal(install({ envelopeJson: tampered, signature }))).code).toBe(
      'bad_signature'
    );
  });

  it('changer le nom affiché casse la signature', async () => {
    const { envelopeJson, signature } = await publish();
    const tampered = envelopeJson.replace('Accueil — Atelier', 'Accueil — Officiel Filarr');
    expect((await refusal(install({ envelopeJson: tampered, signature }))).code).toBe(
      'bad_signature'
    );
  });
});

// ==================== 2. La substitution ====================

describe('substitution — une signature valide ne suffit pas', () => {
  it('l’enveloppe d’un AUTRE modèle, servie sous ce slug, est refusée', async () => {
    // Signée pour de bon, par la bonne clé, mais elle ne désigne pas ce qui a
    // été demandé : un serveur compromis servirait le modèle B sous le nom A.
    const other = await publish({ slug: 'autre-modele' });
    const { code } = await refusal(install(other));
    expect(code).toBe('envelope_mismatch');
  });

  it('une ANCIENNE version rejouée sous le nom d’une neuve est refusée', async () => {
    const old = await publish({ version: '1.0.0' });
    const { code } = await refusal(install(old, { slug: 'accueil-atelier', version: '2.0.0' }));
    expect(code).toBe('envelope_mismatch');
  });
});

// ==================== 3. L'identité de l'éditeur ====================

describe('empreinte — recalculée, jamais crue sur parole', () => {
  it('une enveloppe qui ANNONCE une autre empreinte est refusée', async () => {
    // Elle est signée par la vraie clé : seule l'empreinte annoncée ment. C'est
    // l'attaque qui compte, parce que c'est CETTE chaîne que l'utilisateur
    // compare à l'écran avant de faire confiance.
    const usurped = await publish({ publisherFingerprint: '00000 11111 22222 33333 44444 55555' });
    expect((await refusal(install(usurped))).code).toBe('fingerprint_mismatch');
  });

  it('une empreinte mal formée est refusée à la lecture, avant toute crypto', () => {
    const read = readEnvelope({ ...envelope(), publisherFingerprint: 'Filarr officiel' });
    expect(read).toEqual({ ok: false, code: 'bad-fingerprint' });
  });
});

// ==================== 4. Le rejeu inter-protocoles ====================

describe('séparation des domaines — un greffon n’est pas un modèle', () => {
  it('une signature posée avec le domaine GREFFON ne vaut pas pour un modèle', async () => {
    const envelopeJson = buildEnvelopeJson(envelope());
    // Mêmes octets utiles, même clé, même compte — seul le domaine change. Sans
    // séparation, une signature obtenue dans un contexte servirait dans l'autre.
    const crossSigned = await signWithIdentity(
      new TextEncoder().encode(PLUGIN_MANIFEST_DOMAIN + envelopeJson)
    );
    expect(PLUGIN_MANIFEST_DOMAIN).not.toBe(LAYOUT_MANIFEST_DOMAIN);
    expect((await refusal(install({ envelopeJson, signature: crossSigned }))).code).toBe(
      'bad_signature'
    );
  });
});

// ==================== 5. L'en-tête hostile ====================

describe('en-tête — ce qui s’affiche chez tout le monde', () => {
  const rejects = (over: Record<string, unknown>, code: string) => {
    const read = readEnvelope({ ...envelope(), ...over });
    expect(read).toEqual({ ok: false, code });
  };

  it('un nom qui retourne le sens de lecture est refusé', () => {
    // U+202E : tout ce qui suit s'affiche à l'envers. « Accueil ⁧gpj.exe » se lit
    // « Accueil exe.jpg », et l'utilisateur choisit en croyant savoir.
    rejects({ name: 'Accueil ‮gpj.exe' }, 'bad-name');
  });

  it('un nom qui porte un caractère nul est refusé', () => {
    // JavaScript s'en accommode ; à peu près rien d'autre ne le fait.
    rejects({ name: 'Accueil  caché' }, 'bad-name');
  });

  it('un nom vide, ou fait d’espaces, est refusé', () => {
    rejects({ name: '   ' }, 'bad-name');
  });

  it('une description qui dépasse son plafond est refusée', () => {
    rejects({ description: 'x'.repeat(601) }, 'bad-description');
  });

  it('une « icône » qui n’est pas un emoji est refusée', () => {
    rejects({ icon: '<img src=x>' }, 'bad-icon');
    rejects({ icon: 'A' }, 'bad-icon');
    rejects({ icon: '‮' }, 'bad-icon');
    // Que des liants, aucun pictogramme : ce n'est pas un emoji.
    rejects({ icon: '‍‍' }, 'bad-icon');
  });

  it('une famille liée par des ZWJ reste un emoji valide', () => {
    expect(isEmojiOnly('👨‍👩‍👧‍👦')).toBe(true);
    expect(isEmojiOnly('🗂️')).toBe(true);
    expect(isEmojiOnly('🗂️🗂️🗂️🗂️🗂️')).toBe(false); // au-delà du plafond
  });

  it('un slug hors ASCII minuscule est refusé — l’usurpation par homoglyphe', () => {
    // « ассueil » en cyrillique se lit comme « accueil » et n'est pas le même
    // slug. Une adresse doit être comparable aux octets, pas à l'œil.
    rejects({ slug: 'аccueil-atelier' }, 'bad-slug');
    rejects({ slug: 'Accueil-Atelier' }, 'bad-slug');
    rejects({ slug: '-accueil' }, 'bad-slug');
    rejects({ slug: 'a' }, 'bad-slug');
  });

  it('une version qui n’est pas un semver strict est refusée', () => {
    rejects({ version: '1.0' }, 'bad-version');
    rejects({ version: '1.0.0-beta' }, 'bad-version');
    rejects({ version: 'latest' }, 'bad-version');
  });

  it('une catégorie inconnue RETOMBE sur « other » — jamais un refus', () => {
    // Un catalogue servi par une version plus récente ne doit pas se vider chez
    // qui n'a pas encore mis à jour.
    const read = readEnvelope({ ...envelope(), category: 'quantique' });
    expect(read.ok).toBe(true);
    expect(read.ok && read.envelope.category).toBe('other');
    expect(normalizeLayoutCategory(undefined)).toBe('other');
  });

  it('les champs INCONNUS ne traversent pas la lecture', () => {
    const read = readEnvelope({ ...envelope(), tracker: 'https://exemple.test/pixel' });
    expect(read.ok).toBe(true);
    expect(read.ok && 'tracker' in read.envelope).toBe(false);
  });
});

// ==================== 6. La disposition hostile ====================

describe('disposition — ce que le fichier emporte vraiment', () => {
  const inspect = (layout: string) =>
    inspectEnvelope(buildEnvelopeJson(envelope({ layout })), KNOWN);

  it('une clé de pollution de prototype fait tomber TOUT le fichier', () => {
    const evil = layoutFile().replace(
      '"options":{"metric":"files"}',
      '"options":{"__proto__":{"x":1}}'
    );
    const res = inspect(evil);
    expect(res.ok).toBe(false);
    expect(!res.ok && res.error.code).toBe('bad_layout');
    expect(!res.ok && res.error.detail).toBe('forbidden-key');
  });

  it('LE CAS QUI COMPTE : une liaison qui porte un identifiant fait tomber SON bloc', () => {
    // Et pas le fichier. C'est la bonne granularité : un modèle de vingt blocs
    // dont un seul est sale reste utilisable, et le récapitulatif dit qu'il
    // manque quelque chose. Ce qui ne doit JAMAIS arriver, c'est que le bloc
    // passe avec son identifiant.
    const res = inspect(
      layoutWithWidget({
        uid: 'w2',
        type: 'core:folder-grid',
        x: 0,
        y: 1,
        w: 12,
        h: 4,
        bindings: {
          folder: { slot: { label: '3f2a9c17-6b4e-4f1a-9d3c-1e5a7b9c0d2f', accepts: 'folder' } },
        },
      })
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.inspection.validation.rejected).toEqual([
      { index: 1, uid: 'w2', code: 'binding-identifier' },
    ]);
    // Le bloc n'est nulle part dans le fichier reconstruit — ni appliqué, ni
    // « inconnu », ni conservé pour plus tard.
    const survivants = res.inspection.validation.file.widgets.map((w) => w.uid);
    expect(survivants).toEqual(['w1']);
  });

  it('une liaison directe par identifiant — sans emplacement nommé — est rejetée', () => {
    const res = inspect(
      layoutWithWidget({
        uid: 'w2',
        type: 'core:folder-grid',
        x: 0,
        y: 1,
        w: 12,
        h: 4,
        bindings: { folder: 'd41d8cd98f00b204e9800998ecf8427e' },
      })
    );
    expect(res.ok).toBe(true);
    expect(res.ok && res.inspection.validation.rejected[0].code).toBe('binding-identifier');
  });

  it('une URL cachée dans un réglage fait tomber son bloc — les DEUX filets', () => {
    // Un réglage qui contient une adresse est une fuite : il suffit qu'un bloc
    // la charge pour confirmer à un tiers qui a ouvert le modèle, et quand.
    //
    // Il y a deux filets, et ils ne rendent pas le même code. `readOptions`
    // refuse l'adresse en VALEUR (`bad-options`, le premier tombé) ; `containsUrl`
    // rattrape ce qu'il resterait, notamment une adresse en CLÉ (`url-value`).
    // Les distinguer ici, c'est constater que le second filet sert encore.
    const rejet = (options: Record<string, unknown>) => {
      const res = inspect(
        layoutWithWidget({ uid: 'w2', type: 'core:stat-tile', x: 0, y: 1, w: 3, h: 1, options })
      );
      expect(res.ok).toBe(true);
      return res.ok ? res.inspection.validation.rejected[0]?.code : null;
    };

    for (const poison of [
      'https://exemple.test/pixel.png',
      'javascript:fetch(1)',
      'data:text/html;base64,PHNjcmlwdD4=',
      '//exemple.test/x',
      'www.exemple.test',
    ]) {
      expect(rejet({ metric: 'files', source: poison }), poison).toBe('bad-options');
    }

    // L'adresse en CLÉ : c'est le filet que le premier ne voit pas.
    expect(rejet({ 'https://exemple.test/x': 'ok' })).toBe('url-value');
  });

  it('un fichier sans aucun bloc lisible est refusé', () => {
    const res = inspect(layoutFile({ widgets: [] }));
    expect(res.ok).toBe(false);
    expect(!res.ok && res.error.detail).toBe('no-widgets');
  });

  it('un fichier qui n’est pas du JSON est refusé, sans jeter', () => {
    const res = inspect('{ ceci n’est pas du JSON');
    expect(res.ok).toBe(false);
    expect(!res.ok && res.error.detail).toBe('not-json');
  });

  it('un fichier au-delà de son plafond est refusé AVANT d’être analysé', () => {
    const res = inspect(`"${'x'.repeat(300 * 1024)}"`);
    expect(res.ok).toBe(false);
    // Refusé à la LECTURE de l'enveloppe (le champ dépasse le plafond du
    // fichier), donc avant même que le validateur soit appelé.
    expect(!res.ok && res.error.code).toBe('bad_envelope');
    expect(!res.ok && res.error.detail).toBe('bad-layout');
  });
});

// ==================== 7. Le worker lit comme le client ====================

describe('le worker et le client lisent la MÊME enveloppe', () => {
  it('un ensemble de types VIDE ne refuse rien — les blocs deviennent « inconnus »', () => {
    // C'est le mode du serveur : il n'a pas à connaître le catalogue de blocs
    // d'un binaire, qui change à chaque version. S'il refusait ce qu'il ne
    // connaît pas, une application plus récente ne pourrait plus rien publier.
    const res = inspectEnvelope(buildEnvelopeJson(envelope()), new Set<string>());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.inspection.validation.ok).toHaveLength(0);
    expect(res.inspection.validation.unknown).toHaveLength(2);
    expect(res.inspection.validation.rejected).toHaveLength(0);
  });

  it('mais il refuse EXACTEMENT les mêmes saletés que le client', () => {
    const evil = layoutFile().replace(
      '"options":{"metric":"files"}',
      '"options":{"constructor":{}}'
    );
    const cote = (types: ReadonlySet<string>) =>
      inspectEnvelope(buildEnvelopeJson(envelope({ layout: evil })), types);
    const client = cote(KNOWN);
    const serveur = cote(new Set<string>());
    expect(client.ok).toBe(false);
    expect(serveur.ok).toBe(false);
    expect(!client.ok && client.error.detail).toBe(!serveur.ok ? serveur.error.detail : null);
  });
});

// ==================== 8. Les plafonds d'enveloppe ====================

describe('plafonds — refuser avant de travailler', () => {
  it('une enveloppe démesurée est refusée sans être analysée', async () => {
    // ⚠ La taille est DÉRIVÉE du plafond, jamais écrite en dur.
    //
    // Elle valait 600 Kio, choisis parce que le plafond était de 520. L'arrivée
    // de la galerie l'a monté à 784 : le test a continué de passer une
    // enveloppe parfaitement acceptable en croyant l'éprouver, et il a échoué
    // sur `bad_signature` — un message qui ne désigne rien de ce qu'il teste.
    const huge = `{"kind":"${LAYOUT_MARKET_KIND}","layout":"${'x'.repeat(
      LAYOUT_MARKET_MAX_ENVELOPE_BYTES + 1024
    )}"}`;
    const { code } = await refusal(install({ envelopeJson: huge, signature: 'peu-importe' }));
    expect(code).toBe('too_large');
  });

  it('une enveloppe qui n’est pas une chaîne est refusée', () => {
    const res = inspectEnvelope({ kind: LAYOUT_MARKET_KIND }, KNOWN);
    expect(res.ok).toBe(false);
    expect(!res.ok && res.error.detail).toBe('not-a-string');
  });
});
