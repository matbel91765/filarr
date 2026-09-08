/**
 * mySecurityModel — la carte « Vous » (F15) : mon numéro de sécurité, ce que le
 * serveur en dit, et ce que cet appareil sait encore ouvrir.
 *
 * POURQUOI CES VERDICTS SONT UN MODÈLE PUR ET PAS TROIS `if` DANS UN RENDU.
 * La vérification hors bande est SYMÉTRIQUE : l'hôte compare l'empreinte de son
 * invité (cérémonie existante, `KeyVerification`), et l'invité doit pouvoir lire
 * la sienne à voix haute pour que la comparaison ait un sens. Le numéro affiché
 * ici est donc celui qu'un tiers va vérifier au téléphone : s'il vient du
 * serveur sans qu'on ait regardé s'il correspond à la clé de cet appareil, la
 * cérémonie valide le courtier au lieu de la personne.
 *
 * CE QUE CES TESTS GARDENT :
 *
 *  · « LE SERVEUR NE SERT PAS MA CLÉ » EST LE PIRE CAS, ET IL N'EXISTAIT NULLE
 *    PART. Aucun écran ne comparait la clé publiée à celle qu'on détient : une
 *    substitution côté serveur ne se voyait que chez le PAIR (qui verrait
 *    « changed » sans savoir pourquoi), jamais chez la victime.
 *  · UNE ABSENCE N'EST JAMAIS RASSURANTE. Journal illisible, clé publiée
 *    introuvable, paire pas chargée : trois états distincts, aucun ne doit
 *    retomber sur « tout va bien ».
 *  · SCELLÉ ≠ OUVERT. Une époque pour laquelle le serveur me garde un wrap est
 *    ouvrable ; une époque dont je n'ai AUCUN wrap ne l'est pas, et les
 *    éléments qui en dépendent resteront illisibles pour moi. Confondre les
 *    deux ferait dire à l'écran « tout est lisible » à quelqu'un qui a manqué
 *    une rotation.
 *  · LA CUSTODY : « pas configurée » et « je n'ai pas su lire » ne se disent pas
 *    pareil, et la seconde ne s'affiche pas du tout.
 *
 *   npx vitest run src/renderer/components/vaults/settings/__tests__/mySecurityModel.vitest.ts
 */

import { describe, expect, it } from 'vitest';
import {
  MAX_EPOCH_ROWS,
  MISSING_EPOCHS_SHOWN,
  custodyState,
  epochCoverage,
  fingerprintToShow,
  myKeyVerdict,
  summarizeMissingEpochs,
} from '../mySecurityModel';

const SERVI = { encPublicKey: 'ENC-A', fingerprint: 'aaaa1111' };
const AUTRE = { encPublicKey: 'ENC-B', fingerprint: 'bbbb2222' };

const chaine = (latest: { encPublicKey: string; fingerprint: string } | null, valid = true) => ({
  valid,
  latest,
});

describe('myKeyVerdict — ce que le serveur dit de MA clé', () => {
  it('ok : la clé servie est la mienne, et c’est la dernière du journal', () => {
    expect(
      myKeyVerdict({
        localFingerprint: SERVI.fingerprint,
        served: SERVI,
        chain: chaine(SERVI),
      })
    ).toBe('ok');
  });

  it('not_mine : le serveur publie une AUTRE clé que celle de cet appareil', () => {
    expect(
      myKeyVerdict({
        localFingerprint: SERVI.fingerprint,
        served: AUTRE,
        chain: chaine(AUTRE),
      })
    ).toBe('not_mine');
  });

  it('tampered_log passe avant tout le reste : une chaîne qui ne se recalcule pas', () => {
    expect(
      myKeyVerdict({
        localFingerprint: SERVI.fingerprint,
        served: AUTRE,
        chain: chaine(null, false),
      })
    ).toBe('tampered_log');
  });

  it('served_not_latest : la clé publiée n’est pas la dernière entrée du journal', () => {
    expect(
      myKeyVerdict({
        localFingerprint: SERVI.fingerprint,
        served: SERVI,
        chain: chaine(AUTRE),
      })
    ).toBe('served_not_latest');
  });

  it('no_log : un compte d’avant la transparence — dit, jamais confondu avec « ok »', () => {
    expect(
      myKeyVerdict({ localFingerprint: SERVI.fingerprint, served: SERVI, chain: chaine(null) })
    ).toBe('no_log');
  });

  it('no_local_key : rien à comparer sur cet appareil (coffre verrouillé, session neuve)', () => {
    expect(myKeyVerdict({ localFingerprint: null, served: SERVI, chain: chaine(SERVI) })).toBe(
      'no_local_key'
    );
  });

  it('unavailable : on n’a pas su lire — une panne ne vaut PAS un verdict rassurant', () => {
    expect(
      myKeyVerdict({ localFingerprint: SERVI.fingerprint, served: null, chain: chaine(SERVI) })
    ).toBe('unavailable');
    expect(myKeyVerdict({ localFingerprint: SERVI.fingerprint, served: SERVI, chain: null })).toBe(
      'unavailable'
    );
  });
});

