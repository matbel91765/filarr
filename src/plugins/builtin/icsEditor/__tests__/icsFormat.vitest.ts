/**
 * L'INVARIANT : ce qu'on ne comprend pas doit SURVIVRE.
 *
 * C'est la seule raison pour laquelle l'ICS a le droit de devenir éditable,
 * quand docx, xlsx et pdf ne l'ont pas. Un calendrier réel est plein de choses
 * que cet éditeur ignore — fuseaux, participants, alarmes, propriétés `X-` de
 * chaque agenda du marché. Les perdre en corrigeant un titre serait pire que
 * de ne pas offrir l'édition du tout.
 */

import { describe, it, expect } from 'vitest';
import { parseIcs, serializeIcs } from '../icsFormat';

const utf8 = (s: string) => new TextEncoder().encode(s);
const texte = (b: Uint8Array) => new TextDecoder().decode(b);

const CALENDRIER = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//Exemple//FR',
  'BEGIN:VTIMEZONE',
  'TZID:Europe/Paris',
  'BEGIN:STANDARD',
  'DTSTART:19701025T030000',
  'TZOFFSETFROM:+0200',
  'TZOFFSETTO:+0100',
  'END:STANDARD',
  'END:VTIMEZONE',
  'BEGIN:VEVENT',
  'UID:evenement-1@exemple',
  'DTSTAMP:20260101T120000Z',
  'DTSTART:20260824T143000Z',
  'DTEND:20260824T153000Z',
  'SUMMARY:Point hebdo',
  'LOCATION:Salle 2',
  'DESCRIPTION:Ordre du jour a definir',
  'ATTENDEE;CN=Alice;PARTSTAT=ACCEPTED:mailto:alice@exemple.fr',
  'X-APPLE-TRAVEL-ADVISORY-BEHAVIOR:AUTOMATIC',
  'BEGIN:VALARM',
  'ACTION:DISPLAY',
  'TRIGGER:-PT15M',
  'END:VALARM',
  'END:VEVENT',
  'END:VCALENDAR',
  '',
].join('\r\n');

describe('la lecture', () => {
  it('rend les évènements avec leurs champs modifiables', async () => {
    const doc = (await parseIcs(utf8(CALENDRIER)))!;
    expect(doc.events).toHaveLength(1);
    expect(doc.events[0]).toMatchObject({
      summary: 'Point hebdo',
      location: 'Salle 2',
      description: 'Ordre du jour a definir',
    });
    expect(doc.events[0].start).toMatch(/^2026-08-24T/);
  });

  it('refuse ce qui n’est pas un calendrier', async () => {
    expect(await parseIcs(utf8('ceci n’est pas un ics'))).toBeNull();
    expect(await parseIcs(new Uint8Array([0x61, 0x80, 0x62]))).toBeNull();
  });
});

describe('ce que l’on ne comprend pas SURVIT', () => {
  it('garde le fuseau, le participant, l’alarme et les X-', async () => {
    const doc = (await parseIcs(utf8(CALENDRIER)))!;
    // On corrige UN titre — tout le reste doit traverser.
    const modifies = doc.events.map((e) => ({ ...e, summary: 'Point hebdo (reporté)' }));
    const sortie = texte(await serializeIcs(doc, modifies));

    expect(sortie).toContain('Point hebdo (reporté)');
    expect(sortie).toContain('VTIMEZONE');
    expect(sortie).toContain('TZID:Europe/Paris');
    expect(sortie).toContain('PARTSTAT=ACCEPTED');
    expect(sortie).toContain('X-APPLE-TRAVEL-ADVISORY-BEHAVIOR:AUTOMATIC');
    expect(sortie).toContain('VALARM');
    expect(sortie).toContain('TRIGGER:-PT15M');
    expect(sortie).toContain('UID:evenement-1@exemple');
  });

  it('un aller-retour SANS modification garde toutes les propriétés', async () => {
    // La garantie est SÉMANTIQUE, pas octet pour octet : `stringify` normalise
    // l'ordre et le pliage des lignes. On vérifie donc la présence, pas la
    // forme — et c'est écrit dans l'en-tête du module.
    const doc = (await parseIcs(utf8(CALENDRIER)))!;
    const sortie = texte(await serializeIcs(doc, doc.events));
    for (const attendu of ['VERSION:2.0', 'PRODID', 'DTSTAMP', 'ATTENDEE', 'VALARM']) {
      expect(sortie).toContain(attendu);
    }
    expect((await parseIcs(utf8(sortie)))!.events[0].summary).toBe('Point hebdo');
  });
});

describe('l’écriture', () => {
  it('applique une vraie modification', async () => {
    const doc = (await parseIcs(utf8(CALENDRIER)))!;
    const sortie = texte(
      await serializeIcs(doc, [{ ...doc.events[0], location: 'Salle 7', summary: 'Rétro' }])
    );
    expect(sortie).toContain('Salle 7');
    expect(sortie).toContain('Rétro');
    expect(sortie).not.toContain('Salle 2');
  });

  it('une date VIDÉE ne l’efface pas du fichier', async () => {
    // Un champ effacé par accident ne doit pas supprimer une date : on garde
    // celle du fichier plutôt que d'écrire du vide.
    const doc = (await parseIcs(utf8(CALENDRIER)))!;
    const sortie = texte(await serializeIcs(doc, [{ ...doc.events[0], start: '', end: '' }]));
    expect(sortie).toContain('DTSTART');
    expect(sortie).toContain('DTEND');
  });

  it('une date ILLISIBLE laisse celle du fichier', async () => {
    const doc = (await parseIcs(utf8(CALENDRIER)))!;
    const sortie = texte(await serializeIcs(doc, [{ ...doc.events[0], start: 'n’importe quoi' }]));
    expect(sortie).toContain('DTSTART');
    expect((await parseIcs(utf8(sortie)))!.events[0].start).toMatch(/^2026-08-24T/);
  });

  it('une date valide est bien réécrite', async () => {
    const doc = (await parseIcs(utf8(CALENDRIER)))!;
    const sortie = texte(
      await serializeIcs(doc, [{ ...doc.events[0], start: '2026-09-01T09:00' }])
    );
    expect((await parseIcs(utf8(sortie)))!.events[0].start).toMatch(/^2026-09-01T09:00/);
  });
});
