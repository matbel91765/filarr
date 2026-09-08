/**
 * CONTRATS DE L'EXTRACTION DES IMAGES.
 *
 * Ce module déplace des octets qui, aujourd'hui, ne sont nulle part ailleurs :
 * une image mal extraite ou mal réinsérée n'est pas un affichage cassé, c'est
 * une image PERDUE. Les contrats ci-dessous décrivent donc surtout ce qu'il ne
 * doit jamais faire.
 *
 * Le pivot est l'ALLER-RETOUR : extraire puis réinsérer doit rendre le document
 * de départ, à l'octet près. Si cette propriété tombe, tout le reste est second.
 */

import { describe, expect, it } from 'vitest';

import {
  blobPath,
  blobRefHash,
  extractBlobs,
  inlineBlobs,
  isBlobRef,
  parseDataUrl,
  referencedBlobs,
  selectSweepableBlobs,
  BLOB_REF_PREFIX,
  BLOB_SWEEP_GRACE_MS,
} from '../noteBlobs';

/** Empreinte de test : lisible dans un échec, et déterministe. */
const hashOf = (b64: string): string =>
  Array.from(b64.slice(0, 8))
    .map((c) => c.charCodeAt(0).toString(16).padStart(2, '0'))
    .join('')
    .padEnd(16, '0')
    .slice(0, 16);

const IMG_A = 'AAAABBBBCCCCDDDD';
const IMG_B = 'ZZZZYYYYXXXXWWWW';

const embed = (b64: string, mime = 'image/png') => ({
  type: 'fileEmbed',
  attrs: { fileId: 'f1', fileName: 'capture.png', fileType: mime, src: `data:${mime};base64,${b64}` },
});

const doc = (...nodes: unknown[]) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'bonjour' }] }, ...nodes],
});

// ── 1. L'aller-retour ───────────────────────────────────────────────────────

describe('aller-retour : extraire puis réinsérer rend le document', () => {
  it('rend exactement le document de départ', () => {
    const source = doc(embed(IMG_A), embed(IMG_B, 'image/jpeg'));
    const { content, blobs } = extractBlobs(source, hashOf);
    const { content: rendu, missing } = inlineBlobs(content, (h) => blobs[h] ?? null);
    expect(missing).toEqual([]);
    expect(rendu).toEqual(source);
  });

  it('le document extrait ne contient PLUS aucun octet d’image', () => {
    const source = doc(embed(IMG_A));
    const { content } = extractBlobs(source, hashOf);
    expect(JSON.stringify(content)).not.toContain(IMG_A);
    expect(JSON.stringify(content)).toContain(BLOB_REF_PREFIX);
  });

  /**
   * LA PROPRIÉTÉ QUI JUSTIFIE TOUT LE CHANGEMENT. Une image est immuable :
   * adressée par son contenu, elle porte toujours la même clé. Éditer le TEXTE
   * d'une note ne peut donc plus faire bouger un seul octet d'image.
   */
  it('éditer le texte ne change AUCUNE clé d’image', () => {
    const avant = extractBlobs(doc(embed(IMG_A)), hashOf);
    const apresSource = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'bonjour, et une virgule' }] },
        embed(IMG_A),
      ],
    };
    const apres = extractBlobs(apresSource, hashOf);
    expect(Object.keys(apres.blobs)).toEqual(Object.keys(avant.blobs));
  });

  it('la même image dans cinq notes ne produit qu’UN blob', () => {
    const source = doc(embed(IMG_A), embed(IMG_A), embed(IMG_A), embed(IMG_A), embed(IMG_A));
    const { blobs, rewritten } = extractBlobs(source, hashOf);
    expect(rewritten).toBe(5);
    expect(Object.keys(blobs)).toHaveLength(1);
  });

  it('est idempotent : ré-extraire un document déjà extrait ne fait rien', () => {
    const une = extractBlobs(doc(embed(IMG_A)), hashOf);
    const deux = extractBlobs(une.content, hashOf);
    expect(deux.rewritten).toBe(0);
    expect(deux.blobs).toEqual({});
    expect(deux.content).toEqual(une.content);
  });
});

// ── 2. Ce à quoi il ne touche pas ───────────────────────────────────────────

