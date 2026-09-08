/**
 * CE QUE L'AUTEUR SAISIT DOIT ARRIVER JUSQU'AUX OCTETS SIGNÉS.
 *
 * ── DEUX PASSOIRES SUCCESSIVES, POUR LA MÊME VALEUR ─────────────────────────
 *
 * Le pseudonyme et la capture d'une fiche ont été perdus DEUX fois, à deux
 * endroits différents, sans qu'aucun des deux ne lève :
 *
 *   1. `buildEnvelopeJson` sérialise depuis une LISTE BLANCHE de champs.
 *      `author` et `preview` avaient été ajoutés au TYPE de l'enveloppe sans
 *      être ajoutés à cette liste : ils ne partaient pas.
 *
 *   2. Une fois cette liste corrigée, rien n'avait changé — parce que l'APPEL,
 *      dans le composant, ne passait toujours ni l'un ni l'autre. Il y avait
 *      deux portes fermées ; on n'en avait ouvert qu'une, et le diagnostic
 *      donné à l'utilisateur (« republie en nouvelle version ») était faux.
 *
 * Le champ était pourtant saisi, validé, affiché dans l'aperçu, et prérempli à
 * la republication. Tout « marchait ». C'est précisément ce qui rend ce défaut
 * invisible à l'essai comme à la relecture.
 *
 * ── CE QUE CE TEST FAIT, ET POURQUOI IL EST BÂTI AINSI ──────────────────────
 *
 * Il ne compare pas l'enveloppe au brouillon champ par champ — une liste de
 * plus, qui oublierait le prochain champ ajouté exactement comme les deux
 * autres. Il part de la LISTE DES CLÉS du brouillon, et exige que chacune ait
 * une destination connue : soit elle voyage, soit elle est explicitement
 * déclarée locale. Un champ ajouté au brouillon sans décision fait donc échouer
 * ce test.
 */

import { describe, it, expect } from 'vitest';

import {
  EMPTY_LAYOUT_DRAFT,
  envelopeFromDraft,
  type LayoutPublishDraft,
} from '../layoutPublishValidation';
import { buildEnvelopeJson } from '../../../../services/layouts/layoutMarketSigning';
import { readEnvelope } from '../../../../services/layouts/layoutMarketTypes';
import {
  LAYOUT_FILE_FORMAT_VERSION,
  LAYOUT_FILE_KIND,
} from '../../../../services/layouts/layoutFormat';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg';
const SHOT_A = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAA';
const SHOT_B = 'data:image/webp;base64,UklGRiQAAABXRUJQVlA4';

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

/** Un brouillon dont CHAQUE champ porte une valeur reconnaissable. */
const DRAFT: LayoutPublishDraft = {
  viewId: 'home',
  slug: 'tout-rempli',
  version: '1.2.3',
  name: '  Tout rempli  ',
  author: '  Mathis  ',
  description: '  Une description.  ',
  icon: PNG,
  preview: SHOT_A,
  previews: [SHOT_A, SHOT_B],
  category: 'work',
};

const SIGNER = '12345 67890 12345 67890 12345 67890';

/** L'enveloppe telle qu'elle ressort des octets RÉELLEMENT signés. */
function throughTheWire(draft: LayoutPublishDraft) {
  const envelope = envelopeFromDraft(draft, {
    publisherFingerprint: SIGNER,
    layoutJson: LAYOUT,
  });
  // ⚠ On relit les OCTETS RÉELLEMENT SIGNÉS, pas l'objet de départ.
  //
  // C'est tout l'intérêt : `buildEnvelopeJson` est la liste blanche qui a déjà
  // avalé deux champs. Comparer l'objet à lui-même n'aurait rien gardé.
  const json = buildEnvelopeJson(envelope);
  const read = readEnvelope(JSON.parse(json));
  expect(read.ok, `readEnvelope a refusé : ${read.ok ? '' : read.code}`).toBe(true);
  return read.ok ? read.envelope : null;
}

describe('envelopeFromDraft — rien ne se perd en route', () => {
  it('LA GARDE : le pseudonyme et les captures ARRIVENT dans les octets signés', () => {
    const sent = throughTheWire(DRAFT);
    expect(sent?.author).toBe('Mathis');
    expect(sent?.preview).toBe(SHOT_A);
    expect(sent?.previews).toEqual([SHOT_A, SHOT_B]);
    expect(sent?.icon).toBe(PNG);
  });

  it('LA SECONDE GARDE : chaque champ du brouillon a une destination DÉCIDÉE', () => {
    /**
     * La liste ci-dessous n'énumère pas ce qui voyage — ça reviendrait à
     * recopier une troisième fois la liste qui a déjà failli deux fois. Elle
     * énumère ce qui NE voyage PAS, et pourquoi. Tout le reste doit se
     * retrouver dans l'enveloppe.
     */
    const LOCAL_ONLY: Record<string, string> = {
      // La vue choisie désigne un document de CET appareil. Elle sert à
      // fabriquer le `.filarrlayout`, elle n'a aucun sens chez autrui.
      viewId: 'identifie une vue locale',
    };

    const sent = throughTheWire(DRAFT);
    expect(sent).not.toBeNull();

    const manquants: string[] = [];
    for (const key of Object.keys(DRAFT)) {
      if (key in LOCAL_ONLY) continue;
      if (!(key in (sent as unknown as Record<string, unknown>))) manquants.push(key);
    }
    expect(
      manquants,
      'champs du brouillon sans destination : ajoutez-les à l’enveloppe, ou à LOCAL_ONLY avec la raison'
    ).toEqual([]);
  });

  it('les espaces de bordure sont retirés, une fois pour toutes', () => {
    // Ils sont retirés ICI et non au moment de la saisie : quelqu'un qui colle
    // un nom depuis un autre document emporterait sinon l'espace dans une
    // enveloppe SIGNÉE, où il devient définitif.
    const sent = throughTheWire(DRAFT);
    expect(sent?.name).toBe('Tout rempli');
    expect(sent?.description).toBe('Une description.');
  });

  it('un champ facultatif VIDE disparaît au lieu de voyager vide', () => {
    /**
     * Une chaîne vide dans une enveloppe signée est un CONTENU, pas une
     * absence : l'écran afficherait « auteur : » suivi de rien, au lieu de
     * retomber sur « auteur non nommé ».
     */
    const sent = throughTheWire({
      ...EMPTY_LAYOUT_DRAFT,
      slug: 'minimal',
      version: '1.0.0',
      name: 'Minimal',
      category: 'other',
    });
    expect(sent).not.toBeNull();
    expect('author' in (sent as object)).toBe(false);
    expect('icon' in (sent as object)).toBe(false);
    expect('preview' in (sent as object)).toBe(false);
    expect('previews' in (sent as object)).toBe(false);
  });

  it('une galerie ne transporte pas de case vide', () => {
    // Une chaîne vide dans le tableau ferait échouer la validation de
    // l'enveloppe entière chez celui qui l'installe — pour une image qu'on a
    // simplement retirée en cours de route.
    const sent = throughTheWire({ ...DRAFT, previews: [SHOT_A, '', SHOT_B] });
    expect(sent?.previews).toEqual([SHOT_A, SHOT_B]);
  });
});
