import { describe, it, expect, afterEach } from 'vitest';
import { buildShareMailto, openMailto } from './mailtoLink';

/**
 * « ENVOYER PAR E-MAIL » SANS QUE LA CLÉ NE PASSE PAR NOUS.
 *
 * Ce que ce fichier garde : le `mailto:` composé respecte les deux contraintes
 * du canal `open-external` du bureau (aucun espace ni contrôle, moins de
 * 2 048 caractères), le lien — fragment et clé compris — y est TOUJOURS, et
 * quand il faut couper, on coupe le texte, jamais le lien.
 */

const URL = 'https://filarr.com/s/abcDEF123456#k=' + 'a'.repeat(43);
const base = {
  url: URL,
  subject: 'Contrat.pdf — un fichier partagé avec Filarr',
  intro: 'Voici le lien pour récupérer « Contrat.pdf » :',
  expiry: 'Ce lien expire le 13/09/2026.',
  keyNote:
    'La clé de déchiffrement fait partie du lien : ne le transférez qu’à la personne à qui il est destiné.',
};

describe('buildShareMailto', () => {
  it('compose un mailto: valide pour le bureau — aucun espace, aucun contrôle, sous 2 048', () => {
    const m = buildShareMailto(base);
    expect(m).not.toBeNull();
    expect(m!).toMatch(/^mailto:\S+$/);
    expect(m!.length).toBeLessThan(2048);
    expect(m!).not.toMatch(/\s/); // aucun blanc : encodeURIComponent les a tous encodés
    expect(m!).not.toContain('+'); // l'espace est %20, jamais + (les messageries le liraient tel quel)
  });

  it('porte le lien COMPLET, clé comprise, que la messagerie retrouve en décodant', () => {
    const m = buildShareMailto(base)!;
    const body = new URLSearchParams(m.slice(m.indexOf('?') + 1)).get('body')!;
    expect(body).toContain(URL);
    expect(body).toContain('#k=');
    expect(body).toContain(base.intro);
    expect(body).toContain(base.expiry);
    expect(body).toContain(base.keyNote);
    expect(new URLSearchParams(m.slice(m.indexOf('?') + 1)).get('subject')).toBe(base.subject);
  });

  it('pré-remplit le destinataire quand il est donné', () => {
    expect(
      buildShareMailto({ ...base, to: 'ami@exemple.fr' })!.startsWith('mailto:ami%40exemple.fr?')
    ).toBe(true);
    expect(buildShareMailto(base)!.startsWith('mailto:?')).toBe(true);
  });

  it('quand ça ne tient pas, coupe le texte dans l’ordre — la note, l’échéance, l’ouverture — jamais le lien', () => {
    const long = (n: number) => 'x'.repeat(n);
    // Assez de texte pour dépasser le plafond avec tout, mais pas sans la note.
    const m1 = buildShareMailto({
      ...base,
      keyNote: long(900),
      expiry: long(600),
      intro: long(300),
    })!;
    const body1 = new URLSearchParams(m1.slice(m1.indexOf('?') + 1)).get('body')!;
    expect(body1).toContain(URL);
    expect(body1).not.toContain(long(900)); // la note est partie en premier
    expect(body1).toContain(long(600)); // l'échéance est restée
    // Encore trop : l'échéance part, puis l'ouverture ; le lien reste.
    const m2 = buildShareMailto({
      ...base,
      keyNote: long(900),
      expiry: long(900),
      intro: long(900),
    })!;
    const body2 = new URLSearchParams(m2.slice(m2.indexOf('?') + 1)).get('body')!;
    expect(body2).toContain(URL);
    expect(body2).not.toContain(long(900));
    expect(m2.length).toBeLessThanOrEqual(2000);
  });

  it('refuse plutôt que de tronquer un lien qui ne tiendrait pas seul', () => {
    expect(
      buildShareMailto({ url: 'https://filarr.com/s/' + 'z'.repeat(2100), subject: 's' })
    ).toBeNull();
  });
});

describe('openMailto', () => {
  // Les tests des services tournent sous Node : on pose un `window` minimal.
  const g = globalThis as unknown as { window?: unknown };
  if (!g.window) g.window = {};
  const w = g.window as { electron?: unknown };
  const avant = w.electron;
  afterEach(() => {
    w.electron = avant;
  });

  it('sans pont, dit non — l’appelant propose alors de copier le lien', () => {
    w.electron = undefined;
    expect(openMailto('mailto:?subject=x')).toBe(false);
  });

  it('avec le pont, passe par le canal open-external — le seul que main valide pour mailto:', () => {
    const appels: string[][] = [];
    w.electron = { ipcRenderer: { send: (c: string, u: string) => appels.push([c, u]) } };
    expect(openMailto('mailto:?subject=x')).toBe(true);
    expect(appels).toEqual([['open-external', 'mailto:?subject=x']]);
  });
});
