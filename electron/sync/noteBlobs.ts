/**
 * IMAGES HORS DU JSON DES NOTES — extraction et réinsertion. Module PUR.
 *
 * ═══ LE PROBLÈME, CHIFFRÉ ═══
 *
 * Les images d'une note vivent dans son JSON, en data-URL. Sur le coffre du
 * 2026-09-02 : 31 notes pour 9,87 Mo, soit 318 Ko de moyenne par note, dont la
 * quasi-totalité est de l'image encodée en base64 (qui gonfle encore les octets
 * d'un tiers).
 *
 * Conséquence : taper une virgule dans une note illustrée fait resceller,
 * réécrire et retransférer ses images. La v2 (une note, un objet) réduit ça à
 * UNE note au lieu de toute la bibliothèque — mais cette note-là repart
 * toujours entière.
 *
 * ═══ CE QUI CHANGE, ET POURQUOI C'EST DÉFINITIF ═══
 *
 * Une image ne change JAMAIS. On l'adresse donc par son contenu : l'empreinte
 * de ses octets EST son identifiant. Deux conséquences, et ce sont les deux
 * seules qui comptent :
 *
 *  1. UN OBJET IMMUABLE SE TRANSFÈRE UNE FOIS. Écrit une fois, remonté une
 *     fois, jamais réécrit — quel que soit le nombre de frappes qui suivent.
 *     Le coût d'une modification cesse de dépendre de ce que la note CONTIENT.
 *  2. LES DOUBLONS DISPARAISSENT TOUT SEULS. La même capture collée dans cinq
 *     notes n'existe qu'une fois sur le disque et une fois dans le nuage, sans
 *     qu'aucun code ne s'en occupe.
 *
 * ═══ LA FRONTIÈRE EST LE STOCKAGE, PAS L'ÉDITEUR ═══
 *
 * L'extraction se fait à l'ÉCRITURE, la réinsertion à la LECTURE. En mémoire,
 * le renderer continue de voir exactement ce qu'il voyait : des data-URL. Rien
 * dans l'éditeur, aucune vue de nœud, aucune CSP, aucun protocole ne change.
 *
 * C'est ce qui rend le changement supportable : il vit entre `notes:save` et
 * `notes:load`, et nulle part ailleurs.
 *
 * ⚠ UNE IMAGE ORPHELINE NE DOIT JAMAIS ÊTRE SUPPRIMÉE À LA LÉGÈRE. Le même
 * blob peut être référencé par une note qu'on n'a pas chargée (v2 : les notes
 * sont lues une par une). Le ménage exige donc l'index COMPLET — voir
 * `referencedBlobs`, et son unique appelant.
 */

/** Un nœud TipTap, vu d'assez loin pour que ce module reste sans dépendance. */
export interface JsonNode {
  type?: string;
  attrs?: Record<string, unknown>;
  /**
   * ⚠ UN TABLEAU DE NŒUDS, OU UNE CHAÎNE DE JSON SÉRIALISÉ.
   *
   * `Note.content` est une CHAÎNE (`src/types/notes.ts`) ; les nœuds internes
   * d'un document, eux, portent un tableau. Ce type disait « tableau » tout
   * court — et c'est ce mensonge qui a laissé le parcours ignorer les vraies
   * notes en silence.
   */
  content?: JsonNode[] | string;
  [key: string]: unknown;
}

/** Le schéma de référence : `filarr-blob:<empreinte>`. */
export const BLOB_REF_PREFIX = 'filarr-blob:';

/** Une empreinte acceptable — sert aussi de garde de chemin. */
const HASH_REGEX = /^[0-9a-f]{16,64}$/;

export function isBlobRef(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.startsWith(BLOB_REF_PREFIX) &&
    HASH_REGEX.test(value.slice(BLOB_REF_PREFIX.length))
  );
}

export function blobRefHash(value: string): string | null {
  if (!isBlobRef(value)) return null;
  return value.slice(BLOB_REF_PREFIX.length);
}

/**
 * Une data-URL exploitable : `data:<type>;base64,<charge>`.
 *
 * Seul le base64 est traité. Une data-URL en pourcent-encodage existe en
 * théorie et ne sort jamais des chemins de ce produit ; la laisser telle quelle
 * est strictement plus sûr que de la décoder de travers.
 */
const DATA_URL_REGEX = /^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/;

export interface ParsedDataUrl {
  mime: string;
  base64: string;
}

export function parseDataUrl(value: unknown): ParsedDataUrl | null {
  if (typeof value !== 'string') return null;
  const m = DATA_URL_REGEX.exec(value);
  return m ? { mime: m[1], base64: m[2] } : null;
}

