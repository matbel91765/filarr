/**
 * trashModel — ce que la corbeille d'un coffre a le droit de dire, et comment
 * son vidage s'arrête (F20).
 *
 * CE QUE CES TESTS GARDENT, ET CE QUE CHAQUE RÈGLE A COÛTÉ :
 *
 *  · LA BOUCLE DE VIDAGE. `POST /trash/empty` détruit une passe de cinquante
 *    éléments et rend `{ purged, remaining }`. `destroyVaultItem` rend `false`
 *    quand R2 refuse DURABLEMENT un objet : la passe suivante retrouve alors
 *    exactement les mêmes lignes et rend encore `purged: 0, remaining: N`. Un
 *    écran qui ne regarde que `remaining` boucle jusqu'au 429 du seau (30
 *    passes/heure) — une roue qui tourne un quart d'heure puis affiche une
 *    erreur de débit, là où il fallait dire « il reste N éléments que le serveur
 *    n'arrive pas à détruire ». D'où la règle de contrat, éprouvée ici :
 *    rappeler tant que `purged > 0 && remaining > 0`, s'ARRÊTER sur
 *    `purged === 0 && remaining > 0`.
 *  · LA DATE DE PROCHAINE PURGE N'EST PAS « AUJOURD'HUI + N JOURS ». Elle se
 *    compte à partir du PLUS ANCIEN élément de la corbeille : un élément
 *    supprimé il y a vingt-neuf jours part demain, pas dans trente. Sans
 *    l'instant du plus ancien, on ne dit RIEN plutôt qu'une date fausse.
 *  · « ON NE SAIT PAS » N'EST PAS « C'EST VIDE ». Les agrégats peuvent n'avoir
 *    jamais été lus (429, panne, rang) : un `0` de repli annoncerait une
 *    corbeille vide à qui s'apprête justement à la vider.
 *  · LE MOT À TAPER. Un geste sans retour se confirme en écrivant un mot ; le
 *    comparer sans raboter ferait refuser une saisie correcte suivie d'une
 *    espace, et l'utilisateur chercherait sa faute de frappe.
 *
 *   npx vitest run src/renderer/components/vaults/settings/__tests__/trashModel.vitest.ts
 */

import { describe, expect, it } from 'vitest';
import en from '../../../../../i18n/locales/en/translation.json';
import fr from '../../../../../i18n/locales/fr/translation.json';
import {
  TRASH_EMPTY_MAX_PASSES,
  emptyTrashOutcome,
  emptyTrashProgressPct,
  emptyTrashStep,
  matchesConfirmWord,
  oldestDeletedAt,
  trashSummary,
} from '../trashModel';

const JOUR = 86_400_000;

// ─────────────────────────────────────────────────────────────────────────────
// Le résumé
// ─────────────────────────────────────────────────────────────────────────────

