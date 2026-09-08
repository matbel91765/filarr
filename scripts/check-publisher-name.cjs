/**
 * LE NOM D'ÉDITEUR EMBARQUÉ CORRESPOND-IL AU CERTIFICAT QUI A SIGNÉ ?
 *
 * ── POURQUOI CE GARDE-FOU EXISTE ────────────────────────────────────────────
 *
 * `build.win.signtoolOptions.publisherName` (dans package.json — ⚠ PAS dans
 * electron-builder.yml, qui n'est jamais chargé) est ce qui RALLUME la
 * vérification de signature des mises à jour. Sans lui, `electron-updater` sort
 * de sa vérification par un `return null` (NsisUpdater.js) : l'installateur
 * téléchargé est exécuté sans qu'on regarde qui l'a signé.
 *
 * Mais le poser crée un mode de panne PIRE que l'absence qu'il corrige. Une
 * valeur qui ne correspond pas au certificat ne dégrade pas la vérification :
 * elle la fait ÉCHOUER, et plus aucun poste installé ne peut se mettre à jour.
 * Et cela ne se verrait qu'après publication, chez les gens.
 *
 * Le cas qui arrivera pour de vrai : le renouvellement du certificat. Celui de
 * Filarr expire le 20 mars 2027, et un renouvellement peut changer le CN.
 *
 * ── L'AUTORITÉ ──────────────────────────────────────────────────────────────
 *
 * Le certificat, pas le fichier de configuration. On lit le CN du binaire qu'on
 * vient de signer et on le confronte à la liste déclarée. Comparer deux copies
 * de la même chaîne ne garderait rien — c'est le certificat qui décide, et il
 * n'existe que dans la CI.
 *
 * Usage : node scripts/check-publisher-name.cjs <chemin-de-l-exe>
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * Les noms d'éditeur EMBARQUÉS, lus dans le `app-update.yml` qui sera livré.
 *
 * ⚠ On ne lit PAS `electron-builder.yml`. Celui-là n'est que l'ENTRÉE ; ce
 * qu'`electron-updater` consulte à l'exécution est le `app-update.yml` posé
 * dans les ressources de l'application. Contrôler la source plutôt que le
 * produit laisserait passer le cas où electron-builder n'applique pas la
 * configuration — et ce cas est exactement le défaut qu'on vient de trouver,
 * puisque l'`app-update.yml` livré en 3.0.4 ne portait aucun `publisherName`.
 *
 * Analyse volontairement étroite plutôt qu'un vrai analyseur YAML : `js-yaml`
 * n'est qu'une dépendance TRANSITIVE ici (via electron-builder), et faire
 * dépendre la publication d'un paquet que personne ne déclare, c'est attendre
 * qu'un jour de remontée d'arbre casse la release.
 *
 * `publisherName` accepte une chaîne ou une liste ; on normalise en liste. Une
 * absence n'est PAS un cas dégradé qu'on laisse passer : c'est précisément le
 * défaut corrigé, et le laisser revenir en silence rendrait ce script
 * décoratif.
 */
