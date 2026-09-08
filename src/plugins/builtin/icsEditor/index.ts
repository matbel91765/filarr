/**
 * L'éditeur de CALENDRIER — corriger un rendez-vous sans casser le fichier.
 *
 * ── POURQUOI L'ICS A LE DROIT D'ÊTRE ÉDITABLE ──────────────────────────────
 * La règle du dépôt : un format ne devient éditable en place que si on sait le
 * RÉÉCRIRE. Presque aucun ne passe ce test — docx perd ses sections, xlsx ses
 * formules, pdf tout. L'ICS le passe, parce que `ical.js` fait un aller-retour
 * par jCal, qui représente FIDÈLEMENT le fichier, propriétés inconnues
 * comprises. La démonstration est dans `icsFormat.ts` et ses tests : on corrige
 * un titre, et le fuseau, les participants, l'alarme et les `X-` traversent.
 *
 * ── CE QU'IL MONTRE, ET CE QU'IL NE MONTRE PAS ─────────────────────────────
 * Cinq champs par évènement : titre, début, fin, lieu, description. Rien
 * d'autre — pas de récurrence, pas de participants, pas d'alarmes. Non par
 * paresse : montrer une règle de récurrence dans un formulaire simplifié,
 * c'est inviter à la réécrire de travers. Ce qui n'est pas montré n'est pas
 * touché, et c'est cette discipline qui rend l'édition sûre.
 */

import type {
  EditorHost,
  EditorInstance,
  EditorProvider,
  FilarrPlugin,
} from '../../../services/plugins/pluginTypes';
import { parseIcs, serializeIcs, type IcsDocument, type IcsEvent } from './icsFormat';

/** Un calendrier de plus d'un mégaoctet n'est plus un agenda, c'est un export. */
const MAX_BYTES = 1024 * 1024;

const CHAMPS: { cle: keyof IcsEvent; libelle: string; type: string; multi?: boolean }[] = [
  { cle: 'summary', libelle: 'Titre', type: 'text' },
  { cle: 'start', libelle: 'Début', type: 'datetime-local' },
  { cle: 'end', libelle: 'Fin', type: 'datetime-local' },
  { cle: 'location', libelle: 'Lieu', type: 'text' },
  { cle: 'description', libelle: 'Description', type: 'text', multi: true },
];

function bloc(texte: string): HTMLElement {
  const p = document.createElement('p');
  p.textContent = texte;
  p.style.padding = '16px';
  return p;
}