describe('fingerprintToShow — on lit à voix haute la clé de CET appareil', () => {
  it('préfère l’empreinte locale : c’est elle que la cérémonie vérifie', () => {
    expect(fingerprintToShow({ localFingerprint: 'aaaa', served: SERVI })).toEqual({
      value: 'aaaa',
      source: 'local',
    });
  });

  it('retombe sur celle du serveur, en DISANT d’où elle vient', () => {
    expect(fingerprintToShow({ localFingerprint: null, served: SERVI })).toEqual({
      value: SERVI.fingerprint,
      source: 'served',
    });
  });

  it('rien à montrer quand ni l’un ni l’autre n’a répondu', () => {
    expect(fingerprintToShow({ localFingerprint: null, served: null })).toBeNull();
  });
});

describe('epochCoverage — scellé, ouvert, ou manquant', () => {
  it('marque « ouvert » les seules époques déjà déverrouillées dans cette session', () => {
    const c = epochCoverage({
      wraps: [1, 2],
      currentKeyEpoch: 2,
      unlocked: (e) => e === 2,
    });
    expect(c.rows).toEqual([
      { epoch: 1, sealed: true, unlocked: false },
      { epoch: 2, sealed: true, unlocked: true },
    ]);
    expect(c.sealedCount).toBe(2);
    expect(c.unlockedCount).toBe(1);
    expect(c.missing).toEqual([]);
  });

  it('nomme les époques dont je n’ai AUCUN scellé — leurs éléments me resteront fermés', () => {
    const c = epochCoverage({ wraps: [3], currentKeyEpoch: 3, unlocked: () => false });
    expect(c.missing).toEqual([1, 2]);
    expect(c.rows.map((r) => r.sealed)).toEqual([false, false, true]);
  });

  it('l’époque courante manquante est dite aussi : c’est l’état « on ne m’a pas rescellé »', () => {
    const c = epochCoverage({ wraps: [1], currentKeyEpoch: 2, unlocked: () => false });
    expect(c.missing).toEqual([2]);
    expect(c.hasCurrent).toBe(false);
  });

  it('un wrap au-delà de l’époque annoncée n’est pas jeté (résumé en retard sur le serveur)', () => {
    const c = epochCoverage({ wraps: [1, 2], currentKeyEpoch: 1, unlocked: () => false });
    expect(c.rows.map((r) => r.epoch)).toEqual([1, 2]);
  });

  it('aucun wrap : aucune ligne inventée', () => {
    const c = epochCoverage({ wraps: [], currentKeyEpoch: 0, unlocked: () => false });
    expect(c.rows).toEqual([]);
    expect(c.sealedCount).toBe(0);
  });
});

/**
 * LE MÊME ENTIER HOSTILE QUE LA FRISE, PAR L'AUTRE PORTE. `epochCoverage` est
 * appelée par la carte « Vous » ET par la section « Clé du coffre » avec le même
 * `currentKeyEpoch` recopié du DTO : borner la frise sans borner celle-ci
 * laissait le gel du renderer accessible par la carte. Les COMPTES, eux, restent
 * exacts — ils se calculent, ils ne s'énumèrent pas.
 */
