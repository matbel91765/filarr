/**
 * CE QUE LE PANNEAU DIT DE L'ENREGISTREMENT — et pourquoi il ne peut pas mentir.
 *
 *   npx vitest run src/renderer/components/vaults/__tests__/vaultPaneSaveState.vitest.ts
 *
 * ══ LE DÉFAUT GARDÉ ICI ═════════════════════════════════════════════════════
 *
 * Une note de coffre ouverte dans l'onglet Notes a perdu son pied de fenêtre —
 * ce pied portait « Enregistrer dans le coffre », et il était, dans plusieurs
 * situations parfaitement ordinaires (relais injoignable, salle jamais
 * stabilisée, conflit ouvert), la SEULE chose qui écrivait. Le remplacer par un
 * habillage de note personnelle, où l'enregistrement va de soi, c'était
 * transformer un défaut d'affichage en perte de texte.
 *
 * Deux mensonges sont donc interdits, et ce sont les deux invariants ci-dessous :
 *   · dire « enregistré » sur un document qui ne l'est pas ;
 *   · laisser quelqu'un avec du travail en attente et rien pour l'enregistrer.
 *
 * ══ POURQUOI CES TESTS-LÀ ET PAS UN TEST DE RENDU ═══════════════════════════
 *
 * Un test de rendu vérifierait qu'un mot s'affiche ; il ne dirait rien de sa
 * VÉRITÉ. Ce qu'on garde ici, c'est la correspondance entre l'état réel de
 * l'écriture différée — dont l'autorité est `shouldWriteBackVaultNote`, appelée
 * et non recopiée — et ce que le panneau annonce.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  vaultPaneSaveState,
  vaultPaneAutoSaveCovers,
  vaultPaneSaveIsPending,
  vaultPaneSaveRelief,
  vaultPaneOffersSave,
  vaultPaneSaveEnabled,
  vaultPaneSaveLabel,
  vaultPaneWarnsDraftIsNowhere,
  VAULT_PANE_SAVE_STATES,
  VAULT_PANE_CONFLICTS,
  type VaultPaneSaveState,
  type VaultPaneSaveStateInput,
  type VaultPaneSaveRelief,
  type VaultAutoSaveCapability,
} from '../vaultPaneSaveState';
import { shouldWriteBackVaultNote } from '../vaultNoteCollab';

/** Un document propre, écrivable, sans salle : le point de départ le plus neutre. */
const base: VaultPaneSaveStateInput = {
  mayWrite: true,
  serverReadOnly: false,
  conflict: 'none',
  saving: false,
  dirty: false,
  autoSaveCovers: false,
  offlineRetryArmed: false,
};

const etat = (patch: Partial<VaultPaneSaveStateInput>) => vaultPaneSaveState({ ...base, ...patch });

// ─────────────────────────────────────────────────────────────────────────────

