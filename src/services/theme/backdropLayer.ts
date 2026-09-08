/**
 * POSER LE DÉCOR — l'image, le décor vivant, et le curseur qui les anime.
 *
 * ── AUCUN RENDU REACT ───────────────────────────────────────────────────────
 *
 * Un décor qui suit la souris reçoit des dizaines d'événements par seconde. Le
 * faire passer par un état React, c'est autant de reconciliations de l'arbre
 * ENTIER pour déplacer une lueur — l'application deviendrait pâteuse à la
 * frappe, et personne ne ferait le lien avec un choix de fond d'écran.
 *
 * Tout passe donc par DEUX variables CSS écrites sur `:root`, au rythme de
 * l'affichage, et par des règles qui les lisent. React n'en sait rien.
 *
 * ── UN SEUL ÉCOUTEUR, RETIRÉ AVEC LE DÉCOR ──────────────────────────────────
 *
 * L'écouteur de pointeur et l'horloge sont montés à la pose et démontés au
 * retrait. Un thème changé dix fois dans une session ne doit pas laisser dix
 * écouteurs derrière lui — c'est le genre de fuite qui ne se voit qu'après une
 * heure d'usage, quand tout est devenu lent sans raison apparente.
 */

import type { CustomBackdrop, LivingBackdrop } from './customTheme';

const IMAGE_ID = 'filarr-theme-backdrop';
const LIVING_ID = 'filarr-theme-living';

/** Ce qu'il faut défaire. Rempli à la pose, vidé au retrait. */
let teardown: (() => void)[] = [];

// ==================== Le curseur ====================

/**
 * Suit le pointeur et écrit sa position en POURCENTAGE sur `:root`.
 *
 * ⚠ L'écriture est calée sur `requestAnimationFrame`.
 *
 * `pointermove` se déclenche plus souvent que l'écran ne se rafraîchit — sur
 * une souris à 1 000 Hz, seize fois par image. Écrire la variable à chaque
 * événement ferait seize recalculs de style pour un seul rendu visible. On
 * retient donc la dernière position et on n'écrit qu'une fois par image.
 */
function trackPointer(root: HTMLElement): () => void {
  let x = 50;
  let y = 50;
  let frame = 0;

  const flush = (): void => {
    frame = 0;
    root.style.setProperty('--filarr-pointer-x', `${x}%`);
    root.style.setProperty('--filarr-pointer-y', `${y}%`);
  };

  const onMove = (event: PointerEvent): void => {
    x = (event.clientX / Math.max(1, window.innerWidth)) * 100;
    y = (event.clientY / Math.max(1, window.innerHeight)) * 100;
    if (!frame) frame = window.requestAnimationFrame(flush);
  };

  window.addEventListener('pointermove', onMove, { passive: true });
  return () => {
    window.removeEventListener('pointermove', onMove);
    if (frame) window.cancelAnimationFrame(frame);
    root.style.removeProperty('--filarr-pointer-x');
    root.style.removeProperty('--filarr-pointer-y');
  };
}

// ==================== L'horloge de fond ====================

/**
 * L'heure, en très grand, derrière l'application.
 *
 * Bat à la MINUTE et non à la seconde : c'est la seule granularité affichée, et
 * un réveil par seconde pour ne rien changer cinquante-neuf fois sur soixante
 * est un coût qu'on paierait sur batterie sans rien y gagner.
 *
 * Le premier réveil est calé sur la PROCHAINE minute pleine, pas sur « dans
 * soixante secondes » : sans ça, une horloge posée à 10 h 30 min 59 s
 * afficherait 10:30 pendant une minute entière après être passée à 10 h 31.
 */
function mountClock(host: HTMLElement, language: string): () => void {
  const time = document.createElement('p');
  time.className = 'filarr-living__clock';
  time.setAttribute('aria-hidden', 'true');

  const date = document.createElement('p');
  date.className = 'filarr-living__date';
  date.setAttribute('aria-hidden', 'true');

  const paint = (): void => {
    const now = new Date();
    time.textContent = now.toLocaleTimeString(language, {
      hour: '2-digit',
      minute: '2-digit',
    });
    date.textContent = now.toLocaleDateString(language, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    });
  };

  paint();
  host.appendChild(time);
  host.appendChild(date);

  let timer = 0;
  const schedule = (): void => {
    const now = new Date();
    const toNextMinute = 60_000 - (now.getSeconds() * 1000 + now.getMilliseconds());
    timer = window.setTimeout(() => {
      paint();
      schedule();
    }, toNextMinute);
  };
  schedule();

  return () => {
    window.clearTimeout(timer);
    time.remove();
    date.remove();
  };
}

// ==================== Poser et retirer ====================

export interface BackdropRequest {
  image: CustomBackdrop | null;
  living: LivingBackdrop;
  /** La langue de l'horloge de fond. */
  language: string;
}

export function mountBackdrop(request: BackdropRequest): void {
  if (typeof document === 'undefined') return;
  unmountBackdrop();

  const root = document.documentElement;
  const { image, living } = request;
  const wantsImage = !!image && image.opacity > 0;
  const wantsLiving = living !== 'none';
  if (!wantsImage && !wantsLiving) return;

  // ⚠ LE MARQUEUR EST CE QUI REND LE DÉCOR VISIBLE.
  //
  // Sans lui, `.layout` continue de peindre `--color-background` sur toute la
  // page et le décor reste derrière un mur opaque. C'est exactement le défaut
  // de la première version : la couche existait, avec la bonne image, et
  // personne ne pouvait la voir.
  root.setAttribute('data-backdrop', 'on');

  if (wantsImage && image) {
    const layer = document.createElement('div');
    layer.id = IMAGE_ID;
    layer.className = 'filarr-backdrop';
    layer.setAttribute('aria-hidden', 'true');
    // Par variables et non par `cssText` : régler l'opacité au curseur ne doit
    // pas réécrire toute la déclaration, URL de données comprise.
    layer.style.setProperty('--filarr-backdrop-image', `url("${image.image}")`);
    layer.style.setProperty('--filarr-backdrop-opacity', String(image.opacity));
    layer.style.setProperty('--filarr-backdrop-blur', `${image.blur}px`);
    layer.style.setProperty('--filarr-backdrop-scale', String(1 + image.blur / 200));
    document.body.appendChild(layer);
    teardown.push(() => layer.remove());
  }

  if (wantsLiving) {
    const layer = document.createElement('div');
    layer.id = LIVING_ID;
    layer.className = `filarr-living filarr-living--${living}`;
    layer.setAttribute('aria-hidden', 'true');
    document.body.appendChild(layer);
    teardown.push(() => layer.remove());

    if (living === 'clock') {
      teardown.push(mountClock(layer, request.language));
    }
    // Seuls deux décors lisent le pointeur. Monter l'écouteur pour l'aurore ou
    // l'horloge ferait tourner une boucle d'animation que personne ne regarde.
    if (living === 'glow' || living === 'constellation') {
      teardown.push(trackPointer(root));
    }
  }
}

export function unmountBackdrop(): void {
  if (typeof document === 'undefined') return;
  for (const undo of teardown) undo();
  teardown = [];
  document.documentElement.removeAttribute('data-backdrop');
}
