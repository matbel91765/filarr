/**
 * FdocImage — le nœud image du fdoc, DATA-ONLY par schéma.
 *
 * La garde anti-pixel-espion vit ICI, pas dans la barre d'outils : tout `src`
 * qui ne commence pas par `data:image/` est rejeté au parsing comme à la
 * sérialisation d'attributs — un `<img src="https://…">` collé depuis le web
 * ne peut PAS entrer dans un fdoc (fuite d'IP et d'heure d'ouverture à un
 * serveur tiers à chaque rendu : violation E2EE frontale).
 *
 * width/height sont posés à l'insertion/import — l'export docx en a besoin
 * pour `transformation`, et le rendu évite un reflow au chargement.
 */
import { Image } from '@tiptap/extension-image';
const DATA_IMAGE_PREFIX = 'data:image/';
function sanitizeSrc(value) {
    return typeof value === 'string' && value.startsWith(DATA_IMAGE_PREFIX) ? value : null;
}
export const FdocImage = Image.extend({
    addOptions() {
        return {
            ...this.parent?.(),
            allowBase64: true,
        };
    },
    addAttributes() {
        return {
            ...this.parent?.(),
            src: {
                default: null,
                parseHTML: (element) => sanitizeSrc(element.getAttribute('src')),
                renderHTML: (attributes) => {
                    const src = sanitizeSrc(attributes.src);
                    // Un nœud sans src valide ne rend RIEN d'exploitable — le schéma est
                    // la dernière ligne, quel que soit le chemin d'entrée (paste, import,
                    // JSON hostile).
                    return src ? { src } : {};
                },
            },
            width: {
                default: null,
                parseHTML: (element) => {
                    const raw = Number(element.getAttribute('width'));
                    return Number.isFinite(raw) && raw > 0 ? Math.round(raw) : null;
                },
            },
            height: {
                default: null,
                parseHTML: (element) => {
                    const raw = Number(element.getAttribute('height'));
                    return Number.isFinite(raw) && raw > 0 ? Math.round(raw) : null;
                },
            },
        };
    },
});