describe('epochCoverage est bornée, et ses comptes restent exacts', () => {
  it('un entier hostile ne fabrique pas un milliard de lignes', () => {
    const debut = Date.now();
    // L'entier vient ici de l'ANNONCE du coffre (`currentKeyEpoch`) : c'est le
    // nombre que le coffre donne de lui-même, et l'écran le reprend. Un scellé
    // qui, LUI, dépasserait l'annonce a sa propre règle, plus bas.
    const c = epochCoverage({ wraps: [1e9], currentKeyEpoch: 1e9, unlocked: () => false });
    expect(c.rows).toHaveLength(MAX_EPOCH_ROWS);
    expect(c.rows[c.rows.length - 1].epoch).toBe(1e9);
    expect(c.truncatedBefore).toBe(1e9 - MAX_EPOCH_ROWS);
    // Le compte NE MENT PAS : le coffre annonce un milliard d'époques et je
    // n'en détiens qu'une. Ce sont ces deux nombres que la phrase affiche.
    expect(c.totalEpochs).toBe(1e9);
    expect(c.sealedCount).toBe(1);
    expect(c.missingCount).toBe(1e9 - 1);
    expect(Date.now() - debut).toBeLessThan(1000);
  });

  it('sous la borne, rien ne change : la liste est entière et le reste nul', () => {
    const c = epochCoverage({ wraps: [3], currentKeyEpoch: 3, unlocked: () => false });
    expect(c.rows.map((r) => r.epoch)).toEqual([1, 2, 3]);
    expect(c.truncatedBefore).toBe(0);
    expect(c.totalEpochs).toBe(3);
    expect(c.missing).toEqual([1, 2]);
    expect(c.missingCount).toBe(2);
  });

  it('un scellé HORS de la fenêtre compte quand même comme détenu', () => {
    // Il est réel : le taire ferait dire « aucune époque scellée » à quelqu'un
    // qui en détient une.
    const c = epochCoverage({ wraps: [1, 1e9], currentKeyEpoch: 1e9, unlocked: () => true });
    expect(c.sealedCount).toBe(2);
    expect(c.unlockedCount).toBe(2);
  });

  it('le reste ÉLIDÉ est compté par la phrase, pas perdu', () => {
    const c = epochCoverage({ wraps: [], currentKeyEpoch: 1e6, unlocked: () => false });
    const resume = summarizeMissingEpochs(c.missing, MISSING_EPOCHS_SHOWN, c.missingCount);
    expect(resume.shown).toHaveLength(MISSING_EPOCHS_SHOWN);
    expect(resume.shown.length + resume.rest).toBe(1e6);
  });
});

/**
 * LE TABLEAU DE `/key-wraps` EST LUI AUSSI UNE ENTRÉE HOSTILE, ET DE DEUX
 * FAÇONS. La route n'est ni bornée ni paginée côté worker : elle sert une ligne
 * par époque, autant qu'il y en a.
 *
 *  · SA TAILLE. `Math.max(annonce, ...scelles)` étale ce tableau en ARGUMENTS ;
 *    au-delà d'environ cent mille, le moteur lève `RangeError: Maximum call
 *    stack size exceeded`. Le calcul vit dans un `useMemo`, donc pendant le
 *    rendu : pas une ligne fausse, un écran blanc. Une boucle ne touche pas la
 *    pile. Le tour précédent avait fermé la boucle pilotée par un ENTIER du
 *    courtier ; l'étalement de son TABLEAU restait ouvert.
 *  · SES VALEURS. Un seul scellé d'époque aberrante entraînait le PLAFOND avec
 *    lui : « 1 scellé sur 1 000 000 000 » et « 999 999 999 époques manquantes »
 *    sur un coffre qui n'a jamais tourné. Un scellé en avance d'une rotation
 *    reste légitime (le résumé en mémoire peut être en retard) ; à deux cents
 *    rotations d'avance, ce n'est plus une clé, c'est un nombre.
 */
