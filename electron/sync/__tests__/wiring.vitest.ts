/**
 * wiring.vitest.ts — LE CABLAGE, pas les modules.
 *
 * ── POURQUOI CETTE SUITE EXISTE ──────────────────────────────────────────────
 * Toutes les autres suites de ce dossier verifient des modules PURS, et elles
 * peuvent toutes rester vertes pendant que le produit ne fait rien de ce
 * qu'elles decrivent — parce que personne n'appelle ces modules.
 *
 * Ce n'est pas une crainte theorique. Trois occurrences dans ce chantier :
 *
 *  1. `POST /sync/delta/gc` existe, il est bon, et son appelant l'enveloppe dans
 *     `.catch(() => undefined)`. Un ramassage rate ne repasse donc JAMAIS. Le
 *     module etait la, le cablage etait incomplet.
 *  2. `GET /sync/capabilities` expose un drapeau `deltaSync` que le mobile lit,
 *     stocke, et derriere lequel il n'y a AUCUNE branche.
 *  3. Cote mobile (session filarr-mobile-ff, 2026-09-05) : un lecteur d'URL de
 *     widget entierement teste que rien n'appelait, et qui affichait
 *     « Unmatched Route » sur l'ecran d'accueil de l'utilisateur.
 *
 * D'ou cette suite : elle lit le SOURCE de `syncService.ts` et exige que les
 * points de branchement existent. C'est grossier — un test qui lit du texte —
 * et c'est assume : le raffinement serait de monter tout le processus principal
 * avec Electron, ce qui coute cher et casse pour dix raisons etrangeres au
 * cablage. Ici, si quelqu'un retire un appel, la suite rougit tout de suite.
 *
 * ⚠ ELLE NE REMPLACE PAS les suites de modules, et l'inverse est encore plus
 * vrai. Un appel present ne prouve pas que le module marche ; un module qui
 * marche ne prouve pas qu'il est appele. Il faut les deux.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { codeOnly, sectionAfter } from './sourceScan';


const SERVICE_RAW = readFileSync(join(__dirname, '..', 'syncService.ts'), 'utf8');
const SERVICE = codeOnly(SERVICE_RAW);

describe('lot 1 — l observateur du coffre est REELLEMENT monte', () => {
  it('syncService importe VaultWatcher', () => {
    // Sur le BRUT : `codeOnly` vide les chaines litterales, et un chemin de
    // module en est une. Un import commente passerait donc ici — sans
    // consequence, parce que les tests d USAGE ci-dessous tournent, eux, sur le
    // code nettoye et rougiraient aussitot.
    expect(SERVICE_RAW).toMatch(/import\s*\{[^}]*VaultWatcher[^}]*\}\s*from\s*'\.\/vaultWatcher'/);
  });

  it('le demon en CONSTRUIT un', () => {
    // Sans cette ligne, `vaultWatcher.ts` est du code mort : ses 20 tests
    // resteraient verts et le coffre ne serait surveille par personne.
    expect(SERVICE).toContain('new VaultWatcher(');
  });

  it('et le DEMARRE', () => {
    // Construire sans demarrer est le meme bogue, en plus sournois : l objet
    // existe, le code a l air branche, et aucun evenement n arrive.
    expect(SERVICE).toContain('vaultWatcher.start()');
  });

  it('son evenement declenche bien une synchronisation', () => {
    expect(SERVICE).toMatch(/onSettled:[\s\S]{0,200}triggerSync\(/);
  });

  it('son evenement marque bien le fichier sale', () => {
    expect(SERVICE).toMatch(/onDirty:[\s\S]{0,300}markScanDirty\(/);
  });

  it('il est ARRETE avec le demon', () => {
    // Le laisser tourner ferait marquer sale un profil qui n est plus l actif —
    // exactement le motif que le canal de synchro a deja resolu.
    const stop = sectionAfter(SERVICE, 'function stopDaemon(');
    expect(stop).toContain('vaultWatcher');
    expect(stop).toMatch(/w\.stop\(\)|vaultWatcher\.stop\(\)/);
  });

  it('son echec n est PAS fatal', () => {
    // Un coffre sur un partage reseau, une limite de descripteurs, un pilote
    // recalcitrant : aucun de ces cas ne doit empecher la synchronisation de
    // tourner comme avant.
    const bloc = sectionAfter(SERVICE, 'new VaultWatcher(', 1500);
    expect(bloc).toMatch(/catch\s*\(/);
  });
});

describe('lots 2-3 — le tampon d identite est REELLEMENT consulte', () => {
  it('syncService importe StampRegistry', () => {
    expect(SERVICE_RAW).toMatch(/import\s*\{[^}]*StampRegistry[^}]*\}\s*from\s*'\.\/scanStamp'/);
  });

  it('les QUATRE sites de rehachage passent par le tampon', () => {
    // C est le coeur du constat n 2 : `notes.enc`, `layout.enc` et les deux
    // fichiers de rappels etaient relus integralement 288 fois par jour.
    const appels = SERVICE.match(/stampedChecksum\(/g) ?? [];
    // 1 declaration + 3 sites (les deux fichiers de rappels partagent une boucle).
    expect(appels.length).toBeGreaterThanOrEqual(4);
  });

  it('AUCUN site de balayage ne hache plus directement les blobs de la racine', () => {
    // LA regression a empecher : quelqu un remet un `streamingSha256` direct
    // sur `notesPath` ou `layoutPath` dans le balayage, et les 14 Go de lecture
    // quotidienne reviennent sans que rien ne rougisse.
    const scan = sectionAfter(SERVICE, 'async function scanLocalFiles(', 200000);
    expect(scan).not.toMatch(/const checksum = await streamingSha256\(notesPath\)/);
    expect(scan).not.toMatch(/const checksum = await streamingSha256\(layoutPath\)/);
    expect(scan).not.toMatch(/const checksum = await streamingSha256\(remindersPath\)/);
  });

  it('le tampon est vide a l arret du demon', () => {
    const stop = sectionAfter(SERVICE, 'function stopDaemon(');
    expect(stop).toContain('resetScanStamps()');
  });

  it('le cache ne peut pas INVENTER une empreinte', () => {
    // `stampedChecksum` ne saute le hachage que s il a deja une empreinte
    // connue. Sans elle, il hache, quoi que dise le tampon. Retirer cette
    // garde ferait ecrire une chaine vide dans le manifeste.
    const helper = sectionAfter(SERVICE, 'async function stampedChecksum(', 600);
    expect(helper).toMatch(/if\s*\(\s*known\s*&&/);
  });
});

describe('la bascule v5 — ce qui est branche et ce qui ne l est pas', () => {
  const DELTA = codeOnly(readFileSync(join(__dirname, '..', 'deltaSync.ts'), 'utf8'));
  const DELTA_RAW = readFileSync(join(__dirname, '..', 'deltaSync.ts'), 'utf8');

  it('la LECTURE du v5 est branchee, et sans drapeau', () => {
    // Un lecteur doit savoir lire ce qu un autre appareil a pu ecrire. Gater la
    // lecture rendrait illisibles, au moindre retour en arriere, les fichiers
    // deja ecrits en v5 : le piege classique des drapeaux de format.
    expect(DELTA).toContain('downloadDeltaV5(');
    const bloc = sectionAfter(DELTA, 'let v5Manifest', 1200);
    expect(bloc).toContain('downloadDeltaV5(');
    expect(bloc).not.toContain('isDeltaV5WriteEnabled');
  });

  it('le format est LU dans le manifeste, jamais devine', () => {
    expect(DELTA).toContain('readManifest(');
    expect(DELTA).toContain('MANIFEST_V5');
  });

  it("l ECRITURE du v5 est derriere le drapeau", () => {
    expect(DELTA).toContain('isDeltaV5WriteEnabled()');
    const bloc = sectionAfter(DELTA, 'if (isDeltaV5WriteEnabled())', 900);
    expect(bloc).toContain('uploadDeltaV5(');
  });

  it('le drapeau est ETEINT par defaut', () => {
    const fmt = codeOnly(readFileSync(join(__dirname, '..', 'deltaFormat.ts'), 'utf8'));
    // Une comparaison a une valeur explicite, jamais une coercition : `Boolean(raw)`
    // allumerait le v5 sur `FILARR_DELTA_V5=0`.
    expect(fmt).toMatch(/raw === ''/);
    expect(fmt).not.toMatch(/return\s+Boolean\(/);
  });

  it('le v4 reste le chemin par defaut', () => {
    expect(DELTA).toContain('deserializeManifest(');
    expect(DELTA_RAW).toMatch(/from\s*'\.\/deltaSyncV5'/);
  });
});

describe('lot 26 bis — le rattrapage du ramassage est branche', () => {
  const DELTA = codeOnly(readFileSync(join(__dirname, '..', 'deltaSync.ts'), 'utf8'));

  it('deltaSync sait rejouer un ramassage sans televerser', () => {
    expect(DELTA).toContain('export async function retryGcForFile(');
  });

  it('il refuse de ramasser sur un manifeste absent ou illisible', () => {
    // Envoyer un ensemble vivant VIDE ferait tout supprimer. On abandonne
    // plutot que de deviner.
    const fn = sectionAfter(DELTA, 'export async function retryGcForFile(', 2000);
    expect(fn).toContain('skipped: true');
  });

  it('le cycle APPELLE le balayage, il ne fait pas que le declarer', () => {
    // Piege verifie en sabotant : chercher `sweepPendingGc(` est satisfait par
    // la DECLARATION (`async function sweepPendingGc(`), donc commenter l appel
    // ne faisait pas rougir la garde. On cherche la forme qui ne peut venir
    // que d un site d appel.
    expect(SERVICE).toContain('await sweepPendingGc(');
    expect(SERVICE).toContain('async function sweepPendingGc(');
    expect(SERVICE).toContain('selectForSweep(');
  });

  it('un commit REOUVRE le besoin de ramassage', () => {
    expect(SERVICE).toContain('afterCommit(');
  });

  it('chaque tentative met a jour l etat, succes comme echec', () => {
    expect(SERVICE).toContain('afterAttempt(');
  });

  it('un rattrapage rate ne fait PAS echouer le cycle', () => {
    const fn = sectionAfter(SERVICE, 'async function sweepPendingGc(', 2000);
    expect(fn).toMatch(/catch\s*\(/);
  });
});

describe('lot 93 — l instrumentation est branchee', () => {
  it('le cycle est compte', () => {
    expect(SERVICE).toContain('metrics.cycleStarted()');
  });

  it('le balayage est chronometre', () => {
    // L APPEL se verifie sur le code nettoye — un appel commente ne compte pas.
    // Le LIBELLE de phase, lui, est une chaine litterale que `codeOnly` vide :
    // il se lit donc sur le brut. Les deux ensemble disent « cet appel existe
    // vraiment, et il chronometre bien la bonne phase ».
    expect(SERVICE).toContain('metrics.time(');
    expect(SERVICE_RAW).toMatch(/metrics\.time\('scan'/);
  });

  it('le tampon rend compte de ce qu il evite ET de ce qu il paie', () => {
    // Les deux compteurs ensemble : sans le second, on ne saurait pas si le
    // tampon travaille ou s il ne voit simplement rien.
    expect(SERVICE).toContain('metrics.hashSkipped()');
    expect(SERVICE).toContain('metrics.hashComputed(');
  });

  it('les cycles en erreur sont comptes', () => {
    expect(SERVICE).toContain('metrics.errored()');
  });

  it('les compteurs sont LISIBLES de l exterieur', () => {
    // Une instrumentation qu on ne peut pas lire ne sert a rien.
    expect(SERVICE).toContain('export function getSyncMetrics(');
    expect(SERVICE).toContain('export function formatSyncMetrics(');
  });

  it('elle ne telephone nulle part', () => {
    // Le modele de menace du produit interdit qu une mesure sorte du poste.
    const bloc = sectionAfter(SERVICE, 'const metrics = new SyncMetrics()', 1500);
    expect(bloc).not.toMatch(/fetch\(|authenticatedApiCall\(/);
  });
});

describe('lot 47 — le regroupement n est PAS branche, et c est deliberé', () => {
  it('planBatches n est appele nulle part', () => {
    // Le module est ecrit et teste, mais le brancher REGRESSERAIT : les petits
    // objets partent aujourd hui en direct vers R2 par URL presignee. Les faire
    // transiter par le worker pour les grouper ne reduirait PAS les operations
    // de classe A (le worker ferait toujours N `put`), ajouterait du calcul
    // facture, et defairait la proposition 48 deja livree.
    //
    // Ce test est un REPERE, comme ceux du v5 avant la bascule : le jour ou une
    // route de presignature groupee existera, il tombera et celui qui la branche
    // devra le mettre a jour volontairement.
    expect(SERVICE).not.toContain('planBatches');
    const delta = codeOnly(readFileSync(join(__dirname, '..', 'deltaSync.ts'), 'utf8'));
    expect(delta).not.toContain('planBatches');
  });
});

describe('le trou de correction est REELLEMENT ferme, pas seulement pour les blobs', () => {
  /**
   * J avais surestime le lot 1. L observateur marquait sale sous
   * `dossier/fichier`, alors que le balayage indexe les fichiers ordinaires par
   * `sha256(chemin)` — et surtout il ne consultait PAS le drapeau. Le marquage
   * etait donc inerte exactement la ou le trou se trouvait : les blobs de la
   * racine etaient couverts (leur cle `meta:` coincide), les fichiers
   * ordinaires ne l etaient pas du tout.
   */
  it('UNE seule derivation de fileId, partagee par les deux', () => {
    // Deux copies de la meme derivation, c est deux cles qui divergent, c est
    // un marquage inerte. Le meme piege que les deux classes homonymes.
    expect(SERVICE).toContain('export function scanFileIdOf(');
    // L observateur passe par elle...
    const obs = sectionAfter(SERVICE, 'markScanDirty(', 300);
    expect(obs).toContain('scanFileIdOf(');
    // ...et le balayage aussi.
    const scan = sectionAfter(SERVICE, 'async function scanLocalFiles(', 200000);
    expect(scan).toContain('scanFileIdOf(localPath)');
  });

  it('le raccourci du balayage CONSULTE le drapeau', () => {
    // Sans ce `!isScanDirty(...)`, un fichier deja synchronise est saute sans
    // meme etre `stat`e, quoi que l observateur ait vu.
    const scan = sectionAfter(SERVICE, 'async function scanLocalFiles(', 200000);
    expect(scan).toMatch(/status === ''\s*&&\s*!isScanDirty\(fileId\)/);
  });

  it('le drapeau est LAVE apres examen — via `stampedChecksum`', () => {
    /*
      Sans lavage, un fichier signale une fois serait rehache a chaque cycle
      pour toujours — le correctif se paierait du gaspillage que le lot 2 vient
      de supprimer.

      L APPEL A DEMENAGE, PAS L INVARIANT. Le balayage n appelle plus
      `scanStamps.record` lui-meme : il passe par `stampedChecksum`, qui
      consulte le tampon AVANT de hacher puis enregistre. C est ce qui a
      supprime les 177 secondes de rehachage integral mesurees le 2026-09-07 —
      le raccourci d avant ne sauvait que les entrees `synced`, donc une entree
      bloquee en `pending_upload` etait relue en entier a chaque cycle.

      On verifie donc les DEUX moities : que le balayage passe bien par
      l helper, et que l helper lave bien le drapeau. Verifier l une sans
      l autre laisserait passer la regression qui compte.
    */
    const scan = sectionAfter(SERVICE, 'async function scanLocalFiles(', 200000);
    expect(scan).toContain('stampedChecksum(');
    // Aucun hachage nu ne doit subsister dans le balayage : c est exactement ce
    // qui relisait les gigaoctets.
    expect(scan).not.toContain('streamingSha256(filePath)');
    expect(scan).not.toContain('streamingSha256(metadataPath)');

    const helper = sectionAfter(SERVICE, 'async function stampedChecksum(', 2000);
    expect(helper).toContain('scanStamps.shouldHash(');
    expect(helper).toContain('scanStamps.record(');
  });

  it('la REMONTEE ne rehache pas ce que le balayage vient de hacher', () => {
    // Le balayage a hache le fichier et range l empreinte dans l entree ; la
    // rehacher a la remontee doublait la lecture — dix gigaoctets par cycle au
    // lieu de cinq sur le profil observe.
    const up = sectionAfter(SERVICE, 'async function uploadFile(', 200000);
    expect(up).toContain('stampedChecksum(fileId, filePath, fileStat, entry.checksum)');
  });

  it('le drapeau ne peut que FORCER l examen, jamais l empecher', () => {
    // Corollaire du precedent : la condition doit etre une NEGATION ajoutee au
    // raccourci, pas une condition d entree. Un observateur en panne doit
    // ramener au comportement d avant, jamais a pire.
    const scan = sectionAfter(SERVICE, 'async function scanLocalFiles(', 200000);
    expect(scan).not.toMatch(/if\s*\(\s*isScanDirty\(fileId\)\s*\)\s*\{[\s\S]{0,80}continue/);
  });
});