describe('ce module déplace, il ne répare pas', () => {
  it('laisse intact ce qui n’est pas une data-URL base64', () => {
    for (const src of [
      'https://exemple.test/image.png',
      'data:image/png,pas-du-base64',
      'filarr-blob:pas-une-empreinte',
      '',
      null,
      42,
    ]) {
      const source = { type: 'doc', content: [{ type: 'fileEmbed', attrs: { src } }] };
      const { content, rewritten, blobs } = extractBlobs(source, hashOf);
      expect(rewritten).toBe(0);
      expect(blobs).toEqual({});
      expect(content).toEqual(source);
    }
  });

  it('ne mute jamais le document d’entrée', () => {
    const source = doc(embed(IMG_A));
    const copie = JSON.parse(JSON.stringify(source));
    extractBlobs(source, hashOf);
    expect(source).toEqual(copie);
  });

  it('traverse un document vide, nul ou absurde sans broncher', () => {
    for (const entree of [null, undefined, 42, 'texte', [], {}]) {
      expect(() => extractBlobs(entree, hashOf)).not.toThrow();
      expect(() => inlineBlobs(entree, () => null)).not.toThrow();
    }
  });

  it('conserve le type MIME dans le nœud, pour savoir le reconstruire', () => {
    const { content } = extractBlobs(doc(embed(IMG_A, 'image/webp')), hashOf);
    const noeud = (content.content as Array<{ attrs?: Record<string, unknown> }>)[1];
    expect(noeud.attrs?.fileType).toBe('image/webp');
  });
});

// ── 3. Une image introuvable ────────────────────────────────────────────────

/**
 * LE CAS QUI DÉCIDE SI CE MODULE EST SÛR. Une référence que le magasin ne rend
 * pas est SIGNALÉE et LAISSÉE TELLE QUELLE. La remplacer par du vide effacerait
 * l'image du document — et la sauvegarde suivante propagerait cet effacement
 * partout, définitivement.
 */
describe('une référence introuvable ne fait disparaître personne', () => {
  it('la laisse en place et la signale', () => {
    const { content } = extractBlobs(doc(embed(IMG_A)), hashOf);
    const { content: rendu, missing } = inlineBlobs(content, () => null);
    expect(missing).toHaveLength(1);
    // La référence est toujours là : l'image est cassée à l'écran, pas perdue.
    expect(JSON.stringify(rendu)).toContain(BLOB_REF_PREFIX);
    expect(rendu).toEqual(content);
  });

  it('les images retrouvées sont réinsérées même si une autre manque', () => {
    const { content, blobs } = extractBlobs(doc(embed(IMG_A), embed(IMG_B)), hashOf);
    const hashA = hashOf(IMG_A);
    const { content: rendu, missing } = inlineBlobs(content, (h) =>
      h === hashA ? blobs[h] : null
    );
    expect(missing).toEqual([hashOf(IMG_B)]);
    expect(JSON.stringify(rendu)).toContain(IMG_A);
  });
});

// ── 4. Les références, et la garde de chemin ────────────────────────────────

describe('références et chemins', () => {
  it('reconnaît une référence, et refuse ce qui n’en est pas une', () => {
    expect(isBlobRef(`${BLOB_REF_PREFIX}0123456789abcdef`)).toBe(true);
    expect(blobRefHash(`${BLOB_REF_PREFIX}0123456789abcdef`)).toBe('0123456789abcdef');
    for (const mauvais of [
      `${BLOB_REF_PREFIX}../../evasion`,
      `${BLOB_REF_PREFIX}TROPCOURT`,
      `${BLOB_REF_PREFIX}`,
      'filarr-blob',
      'data:image/png;base64,AAAA',
      null,
    ]) {
      expect(isBlobRef(mauvais)).toBe(false);
    }
  });

  /**
   * L'empreinte vient d'un contenu de note, qui peut venir du nuage : c'est une
   * DONNÉE. Elle ne doit jamais pouvoir fabriquer un chemin hors du dossier.
   */
  it('refuse de fabriquer un chemin depuis une empreinte bricolée', () => {
    expect(blobPath('notes', '0123456789abcdef')).toBe('notes/blobs/0123456789abcdef.enc');
    for (const mauvais of ['../../etc/passwd', 'a/b', '', 'MAJUSCULES1234567', 'zz']) {
      expect(blobPath('notes', mauvais)).toBeNull();
    }
  });

  it('recense toutes les références d’un document', () => {
    const { content } = extractBlobs(doc(embed(IMG_A), embed(IMG_B), embed(IMG_A)), hashOf);
    expect([...referencedBlobs(content)].sort()).toEqual([hashOf(IMG_A), hashOf(IMG_B)].sort());
  });

  it('parseDataUrl ne se laisse pas prendre par une chaîne approchante', () => {
    expect(parseDataUrl('data:image/png;base64,AAAA')).toEqual({
      mime: 'image/png',
      base64: 'AAAA',
    });
    expect(parseDataUrl('data:image/png;base64,')).toBeNull();
    expect(parseDataUrl('data:;base64,AAAA')).toBeNull();
    expect(parseDataUrl('AAAA')).toBeNull();
  });
});