describe('epochCoverage ne se laisse ni étaler ni entraîner par le tableau du serveur', () => {
  it('deux cent mille scellés ne font pas exploser la pile', () => {
    const wraps = Array.from({ length: 200_000 }, (_, i) => i + 1);
    const c = epochCoverage({ wraps, currentKeyEpoch: 200_000, unlocked: () => false });
    expect(c.totalEpochs).toBe(200_000);
    expect(c.sealedCount).toBe(200_000);
    expect(c.rows).toHaveLength(MAX_EPOCH_ROWS);
  });

  it('un scellé d’époque aberrante n’entraîne pas le plafond avec lui', () => {
    const c = epochCoverage({ wraps: [1, 1e9], currentKeyEpoch: 1, unlocked: () => false });
    expect(c.totalEpochs).toBe(1);
    expect(c.rows.map((r) => r.epoch)).toEqual([1]);
    // Il n'est pas compté non plus : le porter au crédit de quelqu'un ferait
    // dire « 1 scellé sur 1, rien ne manque » à qui ne détient rien d'utile.
    expect(c.sealedCount).toBe(1);
    expect(c.missingCount).toBe(0);
  });

  it('un scellé d’UNE rotation d’avance reste légitime', () => {
    const c = epochCoverage({ wraps: [1, 2, 3], currentKeyEpoch: 2, unlocked: () => false });
    expect(c.totalEpochs).toBe(3);
    expect(c.sealedCount).toBe(3);
    expect(c.hasCurrent).toBe(true);
  });
});

/**
 * UNE LIGNE QUI NE SE LIT PLUS N'INFORME PLUS. Un coffre à deux cents rotations
 * dont cet appareil n'a que le dernier scellé affichait deux cents nombres à la
 * suite — la phrase qui les porte (« les éléments chiffrés avec elles vous
 * restent fermés ») disparaissait au bout d'un paragraphe de chiffres. Le
 * COMPTE reste exact, il est déjà dit par la phrase ; seule l'énumération est
 * bornée, et le reste est annoncé plutôt que tu.
 */
describe('summarizeMissingEpochs — une énumération bornée, un compte intact', () => {
  it('en dessous de la borne, tout est nommé et rien n’est annoncé en plus', () => {
    expect(summarizeMissingEpochs([1, 2, 3])).toEqual({ shown: [1, 2, 3], rest: 0 });
  });

  it('à la borne exacte, rien n’est encore élidé', () => {
    const pile = Array.from({ length: MISSING_EPOCHS_SHOWN }, (_, i) => i + 1);
    expect(summarizeMissingEpochs(pile)).toEqual({ shown: pile, rest: 0 });
  });

  it('au-delà : les premières nommées, le reste COMPTÉ (jamais perdu)', () => {
    const pile = Array.from({ length: 200 }, (_, i) => i + 1);
    const r = summarizeMissingEpochs(pile);
    expect(r.shown).toEqual(pile.slice(0, MISSING_EPOCHS_SHOWN));
    expect(r.rest).toBe(200 - MISSING_EPOCHS_SHOWN);
    expect(r.shown.length + r.rest).toBe(pile.length);
  });

  it('n’altère pas la liste d’origine', () => {
    const pile = [9, 8, 7];
    summarizeMissingEpochs(pile, 1);
    expect(pile).toEqual([9, 8, 7]);
  });
});

describe('custodyState — configurée, absente, ou tue', () => {
  it('configurée quand une clé publique est revenue', () => {
    expect(custodyState({ success: true, data: 'PUB' })).toBe('configured');
  });

  it('absente quand le serveur répond explicitement « rien »', () => {
    expect(custodyState({ success: true, data: null })).toBe('absent');
    expect(custodyState({ success: true, data: '' })).toBe('absent');
  });

  it('inconnue sur un échec, une réponse vide, ou un canal absent — et alors on n’affiche rien', () => {
    expect(custodyState({ success: false })).toBe('unknown');
    expect(custodyState(null)).toBe('unknown');
    expect(custodyState(undefined)).toBe('unknown');
  });
});