describe("le pont v1 consulte le verdict — cablage", () => {
  /**
   * Le verdict `legacyNotesVerdict` existait, la regle des trente jours aussi,
   * et le pont v1 ne les consultait pas : il reecrivait et renvoyait 3,5 Mo de
   * `notes.enc` a chaque note modifiee, pour des appareils v1 qui, chez cet
   * utilisateur, n existent plus. Meme motif que tout le reste de ce chantier :
   * la decision existait, personne ne la lisait.
   */
  it("syncService transmet le verdict au cycle des notes", () => {
    const appel = sectionAfter(SERVICE, 'notesCycle.runNotesCycleV2(', 400);
    expect(appel).toContain('legacyVerdict: legacyNotesVerdict(profileId)');
  });

  it("le cycle des notes le consulte avant de reecrire le blob", () => {
    const cycle = codeOnly(readFileSync(join(__dirname, '..', 'notesCycleV2.ts'), 'utf8'));
    const bloc = sectionAfter(cycle, 'const wouldRewrite = shouldWriteBackLegacy(', 1600);
    expect(bloc).toMatch(/verdict === ''/);
    expect(bloc).toContain('else if (wouldRewrite)');
  });

  it("seule la REECRITURE est gatee, jamais la lecture", () => {
    // `reconcileLegacyBlob` (la reinjection v1 -> v2) ne doit dependre d aucun
    // verdict : suspendre la lecture rendrait invisible la note d un appareil v1
    // revenu — la panne d origine.
    const cycle = codeOnly(readFileSync(join(__dirname, '..', 'notesCycleV2.ts'), 'utf8'));
    const lecture = sectionAfter(cycle, 'reconcileLegacyBlob(', 600);
    expect(lecture).not.toContain('legacyVerdict');
    expect(lecture).not.toContain("verdict");
  });
});