// ── 5. Le ménage des images ─────────────────────────────────────────────────
//
// La seule opération destructrice du lot. Ses contrats décrivent donc presque
// uniquement les cas où elle doit REFUSER d'agir : une image effacée à tort ne
// se récupère pas, du stockage qui traîne se récupère toujours.

describe('balayage des images orphelines', () => {
  const base = {
    present: ['aaa', 'bbb'],
    referenced: new Set<string>(),
    scannedNotes: 10,
    expectedNotes: 10,
    ageMs: () => 999_999_999,
    graceMs: BLOB_SWEEP_GRACE_MS,
  };

  it('balaie ce que plus aucune note ne cite', () => {
    expect(selectSweepableBlobs(base).sort()).toEqual(['aaa', 'bbb']);
  });

  it('ne touche jamais à une image citée', () => {
    expect(selectSweepableBlobs({ ...base, referenced: new Set(['aaa']) })).toEqual(['bbb']);
  });

  /**
   * LE GARDE-FOU PRINCIPAL. En v2 les notes se lisent une par une : si l'une
   * n'a pas pu être lue, une image parfaitement vivante peut sembler orpheline.
   * « Personne ne la référence » n'est alors pas une conclusion — c'est une
   * ignorance.
   */
  it('REFUSE TOUT quand une seule note n’a pas pu être lue', () => {
    expect(selectSweepableBlobs({ ...base, scannedNotes: 9, expectedNotes: 10 })).toEqual([]);
    expect(selectSweepableBlobs({ ...base, scannedNotes: 0, expectedNotes: 10 })).toEqual([]);
  });

  /**
   * Une image tout juste extraite peut n'être encore citée par aucune note
   * ÉCRITE : l'extraction pose les blobs avant que le coffre ne soit réécrit,
   * et une coupure entre les deux existe.
   */
  it('protège une image récente, même orpheline', () => {
    expect(selectSweepableBlobs({ ...base, ageMs: () => 60_000 })).toEqual([]);
    // Pile sur le seuil : encore protégée (le test est strict).
    expect(selectSweepableBlobs({ ...base, ageMs: () => BLOB_SWEEP_GRACE_MS })).toEqual([]);
  });

  it('protège une image dont on ne connaît pas l’âge', () => {
    // Ne pas savoir depuis quand elle est là n'autorise pas à la supprimer.
    expect(selectSweepableBlobs({ ...base, ageMs: () => null })).toEqual([]);
  });

  it('un coffre vide et entièrement lu autorise le balayage', () => {
    expect(
      selectSweepableBlobs({ ...base, scannedNotes: 0, expectedNotes: 0 }).sort()
    ).toEqual(['aaa', 'bbb']);
  });
});

// ── 6. LA FORME RÉELLE D'UNE NOTE ───────────────────────────────────────────
//
// ⚠ `Note.content` est une CHAÎNE : du JSON TipTap sérialisé
// (`src/types/notes.ts`). Tous les contrats ci-dessus construisent des
// documents où `content` est un TABLEAU — forme qu'une vraie note n'a jamais.
//
// Ils passaient donc au vert pendant que l'extraction ne trouvait AUCUNE image
// en production : le parcours ne descendait que dans les tableaux, et les
// images étaient à l'intérieur de la chaîne. Une garde qui n'éprouve pas
// l'autorité ne garde rien — ces contrats-ci l'éprouvent.