function lirePublisherName(contenu) {
  // Forme en liste : `publisherName:` puis des `  - Nom` en dessous.
  const liste = /^publisherName:[ \t]*\r?\n((?:[ \t]*-[ \t]*\S.*\r?\n?)+)/m.exec(contenu);
  if (liste) {
    return liste[1]
      .split(/\r?\n/)
      .map((l) => l.replace(/^[ \t]*-[ \t]*/, '').trim())
      .map((n) => n.replace(/^["']|["']$/g, ''))
      .filter(Boolean);
  }
  // Forme scalaire : `publisherName: Nom`.
  const scalaire = /^publisherName:[ \t]*(\S.*?)[ \t]*$/m.exec(contenu);
  if (scalaire) {
    const n = scalaire[1].replace(/^["']|["']$/g, '').trim();
    return n ? [n] : [];
  }
  return [];
}

function nomsEmbarques(racine) {
  const chemin = path.join(racine, 'dist', 'win-unpacked', 'resources', 'app-update.yml');
  if (!fs.existsSync(chemin)) {
    throw new Error(
      `app-update.yml introuvable (${chemin}). Sans lui on ne peut rien affirmer sur ce ` +
        'que le paquet embarque, et un garde-fou qui ne sait pas doit bloquer, pas passer.'
    );
  }
  const noms = lirePublisherName(fs.readFileSync(chemin, 'utf-8'));
  if (noms.length === 0) {
    throw new Error(
      'publisherName est ABSENT du app-update.yml embarque. electron-updater installera ' +
        'donc les mises a jour SANS verifier qui les a signees (NsisUpdater.js sort par ' +
        '`return null`). Le poser dans build.win.signtoolOptions.publisherName de ' +
        'package.json — ⚠ PAS dans electron-builder.yml, qui n_est pas charge ' +
        '(le journal de build dit : loaded configuration file=package.json).'
    );
  }
  return noms;
}

/**
 * INTERPRÉTER LA SORTIE POWERSHELL — trois issues, pas deux.
 *
 * ⚠ « signature invalide » et « je n'ai pas pu vérifier » sont des choses
 * DIFFÉRENTES, et les confondre coûte cher. La première version ne connaissait
 * que deux cas : `Valid`, ou tout le reste traité comme « pas signé
 * valablement ». Sur le runner GitHub, `Get-AuthenticodeSignature` s'est révélé
 * introuvable — GitHub réécrit `PSModulePath` pour PowerShell 7, ce qui casse
 * le chargement automatique des modules de Windows PowerShell 5.1. La commande
 * échoue en erreur NON bloquante, PowerShell sort quand même en 0, `$sig` est
 * nul, et le script annonçait « L'installateur n'est pas signe valablement
 * (statut : ) » — un statut VIDE, sur un installateur parfaitement signé.
 *
 * Les deux issues bloquent la release, et c'est bien. Mais elles n'envoient pas
 * chercher au même endroit : l'une dit « ta signature est cassée », l'autre
 * « mon outil est cassé ». Un garde-fou qui ment sur la nature de la panne fait
 * perdre plus de temps qu'il n'en fait gagner.
 *
 * Fonction PURE, donc éprouvable sans PowerShell.
 */
function interpreterSortie(stdout, stderr) {
  const texte = (stdout || '').trim();

  if (texte.startsWith('CN:')) {
    const sujet = texte.slice(3);
    const m = /CN=([^,]+)/.exec(sujet);
    if (!m) {
      return { etat: 'illisible', detail: `aucun CN dans le sujet du certificat : ${sujet}` };
    }
    return { etat: 'ok', cn: m[1].trim() };
  }

  if (texte.startsWith('INVALID:')) {
    const statut = texte.slice(8).trim();
    // Un statut VIDE ne veut pas dire « invalide » : il veut dire que
    // `Get-AuthenticodeSignature` n'a rien rendu — donc qu'on n'a pas verifie.
    if (!statut) {
      return {
        etat: 'incontrolable',
        detail: 'Get-AuthenticodeSignature n_a rendu aucun statut',
        stderr: (stderr || '').trim(),
      };
    }
    return { etat: 'invalide', detail: statut };
  }

  if (texte.startsWith('UNCHECKABLE:')) {
    return { etat: 'incontrolable', detail: texte.slice(12).trim(), stderr: (stderr || '').trim() };
  }

  return {
    etat: 'incontrolable',
    detail: texte ? `sortie inattendue : ${texte}` : 'aucune sortie',
    stderr: (stderr || '').trim(),
  };
}

/**
 * Le CN du certificat qui a réellement signé le binaire.
 *
 * Passe par PowerShell parce que la vérification Authenticode est une API
 * Windows ; ce script ne tourne donc que sur le runner Windows, ce qui est
 * exactement là où la signature a lieu.
 *
 * `pwsh` D'ABORD, `powershell.exe` en repli : c'est PowerShell 5.1 qui souffre
 * de la réécriture de `PSModulePath` par GitHub, et `pwsh` est présent sur les
 * runners Windows. Le module est en outre importé EXPLICITEMENT, avec
 * `-ErrorAction Stop`, pour que son absence lève au lieu de laisser un `$sig`
 * nul se faire passer pour une signature invalide.
 */
function cnDuCertificat(exe) {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    'try {',
    '  Import-Module Microsoft.PowerShell.Security -ErrorAction Stop',
    `  $sig = Get-AuthenticodeSignature -LiteralPath '${exe.replace(/'/g, "''")}'`,
    '  if ($null -eq $sig) { Write-Output "UNCHECKABLE:Get-AuthenticodeSignature a rendu null"; exit 0 }',
    '  if ($sig.Status -ne "Valid") { Write-Output "INVALID:$($sig.Status)"; exit 0 }',
    '  if ($null -eq $sig.SignerCertificate) { Write-Output "UNCHECKABLE:aucun certificat signataire"; exit 0 }',
    '  Write-Output "CN:$($sig.SignerCertificate.Subject)"',
    '} catch {',
    '  Write-Output "UNCHECKABLE:$($_.Exception.Message)"',
    '}',
  ].join('\n');

  const essais = [];
  let derniere = null;

  for (const exeps of ['pwsh', 'powershell.exe']) {
    let res;
    try {
      res = execFileSync(exeps, ['-NoProfile', '-NonInteractive', '-Command', script], {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      // Interpréteur absent, ou sortie non nulle : on note et on essaie le suivant.
      essais.push(`${exeps} : ${err.message.split('\n')[0]}`);
      continue;
    }
    const verdict = interpreterSortie(res, '');
    if (verdict.etat === 'ok') return verdict.cn;
    derniere = verdict;
    essais.push(`${exeps} : ${verdict.etat} — ${verdict.detail}`);
    // Une signature reellement INVALIDE est un verdict, pas un echec d'outil :
    // inutile de retenter avec l'autre interpreteur, ils liraient le meme
    // fichier et rendraient la meme chose.
    if (verdict.etat === 'invalide') break;
  }

  if (derniere && derniere.etat === 'invalide') {
    throw new Error(
      `L'installateur n'est PAS signe valablement (statut Authenticode : ${derniere.detail}). ` +
        'Publier ainsi casserait la verification des mises a jour.'
    );
  }

  throw new Error(
    "IMPOSSIBLE DE VERIFIER la signature — ce n'est PAS la preuve qu'elle est mauvaise, " +
      "c'est l'outil de controle qui n'a pas pu s'executer. Detail des tentatives :\n  " +
      essais.join('\n  ')
  );
}

function main() {
  const exe = process.argv[2];
  if (!exe) {
    console.error('Usage : node scripts/check-publisher-name.cjs <chemin-de-l-exe>');
    process.exit(2);
  }

  const racine = path.join(__dirname, '..');
  const declares = nomsEmbarques(racine);
  const cn = cnDuCertificat(exe);

  console.log(`Certificat : ${cn}`);
  console.log(`Declare    : ${declares.join(' | ')}`);

  if (!declares.includes(cn)) {
    console.error(
      `::error::Le CN du certificat ("${cn}") n'est pas dans win.publisherName ` +
        `("${declares.join('", "')}"). Publier ainsi CASSERAIT les mises a jour de tout le ` +
        `parc installe. Ajouter le nouveau CN a la liste AVANT de publier, et ne retirer ` +
        `l'ancien qu'une fois le parc passe.`
    );
    process.exit(1);
  }

  console.log("OK — le nom d'editeur embarque correspond au certificat signataire.");
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(`::error::${err.message}`);
    process.exit(1);
  }
}

module.exports = { lirePublisherName, nomsEmbarques, interpreterSortie };
