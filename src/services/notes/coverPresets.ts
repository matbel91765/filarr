/**
 * Cover presets for notes.
 *
 * Gradients and solid colors are encoded as CSS `background` values and
 * applied directly to the cover banner element. Keeping them as strings
 * (rather than separate structured records) means the renderer is just
 * a simple `style={{ background }}` and there is nothing to serialize.
 *
 * Each preset has a stable `id` so a note stores the id (not the raw
 * CSS) — we can then tweak the palette later without breaking existing
 * notes, and the list stays translatable/localizable.
 */

export interface CoverPreset {
  id: string;
  category: CoverCategory;
  /** Raw CSS applied to background. Can be a color, gradient, or image(). */
  css: string;
  /** Short human label, used for tooltip. */
  label: string;
}

export type CoverCategory = 'solid' | 'pastel' | 'dark' | 'tropical' | 'minimal' | 'mesh';

// ── Solid colors (the legacy 15) ─────────────────────────────────────────────

const SOLID: CoverPreset[] = [
  { id: 'solid-blue-pale', category: 'solid', css: '#e3f2fd', label: 'Bleu pâle' },
  { id: 'solid-green-pale', category: 'solid', css: '#e8f5e9', label: 'Vert pâle' },
  { id: 'solid-orange-pale', category: 'solid', css: '#fff3e0', label: 'Orange pâle' },
  { id: 'solid-pink-pale', category: 'solid', css: '#fce4ec', label: 'Rose pâle' },
  { id: 'solid-purple-pale', category: 'solid', css: '#f3e5f5', label: 'Violet pâle' },
  { id: 'solid-cyan-pale', category: 'solid', css: '#e0f7fa', label: 'Cyan pâle' },
  { id: 'solid-yellow-pale', category: 'solid', css: '#fff8e1', label: 'Jaune pâle' },
  { id: 'solid-brown-pale', category: 'solid', css: '#efebe9', label: 'Brun pâle' },
  { id: 'solid-indigo-pale', category: 'solid', css: '#e8eaf6', label: 'Indigo pâle' },
  { id: 'solid-lime-pale', category: 'solid', css: '#f1f8e9', label: 'Lime pâle' },
  { id: 'solid-charcoal', category: 'solid', css: '#263238', label: 'Charbon' },
  { id: 'solid-slate', category: 'solid', css: '#37474f', label: 'Ardoise' },
  { id: 'solid-steel', category: 'solid', css: '#455a64', label: 'Acier' },
  { id: 'solid-navy', category: 'solid', css: '#1a237e', label: 'Marine' },
  { id: 'solid-plum', category: 'solid', css: '#4a148c', label: 'Prune' },
];

// ── Pastel gradients ─────────────────────────────────────────────────────────

const PASTEL: CoverPreset[] = [
  {
    id: 'pastel-sunrise',
    category: 'pastel',
    css: 'linear-gradient(135deg, #fbc2eb 0%, #a6c1ee 100%)',
    label: 'Lever de soleil',
  },
  {
    id: 'pastel-peach',
    category: 'pastel',
    css: 'linear-gradient(135deg, #ffecd2 0%, #fcb69f 100%)',
    label: 'Pêche',
  },
  {
    id: 'pastel-mint',
    category: 'pastel',
    css: 'linear-gradient(135deg, #d4fc79 0%, #96e6a1 100%)',
    label: 'Menthe',
  },
  {
    id: 'pastel-lavender',
    category: 'pastel',
    css: 'linear-gradient(135deg, #c471f5 0%, #fa71cd 100%)',
    label: 'Lavande',
  },
  {
    id: 'pastel-sky',
    category: 'pastel',
    css: 'linear-gradient(135deg, #a1c4fd 0%, #c2e9fb 100%)',
    label: 'Ciel',
  },
  {
    id: 'pastel-rose',
    category: 'pastel',
    css: 'linear-gradient(135deg, #ff9a9e 0%, #fad0c4 100%)',
    label: 'Rose',
  },
  {
    id: 'pastel-cotton',
    category: 'pastel',
    css: 'linear-gradient(120deg, #e0c3fc 0%, #8ec5fc 100%)',
    label: 'Coton',
  },
  {
    id: 'pastel-meadow',
    category: 'pastel',
    css: 'linear-gradient(120deg, #a8edea 0%, #fed6e3 100%)',
    label: 'Prairie',
  },
];