describe('la forme réelle : le document est une chaîne', () => {
  /** Une note telle que le renderer l'écrit vraiment. */
  const vraieNote = (b64: string, mime = 'image/png') => ({
    id: 'n1',
    title: 'Capture',
    plainText: 'bonjour',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    content: JSON.stringify({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'bonjour' }] },
        {
          type: 'fileEmbed',
          attrs: { fileId: 'f1', fileName: 'c.png', fileType: mime, src: `data:${mime};base64,${b64}` },
        },
      ],
    }),
  });

  it('TROUVE l’image, alors qu’elle est dans la chaîne', () => {
    const { blobs, rewritten, content } = extractBlobs(vraieNote(IMG_A), hashOf);
    expect(rewritten).toBe(1);
    expect(Object.keys(blobs)).toEqual([hashOf(IMG_A)]);
    // Les octets ont quitté la note.
    expect(JSON.stringify(content)).not.toContain(IMG_A);
  });

  it('`content` reste une CHAÎNE — sinon le renderer ne sait plus la lire', () => {
    const { content } = extractBlobs(vraieNote(IMG_A), hashOf);
    expect(typeof (content as { content?: unknown }).content).toBe('string');
    // Et elle reste du JSON valide, avec la référence dedans.
    const doc = JSON.parse(String((content as { content?: unknown }).content));
    expect(doc.content[1].attrs.src).toBe(`${BLOB_REF_PREFIX}${hashOf(IMG_A)}`);
  });

  it('aller-retour : le document rendu est équivalent à celui de départ', () => {
    const source = vraieNote(IMG_A);
    const { content, blobs } = extractBlobs(source, hashOf);
    const { content: rendu, missing } = inlineBlobs(content, (h) => blobs[h] ?? null);
    expect(missing).toEqual([]);
    expect(typeof (rendu as { content?: unknown }).content).toBe('string');
    expect(JSON.parse(String((rendu as { content?: unknown }).content))).toEqual(
      JSON.parse(source.content)
    );
  });

  it('recense la référence pour le ménage', () => {
    const { content } = extractBlobs(vraieNote(IMG_A), hashOf);
    expect([...referencedBlobs(content)]).toEqual([hashOf(IMG_A)]);
  });

  /**
   * SANS IMAGE, LA CHAÎNE NE DOIT PAS BOUGER D'UN OCTET. La re-sérialiser
   * changerait l'empreinte de la note, donc la ferait remonter — pour rien, et
   * pour toutes les notes du coffre à la fois.
   */
  it('une note sans image repart avec sa chaîne INTACTE', () => {
    const sansImage = { ...vraieNote(IMG_A), content: '{"type":"doc",  "content":[]}' };
    const { content, rewritten } = extractBlobs(sansImage, hashOf);
    expect(rewritten).toBe(0);
    expect(String((content as { content?: unknown }).content)).toBe(sansImage.content);
  });

  it('une chaîne qui n’est pas du JSON traverse sans broncher', () => {
    for (const brut of ['pas du json', '{cassé', '', 'null', '42']) {
      const note = { ...vraieNote(IMG_A), content: brut };
      const { content, rewritten } = extractBlobs(note, hashOf);
      expect(rewritten).toBe(0);
      expect(String((content as { content?: unknown }).content)).toBe(brut);
    }
  });

  it('une référence introuvable laisse la chaîne telle quelle', () => {
    const { content } = extractBlobs(vraieNote(IMG_A), hashOf);
    const { content: rendu, missing } = inlineBlobs(content, () => null);
    expect(missing).toHaveLength(1);
    expect(rendu).toEqual(content);
  });

  it('est idempotent sur la forme réelle', () => {
    const une = extractBlobs(vraieNote(IMG_A), hashOf);
    const deux = extractBlobs(une.content, hashOf);
    expect(deux.rewritten).toBe(0);
    expect(deux.content).toEqual(une.content);
  });

  it('dédoublonne à travers deux notes distinctes', () => {
    const a = extractBlobs(vraieNote(IMG_A), hashOf);
    const b = extractBlobs({ ...vraieNote(IMG_A), id: 'n2' }, hashOf);
    expect(Object.keys(a.blobs)).toEqual(Object.keys(b.blobs));
  });
});
