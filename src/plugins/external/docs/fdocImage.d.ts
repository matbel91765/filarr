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
import { type ImageOptions } from '@tiptap/extension-image';
export declare const FdocImage: import("@tiptap/core").Node<ImageOptions, any>;