describe("le manifeste local porte ce que le nuage porte — cablage du talon 304", () => {
  /**
   * `shouldRepublishManifest` existait et ne se taisait JAMAIS : 68 publications
   * pour 0 « inchange » le 05/09/2026. Le talon 304 est bati sur le manifeste
   * local, qui ne portait ni `notesMergeVersion` ni `profileMeta` — la garde
   * concluait donc « le nuage n a pas notre marqueur » a chaque cycle vide, et
   * chaque publication reveillait les autres appareils par le canal.
   */
  it("les deux champs sont recopies dans le manifeste local AVANT sa sauvegarde", () => {
    const bloc = sectionAfter(SERVICE, 'const republish = manifest.shouldRepublishManifest(', 3000);
    const version = bloc.indexOf('localManifest.notesMergeVersion = cloudManifest.notesMergeVersion');
    const meta = bloc.indexOf('localManifest.profileMeta = cloudManifest.profileMeta');
    const save = bloc.indexOf('await manifest.save(profileId, localManifest)');
    expect(version).toBeGreaterThan(-1);
    expect(meta).toBeGreaterThan(-1);
    expect(save).toBeGreaterThan(-1);
    expect(version).toBeLessThan(save);
    expect(meta).toBeLessThan(save);
  });
});

describe("une sauvegarde de notes v2 n arme pas le blob v1 — cablage", () => {
  /**
   * `notifyMetadataChanged(…, 'notes')` pose `pending_upload` sur `meta:notes`
   * avec une empreinte VIDE : le balayage rehache et remonte, meme quand
   * `notes.enc` n a pas bouge. En v2 le fichier ne bouge que par le pont du
   * cycle des notes, qui arme lui-meme quand il reecrit. Les deux chemins de
   * sauvegarde armaient pourtant a chaque changement du clair : 3,5 Mo
   * renvoyes a l identique par frappe sauvegardee des que le pont differait.
   *
   * Les sections sont decoupees sur la source BRUTE (le nom du canal est une
   * chaine, que `codeOnly` viderait), puis nettoyees : un appel en commentaire
   * ne satisfait pas la garde.
   */
  const MAIN_RAW = readFileSync(join(__dirname, '..', '..', 'main.ts'), 'utf8');

  it("notes:save n arme meta:notes que si le blob v1 a ete reecrit", () => {
    const bloc = codeOnly(sectionAfter(MAIN_RAW, "'notes:save',", 14000));
    expect(bloc).toContain('let wroteLegacyBlob = false');
    expect(bloc).toContain('wroteLegacyBlob = true');
    const notify = bloc.indexOf("notifyMetadataChanged(activeProfileId, '')");
    expect(notify).toBeGreaterThan(-1);
    expect(bloc.slice(0, notify)).toContain('if (wroteLegacyBlob)');
    expect(bloc).toContain('scheduleSync(activeProfileId)');
  });

  it("notes:saveDelta n arme meta:notes que sur le chemin v1", () => {
    const bloc = codeOnly(sectionAfter(MAIN_RAW, "ipcMain.handle('notes:saveDelta'", 14000));
    const notify = bloc.indexOf("notifyMetadataChanged(profileId, '')");
    expect(notify).toBeGreaterThan(-1);
    expect(bloc.slice(0, notify)).toContain('if (outcome.legacy)');
    expect(bloc).toContain('legacy: false');
    expect(bloc).toContain('legacy: true');
    expect(bloc).toContain('scheduleSync(profileId)');
  });

  it("scheduleSync existe, est exporte, et ne touche PAS au manifeste", () => {
    const fn = sectionAfter(SERVICE, 'export function scheduleSync(', 700);
    expect(fn).not.toBe('');
    expect(fn).toContain('triggerSync(profileId)');
    const fin = fn.indexOf('export function notifyMetadataChanged');
    expect(fin).toBeGreaterThan(-1);
    expect(fn.slice(0, fin)).not.toContain('markPendingUpload');
  });
});

