/**
 * LE NOM D'ÉDITEUR EMBARQUÉ — SA LECTURE, ET LA CLÉ OÙ IL DOIT VIVRE.
 *
 * ── CE QUI ÉTAIT CASSÉ ──────────────────────────────────────────────────────
 *
 * `app-update.yml` livré en 3.0.4 ne portait aucun `publisherName`. Or
 * `electron-updater` le lit pour vérifier la signature de la mise à jour
 * téléchargée, et son absence le fait sortir par un `return null`
 * (NsisUpdater.js) : l'installateur est exécuté SANS qu'on regarde qui l'a
 * signé. Il ne restait que le SHA-512 de `latest.yml`, qui ne protège de rien
 * face à quelqu'un qui contrôle le serveur de publication — puisqu'il contrôle
 * aussi `latest.yml`. La signature est précisément la défense qui survit à ce
 * scénario, et elle était éteinte.
 *
 * ── LE PIÈGE QUI A FAILLI ME FAIRE LIVRER UN PLACEBO ────────────────────────
 *
 * electron-builder 26 a DÉPLACÉ ce réglage. `WindowsConfiguration` n'accepte
 * plus `publisherName` : il vit sous `win.signtoolOptions`. Posé au mauvais
 * endroit, il est ignoré EN SILENCE — le build réussit, le fichier se génère,
 * et rien ne vérifie la signature. Exactement le même symptôme qu'avant, avec
 * en plus la conviction d'avoir corrigé.
 *
 * Le premier test confronte donc la configuration au SCHÉMA d'electron-builder,
 * qui est l'autorité sur les clés qu'il lit réellement — pas à une copie de ce
 * qu'on croit être la bonne forme.
 *
 * ── ET LE SECOND PIÈGE, PLUS VICIEUX ENCORE ─────────────────────────────────
 *
 * Le dépôt contient DEUX configurations electron-builder : `electron-builder.yml`
 * et le champ `build` de `package.json`. Une seule est lue. Le journal de build
 * tranche — « loaded configuration file=package.json ("build" field") » — et le
 * fichier YAML n'est JAMAIS chargé.
 *
 * J'ai posé le correctif dans le YAML d'abord, lancé un build complet, et
 * obtenu exactement le même `app-update.yml` sans `publisherName` : le fichier
 * n'était pas lu. Aucune erreur, aucun avertissement, rien à quoi se raccrocher.
 *
 * D'où le troisième test : la configuration vivante est celle de `package.json`,
 * et un réglage de signature qui n'existerait QUE dans le YAML serait décoratif.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import { describe, it, expect } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { lirePublisherName, interpreterSortie } = require('../../scripts/check-publisher-name.cjs');

const RACINE = join(__dirname, '..', '..');

/** La configuration REELLEMENT chargée par electron-builder. */
function configVivante(): Record<string, unknown> {
  return JSON.parse(readFileSync(join(RACINE, 'package.json'), 'utf-8')).build;
}

describe('configuration de signature — là où electron-builder la lit vraiment', () => {
  it('déclare publisherName dans la config VIVANTE (package.json), pas dans le YAML mort', () => {
    const win = configVivante().win as { signtoolOptions?: { publisherName?: unknown } };
    const noms = win?.signtoolOptions?.publisherName;

    expect(
      noms,
      "publisherName absent de build.win.signtoolOptions dans package.json — " +
        'les mises à jour seraient installées SANS vérification de signature. ' +
        "Le poser dans electron-builder.yml ne compte pas : ce fichier n'est pas chargé."
    ).toBeTruthy();
    expect(Array.isArray(noms) ? noms : [noms]).toContain('Mathis Belouar-Pruvot');
  });

  it("n'utilise aucune clé que le schéma d'electron-builder ignore", () => {
    // L'AUTORITÉ : le schéma du paquet installé. `win.publisherName` et
    // `win.signingHashAlgorithms` étaient valides en v24 et ne le sont plus en
    // v26 — une clé périmée ne fait pas échouer le build, elle est simplement
    // ignorée, ce qui est le pire des deux mondes.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const schema = require('app-builder-lib/scheme.json');

    const win = (configVivante().win ?? {}) as Record<string, unknown>;
    const connues = Object.keys(schema.definitions.WindowsConfiguration.properties);
    const inconnues = Object.keys(win).filter((k) => !connues.includes(k));

    expect(inconnues, `clés ignorées par electron-builder : ${inconnues.join(', ')}`).toEqual([]);
  });

  it('package.json porte bien un champ `build` — sinon le YAML reprendrait la main', () => {
    // Garde-fou de la PRÉMISSE. Si quelqu'un retirait `build` de package.json,
    // electron-builder basculerait sur electron-builder.yml, et les deux tests
    // ci-dessus contrôleraient un fichier qui n'est plus lu — verts et vides
    // de sens. C'est exactement le mode de défaillance qu'on vient de vivre,
    // dans l'autre sens.
    expect(configVivante(), 'package.json n’a plus de champ `build`').toBeTruthy();
  });
});