/**
 * UN DOCUMENT RANGÉ DANS UNE CHAÎNE — et c'est le cas RÉEL, pas un cas limite.
 *
 * ⚠ `Note.content` est une CHAÎNE : du JSON TipTap sérialisé (`src/types/notes.ts`).
 * Les images vivent donc à l'intérieur de cette chaîne, pas dans l'objet note.
 * Un parcours qui ne descend que dans les tableaux `content` n'en trouve
 * AUCUNE — il traverse toutes les notes du monde sans rien voir, sans erreur,
 * et l'extraction ne fait alors strictement rien.
 *
 * C'est exactement ce qui arrivait : les contrats de ce module construisaient
 * des documents où `content` était un tableau, forme qu'une vraie note n'a
 * jamais. Une garde qui n'éprouve pas l'AUTORITÉ ne garde rien.
 *
 * Rend la valeur analysée, ou `null` si ce n'est pas du JSON structuré — auquel
 * cas la chaîne est laissée strictement telle quelle.
 */
function parseDocString(value: unknown): unknown | null {
  if (typeof value !== 'string') return null;
  const t = value.trimStart();
  if (!t.startsWith('{') && !t.startsWith('[')) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export interface ExtractResult {
  /** Le contenu, images remplacées par des références. */
  content: JsonNode;
  /** Empreinte → charge base64, dédoublonnée. */
  blobs: Record<string, string>;
  /** Combien de nœuds ont été réécrits (journal et tests). */
  rewritten: number;
}

/**
 * SORT LES IMAGES DU CONTENU.
 *
 * `hashOf` reçoit la charge base64 et rend son empreinte — injecté pour que ce
 * module reste pur et que les tests soient déterministes. L'empreinte porte sur
 * la CHARGE, pas sur la data-URL entière : deux notes qui déclarent le même
 * octet avec un type MIME écrit différemment doivent partager le même blob.
 *
 * Le type MIME reste dans le nœud (`fileType`), puisque c'est lui qui permettra
 * de reconstruire la data-URL à la lecture sans avoir à deviner.
 *
 * NE TOUCHE À RIEN D'AUTRE. Un nœud dont le `src` n'est pas une data-URL
 * base64 — référence déjà extraite, URL distante, valeur absurde — traverse
 * inchangé. Ce module ne répare pas, il déplace.
 */
export function extractBlobs(
  content: unknown,
  hashOf: (base64: string) => string
): ExtractResult {
  const blobs: Record<string, string> = {};
  let rewritten = 0;

  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (!node || typeof node !== 'object') return node;

    const src = node as JsonNode;
    const out: JsonNode = { ...src };

    const parsed = parseDataUrl(src.attrs?.src);
    if (parsed) {
      const hash = hashOf(parsed.base64);
      blobs[hash] = parsed.base64;
      out.attrs = {
        ...src.attrs,
        src: `${BLOB_REF_PREFIX}${hash}`,
        // Le type voyage avec le nœud : la lecture reconstruit la data-URL sans
        // avoir à renifler les octets ni à en stocker une copie.
        fileType: src.attrs?.fileType || parsed.mime,
      };
      rewritten++;
    }

    if (Array.isArray(src.content)) {
      out.content = src.content.map(walk) as JsonNode[];
    } else {
      // Le cas RÉEL : le document est une chaîne. On ne re-sérialise QUE si on a
      // réellement réécrit quelque chose — sinon la chaîne repart intacte, et
      // l'empreinte de la note ne bouge pas pour rien.
      const doc = parseDocString(src.content);
      if (doc !== null) {
        const avant = rewritten;
        const rendu = walk(doc);
        if (rewritten > avant) out.content = JSON.stringify(rendu);
      }
    }
    return out;
  };

  return { content: walk(content) as JsonNode, blobs, rewritten };
}

export interface InlineResult {
  content: JsonNode;
  /** Références que le magasin n'a pas su rendre. */
  missing: string[];
}

/**
 * REMET LES IMAGES DANS LE CONTENU.
 *
 * `read` rend la charge base64 d'une empreinte, ou `null`.
 *
 * ⚠ UNE RÉFÉRENCE INTROUVABLE EST LAISSÉE TELLE QUELLE, et signalée. La
 * remplacer par du vide effacerait l'image du document — et la prochaine
 * sauvegarde propagerait cet effacement partout. Un `src` que l'éditeur ne sait
 * pas afficher produit une image cassée : c'est visible, réparable, et
 * infiniment préférable à une disparition silencieuse.
 */
export function inlineBlobs(
  content: unknown,
  read: (hash: string) => string | null
): InlineResult {
  const missing: string[] = [];
  // Ce qui a été RÉELLEMENT réinséré : `missing` ne le dit pas, et c'est lui
  // qui décide s'il faut re-sérialiser un document rangé dans une chaîne.
  let replaced = 0;

  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (!node || typeof node !== 'object') return node;

    const src = node as JsonNode;
    const out: JsonNode = { ...src };

    const ref = typeof src.attrs?.src === 'string' ? blobRefHash(src.attrs.src as string) : null;
    if (ref) {
      const base64 = read(ref);
      if (base64 === null) {
        missing.push(ref);
      } else {
        const mime =
          typeof src.attrs?.fileType === 'string' && src.attrs.fileType
            ? (src.attrs.fileType as string)
            : 'application/octet-stream';
        out.attrs = { ...src.attrs, src: `data:${mime};base64,${base64}` };
        replaced++;
      }
    }

    if (Array.isArray(src.content)) {
      out.content = src.content.map(walk) as JsonNode[];
    } else {
      const doc = parseDocString(src.content);
      if (doc !== null) {
        const avant = replaced;
        const rendu = walk(doc);
        if (replaced > avant) out.content = JSON.stringify(rendu);
      }
    }
    return out;
  };

  return { content: walk(content) as JsonNode, missing };
}

