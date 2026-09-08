/**
 * LES DEUX FORMATAGES D'UNE FICHE — une taille et une date.
 *
 * Ils vivaient en privé dans `PluginDetailPanel`. La fiche des modèles affiche
 * exactement les mêmes deux choses, aux mêmes endroits (le poids d'une version,
 * la date d'une publication) : les recopier aurait donné deux fiches où la même
 * version se lit « 128 KiB » d'un côté et « 131 ko » de l'autre.
 *
 * Ils sont donc ici, et les deux fiches les importent.
 */

/** Octets → « 128 KiB » / « 1,4 MiB ». Une taille en octets bruts ne se lit pas. */
export function formatBytes(bytes: number, locale: string): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const kib = bytes / 1024;
  if (kib < 1024)
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(kib)} KiB`;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(kib / 1024)} MiB`;
}

/**
 * Une date ISO → la date du jour dans la langue de l'utilisateur.
 *
 * Une date illisible rend un tiret et non « Invalid Date » : la colonne vient
 * du serveur, et une valeur qu'on n'a pas su lire ne doit pas s'écrire en
 * anglais au milieu d'une fiche en français.
 */
export function formatDate(raw: string, locale: string): string {
  const v = Date.parse(raw);
  if (!Number.isFinite(v)) return '—';
  return new Date(v).toLocaleDateString(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}
