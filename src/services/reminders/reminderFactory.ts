/**
 * FABRIQUE D'UN RAPPEL à partir de ce que la boîte de dialogue a récolté.
 *
 * ── POURQUOI UN MODULE, ET PAS UN OBJET LITTÉRAL DANS LA VUE ────────────────
 * Le même objet était construit à la main dans DEUX écrans (`FolderView` et
 * `Home`), et les deux copies avaient la même fuite : `ReminderModal` récolte
 * `recurring` et `priority`, l'utilisateur les règle, et l'objet construit ne
 * reprenait NI l'un NI l'autre. Un rappel « tous les lundis, priorité haute »
 * arrivait sur le disque muet et ponctuel. Deux copies, deux fois le même
 * oubli : c'est le signe qu'il fallait UN endroit.
 *
 * ── `createdAt` / `updatedAt` NE SONT PAS DÉCORATIFS ────────────────────────
 * Le mobile arbitre les rappels À L'HORODATAGE (`syncMerge.mergeFolderReminders`
 * dans `filarr-mobile`, LWW sur `updatedAt`, égalité au local). Un rappel écrit
 * par le bureau SANS `updatedAt` vaut donc 0 dans cet arbitrage : n'importe
 * quelle version mobile, même ancienne, l'emporte. Autrement dit, le rappel que
 * l'utilisateur vient de créer sur son ordinateur perd contre l'état du
 * téléphone dès le premier cycle. Les deux champs sont donc posés À LA
 * CRÉATION, et `updatedAt` à chaque modification.
 *
 * ── CE QU'ON N'ÉCRIT PAS ────────────────────────────────────────────────────
 * `recurring: 'none'` est écrit tel quel plutôt qu'omis : c'est la valeur par
 * défaut de la boîte de dialogue, et le mobile la lit comme telle
 * (`composeDesktopReminder` écrit `out.recurring` sans condition). `priority`
 * en revanche reste ABSENT quand l'utilisateur n'a rien choisi — le mobile fait
 * la même distinction (`if (reminder.priority !== undefined)`), et semer une
 * valeur par défaut ferait un octet de différence pour rien à chaque
 * recomposition.
 */
import type { Reminder } from '../../types';

/** Ce que `ReminderModal` rend. Recopié pour ne pas faire dépendre un service du rendu. */
export interface ReminderFormData {
  date: string;
  time: string;
  message: string;
  recurring?: 'none' | 'daily' | 'weekly' | 'monthly';
  priority?: 'low' | 'normal' | 'high';
  datetime?: string;
}

/** Ce à quoi le rappel s'accroche. */
export interface ReminderTarget {
  itemId: string;
  itemName: string;
  itemType: 'file' | 'folder' | 'note';
}

/**
 * Date de déclenchement du rappel.
 *
 * `datetime` (posé par la boîte de dialogue quand elle sait déjà composer
 * l'instant) prime ; sinon on recompose depuis `date` + `time`. Une date
 * illisible ne produit PAS `Invalid Date` sérialisée en `null` : on retombe sur
 * `now`, parce qu'un rappel sans instant ne se déclenche jamais et disparaît
 * donc en silence — l'échec le plus discret et le pire.
 */
export function resolveReminderDate(form: ReminderFormData, nowIso: string): string {
  if (form.datetime) return form.datetime;
  const composed = new Date(`${form.date}T${form.time}`);
  const ms = composed.getTime();
  if (Number.isNaN(ms)) return nowIso;
  return composed.toISOString();
}

/**
 * Construit le rappel à écrire. `nowIso` est INJECTÉ : c'est ce qui rend la
 * fabrique testable sans geler l'horloge globale.
 */
export function buildReminder(
  form: ReminderFormData,
  target: ReminderTarget,
  id: string,
  nowIso: string = new Date().toISOString()
): Reminder {
  const reminder: Reminder = {
    id,
    itemId: target.itemId,
    itemName: target.itemName,
    itemType: target.itemType,
    date: resolveReminderDate(form, nowIso),
    message: form.message,
    recurring: form.recurring ?? 'none',
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  if (form.priority !== undefined) reminder.priority = form.priority;
  return reminder;
}

/**
 * Applique une modification à un rappel existant en RAFRAÎCHISSANT `updatedAt`.
 *
 * Sans ce passage obligé, une modification faite sur l'ordinateur garde
 * l'horodatage de la création et perd l'arbitrage contre le téléphone — le
 * défaut symétrique de celui décrit en tête de module.
 */
export function touchReminder(
  reminder: Reminder,
  changes: Partial<Reminder>,
  nowIso: string = new Date().toISOString()
): Reminder {
  return { ...reminder, ...changes, updatedAt: nowIso };
}