/**
 * TOUTES LES EMPREINTES QU'UN CONTENU RÉFÉRENCE.
 *
 * Le SEUL usage légitime est le ménage, et il exige de balayer TOUTES les notes
 * avant de supprimer quoi que ce soit : en v2 les notes se lisent une par une,
 * et une image parfaitement vivante peut n'être citée que par une note qu'on
 * n'a pas ouverte.
 */
export function referencedBlobs(content: unknown, out: Set<string> = new Set()): Set<string> {
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (!node || typeof node !== 'object') return;
    const src = node as JsonNode;
    const ref = typeof src.attrs?.src === 'string' ? blobRefHash(src.attrs.src as string) : null;
    if (ref) out.add(ref);
    if (Array.isArray(src.content)) {
      src.content.forEach(walk);
    } else {
      const doc = parseDocString(src.content);
      if (doc !== null) walk(doc);
    }
  };
  walk(content);
  return out;
}

/**
 * QUELLES IMAGES PEUT-ON SUPPRIMER ? — la seule fonction destructrice du lot,
 * donc la plus prudente.
 *
 * ═══ ELLE EXIGE LA LISTE COMPLÈTE, ET REFUSE DE DEVINER ═══
 *
 * En v2 les notes se lisent UNE PAR UNE. Une image parfaitement vivante peut
 * n'être citée que par une note qu'on n'a pas ouverte — « personne ne la
 * référence » est donc une conclusion qu'on n'a pas les moyens de tirer à
 * partir d'un échantillon.
 *
 * `scannedNotes` et `expectedNotes` disent combien de notes ont RÉELLEMENT été
 * lues, et combien l'index en compte. Si les deux ne coïncident pas, la
 * fonction rend une liste VIDE : mieux vaut du stockage qui traîne qu'une image
 * effacée parce qu'on n'a pas su lire la note qui la citait.
 *
 * ═══ ET ELLE LAISSE UN DÉLAI DE GRÂCE ═══
 *
 * Une image tout juste extraite peut n'être encore citée par aucune note ÉCRITE
 * (extraction faite, coffre pas encore réécrit — la panne existe, `saveVaultV2`
 * écrit en plusieurs temps). `graceMs` la protège tant qu'elle est récente.
 */
export interface BlobSweepInput {
  /** Empreintes présentes sur le disque. */
  present: string[];
  /** Empreintes citées par les notes RÉELLEMENT lues. */
  referenced: Set<string>;
  /** Combien de notes ont pu être lues. */
  scannedNotes: number;
  /** Combien l'index en compte. */
  expectedNotes: number;
  /** Âge d'une image, par empreinte, en ms. Absente = âge inconnu → protégée. */
  ageMs: (hash: string) => number | null;
  /** En deçà de cet âge, on ne touche à rien. */
  graceMs: number;
}

export function selectSweepableBlobs(input: BlobSweepInput): string[] {
  // ON N'A PAS TOUT LU : on ne conclut rien. C'est le garde-fou principal.
  if (input.scannedNotes !== input.expectedNotes) return [];
  return input.present.filter((hash) => {
    if (input.referenced.has(hash)) return false;
    const age = input.ageMs(hash);
    // Âge inconnu = on ne sait pas depuis quand elle est là = on la garde.
    if (age === null) return false;
    return age > input.graceMs;
  });
}

/** Délai de grâce par défaut : une image de moins d'un jour n'est jamais balayée. */
export const BLOB_SWEEP_GRACE_MS = 24 * 60 * 60 * 1000;

/**
 * DÉLAI DE GRÂCE POUR LE NUAGE : sept jours, contre un pour le disque.
 *
 * Supprimer du nuage engage TOUS les appareils, pas seulement celui-ci. Un
 * appareil resté hors ligne une semaine avec une note qui cite l'image la
 * renverra à son retour (voir `blobTombstones` : la remontée ressuscite) — mais
 * autant ne pas lui faire payer ce transfert pour une image d'hier.
 */
export const CLOUD_BLOB_SWEEP_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Suppressions par cycle, au plus. Le Worker limite les suppressions à 120 par
 * cinq minutes et par compte : un premier balayage sur un vieux coffre pourrait
 * en réclamer des centaines. On avance par lots ; le reste attend demain.
 */
export const CLOUD_BLOB_SWEEP_MAX_PER_CYCLE = 20;

/** Nom du dossier des images, sous le dossier de notes du profil. */
export const BLOBS_DIR = 'blobs';

/** Chemin relatif d'un blob, tel que `VaultIO` l'attend. */
export function blobPath(notesDir: string, hash: string): string | null {
  if (!HASH_REGEX.test(hash)) return null;
  return `${notesDir}/${BLOBS_DIR}/${hash}.enc`;
}