describe("les images manquantes au chargement sont redemandees au nuage — cablage", () => {
  /**
   * Le cycle ne descend une image qu avec la note qu il telecharge lui-meme :
   * une note reinjectee depuis la v1 arrive sans les siennes, et rien ne
   * revenait les chercher (8 images « introuvables » le 05/09/2026, toutes
   * presentes dans R2). Le chargement les signale, le service programme un
   * cycle, le cycle les recupere avant tout menage, le rendu est prevenu.
   */
  const MAIN_RAW = readFileSync(join(__dirname, '..', '..', 'main.ts'), 'utf8');

  it("notes:load signale les images manquantes au service", () => {
    const bloc = codeOnly(sectionAfter(MAIN_RAW, "ipcMain.handle('notes:load'", 6000));
    expect(bloc).toContain('reportMissingNoteBlobs(activeProfileId, loaded.missingBlobs)');
  });

  it("le service les memorise pour le cycle ET programme un cycle", () => {
    const fn = sectionAfter(SERVICE, 'export function reportMissingNoteBlobs(', 500);
    expect(fn).toContain('rememberMissingBlobs(profileId, hashes)');
    expect(fn).toContain('scheduleSync(profileId)');
  });

  it("le cycle les recupere AVANT tout menage, et le rendu est prevenu", () => {
    const cycle = codeOnly(readFileSync(join(__dirname, '..', 'notesCycleV2.ts'), 'utf8'));
    const recup = cycle.indexOf('await recoverMissingBlobs(profileId, local, transport)');
    const menage = cycle.indexOf('await findOrphanObjects(io, result.localIndex)');
    expect(recup).toBeGreaterThan(-1);
    expect(menage).toBeGreaterThan(-1);
    expect(recup).toBeLessThan(menage);
    const apresCycle = sectionAfter(SERVICE, 'notesCyclePublished = notesResult.published', 400);
    expect(apresCycle).toContain('notesResult.blobsRecovered > 0');
  });
});

