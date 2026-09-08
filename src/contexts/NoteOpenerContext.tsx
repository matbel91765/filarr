/**
 * NoteOpenerContext
 *
 * Ouverture d'une note PAR LE MÊME CHEMIN que la liste des notes.
 *
 * Dispatcher `setEditingNote` ne suffit pas : en vue scindée — et sur une note
 * atteinte par une route — chaque panneau tient sa note dans son propre état, et
 * la valeur globale du store ne pilote plus rien. Tout ce qui « ouvre une note »
 * depuis l'intérieur d'un panneau (pastille d'une base inline, lien d'une
 * cellule) passe donc par cette fonction, fournie par le panneau lui-même.
 *
 * Absente (composant monté hors d'un panneau : export, aperçu, test), l'appelant
 * retombe sur `setEditingNote`, qui reste juste en panneau unique.
 */

import { createContext, useContext } from 'react';

export type NoteOpener = (noteId: string) => void;

const NoteOpenerContext = createContext<NoteOpener | null>(null);

export const NoteOpenerProvider = NoteOpenerContext.Provider;

export const useNoteOpener = (): NoteOpener | null => useContext(NoteOpenerContext);

export default NoteOpenerContext;
