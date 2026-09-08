/**
 * UNE EMPREINTE PÉRIMÉE NE DOIT PAS BLOQUER UN FICHIER POUR TOUJOURS —
 * ET « JE N'AI PAS PU VÉRIFIER » NE DOIT JAMAIS PASSER POUR « C'EST BON ».
 *
 * ── CE QUI A ÉTÉ OBSERVÉ ────────────────────────────────────────────────────
 *
 * La clé d'objet est déterministe et partagée entre appareils ; la publication
 * du manifeste passe par un compare-and-set. Un appareil qui écrit l'objet puis
 * perd la course du manifeste laisse celui-ci annoncer l'empreinte de l'autre.
 * Le désaccord est alors PERMANENT.
 *
 * Refuser était juste. Ne rien réparer ensuite ne l'était pas : trois
 * tentatives, un recul, puis plus jamais rien. Le 2026-09-07, vingt-cinq
 * fichiers bloqués depuis la veille, dont `meta:layout`, et une centaine
 * d'erreurs répétées dans les journaux.
 *
 * ── LES DEUX FAUTES, ET ELLES NE SE VALENT PAS ──────────────────────────────
 *
 * Refuser un blob sain : un fichier ne descend pas. Visible, réparable.
 * Adopter un blob INVÉRIFIABLE : on écrase un fichier local avec des octets
 * dont personne ne répond. Silencieux, définitif.
 *
 * D'où la règle testée ici : SEUL un déchiffrement RÉUSSI autorise l'adoption.
 * Un échec faute de clé — coffre verrouillé, `safeStorage` muet — n'est pas un
 * demi-succès, c'est un refus.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  verdictBlobDivergent,
  adopteLesOctets,
  isKeyUnavailableError,
} from '../sync/syncService';

describe('le verdict sur un blob divergent', () => {
  it('déchiffrement RÉUSSI → authentique', () => {
    /*
      L'empreinte du manifeste est un PRÉ-CONTRÔLE ; la garantie d'intégrité
      est le chiffrement authentifié. Des octets qui s'ouvrent viennent d'un
      client détenteur de la clé : c'est l'empreinte qui est périmée.
    */
    expect(verdictBlobDivergent(null)).toBe('authentique');
    expect(adopteLesOctets(verdictBlobDivergent(null))).toBe(true);
  });

  it('CLÉ INDISPONIBLE → refus, jamais adoption', () => {
    // LA règle du fichier. On n'a rien vérifié : adopter reviendrait à faire
    // confiance au magasin sans aucun contrôle.
    for (const err of [
      new Error('StorageService not initialized — encryption key not loaded'),
      new Error('safeStorage unavailable'),
      Object.assign(new Error('open failed'), { code: 'EACCES' }),
      Object.assign(new Error('open failed'), { code: 'EPERM' }),
    ]) {
      expect(verdictBlobDivergent(err), err.message).toBe('cle-indisponible');
      expect(adopteLesOctets(verdictBlobDivergent(err))).toBe(false);
    }
  });

  it('CONTENU CORROMPU → refus', () => {
    // Un vrai ciphertext altéré échoue sur le tag GCM, et aucun de ces
    // messages ne cite la clé.
    for (const err of [
      new Error('Unsupported state or unable to authenticate data'),
      new Error('Encrypted data too short'),
      new Error('Invalid IV length'),
      new Error('Fichier corrompu'),
    ]) {
      expect(verdictBlobDivergent(err), err.message).toBe('corrompu');
      expect(adopteLesOctets(verdictBlobDivergent(err))).toBe(false);
    }
  });

  it('s’appuie sur la MÊME distinction que le reste du moteur', () => {
    // `isKeyUnavailableError` était déjà écrite, pour la faute symétrique
    // (prendre un blob local sain pour illisible). Deux distinctions
    // concurrentes finiraient par diverger, et la divergence serait muette.
    const err = new Error('StorageService not initialized — encryption key not loaded');
    expect(isKeyUnavailableError(err)).toBe(true);
    expect(verdictBlobDivergent(err)).toBe('cle-indisponible');
  });
});

