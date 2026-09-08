/**
 * AUCUN CHAMP DE L'ENVELOPPE NE DOIT SE PERDRE À LA SÉRIALISATION.
 *
 * `buildEnvelopeJson` énumère les champs à écrire. C'est une liste blanche, et
 * elle a déjà menti : le pseudonyme et l'image d'aperçu, ajoutés après coup, ont
 * été saisis, validés, affichés en aperçu — et ne sont jamais partis. Aucun type
 * ne l'attrape, parce que l'interface décrit ce qu'on PEUT porter, pas ce qu'on
 * écrit.
 *
 * Ce test remplit TOUS les champs et vérifie qu'ils reviennent. Il échouera le
 * jour où quelqu'un ajoutera un champ sans compléter la liste — c'est-à-dire
 * exactement le jour où il le faut.
 */

import { describe, it, expect } from 'vitest';

import { buildEnvelopeJson } from '../layoutMarketSigning';
import {
  LAYOUT_MARKET_FORMAT_VERSION,
  LAYOUT_MARKET_KIND,
  readEnvelope,
  type LayoutMarketEnvelope,
} from '../layoutMarketTypes';
import { LAYOUT_FILE_FORMAT_VERSION, LAYOUT_FILE_KIND } from '../layoutFormat';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg';
/** Deux captures DISTINCTES : un tableau qui contiendrait deux fois la même
 *  image passerait un aller-retour qui perd l'ordre, ou qui déduplique. */
const PREVIEW_A = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAA';
const PREVIEW_B = 'data:image/webp;base64,UklGRiQAAABXRUJQVlA4';

const LAYOUT = JSON.stringify({
  kind: LAYOUT_FILE_KIND,
  formatVersion: LAYOUT_FILE_FORMAT_VERSION,
  id: 'lay-1',
  name: 'X',
  description: '',
  target: 'home',
  widgets: [{ uid: 'w1', type: 'core:stat-tile', x: 0, y: 0, w: 3, h: 1 }],
  requires: [{ kind: 'core' }],
  version: 1,
});

/** Une enveloppe dont CHAQUE champ facultatif est rempli. */
const FULL: LayoutMarketEnvelope = {
  kind: LAYOUT_MARKET_KIND,
  formatVersion: LAYOUT_MARKET_FORMAT_VERSION,
  slug: 'tout-rempli',
  version: '1.2.3',
  name: 'Tout rempli',
  author: 'Équipe de test',
  description: 'Une description.',
  icon: PNG,
  preview: PNG,
  previews: [PREVIEW_A, PREVIEW_B],
  category: 'work',
  target: 'home',
  publisherFingerprint: '12345 67890 12345 67890 12345 67890',
  layout: LAYOUT,
};

describe('enveloppe — la sérialisation ne perd rien', () => {
  it('TOUS les champs survivent à un aller-retour', () => {
    const read = readEnvelope(JSON.parse(buildEnvelopeJson(FULL)));
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    // Comparaison de l'objet ENTIER : une assertion champ par champ oublierait
    // le prochain champ ajouté, ce qui est précisément le défaut qu'on garde.
    expect(read.envelope).toEqual(FULL);
  });

  it('LE GARDE : chaque clé de l’objet se retrouve dans le JSON écrit', () => {
    const written = JSON.parse(buildEnvelopeJson(FULL)) as Record<string, unknown>;
    for (const key of Object.keys(FULL)) {
      expect(written, `champ « ${key} » absent du JSON signé`).toHaveProperty(key);
    }
  });

  it('les champs facultatifs ABSENTS ne créent pas de clé vide', () => {
    const minimal: LayoutMarketEnvelope = {
      ...FULL,
      author: undefined,
      icon: undefined,
      preview: undefined,
    };
    const written = JSON.parse(buildEnvelopeJson(minimal)) as Record<string, unknown>;
    expect('author' in written).toBe(false);
    expect('icon' in written).toBe(false);
    expect('preview' in written).toBe(false);
  });
});
