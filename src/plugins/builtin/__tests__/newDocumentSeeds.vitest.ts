/**
 * UN FICHIER NEUF DOIT ÊTRE UN FICHIER VALIDE.
 *
 * Ce fichier existe à cause d'un vrai incident : « Nouveau document » écrivait
 * zéro octet, quel que soit le format. Sur un `.txt` c'est légitime — un
 * fichier texte vide est un fichier texte. Sur un format à structure
 * obligatoire, non : le fichier est refusé à la relecture, et celui qui
 * l'ouvre ne voit pas « document vide », il voit « mes données ont disparu ».
 *
 * La règle éprouvée ici : pour CHAQUE format qu'un éditeur déclare créable,
 * les octets qu'il sème sont relus par son propre analyseur. C'est le seul
 * moyen que la promesse ne diverge pas de ce que le format exige vraiment.
 */

import { describe, it, expect } from 'vitest';
import { textEditorPlugin } from '../textEditor';
import { csvEditorPlugin } from '../csvEditor';
import { icsEditorPlugin } from '../icsEditor';
import { codeEditorPlugin } from '../codeEditor';
import { parseCsv } from '../csvEditor/csvFormat';
import { parseIcs } from '../icsEditor/icsFormat';
import { decodeText } from '../../../utils/textEncoding';
import type { FilarrPlugin, NewDocumentOffer } from '../../../services/plugins/pluginTypes';

const offres = (p: FilarrPlugin): NewDocumentOffer[] =>
  (p.editors ?? []).flatMap((e) => e.contribution.newDocument ?? []);

describe('ce que chaque éditeur intégré déclare créable', () => {
  it('l’éditeur de code ne crée RIEN', () => {
    // Il revendique une quarantaine d'extensions pour ouvrir. Les proposer à la
    // création remplissait le menu de « Nouveau .kt » sans que personne ne
    // l'ait demandé — c'est précisément la régression corrigée.
    expect(offres(codeEditorPlugin)).toEqual([]);
  });

  it('le texte crée .txt et .md, et rien de plus', () => {
    // L'éditeur de texte revendique aussi mdx, csv, tsv, json, log : ouvrables,
    // pas créables.
    expect(offres(textEditorPlugin).map((o) => o.ext)).toEqual(['txt', 'md']);
  });
});

describe('les octets semés sont relus par leur propre analyseur', () => {
  it('le texte brut se sème vide — et c’est un document valide', async () => {
    for (const offre of offres(textEditorPlugin)) {
      const octets = offre.seed ? await offre.seed() : new Uint8Array(0);
      // Pas de graine : le vide EST le document neuf, et il se relit.
      expect(decodeText(octets)).not.toBeNull();
      expect(decodeText(octets)!.text).toBe('');
    }
  });

  it('le tableau CSV se sème avec des colonnes où écrire', async () => {
    const offre = offres(csvEditorPlugin)[0];
    const octets = await offre.seed!();
    expect(octets.byteLength).toBeGreaterThan(0);

    const doc = parseCsv(octets, offre.ext);
    expect(doc).not.toBeNull();
    // Une grille sans colonne n'aurait aucune case où saisir : c'est la raison
    // d'être de cette graine.
    expect(doc!.rows[0].length).toBeGreaterThanOrEqual(3);
    expect(doc!.rows.length).toBeGreaterThanOrEqual(2);
  });

  it('le calendrier se sème avec un VCALENDAR que ical.js accepte', async () => {
    const offre = offres(icsEditorPlugin)[0];
    const octets = await offre.seed!();

    // Zéro octet serait refusé ici, et l'éditeur s'ouvrirait en lecture seule
    // sur son propre fichier neuf.
    const doc = await parseIcs(octets);
    expect(doc).not.toBeNull();
    expect(doc!.events).toEqual([]);

    const texte = new TextDecoder().decode(octets);
    // La RFC 5545 impose CRLF : un agenda tiers a le droit de refuser du LF.
    expect(texte).toContain('\r\n');
    expect(texte).toContain('VERSION:2.0');
    expect(texte).toContain('PRODID:');
  });

  it('AUCUN format à graine ne sème du vide', async () => {
    // La garde générale : si un jour quelqu'un déclare une graine, elle doit
    // produire quelque chose. Une graine qui rend zéro octet est un piège plus
    // discret que pas de graine du tout.
    for (const plugin of [textEditorPlugin, csvEditorPlugin, icsEditorPlugin]) {
      for (const offre of offres(plugin)) {
        if (!offre.seed) continue;
        expect((await offre.seed()).byteLength).toBeGreaterThan(0);
      }
    }
  });
});
