/**
 * Le lot SÉQUENTIEL d'`AddToVaultDialog` — la partie pure, éprouvable hors
 * application.
 *
 * Doctrine de `submitFolder`, mot pour mot : un envoi après l'autre (jamais en
 * parallèle : dix envois qui échouent sur la même cause n'apprennent rien de
 * plus que le premier), et ARRÊT PROPRE à la première erreur — ce qui est déjà
 * passé reste dans le coffre, ce qui n'est pas parti n'est pas touché, et
 * l'erreur remonte telle quelle à l'hôte qui sait la traduire. Rejouer le geste
 * ne redépose que le reste (un doublon près).
 *
 * `onProgress` reçoit l'avancement APRÈS chaque réussite, et une fois avant le
 * premier envoi (`0/total`) : la jauge existe dès que l'attente commence.
 */
export async function runSequentially<T>(
  items: ReadonlyArray<T>,
  step: (item: T, index: number) => Promise<void>,
  onProgress?: (done: number, total: number) => void
): Promise<number> {
  const total = items.length;
  let done = 0;
  onProgress?.(done, total);
  for (let i = 0; i < total; i++) {
    await step(items[i], i);
    done++;
    onProgress?.(done, total);
  }
  return done;
}