describe("conteneur cle machine v3 — cablage de la lecture et de l ecriture", () => {
  /**
   * Le module pur prouve le format ; ceci prouve qu il est BRANCHE. Une lecture
   * qui ignorerait le marqueur `v3:` rendrait un objet ecrit par un bureau a
   * jour illisible partout ailleurs — et une migration de metadonnees qui
   * comparerait encore au seul `v2:` reecrirait chaque `v3:` en `v2:` a chaque
   * relecture (puis la synchro renverrait le fichier, pour rien).
   */
  const STORAGE = codeOnly(readFileSync(join(__dirname, '..', '..', 'storageService.ts'), 'utf8'));
  const MAIN_RAW = readFileSync(join(__dirname, '..', '..', 'main.ts'), 'utf8');
  const MAIN = codeOnly(MAIN_RAW);
  const VAULT_IO = codeOnly(readFileSync(join(__dirname, '..', 'notesVaultIO.ts'), 'utf8'));

  it("StorageService lit v3 en texte ET en binaire, sans condition de drapeau", () => {
    const texte = sectionAfter(STORAGE, 'async decrypt(encryptedData: string)', 700);
    expect(texte).toContain('startsWith(this.ENCRYPTION_VERSION_3)');
    expect(texte).toContain('openMachineV3Text(this.key, encryptedData)');
    expect(texte).not.toContain('machineWriteVersion');
    const binaire = sectionAfter(STORAGE, 'async decryptBinary(encryptedData: Buffer)', 900);
    expect(binaire).toContain('equals(v3Marker)');
    expect(binaire).toContain('openMachineV3Bytes(this.key, encryptedData)');
    expect(binaire).not.toContain('machineWriteVersion');
  });

  it("les trois ecrivains passent par la version courante ou celle imposee", () => {
    for (const marque of [
      'async encrypt(data: any, opts?: { version?: MachineContainerVersion })',
      'async encryptToFile(',
      'async encryptBinary(data: Buffer, opts?: { version?: MachineContainerVersion })',
    ]) {
      const bloc = sectionAfter(STORAGE, marque, 1200);
      expect(bloc, marque).toContain("opts?.version ?? machineWriteVersion('')");
    }
    expect(sectionAfter(STORAGE, 'async encryptToFile(', 2500)).toContain(
      "marker + salt.toString('') + iv.toString('')"
    );
  });

  it("aucune migration ne compare plus au seul v2 — jamais de retrogradation", () => {
    expect(STORAGE).not.toContain('!encryptedMetadata.startsWith(this.ENCRYPTION_VERSION_2)');
    expect(STORAGE).toContain('machineContainerNeedsRewrite(encryptedMetadata)');
    expect(MAIN).not.toContain('!encryptedContent.slice(0, v2Marker.length).equals(v2Marker)');
    expect(MAIN.split('StorageService.needsMachineRewrite(encryptedContent)').length - 1).toBe(2);
    const inventaire = codeOnly(readFileSync(join(__dirname, '..', '..', 'publish', 'inventoryScan.ts'), 'utf8'));
    expect(inventaire).toContain("head === '' || head === '' || head === ''");
  });

  it("le coffre de notes ecrit selon le perimetre, et notes:load lance la migration sous verrou", () => {
    expect(VAULT_IO).toContain('{ version: vaultWriteVersion(relPath) }');
    const chargement = codeOnly(sectionAfter(MAIN_RAW, "ipcMain.handle('notes:load'", 7000));
    expect(chargement).toContain('withNotesLock(() => notesVault.upgradeContainers(dataDir))');
  });

  it("le web renifle v3 la ou il reniflait v2 et v1", () => {
    const racine = join(__dirname, '..', '..', '..', 'src', 'platform', 'web', 'sync');
    const cycle = readFileSync(join(racine, 'webNotesCycleV2.ts'), 'utf8');
    expect(cycle).toContain("!text.startsWith('v3:') && !text.startsWith('v2:') && !text.startsWith('v1:')");
    const conteneur = readFileSync(join(racine, 'containerCrypto.ts'), 'utf8');
    expect(conteneur).toContain("container.startsWith('v3:')");
    expect(conteneur).toContain("startsWith(bytes, ascii('v3:'))");
    expect(conteneur).toContain("hash: 'SHA-256'");
    expect(conteneur).toContain("'filarr-container-v3'");
  });
});

