/**
 * Retours utilisateur pour la copie / l'enregistrement d'une image de note.
 *
 * Passe par la file Redux (et non par `useNotification`) parce que le même
 * message doit pouvoir partir d'un composant React (le menu contextuel) ET
 * d'un gestionnaire ProseMirror (Ctrl+C), qui lui vit hors de tout Context.
 * `metadata.source` est l'opt-in exigé par `ReduxNotificationsHost` pour
 * relayer dans la pile de toasts du design system.
 *
 * LE STORE EST IMPORTÉ À L'USAGE, pas au chargement du module. Importé en tête,
 * il entre dans le graphe de `fileEmbedExtension` — donc dans celui du SCHÉMA
 * de l'éditeur —, et `src/store/index.ts` lit `localStorage` dès son
 * évaluation : toute vérification du schéma hors navigateur s'écroulait sur un
 * `localStorage is not defined`, très loin de sa cause. Un toast n'a de toute
 * façon jamais besoin d'exister avant le premier clic.
 */

import i18n from '../../../../i18n/config';

const SOURCE = { metadata: { source: 'notes-image' } };

type NotificationAction = (message: string, options: typeof SOURCE) => unknown;

async function notify(kind: 'success' | 'error', key: string, fallback: string): Promise<void> {
  try {
    const [{ default: store }, slice] = await Promise.all([
      import('../../../../store'),
      import('../../../../store/slices/uiSlice'),
    ]);
    const action = (
      kind === 'success' ? slice.showSuccessNotification : slice.showErrorNotification
    ) as NotificationAction;
    store.dispatch(action(i18n.t(key, { defaultValue: fallback }), SOURCE) as never);
  } catch {
    // Un toast qui ne part pas ne doit jamais emporter l'action qui l'a demandé.
  }
}

export function notifyImageCopied(): void {
  void notify('success', 'notes.image.copied', 'Image copied to clipboard');
}

export function notifyImageCopyFailed(): void {
  void notify('error', 'notes.image.copyFailed', 'Could not copy this image');
}

export function notifyImageSaved(): void {
  void notify('success', 'notes.image.saved', 'Image saved');
}

export function notifyImageSaveFailed(): void {
  void notify('error', 'notes.image.saveFailed', 'Could not save this image');
}