// ── Dark / moody gradients ───────────────────────────────────────────────────

const DARK: CoverPreset[] = [
  {
    id: 'dark-midnight',
    category: 'dark',
    css: 'linear-gradient(135deg, #0f2027 0%, #203a43 50%, #2c5364 100%)',
    label: 'Minuit',
  },
  {
    id: 'dark-cosmic',
    category: 'dark',
    css: 'linear-gradient(135deg, #232526 0%, #414345 100%)',
    label: 'Cosmique',
  },
  {
    id: 'dark-deep-purple',
    category: 'dark',
    css: 'linear-gradient(135deg, #1e3c72 0%, #2a5298 100%)',
    label: 'Pourpre profond',
  },
  {
    id: 'dark-plum-night',
    category: 'dark',
    css: 'linear-gradient(135deg, #2c003e 0%, #4a1a5c 100%)',
    label: 'Nuit prune',
  },
  {
    id: 'dark-forest',
    category: 'dark',
    css: 'linear-gradient(135deg, #134e5e 0%, #71b280 100%)',
    label: 'Forêt',
  },
  {
    id: 'dark-obsidian',
    category: 'dark',
    css: 'linear-gradient(135deg, #000000 0%, #434343 100%)',
    label: 'Obsidienne',
  },
  {
    id: 'dark-aurora',
    category: 'dark',
    css: 'linear-gradient(135deg, #0575e6 0%, #021b79 100%)',
    label: 'Aurore',
  },
  {
    id: 'dark-ember',
    category: 'dark',
    css: 'linear-gradient(135deg, #3a1c71 0%, #d76d77 50%, #ffaf7b 100%)',
    label: 'Braise',
  },
];

// ── Tropical / vibrant gradients ─────────────────────────────────────────────

const TROPICAL: CoverPreset[] = [
  {
    id: 'tropical-sunset',
    category: 'tropical',
    css: 'linear-gradient(135deg, #ff6e7f 0%, #bfe9ff 100%)',
    label: 'Coucher tropical',
  },
  {
    id: 'tropical-mango',
    category: 'tropical',
    css: 'linear-gradient(135deg, #ffa17f 0%, #00223e 100%)',
    label: 'Mangue',
  },
  {
    id: 'tropical-ocean',
    category: 'tropical',
    css: 'linear-gradient(135deg, #2e3192 0%, #1bffff 100%)',
    label: 'Océan',
  },
  {
    id: 'tropical-flamingo',
    category: 'tropical',
    css: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
    label: 'Flamant',
  },
  {
    id: 'tropical-lagoon',
    category: 'tropical',
    css: 'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
    label: 'Lagon',
  },
  {
    id: 'tropical-coral',
    category: 'tropical',
    css: 'linear-gradient(135deg, #ff9a8b 0%, #ff6a88 55%, #ff99ac 100%)',
    label: 'Corail',
  },
  {
    id: 'tropical-papaya',
    category: 'tropical',
    css: 'linear-gradient(135deg, #fcb045 0%, #fd1d1d 50%, #833ab4 100%)',
    label: 'Papaye',
  },
  {
    id: 'tropical-sunrise-bay',
    category: 'tropical',
    css: 'linear-gradient(135deg, #ee9ca7 0%, #ffdde1 100%)',
    label: 'Baie',
  },
];

// ── Minimal / monochrome gradients ───────────────────────────────────────────