describe("les interrupteurs d ecriture serveur sont branches sur la sonde de capacites — cablage", () => {
  /**
   * Un drapeau d environnement n atteint jamais une application installee :
   * l allumage de v3 / delta v5 en production passe par `/sync/capabilities`,
   * lu a chaque cycle. Si la sonde ne posait pas les interrupteurs — ou ne les
   * eteignait pas quand elle echoue ou change de profil — le serveur croirait
   * commander un bureau qui n ecoute pas.
   */
  const R2 = codeOnly(readFileSync(join(__dirname, '..', 'syncR2Client.ts'), 'utf8'));

  it("la sonde pose les deux interrupteurs depuis la reponse, et les eteint sur echec", () => {
    const sonde = sectionAfter(R2, 'async function fetchCapabilities(', 1600);
    expect(sonde).toContain('setServerMachineV3Write(!!(res.success && res.data?.machineContainerV3Write))');
    expect(sonde).toContain('setServerDeltaV5Write(!!(res.success && res.data?.deltaV5Write))');
    const echec = sonde.slice(sonde.indexOf('catch'));
    expect(echec).toContain('setServerMachineV3Write(false)');
    expect(echec).toContain('setServerDeltaV5Write(false)');
  });

  it("le changement de profil eteint les interrupteurs jusqu a la prochaine sonde", () => {
    const reset = sectionAfter(R2, 'export function resetDirectCapabilityCache(', 500);
    expect(reset).toContain('setServerMachineV3Write(false)');
    expect(reset).toContain('setServerDeltaV5Write(false)');
  });

  it("les deux drapeaux consultent l interrupteur serveur AVANT l environnement", () => {
    const v3 = codeOnly(readFileSync(join(__dirname, '..', '..', 'machineContainerV3.ts'), 'utf8'));
    const f3 = sectionAfter(v3, 'export function isMachineV3WriteEnabled(', 300);
    expect(f3.indexOf('if (serverMachineV3Write) return true')).toBeGreaterThan(-1);
    expect(f3.indexOf('if (serverMachineV3Write) return true')).toBeLessThan(f3.indexOf('process.env'));
    const v5 = codeOnly(readFileSync(join(__dirname, '..', 'deltaFormat.ts'), 'utf8'));
    const f5 = sectionAfter(v5, 'export function isDeltaV5WriteEnabled(', 300);
    expect(f5.indexOf('if (serverDeltaV5Write) return true')).toBeGreaterThan(-1);
    expect(f5.indexOf('if (serverDeltaV5Write) return true')).toBeLessThan(f5.indexOf('process.env'));
  });
});

