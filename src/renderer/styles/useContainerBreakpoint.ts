/**
 * useContainerBreakpoint — la bande d'une SURFACE, mesurée sur elle-même.
 *
 * POURQUOI PAS LA FENÊTRE, ET POURQUOI CE HOOK EXISTE.
 *
 * `breakpoints.ts` pose la décision d'architecture : trois bandes, mesurées sur
 * le CONTENEUR. Elle n'est pas théorique — l'application ne défile pas dans la
 * fenêtre (`body { overflow: hidden }`), et ses écrans vivent à côté d'une barre
 * latérale rétractable, dans des panneaux, parfois dans des onglets scindés. La
 * largeur de la fenêtre ne dit donc RIEN de la place réellement offerte à un
 * écran : une page de 700 px dans une fenêtre de 4 K doit se replier, et une
 * requête média ne le saura jamais. C'est le même piège qui avait faussé
 * l'ancrage de la liste de suggestions.
 *
 * DEUX ÉCRANS RECOPIAIENT DÉJÀ CE MOTIF À LA MAIN (l'accueil et la vue dossier),
 * avec un écart : l'un mesurait la boîte de BORDURE à la première mesure et la
 * boîte de CONTENU ensuite, si bien que les deux tombaient de part et d'autre du
 * seuil sur quelques dizaines de pixels. Le hook fait la mesure JUSTE une fois
 * pour tout le monde : la boîte de CONTENU des deux côtés (`clientWidth` moins
 * les marges intérieures à la première mesure, `contentRect` ensuite), barre de
 * défilement exclue de part et d'autre.
 *
 * LA PREMIÈRE MESURE EST SYNCHRONE. Un `ResizeObserver` ne parle qu'au cycle
 * suivant : sans elle, tout écran s'afficherait une frame en `compact` avant de
 * sauter dans sa vraie bande — un clignotement à chaque montage, et pour les
 * écrans qui montent/démontent leurs sous-arbres selon la bande, un aller-retour
 * de rendu complet.
 *
 * `compact` TANT QU'ON N'A PAS MESURÉ : c'est la seule disposition qui ne peut
 * pas déborder (`breakpointForWidth` le garantit sur 0 et sur NaN).
 */

import { useCallback, useEffect, useState } from 'react';
import { breakpointForWidth, type LayoutBreakpoint } from './breakpoints';

/**
 * Rend la ref à poser sur la surface à mesurer, et sa bande courante.
 *
 * UNE REF DE RAPPEL, PAS UN OBJET, et c'est la seule chose qui demande à être
 * expliquée. Un `useRef` + un effet sans dépendance ne mesure que ce qui est
 * monté au premier tour : une page qui rend `null` le temps que sa donnée
 * arrive (« coffre pas encore chargé ») n'aurait jamais de nœud à observer, et
 * resterait `compact` pour toujours — un repli permanent sur un écran large,
 * qu'on ne relierait jamais à cette ligne-ci. Le rappel, lui, se déclenche à
 * l'attachement RÉEL du nœud, quel que soit le tour où il arrive.
 *
 * La ref est typée `HTMLDivElement` : tous les appelants mesurent un conteneur
 * de mise en page, et un type générique obligerait chaque site d'appel à
 * l'annoter pour rien.
 */
/** La ref de rappel à poser sur la surface (`<div ref={ref}>`). */
export type ContainerRef = (node: HTMLDivElement | null) => void;

export function useContainerBreakpoint(): [ContainerRef, LayoutBreakpoint] {
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);

  const ref = useCallback((n: HTMLDivElement | null) => setNode(n), []);

  useEffect(() => {
    // Un cleanup rendu DANS TOUS LES CAS : une fonction qui n'en rend que dans
    // une branche déclenche TS7030.
    if (!node) return () => {};
    // Première mesure immédiate, sur la boîte de CONTENU — la même que celle que
    // l'observateur rendra ensuite, sans quoi les deux tomberaient de part et
    // d'autre du seuil sur la largeur des marges intérieures.
    //
    // `clientWidth`, PAS `getBoundingClientRect().width`, et l'écart n'est pas
    // théorique : la boîte de bordure inclut encore la BARRE DE DÉFILEMENT du
    // conteneur, que `ResizeObserver.contentRect` exclut. Sur une surface qui
    // défile — c'est le cas de la page « Gérer le coffre », `overflowY: auto` —
    // les deux mesures diffèrent d'une quinzaine de pixels, c'est-à-dire
    // exactement l'écart que ce hook existe pour supprimer : au ras du seuil, la
    // page montait le tableau puis le démontait à la frame suivante.
    // `clientWidth` retire déjà la bordure et la barre ; restent les marges
    // intérieures, que `contentRect` ne compte pas non plus.
    const style = getComputedStyle(node);
    setWidth(
      node.clientWidth -
        parseFloat(style.paddingLeft || '0') -
        parseFloat(style.paddingRight || '0')
    );
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);

  return [ref, breakpointForWidth(width)];
}

export default useContainerBreakpoint;