describe('LE CHEMIN RÉEL CONSULTE BIEN CE VERDICT', () => {
  /*
    Deux gardes de ce dépôt sont restées vertes pendant que le vrai chemin
    régressait, parce qu'elles exerçaient une décision que plus personne ne
    consultait. Une lecture de source ferme ça — et ici l'enjeu est une
    branche qui décide d'ÉCRASER un fichier.
  */
  const source = (): string =>
    fs.readFileSync(path.join(__dirname, '..', 'sync', 'syncService.ts'), 'utf8');

  it('la garde bufferisée demande un déchiffrement avant d’adopter', () => {
    const s = source();
    const debut = s.indexOf('async function fetchRemoteBlobToTemp(');
    expect(debut).toBeGreaterThan(0);
    const fin = s.indexOf('async function erreurDOuverture(', debut);
    const corps = s.slice(debut, fin > 0 ? fin : undefined);
    // Le déchiffrement passe par `erreurDOuverture`, qui consulte les DEUX
    // décodeurs — voir plus bas. L'appel direct au seul décodeur binaire était
    // le défaut du premier jet.
    expect(corps).toContain('erreurDOuverture(tmpPath)');
    expect(corps).toContain('verdictBlobDivergent(');
    expect(corps).toContain('adopteLesOctets(');
  });

  it('le REFUS efface toujours le temporaire', () => {
    // Un temporaire laissé derrière serait vu par le balayage au tour suivant,
    // ou occuperait la place d'un fichier de plusieurs gigaoctets.
    const s = source();
    const i = s.indexOf('if (!adopteLesOctets(verdict))');
    expect(i).toBeGreaterThan(0);
    const branche = s.slice(i, i + 400);
    expect(branche).toContain('fs.unlink(tmpPath)');
    expect(branche).toContain('throw new Error(');
  });

  it('le chemin PAR PLAGES reste strict — il n’adopte rien', () => {
    /*
      Décision assumée : ce chemin sert les blobs de plusieurs gigaoctets, et
      les rouvrir pour les vérifier coûterait des minutes à CHAQUE tentative.
      Les désaccords observés sont tous sur le chemin bufferisé — métadonnées
      de dossier, mise en page, petits fichiers — parce que ce sont eux que
      deux appareils réécrivent en même temps.
    */
    const s = source();
    const i = s.indexOf('Checksum mismatch on ranged download');
    expect(i).toBeGreaterThan(0);
    const avant = s.slice(Math.max(0, i - 600), i);
    expect(avant).not.toContain('adopteLesOctets(');
  });
});

describe('LE JUGE CONSULTE TOUS LES LECTEURS, PAS UN SEUL', () => {
  /*
    UN MÊME CONTENEUR EXISTE EN DEUX REPRÉSENTATIONS, et chacune a SON décodeur :
    `decryptFileAuto` lit la forme OCTETS, `decrypt` la forme TEXTE — celle de
    `notes.enc`, `layout.enc` et des `metadata.json`. Les deux portent le même
    marqueur `v3:`.

    Mon premier jet ne consultait que le décodeur binaire. Toute entrée `meta:`
    était donc jugée « corrompue » : le refus était le même qu'avant la
    réparation — aucune régression — mais la réparation ne s'appliquait JAMAIS
    aux seules entrées qui en avaient besoin, et le journal accusait une
    corruption inexistante. Observé le 2026-09-08 sur `meta:notes`,
    `meta:layout` et un `meta:<dossier>`, à chaque cycle.
  */
  const source = (): string =>
    fs.readFileSync(path.join(__dirname, '..', 'sync', 'syncService.ts'), 'utf8');

  it('la garde passe par `erreurDOuverture`, pas par un décodeur unique', () => {
    const s = source();
    const debut = s.indexOf('async function fetchRemoteBlobToTemp(');
    const fin = s.indexOf('async function erreurDOuverture(', debut);
    const corps = s.slice(debut, fin > 0 ? fin : undefined);
    expect(corps).toContain('erreurDOuverture(tmpPath)');
    // Plus d'appel direct : c'était lui qui ne connaissait qu'une moitié.
    expect(corps).not.toContain('StorageService.decryptFileAuto(tmpPath)');
  });

  it('`erreurDOuverture` essaie les DEUX formes', () => {
    const s = source();
    const debut = s.indexOf('async function erreurDOuverture(');
    expect(debut).toBeGreaterThan(0);
    const corps = s.slice(debut, s.indexOf('export type VerdictBlob', debut));
    expect(corps).toContain('StorageService.decryptFileAuto(tmpPath)');
    expect(corps).toContain('StorageService.decrypt(');
    // Le marqueur décide : on ne lit pas 500 Mo en texte pour rien.
    expect(corps).toMatch(/\/\^v\[123\]:\//);
  });

  it('l’erreur rendue est celle du PREMIER décodeur — c’est elle qui diagnostique', () => {
    // La seconde tentative ne change pas « clé indisponible » en « corrompu » :
    // seule la première porte le message qui distingue les deux.
    const s = source();
    const debut = s.indexOf('async function erreurDOuverture(');
    const corps = s.slice(debut, s.indexOf('export type VerdictBlob', debut));
    expect(corps).toContain('return binaire;');
  });
});