const MINIMAL: CoverPreset[] = [
  {
    id: 'minimal-paper',
    category: 'minimal',
    css: 'linear-gradient(180deg, #ffffff 0%, #f5f5f5 100%)',
    label: 'Papier',
  },
  {
    id: 'minimal-linen',
    category: 'minimal',
    css: 'linear-gradient(180deg, #faf3e0 0%, #e8d8ae 100%)',
    label: 'Lin',
  },
  {
    id: 'minimal-stone',
    category: 'minimal',
    css: 'linear-gradient(180deg, #d7d2cc 0%, #304352 100%)',
    label: 'Pierre',
  },
  {
    id: 'minimal-mist',
    category: 'minimal',
    css: 'linear-gradient(180deg, #e6dada 0%, #274046 100%)',
    label: 'Brume',
  },
  {
    id: 'minimal-fog',
    category: 'minimal',
    css: 'linear-gradient(180deg, #bdc3c7 0%, #2c3e50 100%)',
    label: 'Brouillard',
  },
  {
    id: 'minimal-cream',
    category: 'minimal',
    css: 'linear-gradient(180deg, #fffbd5 0%, #b20a2c 100%)',
    label: 'Crème',
  },
];

// ── Mesh gradients (radial blends, "modern" look) ────────────────────────────

const MESH: CoverPreset[] = [
  {
    id: 'mesh-nebula',
    category: 'mesh',
    css:
      'radial-gradient(at 20% 20%, #ff6b6b 0%, transparent 50%), ' +
      'radial-gradient(at 80% 30%, #4ecdc4 0%, transparent 50%), ' +
      'radial-gradient(at 50% 80%, #45b7d1 0%, transparent 50%), #1a1a2e',
    label: 'Nébuleuse',
  },
  {
    id: 'mesh-candy',
    category: 'mesh',
    css:
      'radial-gradient(at 10% 90%, #fbc2eb 0%, transparent 50%), ' +
      'radial-gradient(at 90% 10%, #a6c1ee 0%, transparent 50%), ' +
      'radial-gradient(at 50% 50%, #fecfef 0%, transparent 70%), #ffffff',
    label: 'Bonbon',
  },
  {
    id: 'mesh-aurora-borealis',
    category: 'mesh',
    css:
      'radial-gradient(at 0% 0%, #00c9ff 0%, transparent 50%), ' +
      'radial-gradient(at 100% 100%, #92fe9d 0%, transparent 50%), ' +
      'radial-gradient(at 50% 50%, #6a11cb 0%, transparent 70%), #0f0c29',
    label: 'Aurore boréale',
  },
  {
    id: 'mesh-citrus',
    category: 'mesh',
    css:
      'radial-gradient(at 10% 10%, #fddb92 0%, transparent 50%), ' +
      'radial-gradient(at 90% 90%, #d1fdff 0%, transparent 50%), #fef9d7',
    label: 'Agrumes',
  },
];

export const COVER_PRESETS: CoverPreset[] = [
  ...SOLID,
  ...PASTEL,
  ...DARK,
  ...TROPICAL,
  ...MINIMAL,
  ...MESH,
];

/** Index for O(1) lookup by id. Built lazily once. */
let presetsById: Map<string, CoverPreset> | null = null;

export function getCoverPreset(id: string): CoverPreset | null {
  if (!presetsById) {
    presetsById = new Map(COVER_PRESETS.map((p) => [p.id, p]));
  }
  return presetsById.get(id) ?? null;
}

/** Group presets by category in display order. */
export function getPresetsByCategory(): Array<[CoverCategory, CoverPreset[]]> {
  const order: CoverCategory[] = ['solid', 'pastel', 'dark', 'tropical', 'minimal', 'mesh'];
  return order.map((cat) => [cat, COVER_PRESETS.filter((p) => p.category === cat)]);
}

// ── Category labels (kept separate so they can be translated) ────────────────

export const CATEGORY_LABELS: Record<CoverCategory, { fr: string; en: string }> = {
  solid: { fr: 'Couleurs', en: 'Colors' },
  pastel: { fr: 'Pastels', en: 'Pastels' },
  dark: { fr: 'Sombres', en: 'Dark' },
  tropical: { fr: 'Tropicaux', en: 'Tropical' },
  minimal: { fr: 'Minimal', en: 'Minimal' },
  mesh: { fr: 'Mesh', en: 'Mesh' },
};

// ── Back-compat: the old `coverColor` field stored a raw hex string. ─────────
// Resolve that into either a matching preset id or the raw color itself.

export function resolveLegacyCoverColor(hex: string | undefined): string | null {
  if (!hex) return null;
  const match = COVER_PRESETS.find((p) => p.css === hex);
  return match?.id ?? hex;
}