describe('trashSummary — ce que la carte a le droit d’affirmer', () => {
  it('un compte LU et nul dit « vide » ; un compte JAMAIS lu ne dit rien', () => {
    const lu = trashSummary({
      trashedCount: 0,
      trashedBytes: 0,
      retentionDays: 30,
      oldestDeletedAtMs: null,
      nowMs: 0,
    });
    expect(lu.count).toBe(0);
    expect(lu.empty).toBe(true);

    // Les agrégats n'ont pas été lus (429 sans valeur en main, panne, rang) :
    // `empty` resterait FAUX, parce qu'une ignorance n'est pas un inventaire.
    const inconnu = trashSummary({
      trashedCount: null,
      trashedBytes: null,
      retentionDays: 30,
      oldestDeletedAtMs: null,
      nowMs: 0,
    });
    expect(inconnu.count).toBeNull();
    expect(inconnu.bytes).toBeNull();
    expect(inconnu.empty).toBe(false);
  });

  it('la prochaine purge se compte depuis le PLUS ANCIEN, pas depuis maintenant', () => {
    const now = 100 * JOUR;
    // Supprimé il y a vingt-neuf jours, conservation de trente : il part demain.
    const s = trashSummary({
      trashedCount: 3,
      trashedBytes: 4096,
      retentionDays: 30,
      oldestDeletedAtMs: now - 29 * JOUR,
      nowMs: now,
    });
    expect(s.nextPurge).not.toBeNull();
    expect(s.nextPurge?.at).toBe(now + JOUR);
    expect(s.nextPurge?.due).toBe(false);
  });

  it('une échéance DÉPASSÉE se dit « imminente », pas « dans le passé »', () => {
    const now = 100 * JOUR;
    const s = trashSummary({
      trashedCount: 1,
      trashedBytes: 10,
      retentionDays: 7,
      oldestDeletedAtMs: now - 40 * JOUR,
      nowMs: now,
    });
    // Le balayage passe par lots : l'échéance peut être franchie sans que la
    // ligne ait encore disparu. On le DIT, plutôt que d'afficher une date d'il
    // y a un mois pour une purge qui n'a pas eu lieu.
    expect(s.nextPurge?.due).toBe(true);
  });

  it('sans l’instant du plus ancien, AUCUNE date — jamais « aujourd’hui + N »', () => {
    const s = trashSummary({
      trashedCount: 12,
      trashedBytes: 999,
      retentionDays: 90,
      oldestDeletedAtMs: null,
      nowMs: 0,
    });
    // Les agrégats (`/stats`) ne servent aucun instant de suppression : dater la
    // purge de « maintenant + 90 jours » promettrait trois mois à des éléments
    // qui partent peut-être cette nuit.
    expect(s.nextPurge).toBeNull();
    expect(s.retentionDays).toBe(90);
  });

  it('une corbeille vide n’a pas d’échéance, même avec un plus ancien connu', () => {
    const s = trashSummary({
      trashedCount: 0,
      trashedBytes: 0,
      retentionDays: 30,
      oldestDeletedAtMs: 1_000,
      nowMs: 2_000,
    });
    expect(s.nextPurge).toBeNull();
  });

  /**
   * UNE CONSERVATION NON LUE N'EST PAS TRENTE JOURS.
   *
   * `useVaultSettings` retombe VOLONTAIREMENT sur les défauts quand
   * `GET /:id/settings` échoue (le repli permissif), et le signale par
   * `state === 'unavailable'`. La carte qui recopierait ce défaut annoncerait
   * « détruits 30 jours après leur suppression » — et DATERAIT la purge avec —
   * sur un coffre réglé à sept : une date jusqu'à quatre-vingt-trois jours trop
   * tard, présentée comme un fait, sur la seule carte de la page qui parle de
   * destruction irréversible. C'est le verdict-sur-un-silence que l'en-tête de
   * `trashModel` interdit, et il doit s'arrêter DANS le modèle, pas dans un
   * `if` de rendu qui ne s'éprouve pas.
   */
  it('une conservation NON LUE ne devient pas un défaut, et ne date RIEN', () => {
    const now = 100 * JOUR;
    const s = trashSummary({
      trashedCount: 4,
      trashedBytes: 512,
      retentionDays: null,
      oldestDeletedAtMs: now - 3 * JOUR,
      nowMs: now,
    });
    // Le compte, lui, a bien été lu : l'ignorance de la conservation ne
    // contamine pas ce qu'on sait par ailleurs.
    expect(s.count).toBe(4);
    expect(s.retentionDays).toBeNull();
    // Et surtout AUCUNE échéance : « aujourd'hui + trente » serait une date
    // fausse là où le silence est vrai.
    expect(s.nextPurge).toBeNull();
  });
});

