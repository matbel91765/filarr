/**
 * Rattrapage des images des notes importées AVANT le 2026-08-26.
 *
 * L'importateur HTML produisait des nœuds `{ type: 'image' }`. Ce type
 * N'EXISTE PAS dans le schéma de l'éditeur : ProseMirror ne l'ignore pas, il
 * le SUPPRIME au parse. L'image restait donc visible dans le JSON stocké — et
 * disparaissait définitivement à la première frappe dans la note, parce que le
 * write-back sérialise le document PARSÉ. Perte silencieuse, irréversible, sur
 * des notes déjà chez l'utilisateur.
 *
 * L'importateur est corrigé depuis ; ce module traite le reliquat, celui qui
 * dort déjà dans les coffres. Il tourne au moment où le contenu est
 * DÉSÉRIALISÉ, juste avant que TipTap ne le voie : la note se répare quand on
 * l'ouvre, et le premier vrai changement l'enregistre sous sa forme saine. Pas
 * de réécriture en masse du stockage, donc pas de tempête de synchronisation,
 * et rien à annuler si quelque chose se passe mal.
 *
 * Les règles sont CELLES de l'importateur corrigé (`noteImportService`), pour
 * que les deux chemins ne divergent jamais :
 *  - data-URI d'image → `fileEmbed` (les octets voyagent chiffrés dans la note) ;
 *  - URL distante → lien, jamais une image : la CSP du renderer la bloquerait,
 *    et la charger ferait fuiter l'ouverture de la note vers cet hôte ;
 *  - ni l'un ni l'autre → le texte alternatif s'il existe, sinon rien.
 */

/** Nœud TipTap, vu d'assez loin pour que le module reste sans dépendance. */
interface JsonNode {
  type?: string;
  attrs?: Record<string, unknown>;
  content?: JsonNode[];
  [key: string]: unknown;
}

const LEGACY_TYPE = 'image';

/** Un contenu qui ne porte pas ce mot ne peut pas porter le nœud. */
const MARKER = '"image"';

function str(attrs: Record<string, unknown> | undefined, key: string): string {
  const value = attrs?.[key];
  return typeof value === 'string' ? value : '';
}

/** Le nœud de remplacement, ou `null` quand il n'y a rien à sauver. */
function convert(node: JsonNode, index: number): JsonNode | null {
  const src = str(node.attrs, 'src');
  const alt = str(node.attrs, 'alt');
  const rawWidth = node.attrs?.width;
  const width =
    typeof rawWidth === 'number' && Number.isFinite(rawWidth) && rawWidth > 0
      ? Math.round(rawWidth)
      : null;

  if (/^data:image\//i.test(src)) {
    return {
      type: 'fileEmbed',
      attrs: {
        // Pas d'horodatage : la migration doit être REPRODUCTIBLE. Deux
        // ouvertures de la même note doivent produire le même document, sinon
        // la synchronisation verrait une modification à chaque ouverture.
        fileId: `migrated-image-${index}`,
        fileName: alt || 'image',
        fileType: src.slice(5).split(/[;,]/)[0] || 'image/png',
        src,
        width,
      },
    };
  }

  if (/^https?:\/\//i.test(src)) {
    return {
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text: alt || src,
          marks: [{ type: 'link', attrs: { href: src } }],
        },
      ],
    };
  }

  if (alt) return { type: 'paragraph', content: [{ type: 'text', text: alt }] };
  return null;
}

/**
 * Rend le document migré, et un compteur de ce qui a été converti (0 = rien
 * touché : l'appelant peut alors garder l'objet d'origine).
 */
export function migrateLegacyImageNodes<T>(doc: T): { doc: T; converted: number } {
  let converted = 0;

  const walk = (node: JsonNode): JsonNode => {
    if (!Array.isArray(node.content)) return node;

    const next: JsonNode[] = [];
    let changed = false;

    for (const child of node.content) {
      if (child && child.type === LEGACY_TYPE) {
        const replacement = convert(child, converted);
        converted += 1;
        changed = true;
        if (replacement) next.push(replacement);
        continue;
      }
      const walked = child ? walk(child) : child;
      if (walked !== child) changed = true;
      next.push(walked);
    }

    return changed ? { ...node, content: next } : node;
  };

  if (!doc || typeof doc !== 'object') return { doc, converted: 0 };
  const migrated = walk(doc as JsonNode);
  return { doc: migrated as unknown as T, converted };
}

/**
 * Même chose sur du contenu SÉRIALISÉ, tolérante de bout en bout : ce qui
 * n'est pas du JSON, ou ne porte aucun nœud à migrer, ressort à l'identique
 * (même chaîne, pas une re-sérialisation) — un document intact ne doit pas
 * paraître modifié.
 */
export function migrateLegacyImagesInContent(content: string): string {
  if (typeof content !== 'string' || !content.includes(MARKER)) return content;
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return content;
  }
  const { doc, converted } = migrateLegacyImageNodes(parsed);
  if (converted === 0) return content;
  try {
    return JSON.stringify(doc);
  } catch {
    return content;
  }
}
