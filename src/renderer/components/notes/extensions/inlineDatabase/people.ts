/**
 * Colonne PERSONNE — logique pure.
 *
 * CE QUE C'EST, ET CE QUE CE N'EST PAS. Notion adosse ce type à l'annuaire de
 * son espace de travail : chaque valeur est un compte, avec sa photo et ses
 * droits. Filarr est local d'abord, et n'a pas d'annuaire à interroger — une
 * base vit dans une note, qui peut n'avoir jamais quitté l'appareil.
 *
 * Ce type stocke donc des NOMS saisis à la main, en liste. C'est ce qu'attend
 * un import Notion (dont les CSV n'exportent, eux aussi, que des noms), et ça
 * rend les gestes utiles : filtrer sur quelqu'un, regrouper, compter. Ce qu'il
 * ne fait PAS — et il ne doit pas le laisser croire — c'est mentionner un
 * compte, notifier, ou donner un droit d'accès.
 *
 * Les noms déjà saisis dans la colonne servent de suggestions : c'est le seul
 * « annuaire » honnête qu'on puisse offrir hors ligne.
 */

import type { DbProperty, DbRow } from './types';

/** Valeur d'une cellule personne : une liste de noms, toujours. */
export function peopleOf(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter(
      (entry): entry is string => typeof entry === 'string' && entry.trim() !== ''
    );
  }
  if (typeof value === 'string' && value.trim() !== '') {
    // Une valeur héritée (import, saisie ancienne) peut être une chaîne :
    // « Ada, Grace » se lit comme deux personnes, pas comme un nom à rallonge.
    return value
      .split(',')
      .map((piece) => piece.trim())
      .filter((piece) => piece !== '');
  }
  return [];
}

/** Écrit une liste de noms, dédoublonnée ; vide = cellule effacée. */
export function writePeople(names: string[]): string[] | undefined {
  const cleaned: string[] = [];
  for (const name of names) {
    const trimmed = name.trim();
    if (trimmed !== '' && !cleaned.some((kept) => kept.toLowerCase() === trimmed.toLowerCase())) {
      cleaned.push(trimmed);
    }
  }
  return cleaned.length > 0 ? cleaned : undefined;
}

/**
 * Initiales pour la pastille : une ou deux lettres.
 *
 * Prend la première lettre du premier et du dernier mot — « Ada Lovelace » →
 * « AL ». Un nom d'un seul mot rend une seule lettre plutôt que deux lettres
 * du même mot, qui se ressembleraient toutes.
 */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const first = [...words[0]][0] ?? '';
  if (words.length === 1) return first.toUpperCase();
  const last = [...words[words.length - 1]][0] ?? '';
  return `${first}${last}`.toUpperCase();
}

/**
 * Couleur STABLE d'une personne, dérivée de son nom.
 *
 * Déterministe : la même personne garde sa couleur d'une session à l'autre et
 * d'un appareil à l'autre, sans que rien ne soit stocké.
 */
export function personColorIndex(name: string, palette: number): number {
  let hash = 0;
  for (const char of name.toLowerCase()) {
    hash = (hash * 31 + char.codePointAt(0)!) % 100_000;
  }
  return hash % Math.max(1, palette);
}

/**
 * Noms déjà employés dans la colonne, du plus fréquent au moins fréquent.
 * C'est la liste de suggestions — le seul annuaire disponible hors ligne.
 */
export function knownPeople(rows: DbRow[], property: DbProperty): string[] {
  const counts = new Map<string, { name: string; count: number }>();
  for (const row of rows) {
    for (const name of peopleOf(row.cells[property.id])) {
      const key = name.toLowerCase();
      const entry = counts.get(key);
      if (entry) entry.count += 1;
      else counts.set(key, { name, count: 1 });
    }
  }
  return Array.from(counts.values())
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .map((entry) => entry.name);
}
