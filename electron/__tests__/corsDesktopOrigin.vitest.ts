/**
 * LES DEUX MOITIES DE L'ORIGINE DU BUREAU, CONFRONTEES.
 *
 * ── LA PANNE QUE CECI EMPECHE DE REVENIR ────────────────────────────────────
 *
 * L'application empaquetee charge son renderer depuis `app://filarr.app`, une
 * origine construite dans `main.ts` a partir de deux constantes. Le Worker
 * decide separement quelles origines il admet. Rien ne reliait les deux.
 *
 * La migration de `file://` vers `app://` -- faite pour donner a WebAuthn un
 * `rp.id` valide, que `file://` n'a pas -- a change une moitie sans toucher
 * l'autre. Le Worker s'est alors mis a refuser TOUT appel HTTP du renderer
 * empaquete, en silence.
 *
 * Le symptome ne ressemblait pas a sa cause. Le navigateur bloque la reponse,
 * axios ne voit AUCUNE reponse, et « aucune reponse » se traduit legitimement
 * par `network_unavailable` -- « verifiez votre connexion », sur une machine
 * dont la connexion allait parfaitement bien : le processus principal, qui
 * parle en Node et n'a donc pas de CORS, synchronisait A LA MEME SECONDE. Et
 * le defaut etait invisible partout ailleurs : en developpement l'origine est
 * `http://localhost:3000`, admise ; sur le web `https://app.filarr.com`,
 * admise. Seul le paquet cassait, c'est-a-dire seulement chez les gens.
 *
 * ── POURQUOI CE TEST VIT ICI ────────────────────────────────────────────────
 *
 * Il faut voir les DEUX fichiers. Le paquet du Worker cible le runtime Workers
 * et n'a pas acces au disque ; son propre `cors-origin.test.ts` ne peut donc
 * verifier que le comportement du resolveur autour de sa constante -- ce qui
 * serait reste VERT pendant toute la panne, puisque le Worker admettait
 * fidelement l'origine qu'il CROYAIT etre celle du bureau.
 *
 * L'autorite, ici, est `main.ts` : c'est cette chaine-la que Chromium envoie.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import { describe, it, expect } from 'vitest';

const RACINE = join(__dirname, '..', '..');

function lire(...segments: string[]): string {
  return readFileSync(join(RACINE, ...segments), 'utf-8');
}

/**
 * Extrait une constante chaine, en ECHOUANT si elle a disparu.
 *
 * Un renommage ne doit pas rendre ce test silencieusement inoffensif : c'est
 * precisement le mode de defaillance qu'on cherche a fermer.
 */
function constante(source: string, nom: string, ou: string): string {
  const m = new RegExp(`const ${nom} = '([^']+)'`).exec(source);
  expect(m, `${nom} introuvable dans ${ou} — a-t-elle ete renommee ?`).not.toBeNull();
  return m![1];
}

describe("CORS — l'origine du bureau empaquete, des deux cotes", () => {
  it("le Worker admet exactement l'origine que main.ts construit", () => {
    const main = lire('electron', 'main.ts');
    const origineApplication = `${constante(main, 'APP_SCHEME', 'electron/main.ts')}://${constante(
      main,
      'APP_HOST',
      'electron/main.ts'
    )}`;

    const worker = lire('infra', 'cloudflare-worker', 'src', 'index.ts');
    const origineWorker = constante(
      worker,
      'DESKTOP_APP_ORIGIN',
      'infra/cloudflare-worker/src/index.ts'
    );

    expect(
      origineWorker,
      `Le paquet charge « ${origineApplication} » mais le Worker n'admet que ` +
        `« ${origineWorker} ». Tout appel HTTP du renderer empaquete sera bloque ` +
        `par CORS, et l'application dira « verifiez votre connexion » alors que le ` +
        `reseau va bien. Mettre les deux d'accord.`
    ).toBe(origineApplication);
  });

  it('main.ts charge bien cette origine pour un paquet (et localhost sinon)', () => {
    const main = lire('electron', 'main.ts');
    // Si le chargement cessait de passer par ces constantes, le test ci-dessus
    // comparerait deux chaines que plus personne n'utilise.
    expect(main).toContain('app.isPackaged ? `${APP_SCHEME}://${APP_HOST}/index.html`');
  });
});
