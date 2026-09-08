/**
 * icsFormat — modifier un calendrier sans perdre ce qu'on n'a pas compris.
 *
 * ── POURQUOI L'ICS EST UN BON CANDIDAT À L'ÉDITION ─────────────────────────
 * La règle du dépôt est qu'un format ne devient éditable en place que si on
 * sait le RÉÉCRIRE fidèlement. Presque aucun format ne passe ce test : docx
 * perd ses sections, xlsx ses formules, pdf tout. L'ICS, si — parce que
 * `ical.js` fait un aller-retour par jCal, une représentation FIDÈLE du
 * fichier, y compris des propriétés qu'il ne connaît pas.
 *
 * Concrètement : un `X-APPLE-TRAVEL-ADVISORY-BEHAVIOR` posé par Calendar,
 * une `ATTENDEE` avec ses douze paramètres, une `VTIMEZONE` entière — rien de
 * tout cela n'est compris par cet éditeur, et rien n'est perdu. On ne touche
 * QUE les propriétés qu'on affiche.
 *
 * ── CE QUI CHANGE QUAND MÊME ───────────────────────────────────────────────
 * `ICAL.stringify` normalise l'ordre des propriétés et le pliage des lignes
 * (RFC 5545 impose 75 octets). Un fichier réenregistré sans modification n'est
 * donc pas garanti octet pour octet — il est garanti SÉMANTIQUEMENT identique.
 * C'est une différence réelle avec le CSV et le texte, où l'on tient l'octet.
 * Elle est acceptable ici : un `.ics` n'est presque jamais suivi en git, et
 * aucun agenda ne lit le pliage des lignes comme une donnée.
 */

/** Ce qu'on montre et laisse modifier d'un évènement. */
export interface IcsEvent {
  /** Position du VEVENT dans le calendrier — la clé pour réécrire. */
  index: number;
  summary: string;
  /** Dates au format ISO local (`2026-08-24T14:30`), pour un `<input>`. */
  start: string;
  end: string;
  location: string;
  description: string;
  /** Journée entière : la date n'a pas d'heure dans le fichier. */
  allDay: boolean;
}

export interface IcsDocument {
  events: IcsEvent[];
  /** Le calendrier COMPLET, en jCal. C'est lui qu'on réécrit. */
  jcal: unknown;
}

type IcalModule = {
  parse: (s: string) => unknown;
  stringify: (j: unknown) => string;
  Component: new (j: unknown) => IcalComponent;
  Time: { fromString: (s: string) => unknown };
};

interface IcalComponent {
  getAllSubcomponents(name: string): IcalComponent[];
  getFirstPropertyValue(name: string): unknown;
  updatePropertyWithValue(name: string, value: unknown): unknown;
  toJSON(): unknown;
}

let module_: Promise<IcalModule> | null = null;

/**
 * `ical.js` n'a aucune dépendance mais une grande surface : on le charge à la
 * demande, pour qu'il ne pèse pas sur le démarrage de gens qui n'ouvriront
 * jamais un calendrier. Même choix que l'aperçu.
 */
function chargerIcal(): Promise<IcalModule> {
  if (!module_) {
    module_ = import('ical.js').then(
      (m) => ((m as unknown as { default?: IcalModule }).default ?? m) as unknown as IcalModule
    );
  }
  return module_;
}

/** `ICAL.Time` → chaîne d'`<input type="datetime-local">`, sans décalage. */
function versChampLocal(valeur: unknown): { texte: string; allDay: boolean } {
  if (!valeur || typeof valeur !== 'object') return { texte: '', allDay: false };
  const t = valeur as {
    year?: number;
    month?: number;
    day?: number;
    hour?: number;
    minute?: number;
    isDate?: boolean;
  };
  if (typeof t.year !== 'number') return { texte: '', allDay: false };
  const p2 = (n: number) => String(n).padStart(2, '0');
  const date = `${t.year}-${p2(t.month ?? 1)}-${p2(t.day ?? 1)}`;
  if (t.isDate) return { texte: date, allDay: true };
  return { texte: `${date}T${p2(t.hour ?? 0)}:${p2(t.minute ?? 0)}`, allDay: false };
}

const chaine = (v: unknown): string => (typeof v === 'string' ? v : '');

/**
 * Lire des octets comme un calendrier. `null` quand ce n'est pas de l'ICS —
 * jamais un calendrier approximatif.
 */
export async function parseIcs(bytes: Uint8Array): Promise<IcsDocument | null> {
  let texte: string;
  try {
    texte = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }

  try {
    const ICAL = await chargerIcal();
    const jcal = ICAL.parse(texte);
    const calendrier = new ICAL.Component(jcal);
    const events: IcsEvent[] = calendrier.getAllSubcomponents('vevent').map((v, index) => {
      const debut = versChampLocal(v.getFirstPropertyValue('dtstart'));
      const fin = versChampLocal(v.getFirstPropertyValue('dtend'));
      return {
        index,
        summary: chaine(v.getFirstPropertyValue('summary')),
        start: debut.texte,
        end: fin.texte,
        location: chaine(v.getFirstPropertyValue('location')),
        description: chaine(v.getFirstPropertyValue('description')),
        allDay: debut.allDay,
      };
    });
    return { events, jcal };
  } catch {
    return null;
  }
}

/**
 * Réécrire le calendrier avec les évènements modifiés.
 *
 * On repart du jCal D'ORIGINE et on n'y remplace que les propriétés éditées :
 * tout le reste — VTIMEZONE, ATTENDEE, X-*, l'ordre des composants — traverse
 * sans qu'on l'ait seulement lu.
 */
export async function serializeIcs(doc: IcsDocument, events: IcsEvent[]): Promise<Uint8Array> {
  const ICAL = await chargerIcal();
  const calendrier = new ICAL.Component(doc.jcal);
  const vevents = calendrier.getAllSubcomponents('vevent');

  for (const e of events) {
    const v = vevents[e.index];
    if (!v) continue;
    v.updatePropertyWithValue('summary', e.summary);
    v.updatePropertyWithValue('location', e.location);
    v.updatePropertyWithValue('description', e.description);
    // Les dates ne sont réécrites que si elles ont une valeur lisible : un
    // champ vidé par accident ne doit pas effacer une date du fichier.
    for (const [nom, texte] of [
      ['dtstart', e.start],
      ['dtend', e.end],
    ] as const) {
      if (!texte) continue;
      try {
        /**
         * `ICAL.Time.fromString` attend la forme ÉTENDUE (`2026-09-01T09:00:00`),
         * PAS la forme compacte du fichier ICS (`20260901T090000`) — vérifié
         * contre la bibliothèque, elle refuse la seconde.
         *
         * Et il faut les SECONDES : un `<input datetime-local>` rend
         * `AAAA-MM-JJTHH:MM`, que `fromString` rejette. L'analyse échouait
         * alors en silence et la date du fichier restait : une modification
         * qui ne prenait jamais, sans le moindre message.
         */
        const complet = texte.includes('T') && texte.length === 16 ? `${texte}:00` : texte;
        v.updatePropertyWithValue(nom, ICAL.Time.fromString(complet));
      } catch {
        // Date illisible : on laisse celle du fichier plutôt que d'en écrire
        // une fausse.
      }
    }
  }

  return new TextEncoder().encode(ICAL.stringify(calendrier.toJSON()));
}
