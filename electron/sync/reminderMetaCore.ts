/**
 * LOGIQUE PURE DES RAPPELS côté processus principal — recensement et fusion.
 *
 * Aucune E/S, aucune horloge non injectée, aucun `StorageService` : c'est ce
 * qui rend ce module testable sans monter un profil sur le disque, et c'est là
 * que vivent les deux règles que le reste du bureau appliquait de travers.
 */

/**
 * Le rappel tel qu'il vit dans les fichiers du profil. Forme OUVERTE :
 * `metadata.json`, `calendarReminders.json` et `noteReminders.json` sont écrits
 * par des versions différentes de l'application, et un champ inconnu d'ici doit
 * traverser intact plutôt que disparaître.
 */
export interface StoredReminder {
  id: string;
  itemId?: string;
  itemName?: string;
  itemType?: string;
  date?: string;
  message?: string;
  description?: string;
  priority?: string;
  recurring?: string;
  completed?: boolean;
  isCompleted?: boolean;
  read?: boolean;
  snoozedUntil?: string;
  createdAt?: string;
  updatedAt?: string;
  /** Pierre tombale — voir `reminderMetaDoc`. */
  deletedAt?: string;
  [key: string]: unknown;
}

/**
 * DÉDOUBLONNAGE PAR IDENTIFIANT, PREMIER VU GAGNANT.
 *
 * `StorageService.getAllReminders` balaie tous les dossiers, puis pour chacun
 * ses `items[]`. Or un SOUS-DOSSIER est deux choses à la fois : un dossier à
 * part entière (son propre `metadata.json`, ses propres `reminders[]`) ET un
 * item du dossier parent, dont le `metadata.json` porte une COPIE du même
 * tableau. Le rappel d'un sous-dossier ressortait donc DEUX FOIS — deux lignes
 * dans l'écran des rappels, et deux notifications programmées pour un seul
 * rappel.
 *
 * On garde la PREMIÈRE occurrence. Ce n'est pas arbitraire : le balayage voit
 * le sous-dossier comme dossier avant de le revoir comme item du parent, et
 * c'est la forme que `StorageService.addReminder` écrit (il teste
 * `folder.id === itemId` AVANT de fouiller `items[]`). C'est donc celle dont
 * `itemType` et `itemName` sont justes.
 *
 * Un enregistrement sans `id` est écarté : il ne peut être ni dédoublonné, ni
 * mis à jour, ni supprimé — le garder ne ferait qu'une ligne fantôme.
 */
export function dedupeRemindersById<T extends { id?: string }>(reminders: readonly T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const reminder of reminders) {
    const id = reminder?.id;
    if (typeof id !== 'string' || id === '') continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(reminder);
  }
  return out;
}

/**
 * Horodatage d'arbitrage d'un rappel, en millisecondes.
 *
 * `updatedAt` d'abord, `createdAt` en repli, `0` quand aucun des deux n'est
 * lisible. Le `0` n'est pas neutre : il fait PERDRE l'enregistrement contre
 * n'importe quel autre — ce qui est le comportement voulu, un rappel sans
 * horodatage étant, par construction, plus ancien que ceux qui en ont un.
 */
export function reminderClockMs(reminder: Pick<StoredReminder, 'updatedAt' | 'createdAt'>): number {
  for (const raw of [reminder.updatedAt, reminder.createdAt]) {
    if (typeof raw !== 'string' || raw === '') continue;
    const ms = new Date(raw).getTime();
    if (!Number.isNaN(ms)) return ms;
  }
  return 0;
}

/**
 * Pose `createdAt` / `updatedAt` sur un rappel qui vient de naître, EN PLACE.
 *
 * En place, parce que les appelants du processus principal rendent l'objet
 * qu'ils ont reçu (`addReminder` rend son paramètre) : construire une copie
 * ferait diverger ce qui est écrit sur le disque de ce qui remonte au renderer.
 *
 * `createdAt` déjà posé est RESPECTÉ — un rappel qui arrive d'un import ou
 * d'une autre machine garde sa date de naissance ; seul `updatedAt` est
 * rafraîchi.
 */
export function stampReminderCreation<T extends { createdAt?: string; updatedAt?: string }>(
  reminder: T,
  nowIso: string = new Date().toISOString()
): T {
  if (!reminder.createdAt) reminder.createdAt = nowIso;
  reminder.updatedAt = nowIso;
  return reminder;
}

/**
 * Applique une modification et RAFRAÎCHIT `updatedAt`.
 *
 * Le champ n'est pas laissé à la merci de l'appelant : une modification qui
 * garderait l'horodatage de la création perdrait l'arbitrage contre le
 * téléphone, et l'utilisateur verrait sa correction annulée au cycle suivant.
 * Un `updatedAt` explicitement fourni dans `changes` gagne quand même — c'est
 * le cas d'une descente, où l'horodatage est celui de l'écrivain d'origine.
 */
export function touchReminder<T extends { updatedAt?: string }>(
  reminder: T,
  changes: Partial<T>,
  nowIso: string = new Date().toISOString()
): T {
  const next = { ...reminder, ...changes } as T;
  if (changes.updatedAt === undefined) next.updatedAt = nowIso;
  return next;
}