async function mountIcsEditor(host: EditorHost): Promise<EditorInstance> {
  const racine = document.createElement('div');
  Object.assign(racine.style, {
    width: '100%',
    height: '100%',
    overflow: 'auto',
    padding: '16px',
    font: '13px/1.5 system-ui, sans-serif',
    boxSizing: 'border-box',
  } satisfies Partial<CSSStyleDeclaration>);
  host.container.appendChild(racine);

  const doc: IcsDocument | null = await parseIcs(host.initialBytes);

  if (!doc) {
    racine.appendChild(
      bloc(
        "Ce fichier n'est pas un calendrier lisible : il est ouvert en lecture " +
          'seule. Son contenu est laissé intact.'
      )
    );
    return {
      destroy: () => racine.remove(),
      // On n'a jamais eu le calendrier : rendre les octets d'origine est la
      // seule issue qui ne détruit pas le fichier.
      getBytes: () => host.initialBytes,
    };
  }

  // Copie de travail : le `doc.jcal` d'origine reste intact, et c'est LUI que
  // la sérialisation reprend — les propriétés qu'on n'affiche pas y vivent.
  const evenements: IcsEvent[] = doc.events.map((e) => ({ ...e }));

  if (evenements.length === 0)
    racine.appendChild(bloc('Ce calendrier ne contient aucun évènement.'));

  evenements.forEach((evenement, i) => {
    const carte = document.createElement('section');
    Object.assign(carte.style, {
      marginBottom: '16px',
      padding: '12px',
      border: '1px solid rgba(128,128,128,.3)',
      borderRadius: '8px',
    } satisfies Partial<CSSStyleDeclaration>);

    for (const champ of CHAMPS) {
      const etiquette = document.createElement('label');
      Object.assign(etiquette.style, {
        display: 'block',
        marginBottom: '8px',
      } satisfies Partial<CSSStyleDeclaration>);

      const titre = document.createElement('span');
      titre.textContent = champ.libelle;
      Object.assign(titre.style, {
        display: 'block',
        marginBottom: '2px',
        opacity: '0.7',
        fontSize: '12px',
      } satisfies Partial<CSSStyleDeclaration>);
      etiquette.appendChild(titre);

      const saisie: HTMLInputElement | HTMLTextAreaElement = champ.multi
        ? document.createElement('textarea')
        : document.createElement('input');
      if (saisie instanceof HTMLInputElement) {
        // Une date SANS heure vient d'un évènement « journée entière » : lui
        // imposer un champ datetime effacerait cette distinction, et l'agenda
        // qui relit le fichier afficherait un rendez-vous d'une seconde.
        saisie.type = champ.type === 'datetime-local' && evenement.allDay ? 'date' : champ.type;
      } else {
        saisie.rows = 3;
      }
      saisie.value = String(evenement[champ.cle] ?? '');
      saisie.readOnly = host.readOnly;
      saisie.setAttribute('aria-label', `${champ.libelle} — évènement ${i + 1}`);
      Object.assign(saisie.style, {
        width: '100%',
        padding: '6px 8px',
        border: '1px solid rgba(128,128,128,.35)',
        borderRadius: '5px',
        background: 'transparent',
        color: 'inherit',
        font: 'inherit',
        boxSizing: 'border-box',
        resize: champ.multi ? 'vertical' : 'none',
      } satisfies Partial<CSSStyleDeclaration>);

      saisie.addEventListener('input', () => {
        (evenement[champ.cle] as unknown) = saisie.value;
        host.onDirty(true);
      });

      etiquette.appendChild(saisie);
      carte.appendChild(etiquette);
    }
    racine.appendChild(carte);
  });

  return {
    destroy() {
      racine.remove();
    },
    getBytes() {
      // `getBytes` peut rendre une Promise — le contrat le prévoit pour le pont
      // du bac à sable, et ça sert ici : `ical.js` est chargé à la demande.
      return serializeIcs(doc, evenements) as unknown as Uint8Array;
    },
  };
}

/**
 * Le plus petit calendrier valide.
 *
 * `VERSION` et `PRODID` sont obligatoires (RFC 5545 §3.6), et les fins de
 * ligne sont en CRLF parce que la norme l'impose — un agenda tiers a le droit
 * de refuser un fichier plié en LF. Aucun VEVENT : le calendrier neuf est
 * vide d'évènements, ce qui est un état légitime, là où zéro octet ne l'est
 * pas.
 */
const GRAINE_ICS = new TextEncoder().encode(
  [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Filarr//Calendrier//FR',
    'CALSCALE:GREGORIAN',
    'END:VCALENDAR',
    '',
  ].join('\r\n')
);

const provider: EditorProvider = {
  contribution: {
    id: 'ics-calendar',
    extensions: ['ics'],
    // Un .ics de zéro octet n'est pas un calendrier vide : c'est un fichier
    // invalide, que cet éditeur lui-même refuserait en lecture seule. La
    // graine est le plus petit VCALENDAR conforme à la RFC 5545.
    newDocument: [{ ext: 'ics', label: 'Calendrier', seed: () => GRAINE_ICS }],
    displayName: 'Éditer le calendrier',
    maxBytes: MAX_BYTES,
  },
  mount: mountIcsEditor,
};

export const icsEditorPlugin: FilarrPlugin = {
  manifest: {
    id: 'ics-editor',
    name: 'Éditeur de calendrier',
    version: '1.0.0',
    trust: 'builtin',
    provides: { editors: [provider.contribution] },
  },
  editors: [provider],
};