describe('oldestDeletedAt — le plus ancien, sans inventer de date', () => {
  it('rend le MINIMUM des instants lisibles', () => {
    const rows = [
      { updatedAt: new Date(5 * JOUR).toISOString() },
      { updatedAt: new Date(2 * JOUR).toISOString() },
      { updatedAt: new Date(9 * JOUR).toISOString() },
    ];
    expect(oldestDeletedAt(rows)).toBe(2 * JOUR);
  });

  it('une date ILLISIBLE est ignorée, elle ne devient pas « l’époque zéro »', () => {
    // `Date.parse('')` rend NaN, et un NaN glissé dans un `Math.min` empoisonne
    // tout le calcul : la carte annoncerait une purge datée de 1970.
    const rows = [{ updatedAt: 'pas une date' }, { updatedAt: new Date(3 * JOUR).toISOString() }];
    expect(oldestDeletedAt(rows)).toBe(3 * JOUR);
  });

  it('rien de lisible, ou rien du tout ⇒ null', () => {
    expect(oldestDeletedAt([])).toBeNull();
    expect(oldestDeletedAt([{ updatedAt: '' }])).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// La boucle de vidage — la règle de contrat du worker
// ─────────────────────────────────────────────────────────────────────────────

describe('emptyTrashStep — quand rappeler, quand s’arrêter', () => {
  it('il reste des éléments ET la passe en a détruit ⇒ on rappelle', () => {
    expect(emptyTrashStep({ purged: 50, remaining: 120 }, 1)).toBe('again');
  });

  it('plus rien ⇒ terminé', () => {
    expect(emptyTrashStep({ purged: 50, remaining: 0 }, 1)).toBe('done');
    // Une passe qui n'a rien détruit parce qu'il n'y avait rien à détruire :
    // c'est « terminé », pas un échec.
    expect(emptyTrashStep({ purged: 0, remaining: 0 }, 1)).toBe('done');
  });

  it('LA RÈGLE : rien détruit mais il en reste ⇒ ARRÊT, échec partiel', () => {
    // C'est la signature d'un objet que R2 refuse durablement. Rappeler
    // reproduirait la même passe jusqu'au 429 du seau (30/h).
    expect(emptyTrashStep({ purged: 0, remaining: 7 }, 1)).toBe('stalled');
  });

  /**
   * NOTRE BORNE N'EST PAS UNE PANNE DU SERVEUR, et les confondre ACCUSE à tort.
   * `stalled` veut dire « le stockage refuse durablement ces objets-là » ;
   * `capped` veut dire « nous avons arrêté nous-mêmes, le seau horaire est
   * atteint ». Le conseil se ressemble (revenez plus tard), la cause est
   * opposée — et c'est la cause qui décide si l'on doit s'inquiéter pour ses
   * documents ou simplement attendre une heure.
   */
  it('la boucle est BORNÉE par le seau du serveur, pas par la confiance', () => {
    // Trente passes par heure et par coffre : une trente-et-unième ne peut être
    // que refusée. Un serveur qui annoncerait éternellement « j'en ai détruit »
    // ne doit pas faire tourner la roue pour rien.
    expect(emptyTrashStep({ purged: 1, remaining: 1 }, TRASH_EMPTY_MAX_PASSES - 1)).toBe('again');
    expect(emptyTrashStep({ purged: 1, remaining: 1 }, TRASH_EMPTY_MAX_PASSES)).toBe('capped');
  });

  it('la borne atteinte ne masque pas un vidage TERMINÉ', () => {
    // Plus rien à détruire : le seau n'a plus rien à borner, et dire « il reste
    // des éléments » sur une corbeille vide serait un faux négatif.
    expect(emptyTrashStep({ purged: 3, remaining: 0 }, TRASH_EMPTY_MAX_PASSES)).toBe('done');
    // Rien détruit ET il en reste : c'est le stockage qui refuse, pas notre
    // compteur — même à la borne, le verdict reste `stalled`.
    expect(emptyTrashStep({ purged: 0, remaining: 9 }, TRASH_EMPTY_MAX_PASSES)).toBe('stalled');
  });

  it('une réponse ABERRANTE arrête la boucle au lieu de l’emballer', () => {
    // Des nombres négatifs ou non finis ne viennent d'aucun contrat : on ne
    // rappelle pas sur ce qu'on ne comprend pas.
    expect(emptyTrashStep({ purged: Number.NaN, remaining: 5 }, 1)).toBe('stalled');
    expect(emptyTrashStep({ purged: 5, remaining: Number.POSITIVE_INFINITY }, 1)).toBe('stalled');
    expect(emptyTrashStep({ purged: -1, remaining: 5 }, 1)).toBe('stalled');
  });
});

describe('emptyTrashProgressPct — une progression, pas une roue', () => {
  it('la part détruite du total connu au départ', () => {
    expect(emptyTrashProgressPct({ purgedTotal: 0, remaining: 100 })).toBe(0);
    expect(emptyTrashProgressPct({ purgedTotal: 50, remaining: 50 })).toBe(50);
    expect(emptyTrashProgressPct({ purgedTotal: 100, remaining: 0 })).toBe(100);
  });

  it('plus rien des deux côtés ⇒ 100 %, jamais une division par zéro', () => {
    expect(emptyTrashProgressPct({ purgedTotal: 0, remaining: 0 })).toBe(100);
  });
});

describe('emptyTrashOutcome — le verdict final se dit tel qu’il est', () => {
  it('tout est parti ⇒ succès', () => {
    expect(emptyTrashOutcome(120, 0, 'done')).toEqual({
      outcome: 'done',
      purged: 120,
      remaining: 0,
    });
  });

  it('il en reste ⇒ ÉCHEC PARTIEL, avec le nombre restant', () => {
    // « Corbeille vidée » sur une corbeille qui contient encore sept éléments
    // est exactement le mensonge que cette fiche existe pour empêcher.
    expect(emptyTrashOutcome(43, 7, 'stalled')).toEqual({
      outcome: 'partial',
      purged: 43,
      remaining: 7,
    });
  });

  /**
   * NE PAS ACCUSER LE SERVEUR DE NOTRE PROPRE BORNE. Sur une corbeille de plus
   * de mille cinq cents éléments, la boucle s'arrête sur `TRASH_EMPTY_MAX_PASSES`
   * — le serveur détruit très bien, c'est le seau de trente passes par heure qui
   * est atteint. Dire « il en reste N que le serveur n'arrive pas à détruire »
   * enverrait chercher une panne qui n'existe pas, et ferait douter du sort de
   * documents qui vont partir dans l'heure.
   */
  it('la borne de passes rend un TROISIÈME verdict, qui n’accuse personne', () => {
    expect(emptyTrashOutcome(1_500, 200, 'capped')).toEqual({
      outcome: 'capped',
      purged: 1_500,
      remaining: 200,
    });
  });

  it('une corbeille vidée à la borne reste un SUCCÈS', () => {
    // La dernière passe a tout emporté : le seau n'a rien coûté.
    expect(emptyTrashOutcome(1_500, 0, 'capped')).toEqual({
      outcome: 'done',
      purged: 1_500,
      remaining: 0,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Le mot à taper
// ─────────────────────────────────────────────────────────────────────────────

describe('matchesConfirmWord — la saisie qui arme un geste sans retour', () => {
  it('accepte le mot, quels que soient la casse et les espaces autour', () => {
    expect(matchesConfirmWord('SUPPRIMER', 'SUPPRIMER')).toBe(true);
    expect(matchesConfirmWord('  supprimer ', 'SUPPRIMER')).toBe(true);
    expect(matchesConfirmWord('DELETE', 'DELETE')).toBe(true);
  });

  it('refuse autre chose, et refuse le vide', () => {
    expect(matchesConfirmWord('', 'SUPPRIMER')).toBe(false);
    expect(matchesConfirmWord('   ', 'SUPPRIMER')).toBe(false);
    expect(matchesConfirmWord('supprime', 'SUPPRIMER')).toBe(false);
    // Un mot attendu vide n'arme rien : sinon un libellé i18n manquant
    // transformerait la confirmation en simple clic.
    expect(matchesConfirmWord('', '')).toBe(false);
    expect(matchesConfirmWord('x', '')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Les phrases existent dans LES DEUX langues
// ─────────────────────────────────────────────────────────────────────────────

type Tree = Record<string, unknown>;
const at = (tree: Tree, path: string): unknown =>
  path.split('.').reduce<unknown>((n, k) => (n as Tree | undefined)?.[k], tree);

/**
 * Une clé PLURALISÉE n'existe pas sous son nom nu : i18next range `retention`
 * en `retention_one` / `retention_other`. Chercher la seule forme nue ferait
 * échouer la garde sur une phrase parfaitement présente — et, pire, laisserait
 * passer l'inverse le jour où quelqu'un ajouterait un singulier sans pluriel.
 */
const phrase = (tree: Tree, path: string): unknown => {
  const nue = at(tree, path);
  if (typeof nue === 'string') return nue;
  const un = at(tree, `${path}_one`);
  const autre = at(tree, `${path}_other`);
  return typeof un === 'string' && typeof autre === 'string' ? un : undefined;
};

/**
 * TOUTES les formes d'une clé, pluriels compris.
 *
 * Ne regarder que le singulier ne garde RIEN : la casse volontaire qui a remis
 * « 30 jours » dans le seul `hint_other` est passée inaperçue — c'est-à-dire
 * exactement la phrase que l'immense majorité des coffres affiche. Une garde qui
 * ne regarde qu'une variante est une garde qui ne regarde pas.
 */
const phrases = (tree: Tree, path: string): string[] => {
  const out: string[] = [];
  for (const suffixe of ['', '_zero', '_one', '_two', '_few', '_many', '_other']) {
    const v = at(tree, path + suffixe);
    if (typeof v === 'string') out.push(v);
  }
  return out;
};

describe('i18n — aucune de ces phrases ne s’affiche sur un repli', () => {
  const cles = [
    'teamVaults.settings.edit.retention.title',
    'teamVaults.settings.edit.retention.hint',
    'teamVaults.settings.edit.retention.days.label',
    'teamVaults.settings.edit.retention.days.hint',
    'teamVaults.settings.edit.retention.revisions.label',
    'teamVaults.settings.edit.retention.revisions.hint',
    'teamVaults.settings.edit.retention.overPolicy',
    'teamVaults.settings.edit.retention.overPolicyCapped',
    'teamVaults.settings.edit.storage.title',
    'teamVaults.settings.edit.storage.hint',
    'teamVaults.settings.edit.storage.cap.label',
    'teamVaults.settings.edit.storage.cap.hint',
    'teamVaults.settings.edit.storage.cap.placeholder',
    'teamVaults.settings.edit.storage.gauge',
    'teamVaults.settings.edit.storage.noCap',
    'teamVaults.settings.edit.storage.nearLimit',
    'teamVaults.settings.edit.storage.alreadyOver',
    'teamVaults.settings.danger.trash.title',
    'teamVaults.settings.danger.trash.hint',
    'teamVaults.settings.danger.trash.action',
    'teamVaults.settings.danger.trash.summary',
    'teamVaults.settings.danger.trash.unknown',
    'teamVaults.settings.danger.trash.emptyState',
    'teamVaults.settings.danger.trash.retention',
    'teamVaults.settings.danger.trash.retentionUnknown',
    'teamVaults.settings.danger.trash.nextPurge',
    'teamVaults.settings.danger.trash.nextPurgeDue',
    'teamVaults.settings.danger.trash.confirmTitle',
    'teamVaults.settings.danger.trash.confirmBody',
    'teamVaults.settings.danger.trash.confirmWord',
    'teamVaults.settings.danger.trash.confirmLabel',
    'teamVaults.settings.danger.trash.wrongWord',
    'teamVaults.settings.danger.trash.working',
    'teamVaults.settings.danger.trash.workingUnknown',
    'teamVaults.settings.danger.trash.done',
    'teamVaults.settings.danger.trash.partial',
    'teamVaults.settings.danger.trash.capped',
    'teamVaults.settings.danger.trash.stoppedAfter',
    'teamVaults.settings.danger.trash.legalHold',
    'teamVaults.trash.hint',
    'teamVaults.trash.hintNoDuration',
    'teamVaults.selection.deleteConfirmNoDuration',
    'teamVaults.folders.deleteRecursiveConfirmNoDuration',
    'teamVaults.trash.purgeItem',
    'teamVaults.trash.purgeItemTitle',
    'teamVaults.trash.purgeItemConfirm',
    'teamVaults.trash.purgedItem',
    'teamVaults.trash.purgeVault',
    'teamVaults.trash.purgeVaultHint',
    'teamVaults.trash.purgeVaultTitle',
    'teamVaults.trash.purgeVaultConfirm',
    'teamVaults.trash.purgeVaultWord',
    'teamVaults.trash.purgeVaultStarted',
    'teamVaults.trash.purgeVaultDone',
  ];

  it('EN et FR portent chacune des clés, non vides', () => {
    for (const cle of cles) {
      expect(typeof phrase(en as Tree, cle), `en:${cle}`).toBe('string');
      expect(typeof phrase(fr as Tree, cle), `fr:${cle}`).toBe('string');
      expect(String(phrase(en as Tree, cle)).length, `en:${cle}`).toBeGreaterThan(0);
      expect(String(phrase(fr as Tree, cle)).length, `fr:${cle}`).toBeGreaterThan(0);
    }
  });

  /**
   * LA DURÉE DE CONSERVATION EST DEVENUE UN RÉGLAGE, et les phrases qui la
   * promettaient en dur mentaient sur tout coffre réglé autrement que trente
   * jours. « Restaurable 30 jours » sur un coffre réglé à sept, c'est faire
   * compter sur une récupération déjà expirée — et l'on ne s'en aperçoit qu'en
   * venant chercher ce qui n'est plus là.
   */
  it('aucune promesse de récupération ne cite une durée EN DUR', () => {
    const promesses = [
      'teamVaults.trash.hint',
      'teamVaults.selection.deleteConfirm',
      'teamVaults.folders.deleteRecursiveConfirm',
    ];
    for (const cle of promesses) {
      for (const [nom, tree] of [
        ['en', en],
        ['fr', fr],
      ] as const) {
        const formes = phrases(tree as Tree, cle);
        // Au moins une forme : une clé absente ne doit pas passer pour propre.
        expect(formes.length, `${nom}:${cle}`).toBeGreaterThan(0);
        for (const texte of formes) {
          expect(texte, `${nom}:${cle}`).not.toMatch(/\b30\b/);
          expect(texte, `${nom}:${cle}`).toMatch(/\{\{(count|days)\}\}/);
        }
      }
    }
  });

  /**
   * QUAND LA DURÉE N'A PAS ÉTÉ LUE, ON N'EN CITE AUCUNE.
   *
   * `useVaultSettings` retombe sur les défauts en cas de panne de lecture ; la
   * durée affichée serait alors PLAUSIBLE ET FAUSSE. La sortie n'est pas de
   * deviner mieux, c'est de ne rien promettre : ces variantes disent où va
   * l'élément sans dire combien de temps il y reste. Une variante qui
   * reglisserait un nombre annulerait tout l'exercice.
   */
  it('les variantes « durée inconnue » ne citent AUCUNE durée', () => {
    const muettes = [
      'teamVaults.trash.hintNoDuration',
      'teamVaults.selection.deleteConfirmNoDuration',
      'teamVaults.folders.deleteRecursiveConfirmNoDuration',
      'teamVaults.settings.danger.trash.retentionUnknown',
    ];
    for (const cle of muettes) {
      for (const [nom, tree] of [
        ['en', en],
        ['fr', fr],
      ] as const) {
        const formes = phrases(tree as Tree, cle);
        expect(formes.length, `${nom}:${cle}`).toBeGreaterThan(0);
        for (const texte of formes) {
          // Ni le jeton de durée…
          expect(texte, `${nom}:${cle}`).not.toMatch(/\{\{days\}\}/);
          // …ni un nombre de jours écrit en clair.
          expect(texte, `${nom}:${cle}`).not.toMatch(/\d+\s*(jour|day)/i);
        }
      }
    }
  });

  /**
   * LA BORNE DE PASSES N'ACCUSE PAS LE SERVEUR. `partial` dit « le serveur
   * n'arrive pas à les détruire » — sur un arrêt dû à notre propre seau horaire,
   * c'est une accusation fausse qui envoie chercher une panne inexistante. Les
   * deux phrases doivent donc EXISTER séparément, et celle du seau doit nommer
   * l'heure : c'est la seule information qui rend le conseil actionnable.
   */
  it('le verdict « seau atteint » a sa propre phrase, et elle parle d’heure', () => {
    const partiel = String(phrase(fr as Tree, 'teamVaults.settings.danger.trash.partial'));
    const seau = String(phrase(fr as Tree, 'teamVaults.settings.danger.trash.capped'));
    expect(seau).not.toBe(partiel);
    expect(seau.toLowerCase()).toContain('heure');
    expect(
      String(phrase(en as Tree, 'teamVaults.settings.danger.trash.capped')).toLowerCase()
    ).toContain('hour');
  });

  /**
   * LE REFUS DE QUOTA DU COFFRE NE DOIT PAS PARLER DE L'ESPACE.
   *
   * `pooled_quota_exceeded` et `vault_quota_exceeded` sont DEUX refus, et ils
   * appellent des gestes opposés : le premier se lève en achetant des sièges ou
   * en faisant du ménage ailleurs, le second en relevant un curseur dans les
   * réglages DE CE COFFRE. Dire « votre espace est plein » au second envoie
   * payer pour un interrupteur.
   */
  it('les deux plafonds ne se disent pas avec les mêmes mots', () => {
    const espace = String(at(fr as Tree, 'teamVaults.errors.storageFull'));
    const coffre = String(at(fr as Tree, 'teamVaults.errors.vaultStorageCap'));
    expect(coffre).not.toBe(espace);
    expect(coffre.toLowerCase()).toContain('coffre');
    expect(espace.toLowerCase()).toContain('espace');
    expect(String(at(en as Tree, 'teamVaults.errors.vaultStorageCap')).toLowerCase()).toContain(
      'vault'
    );
    // Le contrôle AMONT de l'explorateur mesure le POOL de l'espace, pas le
    // plafond du coffre : sa phrase disait pourtant « dans ce coffre », ce qui
    // envoyait relever un curseur qui n'y était pour rien.
    const amont = String(at(fr as Tree, 'teamVaults.items.quotaFull')).toLowerCase();
    expect(amont).toContain('espace');
    expect(amont).not.toContain('coffre');
  });

  /**
   * `purge_failed` (503) dit l'INVERSE du repli de l'appelant : rien n'a été
   * détruit, l'élément est toujours là, et il faut réessayer. Un « impossible de
   * supprimer » laisserait croire à une destruction à moitié faite.
   */
  it('un 503 de purge dit que l’élément est TOUJOURS là', () => {
    expect(String(at(fr as Tree, 'teamVaults.errors.purgeFailed')).toLowerCase()).toContain(
      'corbeille'
    );
    expect(String(at(en as Tree, 'teamVaults.errors.purgeFailed')).toLowerCase()).toContain(
      'trash'
    );
  });
});
