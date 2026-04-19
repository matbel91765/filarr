/**
 * Avatar Gradient Utility
 *
 * Generates consistent gradient backgrounds for profile avatars.
 * Used across ProfilePicker, Header, ManageProfiles, Onboarding, etc.
 */

function lightenColor(hex: string, amount: number): string {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.min(255, (num >> 16) + amount);
  const g = Math.min(255, ((num >> 8) & 0x00ff) + amount);
  const b = Math.min(255, (num & 0x0000ff) + amount);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

function darkenColor(hex: string, amount: number): string {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.max(0, (num >> 16) - amount);
  const g = Math.max(0, ((num >> 8) & 0x00ff) - amount);
  const b = Math.max(0, (num & 0x0000ff) - amount);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

/**
 * Generate a gradient background string for an avatar.
 * @param color - Base hex color (e.g. '#4682B4')
 * @returns CSS background value
 */
export function avatarGradient(color: string): string {
  return `linear-gradient(135deg, ${color}, ${lightenColor(color, 60)})`;
}

/**
 * Generate a richer gradient with a subtle darkened edge.
 * @param color - Base hex color
 * @returns CSS background value
 */
export function avatarGradientRich(color: string): string {
  return `linear-gradient(135deg, ${darkenColor(color, 15)}, ${color}, ${lightenColor(color, 50)})`;
}