describe('lirePublisherName', () => {
  it('lit la forme en liste', () => {
    const noms = lirePublisherName(
      'provider: generic\npublisherName:\n  - Mathis Belouar-Pruvot\n  - Filarr SAS\nurl: x\n'
    );
    expect(noms).toEqual(['Mathis Belouar-Pruvot', 'Filarr SAS']);
  });

  it('lit la forme scalaire', () => {
    expect(lirePublisherName('publisherName: Mathis Belouar-Pruvot\n')).toEqual([
      'Mathis Belouar-Pruvot',
    ]);
  });

  it('accepte les fins de ligne Windows', () => {
    // Le fichier est écrit par electron-builder sur un runner Windows.
    expect(lirePublisherName('publisherName:\r\n  - Mathis Belouar-Pruvot\r\nurl: x\r\n')).toEqual([
      'Mathis Belouar-Pruvot',
    ]);
  });

  it('retire les guillemets que le sérialiseur YAML peut poser', () => {
    // Un nom contenant une virgule ou un deux-points ressort cité ; sans ce
    // nettoyage la comparaison au CN échouerait et bloquerait toute release.
    expect(lirePublisherName("publisherName:\n  - 'Mathis Belouar-Pruvot'\n")).toEqual([
      'Mathis Belouar-Pruvot',
    ]);
    expect(lirePublisherName('publisherName: "Filarr, SAS"\n')).toEqual(['Filarr, SAS']);
  });

  it('rend une liste VIDE quand la clé est absente', () => {
    // Le cas réel de 3.0.4. Une liste vide fait échouer l'appelant, ce qui est
    // le comportement voulu : un garde-fou qui ne sait pas doit bloquer.
    expect(lirePublisherName('provider: generic\nurl: https://x\n')).toEqual([]);
  });

  it("ne confond pas une clé d'un autre nom qui se termine pareil", () => {
    // `^` ancre la ligne : sans lui, une future clé du genre
    // `azurePublisherName:` serait lue à la place et comparée au certificat.
    expect(lirePublisherName('azurePublisherName: Autre\n')).toEqual([]);
  });
});

/**
 * « SIGNATURE INVALIDE » ET « JE N'AI PAS PU VERIFIER » NE SONT PAS LA MEME
 * CHOSE.
 *
 * ── CE QUI EST ARRIVE EN VRAI ───────────────────────────────────────────────
 *
 * La premiere version ne connaissait que deux issues : `Valid`, ou tout le
 * reste traite comme « pas signe valablement ». Sur le runner GitHub,
 * `Get-AuthenticodeSignature` s'est revele INTROUVABLE — GitHub reecrit
 * `PSModulePath` pour PowerShell 7, ce qui casse le chargement automatique des
 * modules de Windows PowerShell 5.1. La commande echoue en erreur NON
 * bloquante, PowerShell sort quand meme en 0, `$sig` est nul, et le script
 * annonçait :
 *
 *     « L'installateur n'est pas signe valablement (statut : ) »
 *
 * Un statut VIDE. Sur un installateur parfaitement signe. Le garde-fou a bien
 * bloque la release — c'est le bon sens de l'echec — mais il a envoye chercher
 * une signature cassee alors que c'etait son propre outil qui ne tournait pas.
 *
 * Les deux issues doivent bloquer. Elles ne doivent pas raconter la meme
 * histoire.
 */
describe('interpreterSortie', () => {
  it('lit le CN quand la signature est valide', () => {
    const v = interpreterSortie(
      'CN:CN=Mathis Belouar-Pruvot, O=Mathis Belouar-Pruvot, C=FR',
      ''
    );
    expect(v.etat).toBe('ok');
    expect(v.cn).toBe('Mathis Belouar-Pruvot');
  });

  it('dit INVALIDE quand Authenticode rend un vrai statut de refus', () => {
    const v = interpreterSortie('INVALID:NotSigned', '');
    expect(v.etat).toBe('invalide');
    expect(v.detail).toBe('NotSigned');
  });

  it('ne prend PAS un statut VIDE pour une signature invalide', () => {
    // LE CAS REEL. `$sig` nul donne "INVALID:" sans statut : cela ne dit rien
    // sur la signature, seulement que la verification n'a pas eu lieu.
    const v = interpreterSortie('INVALID:', '');
    expect(v.etat).toBe('incontrolable');
  });

  it("dit INCONTROLABLE quand PowerShell rapporte une exception", () => {
    const v = interpreterSortie(
      'UNCHECKABLE:The specified module could not be loaded.',
      ''
    );
    expect(v.etat).toBe('incontrolable');
    expect(v.detail).toContain('module');
  });

  it('dit INCONTROLABLE sur une sortie vide ou inattendue', () => {
    // Interpreteur qui n'ecrit rien, ou qui ecrit autre chose : dans les deux
    // cas on ne SAIT pas, et un garde-fou qui ne sait pas ne doit pas accuser.
    expect(interpreterSortie('', '').etat).toBe('incontrolable');
    expect(interpreterSortie('bonjour', '').etat).toBe('incontrolable');
  });

  it("dit ILLISIBLE quand le sujet ne porte aucun CN", () => {
    const v = interpreterSortie('CN:O=Sans Common Name, C=FR', '');
    expect(v.etat).toBe('illisible');
  });
});