describe("le balayage des images ne concurrence pas l ouverture des notes au demarrage — cablage", () => {
  /**
   * Mesure du 06/09/2026 : 12,5 s pour ouvrir 32 notes en prod contre ~3 s en
   * dev — le cycle declenche a l ouverture balayait les images, donc relisait
   * chaque note (PBKDF2), sur les memes quatre fils que `notes:load`.
   */
  it("syncService passe skipBlobSweep pendant la grace de demarrage, et le cycle l honore", () => {
    const appel = sectionAfter(SERVICE, 'notesCycle.runNotesCycleV2(', 900);
    expect(appel).toContain('skipBlobSweep: process.uptime() < NOTES_SWEEP_STARTUP_GRACE_S');
    expect(SERVICE).toContain('const NOTES_SWEEP_STARTUP_GRACE_S = 180');
    const cycle = codeOnly(readFileSync(join(__dirname, '..', 'notesCycleV2.ts'), 'utf8'));
    const condition = sectionAfter(cycle, 'const aBalayer =', 200);
    expect(condition).toContain('!overrides?.skipBlobSweep');
  });
});

describe("les interrupteurs serveur sont lus en debut de cycle, et la migration v3 suit — cablage", () => {
  /**
   * La 3.1.1 ne sondait /sync/capabilities qu au moment d une remontee : un
   * bureau qui ne remontait rien n apprenait jamais qu on l avait allume, et la
   * passe de migration du chargement testait un drapeau encore faux. Le cycle
   * sonde desormais AVANT sa premiere ecriture, et relance la passe sous verrou
   * quand l interrupteur est allume (hors grace de demarrage).
   */
  const R2 = codeOnly(readFileSync(join(__dirname, '..', 'syncR2Client.ts'), 'utf8'));

  it("syncR2Client exporte refreshCapabilities, qui sonde vraiment", () => {
    const fn = sectionAfter(R2, 'export async function refreshCapabilities(', 200);
    expect(fn).toContain('await fetchCapabilities()');
  });

  it("le cycle sonde juste apres avoir vide le cache, avant toute ecriture", () => {
    const debut = sectionAfter(SERVICE, 'r2.setCapabilityScope(activeProfileId);', 300);
    expect(debut).toContain('r2.resetDirectCapabilityCache();');
    expect(debut).toContain('await r2.refreshCapabilities();');
    expect(debut.indexOf('resetDirectCapabilityCache')).toBeLessThan(debut.indexOf('refreshCapabilities'));
  });

  it("apres le cycle des notes, la passe v3 tourne sous verrou si l interrupteur est allume, hors grace", () => {
    const apres = sectionAfter(SERVICE, 'notesCyclePublished = notesResult.published', 1400);
    expect(apres).toContain("isMachineV3WriteEnabled('')");
    expect(apres).toContain('process.uptime() >= NOTES_SWEEP_STARTUP_GRACE_S');
    expect(apres).toContain('withNotesLock(() => upgradeNotesVaultContainers(StorageService.getBaseDir()))');
    expect(apres).toContain('upgradePassInFlight = false');
  });
});