describe('les deux invariants — on ne ment ni sur l’enregistrement, ni sur l’issue', () => {
  it('« enregistré » n’est JAMAIS rendu sur un document sale', () => {
    /**
     * Le balayage est exhaustif sur les CINQ booléens ET les trois formes de
     * conflit : 96 combinaisons, et pas une seule ne doit rendre `'saved'` avec
     * `dirty`. C'est LE test du fichier
     * — un badge vert affiché à tort ne se voit ni à la compilation, ni à
     * l'écran, mais une seule fois, chez quelqu'un qui a fermé son panneau en
     * confiance.
     */
    const bool = [false, true];
    let vus = 0;
    for (const mayWrite of bool)
      for (const serverReadOnly of bool)
        for (const conflict of VAULT_PANE_CONFLICTS)
          for (const saving of bool)
            for (const autoSaveCovers of bool)
              for (const offlineRetryArmed of bool) {
                vus++;
                const sale = vaultPaneSaveState({
                  mayWrite,
                  serverReadOnly,
                  conflict,
                  saving,
                  autoSaveCovers,
                  offlineRetryArmed,
                  dirty: true,
                });
                expect(sale).not.toBe('saved');
                // …et le corollaire : un document sale est TOUJOURS déclaré en attente.
                expect(vaultPaneSaveIsPending(sale)).toBe(true);
              }
    expect(vus).toBe(96);
  });

  it('tout état en attente NOMME son secours — aucun cul-de-sac', () => {
    for (const s of VAULT_PANE_SAVE_STATES) {
      const secours = vaultPaneSaveRelief(s);
      if (vaultPaneSaveIsPending(s)) {
        // Un travail en attente sans secours nommé, ce serait exactement le
        // défaut d'origine : du texte qu'on croit posé et que rien n'écrit.
        expect(secours).not.toBe('none-needed');
      } else {
        expect(secours).toBe('none-needed');
      }
    }
  });

  it('le secours annoncé EST celui que l’habillage propose', () => {
    // La correspondance secours → bouton est la seule chose que le composant
    // lit : si elle se désaccorde, le badge dirait « cliquez » sans bouton, ou
    // l'inverse.
    for (const s of VAULT_PANE_SAVE_STATES) {
      const secours = vaultPaneSaveRelief(s);
      expect(vaultPaneOffersSave(s)).toBe(secours === 'button' || secours === 'in-flight');
      expect(vaultPaneSaveEnabled(s)).toBe(secours === 'button');
    }
  });

  it('chaque état a une phrase et une teinte — aucun silence', () => {
    const cles = new Set<string>();
    for (const s of VAULT_PANE_SAVE_STATES) {
      const { key, tone } = vaultPaneSaveLabel(s);
      expect(key).toMatch(/^state[A-Z]/);
      cles.add(key);
      expect(['synced', 'saving', 'pending', 'error', 'idle']).toContain(tone);
    }
    // Deux états qui partageraient une phrase seraient indiscernables à l'écran.
    expect(cles.size).toBe(VAULT_PANE_SAVE_STATES.length);
  });

  it('la teinte VERTE est réservée à « c’est dans le coffre »', () => {
    // Un lecteur (`read-only`) ne doit pas récolter la pastille verte : elle
    // répondrait « enregistré » à une question qu'il n'a pas posée.
    for (const s of VAULT_PANE_SAVE_STATES) {
      if (vaultPaneSaveLabel(s).tone === 'synced') expect(s).toBe('saved');
    }
  });

  it('CHAQUE ÉTAT DIT SA PHRASE, ET C’EST LA SIENNE', () => {
    /**
     * POURQUOI UNE TABLE NOMMÉE, ET PAS SEULEMENT DES PROPRIÉTÉS.
     *
     * Les contrôles ci-dessus (clés distinctes, teintes connues, secours non
     * vide) sont tous invariants par PERMUTATION : échanger les phrases de
     * `unsaved-auto` et `unsaved-manual` les laisse tous verts — et le panneau
     * dirait alors « enregistrement pris en charge » à qui doit cliquer, et
     * « rien ne les enregistrera tout seul » à qui n'a rien à faire. C'est
     * exactement le mensonge que ce module existe pour fermer, et aucune
     * propriété générale ne peut l'attraper : seul le nom le peut.
     *
     * La teinte est du même bois. `unsaved-manual` est le seul état qui réclame
     * un geste ; le passer en `idle` (« je ne peux rien écrire ici », grisé et
     * atténué) rendrait la seule demande d'action de l'écran indistincte du
     * repos.
     */
    const attendu: Record<
      VaultPaneSaveState,
      { key: string; tone: string; secours: VaultPaneSaveRelief }
    > = {
      saved: { key: 'stateSaved', tone: 'synced', secours: 'none-needed' },
      saving: { key: 'stateSaving', tone: 'saving', secours: 'in-flight' },
      'read-only': { key: 'stateReadOnly', tone: 'idle', secours: 'none-needed' },
      'blocked-unsaved': { key: 'stateBlocked', tone: 'error', secours: 'cannot-write' },
      conflict: { key: 'stateConflict', tone: 'error', secours: 'conflict-panel' },
      'conflict-gone': { key: 'stateConflictGone', tone: 'error', secours: 'cannot-write' },
      'offline-pending': { key: 'stateOffline', tone: 'pending', secours: 'retry' },
      'unsaved-auto': { key: 'stateUnsavedAuto', tone: 'saving', secours: 'automatic' },
      'unsaved-manual': { key: 'stateUnsavedManual', tone: 'pending', secours: 'button' },
    };
    for (const s of VAULT_PANE_SAVE_STATES) {
      const { key, tone } = vaultPaneSaveLabel(s);
      expect({ key, tone, secours: vaultPaneSaveRelief(s) }, s).toEqual(attendu[s]);
    }
    expect(Object.keys(attendu).sort()).toEqual([...VAULT_PANE_SAVE_STATES].sort());
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('l’ordre des questions', () => {
  it('un document propre et écrivable : enregistré', () => {
    expect(etat({})).toBe('saved');
  });

  it('un envoi EN VOL prime sur tout le reste', () => {
    // Y compris sur un gel qui arriverait au milieu : le commit part, il
    // aboutira ou échouera avec son propre message.
    expect(etat({ saving: true, dirty: true })).toBe('saving');
    expect(etat({ saving: true, dirty: true, serverReadOnly: true })).toBe('saving');
    expect(etat({ saving: true, dirty: true, conflict: 'open' })).toBe('saving');
    expect(etat({ saving: true, dirty: true, conflict: 'gone' })).toBe('saving');
  });

  it('un LECTEUR sans travail en attente lit « lecture seule »', () => {
    expect(etat({ mayWrite: false })).toBe('read-only');
    expect(vaultPaneOffersSave('read-only')).toBe(false);
  });

  it('LE GEL QUI TOMBE SUR QUELQU’UN QUI ÉCRIVAIT NE DIT PAS « lecture seule »', () => {
    /**
     * C'est le cas le plus coûteux du fichier, et il arrive pour de vrai : un
     * coffre gelé (F23) ou une rétrogradation pendant l'édition font répondre
     * `role: 'viewer'` au relais. La personne a du texte à l'écran qui ne
     * partira jamais d'ici. « Lecture seule » tout court la laisserait fermer
     * son panneau en croyant n'avoir rien perdu.
     */
    expect(etat({ dirty: true, serverReadOnly: true })).toBe('blocked-unsaved');
    expect(etat({ dirty: true, mayWrite: false })).toBe('blocked-unsaved');
    // Et on ne lui propose PAS un bouton : il récolterait un 409 `vault_frozen`.
    // Le secours nommé est l'aveu, que la phrase porte (« copiez ce qui compte »).
    expect(vaultPaneSaveRelief('blocked-unsaved')).toBe('cannot-write');
    expect(vaultPaneOffersSave('blocked-unsaved')).toBe(false);
  });

  it('un CONFLIT ouvert ne se déclare jamais « enregistré », même compteurs retombés', () => {
    expect(etat({ conflict: 'open', dirty: true })).toBe('conflict');
    // Les compteurs peuvent retomber (un commit partiel, un rechargement) alors
    // que le bandeau de conflit est encore à l'écran : répondre « enregistré »
    // contredirait la ligne juste au-dessus.
    expect(etat({ conflict: 'open', dirty: false })).toBe('conflict');
    // Et le geste vit dans l'écran de conflit (« enregistrer ma version »), pas
    // dans un second bouton qui répondrait la question à la place de la personne.
    expect(vaultPaneSaveRelief('conflict')).toBe('conflict-panel');
    expect(vaultPaneOffersSave('conflict')).toBe(false);
  });

  it('L’ÉLÉMENT SUPPRIMÉ N’EST PAS LE MÊME 409 — et ne promet pas le même geste', () => {
    /**
     * `conflict.serverVersion === null` veut dire que l'élément a été supprimé
     * pendant l'édition : l'écran de conflit n'offre alors que « Fermer »,
     * puisqu'il n'y a plus de version sur laquelle se rebaser. Les deux conflits
     * confondus, le badge renvoyait vers « enregistrer ma version » — un geste
     * que la personne aurait cherché en vain, au lieu de lire qu'il faut copier
     * son texte ailleurs.
     */
    expect(etat({ conflict: 'gone', dirty: true })).toBe('conflict-gone');
    expect(etat({ conflict: 'gone', dirty: false })).toBe('conflict-gone');
    expect(vaultPaneSaveRelief('conflict-gone')).toBe('cannot-write');
    expect(vaultPaneSaveRelief('conflict-gone')).not.toBe('conflict-panel');
    expect(vaultPaneOffersSave('conflict-gone')).toBe(false);
  });

  it('sale + rien pour l’écrire = LE BOUTON, et il est actionnable', () => {
    const s = etat({ dirty: true, autoSaveCovers: false });
    expect(s).toBe('unsaved-manual');
    expect(vaultPaneOffersSave(s)).toBe(true);
    expect(vaultPaneSaveEnabled(s)).toBe(true);
  });

  it('sale + quelque chose l’écrira = pas de bouton, mais la phrase le dit', () => {
    const s = etat({ dirty: true, autoSaveCovers: true });
    expect(s).toBe('unsaved-auto');
    expect(vaultPaneSaveRelief(s)).toBe('automatic');
    expect(vaultPaneOffersSave(s)).toBe(false);
  });

  it('UNE COUPURE AVÉRÉE PRIME SUR L’ESPOIR DE L’AUTOMATIQUE', () => {
    /**
     * L'ordre compte, et il n'est pas symétrique. `autoSaveCovers` est une
     * CAPACITÉ — l'élu d'une salle stabilisée a le droit d'écrire, et un
     * minuteur court. `offlineRetryArmed` est un FAIT plus récent et plus dur :
     * un envoi vient de partir et de ne rencontrer personne. Répondre
     * « enregistrement pris en charge » juste après, c'était reproduire le
     * défaut d'origine — une promesse sans cause affichée.
     */
    const s = etat({ dirty: true, autoSaveCovers: true, offlineRetryArmed: true });
    expect(s).toBe('offline-pending');
    expect(vaultPaneSaveRelief(s)).toBe('retry');
  });

  it('LA COUPURE NE SURVIT PAS À SES PROPRES CONDITIONS', () => {
    // Un document propre est enregistré, coupure ou pas : `dirty` reste la
    // seule porte vers `'saved'`, et rien n'a le droit de la contourner.
    expect(etat({ dirty: false, offlineRetryArmed: true })).toBe('saved');
    // Un conflit à l'écran passe devant : c'est LUI qui porte le geste.
    expect(etat({ dirty: true, conflict: 'open', offlineRetryArmed: true })).toBe('conflict');
    // Et un envoi en vol reste un fait plus immédiat encore.
    expect(etat({ dirty: true, saving: true, offlineRetryArmed: true })).toBe('saving');
    // Un coffre qui n'accepte plus rien n'a pas de reprise à espérer.
    expect(etat({ dirty: true, serverReadOnly: true, offlineRetryArmed: true })).toBe(
      'blocked-unsaved'
    );
  });

  it('LA REPRISE ÉPUISÉE REND LE BOUTON — une promesse qui expire, pas une qui ment', () => {
    /**
     * `offlineRetryArmed` est le FAIT « un minuteur court en ce moment », et la
     * borne de tentatives le fait retomber. L'écran redescend alors à « rien ne
     * les enregistrera tout seul », avec son geste : c'est vrai, et c'est
     * actionnable. Continuer à afficher « reprise dès le retour du réseau »
     * après avoir renoncé aurait été la même faute qu'une capacité prise pour
     * une promesse.
     */
    const s = etat({ dirty: true, autoSaveCovers: false, offlineRetryArmed: false });
    expect(s).toBe('unsaved-manual');
    expect(vaultPaneSaveEnabled(s)).toBe(true);
  });

  it('L’AVEU « rien n’est stocké ici » NE SORT QUE LÀ', () => {
    // Ailleurs, l'écran demande un geste immédiat : un second avertissement
    // n'affaiblirait que le premier.
    for (const s of VAULT_PANE_SAVE_STATES) {
      expect(vaultPaneWarnsDraftIsNowhere(s), s).toBe(s === 'offline-pending');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────

/** Ce que l'autorité accepte : élu, rôle écrivant, salle stabilisée, version connue. */
const capable: VaultAutoSaveCapability = {
  responsible: true,
  localRole: 'member',
  guardVersion: 3,
  settled: true,
  loneSaver: false,
  serverReadOnly: false,
};

const couvre = (patch: {
  autoSaveArmed?: boolean;
  settled?: boolean;
  otherSaverPresent?: boolean;
  titlePending?: boolean;
  serverReadOnly?: boolean;
  capability?: Partial<VaultAutoSaveCapability>;
}) =>
  vaultPaneAutoSaveCovers({
    autoSaveArmed: true,
    settled: true,
    otherSaverPresent: false,
    titlePending: false,
    serverReadOnly: false,
    ...patch,
    capability: { ...capable, ...(patch.capability ?? {}) },
  });

describe('« l’automatique couvre-t-il ce document ? » — la question qui décide du bouton', () => {
  it('l’élu d’une salle stabilisée : oui', () => {
    expect(couvre({})).toBe(true);
  });

  it('AUCUN MINUTEUR ARMÉ, aucune couverture — même si tous les vetos sont levés', () => {
    /**
     * LE PIÈGE DE CE CHANTIER, et il ne se voit pas dans `shouldWriteBackVaultNote`.
     * Cette fonction-là répond « ai-je le DROIT d'écrire », jamais « quelque
     * chose va-t-il écrire » : le minuteur, lui, est armé à la main par les
     * appels à `scheduleAutoSave` de `VaultNoteEditor`. Il a suffi qu'un chemin
     * de modification oublie d'armer — le TITRE, qui montait `dirty` sans jamais
     * lancer de minuteur — pour que le panneau annonce « enregistrement pris en
     * charge » sur du texte que rien n'écrirait jamais. Une capacité n'est pas
     * une promesse : ce module exige le FAIT.
     */
    expect(couvre({ autoSaveArmed: false })).toBe(false);
    // …et le panneau retombe alors sur le bouton, qui est bien la seule issue.
    expect(
      vaultPaneSaveState({ ...base, dirty: true, autoSaveCovers: couvre({ autoSaveArmed: false }) })
    ).toBe('unsaved-manual');
  });

  it('ET AUCUNE CAPACITÉ NE RATTRAPE UN MINUTEUR ABSENT', () => {
    // Le balayage complet : quelle que soit la réponse de l'autorité, sans
    // minuteur armé notre chemin ne couvre rien. C'est la moitié « modèle » du
    // défaut du titre ; l'autre moitié (armer) est gardée dans le composant.
    const bool = [false, true];
    for (const responsible of bool)
      for (const settled of bool)
        for (const loneSaver of bool)
          for (const guardVersion of [null, 7]) {
            expect(
              couvre({
                autoSaveArmed: false,
                settled,
                capability: { responsible, settled, loneSaver, guardVersion },
              })
            ).toBe(false);
          }
  });

  it('UN RENOMMAGE N’EST PORTÉ PAR AUCUN AUTRE PAIR — le titre n’est pas dans le CRDT', () => {
    /**
     * L'élu enregistre le texte de la salle avec SON titre : le nôtre n'a jamais
     * voyagé. Dire « enregistrement pris en charge » à quelqu'un qui vient de
     * renommer, c'était lui promettre que son renommage partait — alors que le
     * commit suivant l'écrasait. Notre PROPRE chemin, lui, couvre le titre :
     * c'est notre commit qui l'emporte.
     */
    expect(couvre({ capability: { responsible: false }, otherSaverPresent: true })).toBe(true);
    expect(
      couvre({ capability: { responsible: false }, otherSaverPresent: true, titlePending: true })
    ).toBe(false);
    // Nous sommes l'élu et le minuteur court : le titre part avec le reste.
    expect(couvre({ titlePending: true })).toBe(true);
  });

  it('un RELAIS JAMAIS STABILISÉ ne couvre rien — le cas rapporté', () => {
    // `vaultRoomSettled` n'accepte que 'synced' : hors ligne ne prouve rien sur
    // les autres membres, donc personne n'est élu, donc rien n'écrit tout seul.
    expect(couvre({ settled: false, capability: { settled: false } })).toBe(false);
  });

  it('le RÉDACTEUR ISOLÉ est couvert, salle non stabilisée comprise', () => {
    // Second chemin de `shouldWriteBackVaultNote` : coffre à un membre, relais
    // muet depuis vingt secondes. La salle est montée (statut « hors ligne »),
    // donc le minuteur est bien armé.
    expect(couvre({ settled: false, capability: { settled: false, loneSaver: true } })).toBe(true);
  });

  it('UN AUTRE PAIR TIENT LE STYLO : couvert, et sans bouton', () => {
    /**
     * Sans ce chemin, un pair non élu d'une salle vivante afficherait en
     * permanence « modifications non enregistrées » avec un bouton — l'invitant
     * à écrire par-dessus l'élu pour récolter un 409, alors que son texte est
     * déjà en route vers celui qui commite.
     */
    expect(couvre({ capability: { responsible: false }, otherSaverPresent: true })).toBe(true);
    expect(couvre({ capability: { responsible: false }, otherSaverPresent: false })).toBe(false);
  });

  it('…mais pas depuis une salle qui n’a pas rejoué', () => {
    // Une présence lue avant le verdict de la salle peut désigner un « élu » qui
    // n'en est pas un : le scrutin se tient sur un effectif à moitié arrivé.
    expect(
      couvre({
        settled: false,
        otherSaverPresent: true,
        capability: { responsible: false, settled: false },
      })
    ).toBe(false);
  });

  it('LE VETO DU RELAIS annule les deux chemins', () => {
    // Coffre gelé : ni nous ni l'élu n'écrirons. Dire « c'est pris en charge »
    // enverrait tout le monde fermer son panneau sur du texte perdu.
    expect(couvre({ serverReadOnly: true })).toBe(false);
    expect(couvre({ serverReadOnly: true, otherSaverPresent: true })).toBe(false);
  });

  it('un LECTEUR n’est jamais couvert par notre propre chemin', () => {
    expect(couvre({ capability: { localRole: 'viewer' } })).toBe(false);
  });

  it('L’AUTORITÉ EST `shouldWriteBackVaultNote`, pas une seconde liste recopiée', () => {
    /**
     * Confronter à l'autorité, jamais à un dérivé. Pour toutes les combinaisons
     * de vetos que le modèle transmet, le chemin « c'est moi qui écris » doit
     * suivre EXACTEMENT ce que répond la fonction de référence — sans quoi une
     * règle ajoutée là-bas laisserait ici un badge qui promet le contraire.
     */
    const bool = [false, true];
    for (const responsible of bool)
      for (const settled of bool)
        for (const loneSaver of bool)
          for (const role of ['member', 'viewer'])
            for (const guardVersion of [null, 7]) {
              const capability: VaultAutoSaveCapability = {
                responsible,
                localRole: role,
                guardVersion,
                settled,
                loneSaver,
                serverReadOnly: false,
              };
              const attendu = shouldWriteBackVaultNote({
                ...capability,
                dirty: true,
                saving: false,
                hasConflict: false,
              });
              expect(
                vaultPaneAutoSaveCovers({
                  autoSaveArmed: true,
                  settled,
                  // Le second chemin est neutralisé : on n'éprouve ici que le nôtre.
                  otherSaverPresent: false,
                  titlePending: false,
                  serverReadOnly: false,
                  capability,
                })
              ).toBe(attendu);
            }
  });
});

// ─────────────────────────────────────────────────────────────────────────────

const source = readFileSync(join(__dirname, '..', 'VaultNoteEditor.tsx'), 'utf8');

/**
 * LES DEUX TRANCHES QUE LES GARDES LISENT.
 *
 * `partagee` va du contenu commun jusqu'à la fenêtre : elle couvre le corps ET
 * l'habillage « panneau ». C'est délibéré, et c'est une correction — la garde
 * s'arrêtait au corps, si bien qu'un `<ModalFooter>` REPOSÉ DANS LE PANNEAU,
 * c'est-à-dire le défaut d'origine restauré à l'identique, la laissait verte.
 */
const partagee = source.slice(
  source.indexOf('const corps = ('),
  source.indexOf('// ══ LA FENÊTRE')
);
/** Le seul habillage « panneau », borne à borne. */
const panneau = source.slice(
  source.indexOf("if (variant === 'pane')"),
  source.indexOf('// ══ LA FENÊTRE')
);

describe('le panneau AFFICHE le modèle — il ne redécide rien', () => {
  it('l’habillage lit l’état par le modèle, une seule fois', () => {
    expect(source).toMatch(/vaultPaneSaveState\(\{/);
    expect(source.match(/vaultPaneSaveState\(\{/g)?.length).toBe(1);
    expect(source).toMatch(/from '\.\/vaultPaneSaveState'/);
  });

  it('LE CHOIX LE PLUS IMPORTANT DU MODÈLE EST TENU AU POINT D’APPEL : `dirty`', () => {
    /**
     * `dirty` couvre TOUT ce qui diffère du coffre — nos frappes, celles qui
     * arrivent par le CRDT, et le titre ; `unsaved` ne couvre que les nôtres.
     * Le second est un sous-ensemble : le passer ici afficherait « Enregistré
     * dans le coffre » sur le travail d'un autre membre, en vert, alors qu'il
     * n'y est pas. Le modèle a beau documenter le choix, c'est l'APPELANT qui le
     * fait — et aucun test du modèle ne peut le voir.
     */
    const appel = source
      .slice(
        source.indexOf('const paneSaveState = vaultPaneSaveState({'),
        source.indexOf('const peutEnregistrerMaintenant')
      )
      // On interroge le CODE, pas la prose : le commentaire du point d'appel
      // PARLE justement d'`unsaved` pour expliquer qu'il ne le passe pas, et un
      // garde qui tomberait là-dessus punirait l'explication.
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(appel.length).toBeGreaterThan(100);
    expect(appel).toMatch(/^\s*dirty,$/m);
    expect(appel).not.toMatch(/\bunsaved\b/);
  });

  it('« l’automatique couvre » reçoit un FAIT, pas une déduction', () => {
    /**
     * `autoSaveArmed` doit venir du minuteur lui-même (`autoSave.armed`), et de
     * rien d'autre : c'est toute la différence entre « j'ai le droit d'écrire »
     * et « quelque chose écrira ». Le lui donner depuis un booléen d'ambiance
     * (la salle est montée, par exemple) ramènerait exactement le défaut : le
     * renommage seul n'arme rien, et le badge promettait quand même.
     */
    const appel = source.slice(
      source.indexOf('const autoSaveCovers = vaultPaneAutoSaveCovers({'),
      source.indexOf('const paneConflict')
    );
    expect(appel.length).toBeGreaterThan(100);
    expect(appel).toMatch(/autoSaveArmed: autoSave\.armed,/);
    expect(appel).toMatch(/titlePending,/);
    // Et le fait vient bien du minuteur partagé, pas d'un compteur local.
    expect(source).toMatch(/const autoSave = useDebouncedCallback\(/);
  });

  it('le bouton du panneau est posé par `vaultPaneOffersSave`, jamais par une condition maison', () => {
    // Une seconde règle d'affichage à côté du modèle, c'est une seconde vérité
    // possible sur « peut-on encore enregistrer » — exactement ce que ce
    // chantier ferme.
    expect(source).toMatch(/vaultPaneOffersSave\(paneSaveState\)/);
    expect(source).toMatch(/vaultPaneSaveEnabled\(paneSaveState\)/);
  });

  it('« l’automatique couvre » vient du modèle, pas d’un appel direct à l’autorité', () => {
    expect(source).toMatch(/vaultPaneAutoSaveCovers\(\{/);
    // `shouldWriteBackVaultNote` reste appelée par le composant pour la CADENCE
    // (le minuteur) et pour la garde de sortie ; l'affichage, lui, passe par le
    // modèle. Deux usages, deux appels, et aucun troisième.
    expect(source.match(/shouldWriteBackVaultNote\(/g)?.length).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('LE TITRE ARME LA CADENCE, comme le corps', () => {
  const bloc = source.slice(
    source.indexOf('const handleTitleChange'),
    source.indexOf('const paneTitleRef')
  );

  it('renommer sans toucher au texte lance bien un minuteur', () => {
    /**
     * LA PERTE FERMÉE. `handleTitleChange` montait `docSeq`, `localSeq`, `dirty`
     * et `unsaved` — et n'appelait pas `scheduleAutoSave`. Seul dans une salle
     * saine, renommer une note depuis l'onglet Notes affichait donc
     * « enregistrement pris en charge », sans bouton, et RIEN n'écrivait jamais.
     */
    expect(bloc.length).toBeGreaterThan(200);
    expect(bloc).toMatch(/if \(collabLiveRef\.current\) scheduleAutoSave\(\);/);
  });

  it('et un titre n’emporte pas de saut de ligne', () => {
    // `trim()` ne rogne que les bords : une touche Entrée dans le `<textarea>`
    // du panneau, ou un collage multiligne, envoyait le reste dans `meta.title`
    // — donc dans la liste du coffre et dans le titre de la fenêtre.
    expect(bloc).toMatch(/replace\(\/\[\\r\\n\]\+\/g, ' '\)/);
    // Et Entrée descend dans le corps plutôt que d'ouvrir une ligne.
    expect(panneau).toMatch(
      /onKeyDown=\{\(e\) => \{[\s\S]{0,240}surfaceCommandsRef\.current\?\.focusStart\(\)/
    );
    expect(panneau).toMatch(/e\.preventDefault\(\)/);
  });
});

describe('UN COMMIT DISTANT NE DÉCLARE PAS PROPRE CE QU’IL N’A PAS ÉCRIT', () => {
  it('l’annonce de commit passe par `reconcileCommittedTitle` avant de baisser `dirty`', () => {
    /**
     * L'invariant « `'saved'` n'est jamais rendu sur un document sale » est vrai
     * DU MODÈLE et il était faux DE L'ÉCRAN : c'est le composant qui mentait sur
     * `dirty`, en amont, en le baissant sur le commit d'un pair — commit qui
     * porte SON titre, jamais le nôtre.
     */
    const bloc = source.slice(
      source.indexOf('collabSession.onCommittedVersion('),
      source.indexOf('// ── Commentaires : l’observateur de la carte partagee')
    );
    expect(bloc.length).toBeGreaterThan(200);
    expect(bloc).toMatch(/reconcileCommittedTitle\(\{/);
    // Une seule baisse, et elle est GARDÉE par le verdict.
    expect(bloc.match(/setDirty\(false\)/g)?.length).toBe(1);
    expect(bloc).toMatch(/stillPending\) return;[\s\S]{0,240}setDirty\(false\)/);
  });

  it('et le titre voyage avec la version committée — sans quoi rien à comparer', () => {
    expect(source).toMatch(/publishCommittedVersion\(expectedVersion \+ 1, titleSent\)/);
    const session = readFileSync(
      join(__dirname, '..', '..', '..', '..', 'services', 'collab', 'collabSession.ts'),
      'utf8'
    );
    expect(session).toMatch(/publishCommittedVersion\(version: number, title\?: string\)/);
    expect(session).toMatch(/listener\(version, this\.getCommittedTitle\(\)\)/);
  });
});

describe('AUCUNE SORTIE NE JETTE DU TEXTE EN SILENCE', () => {
  it('le retour « ← nom du coffre » est gardé comme la fermeture', () => {
    // Il appelait `onOpenInVault` en direct : hors salle (`unsaved-manual`), un
    // clic emportait la personne dans l'explorateur en jetant son paragraphe.
    expect(panneau).toMatch(/onClick=\{\(\) => quitterPanneau\(onOpenInVault\)\}/);
    expect(panneau).toMatch(/onClick=\{\(\) => quitterPanneau\(onClose\)\}/);
    expect(panneau).not.toMatch(/onClick=\{onOpenInVault\}/);
  });

  it('et quand rien ne peut écrire, le panneau DEMANDE au lieu de partir', () => {
    expect(panneau).toMatch(/<ConfirmModal/);
    expect(panneau).toMatch(/pane\.exitDiscard/);
    expect(panneau).toMatch(/pane\.exitStay/);
    // « Enregistrer et partir » n'est offert que si le coffre accepte encore une
    // écriture — sinon le message dit de copier ce qui compte.
    expect(panneau).toMatch(/peutEnregistrerMaintenant[\s\S]{0,400}pane\.exitSaveAndLeave/);
    expect(panneau).toMatch(/pane\.exitMessageBlocked/);
    // Et on ne part qu'une fois le commit ABOUTI : un 409 sur le pas de la porte
    // jetterait le texte qu'on venait de promettre d'enregistrer.
    expect(panneau).toMatch(/\.then\(\(ok\) => \{[\s\S]{0,200}if \(!ok\) return;/);
  });
});

describe('la FENÊTRE, elle, n’a pas bougé', () => {
  it('le corps et le pied de la modale sont toujours là', () => {
    // La variante `modal` est ce que voit un LECTEUR (`vaultNoteOpenTarget`) :
    // une régression ici serait une régression pour tous les lecteurs.
    expect(source).toMatch(/<ModalBody>/);
    expect(source).toMatch(/<ModalFooter>/);
  });

  it('…et NI le corps partagé NI le panneau n’en reçoivent', () => {
    /**
     * Le défaut rapporté tenait entièrement là : la variante `pane` insérait
     * `<ModalBody>…</ModalBody><ModalFooter>…</ModalFooter>` dans un cadre à
     * plat, d'où le champ « Titre » encadré, le libellé « Commenter » et le pied
     * « Fermer / Enregistrer dans le coffre » au milieu de l'onglet Notes.
     *
     * LA TRANCHE LUE VA JUSQU'À LA FENÊTRE, et c'est la correction : bornée au
     * corps partagé, elle laissait passer le pied REPOSÉ DANS LE PANNEAU —
     * c'est-à-dire le défaut d'origine, restauré, sous le garde-fou censé le
     * fermer.
     */
    expect(partagee.length).toBeGreaterThan(500);
    expect(panneau.length).toBeGreaterThan(500);
    expect(partagee).not.toMatch(/ModalBody|ModalFooter/);
    // La borne existe : sans elle, `slice` rendrait une tranche vide et tout
    // passerait (`indexOf` = -1 → tranche jusqu'à la fin).
    expect(source).toMatch(/\/\/ ══ LA FENÊTRE/);
    expect(source.indexOf('// ══ LA FENÊTRE')).toBeGreaterThan(source.indexOf('const corps = ('));
  });

  it('LE PANNEAU NE REND QU’UN SEUL CONTENU : celui du corps partagé', () => {
    /**
     * Deux constructions divergent en un mois. Le garde-fou d'origine comptait
     * les appels à `corps({`, ce qu'un SECOND contenu posé à côté ne changeait
     * pas : on vérifie donc ce que l'habillage MONTE. Tout ce qui touche au
     * DOCUMENT (surface, présence, commentaires, bandeaux) vient du corps
     * partagé ; le panneau n'a droit qu'à sa barre, son titre et sa demande de
     * sortie.
     */
    expect(panneau.match(/corps\(\{/g)?.length).toBe(1);
    const composants = new Set(panneau.match(/<([A-Z][A-Za-z0-9]*)/g) ?? []);
    expect([...composants].sort()).toEqual(['<Button', '<ConfirmModal']);
  });

  it('le titre du panneau n’est pas un champ de formulaire étiqueté', () => {
    // `titleLabel` (« Titre ») reste l'étiquette VISIBLE du champ de la MODALE,
    // et il n'y en a qu'une.
    // `[^-]` écarte l'`aria-label` du panneau : ce n'est pas une étiquette
    // visible, mais le NOM du champ pour une aide technique (voir plus bas).
    expect(source.match(/[^-]label=\{t\('teamVaults\.noteEditor\.titleLabel'\)\}/g)?.length).toBe(
      1
    );
    // Le panneau, lui, pose le titre comme l'éditeur ordinaire : même classe,
    // même vocabulaire visuel, aucune étiquette.
    expect(panneau).toMatch(/className="note-editor__title"/);
    expect(panneau).not.toMatch(/[^-]label=\{t\('teamVaults\.noteEditor\.titleLabel'\)\}/);
    // MAIS PAS SANS NOM POUR AUTANT : le texte de substitution disparaît dès
    // qu'on tape, et une aide technique annoncerait alors un champ anonyme.
    expect(panneau).toMatch(/aria-label=\{t\('teamVaults\.noteEditor\.titleLabel'\)\}/);
  });

  it('le retour « ← nom du coffre » reste', () => {
    expect(source).toMatch(/onOpenInVault/);
    expect(source).toMatch(/vaultName \|\|/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('les phrases existent dans LES DEUX langues', () => {
  const locales = join(__dirname, '..', '..', '..', '..', 'i18n', 'locales');
  const lire = (l: string) =>
    JSON.parse(readFileSync(join(locales, l, 'translation.json'), 'utf8')) as Record<string, never>;
  const pane = (l: string) =>
    (lire(l) as never as { teamVaults: { noteEditor: { pane: unknown } } }).teamVaults.noteEditor
      .pane as Record<string, unknown>;

  it('chaque état a sa clé en EN et en FR', () => {
    for (const langue of ['en', 'fr']) {
      expect(pane(langue)).toBeTruthy();
      for (const s of VAULT_PANE_SAVE_STATES) {
        const { key } = vaultPaneSaveLabel(s);
        expect(typeof pane(langue)[key], `${langue}.${key}`).toBe('string');
        expect((pane(langue)[key] as string).length).toBeGreaterThan(0);
      }
    }
  });

  it('la demande de sortie aussi — sans elle, la garde s’ouvrirait vide', () => {
    for (const langue of ['en', 'fr']) {
      for (const k of [
        'exitTitle',
        'exitMessage',
        'exitMessageBlocked',
        // La troisième phrase de sortie : hors ligne, les deux autres sont
        // fausses (une reprise EST armée, et « enregistrer » n'aboutira pas).
        'exitMessageOffline',
        'exitStay',
        'exitSaveAndLeave',
        'exitDiscard',
        // L'aveu à l'écran et le mot dit au premier échec.
        'offlineDraftNowhere',
        'offlineSave',
      ]) {
        expect(typeof pane(langue)[k], `${langue}.${k}`).toBe('string');
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('LES DEUX AVEUX LES PLUS COÛTEUX SONT LISIBLES — sur les douze thèmes', () => {
  /**
   * « rien ne les enregistrera tout seul » et « ce coffre ne les accepte plus »
   * étaient écrits en dur, sombres, à 0,72 rem : ~3:1 et ~2,3:1 sur les six
   * thèmes sombres. Ce ne sont pas des décorations — ce sont les deux phrases
   * qui préviennent d'une perte de texte, et elles étaient les moins lisibles de
   * l'écran.
   *
   * Le test RÉSOUT les jetons thème par thème et MESURE. Une teinte codée en dur
   * échoue ; un treizième thème qui oublierait de redéfinir ces jetons échoue
   * aussi — ce qu'aucune relecture de feuille de style n'attrape.
   */
  const tokens = readFileSync(
    join(__dirname, '..', '..', '..', 'styles', 'tokens', 'colors.css'),
    'utf8'
  );
  const editeur = readFileSync(join(__dirname, '..', '..', 'notes', 'NoteEditor.css'), 'utf8');

  /** Les blocs de premier niveau : `:root` et chaque `[data-theme='…']`. */
  const blocs = new Map<string, Record<string, string>>();
  for (const m of tokens.matchAll(/^(:root|\[data-theme='[a-z]+'\]) \{([\s\S]*?)^\}/gm)) {
    const decls: Record<string, string> = {};
    for (const d of m[2].matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)) decls[d[1]] = d[2].trim();
    blocs.set(m[1], decls);
  }
  const racine = blocs.get(':root') ?? {};
  const resoudre = (theme: string, nom: string): string => {
    const local = blocs.get(theme) ?? {};
    let v: string | undefined = local[nom] ?? racine[nom];
    for (let i = 0; i < 5 && v && v.startsWith('var('); i += 1) {
      const inner = v.slice(4, -1).split(',')[0].trim();
      v = local[inner] ?? racine[inner];
    }
    return v ?? '';
  };
  const luminance = (hex: string): number => {
    const c = hex.replace('#', '');
    const canal = [0, 2, 4].map((i) => {
      const v = parseInt(c.slice(i, i + 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * canal[0] + 0.7152 * canal[1] + 0.0722 * canal[2];
  };
  const contraste = (a: string, b: string) => {
    const l1 = luminance(a);
    const l2 = luminance(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };

  it('les deux teintes viennent de jetons de thème, pas de valeurs en dur', () => {
    const regle = (tone: string) => {
      const i = editeur.indexOf(`.note-editor__save-state--${tone} {`);
      expect(i, tone).toBeGreaterThan(0);
      return editeur.slice(i, i + 120);
    };
    expect(regle('pending')).toMatch(/color: var\(--color-warning-on-background\);/);
    expect(regle('error')).toMatch(/color: var\(--color-error-on-background\);/);
    // Et plus aucune teinte écrite à la main dans ces deux règles.
    expect(regle('pending').split('}')[0]).not.toMatch(/#[0-9a-f]{3,6}/i);
    expect(regle('error').split('}')[0]).not.toMatch(/#[0-9a-f]{3,6}/i);
  });

  it('et chaque thème les rend lisibles sur SON fond (≥ 4,5:1)', () => {
    expect(blocs.size).toBe(12);
    const teintes = new Set(
      VAULT_PANE_SAVE_STATES.map((s) => vaultPaneSaveLabel(s).tone).filter(
        (t) => t === 'pending' || t === 'error'
      )
    );
    // Les deux teintes d'aveu sont bien celles que le modèle emploie : si
    // quelqu'un déplaçait « rien ne les enregistrera » vers une autre teinte, ce
    // garde-fou cesserait de mesurer la bonne — d'où le contrôle.
    expect([...teintes].sort()).toEqual(['error', 'pending']);
    for (const theme of blocs.keys()) {
      const fond = resoudre(theme, '--color-background');
      expect(fond, theme).toMatch(/^#[0-9a-f]{6}$/i);
      for (const jeton of ['--color-warning-on-background', '--color-error-on-background']) {
        const teinte = resoudre(theme, jeton);
        expect(teinte, `${theme} ${jeton}`).toMatch(/^#[0-9a-f]{6}$/i);
        expect(contraste(teinte, fond), `${theme} ${jeton}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

describe('LA GOUTTIÈRE ET LA RESPIRATION DU TITRE ne se départagent pas au hasard', () => {
  const paneCss = readFileSync(join(__dirname, '..', 'VaultNoteEditor.css'), 'utf8');
  const editeurCss = readFileSync(join(__dirname, '..', '..', 'notes', 'NoteEditor.css'), 'utf8');

  it('le longhand du panneau DOUBLE son sélecteur face au raccourci de l’éditeur', () => {
    /**
     * `.note-editor__title-area` pose un `padding` raccourci ; le panneau ne
     * corrige que le haut. Même spécificité (0,1,0), deux feuilles distinctes :
     * c'est l'ordre d'insertion des modules qui tranchait — c'est-à-dire l'ordre
     * des `import` d'un fichier tiers. La règle du dépôt est de doubler.
     */
    expect(editeurCss).toMatch(/\.note-editor__title-area \{\s*padding: /);
    expect(paneCss).toMatch(/\.vault-note-pane__title-area\.vault-note-pane__title-area \{/);
  });

  it('et la colonne du document LIT la gouttière au lieu de la recopier', () => {
    // Deux nombres tenus d'accord à la main dans deux fichiers finissent
    // toujours par diverger, sans que rien ne le signale.
    expect(editeurCss).toMatch(/--note-editor-gutter: \d+px;/);
    expect(editeurCss).toMatch(/padding: 16px var\(--note-editor-gutter\) 8px;/);
    expect(paneCss).toMatch(/padding: 0 var\(--note-editor-gutter, 48px\)/);
  });

  it('le vocabulaire `note-editor__*` vit dans la feuille de l’éditeur', () => {
    // `--idle` était déclarée dans la feuille du coffre : une classe posée loin
    // de sa famille se perd à la première relecture.
    expect(editeurCss).toMatch(/\.note-editor__save-dot--idle \{/);
    expect(editeurCss).toMatch(/\.note-editor__save-state--idle \{/);
    expect(paneCss).not.toMatch(/\.note-editor__save-(dot|state)--idle/);
  });
});

/** Le typage de l'énumération est tenu par le compilateur, pas par ce fichier. */
const _exhaustif: readonly VaultPaneSaveState[] = VAULT_PANE_SAVE_STATES;
void _exhaustif;
