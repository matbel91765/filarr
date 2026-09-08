/**
 * UNE COUPURE N'EST PAS UN REFUS — et ce fichier garde la seule chose qui les
 * distingue, plus la promesse qu'on ajoute en la distinguant.
 *
 *   npx vitest run src/renderer/components/vaults/__tests__/vaultSaveFailure.vitest.ts
 *
 * ══ LE DÉFAUT GARDÉ ICI ═════════════════════════════════════════════════════
 *
 * Réseau coupé, clic sur « Enregistrer » : « Impossible d'enregistrer cette
 * note. Rien n'a été modifié dans le coffre. » Rien n'était cassé, rien n'était
 * perdu, et la phrase était littéralement vraie — elle ne disait simplement pas
 * la CAUSE (le coffre n'a pas refusé, il n'a pas été atteint), n'affirmait pas
 * que le texte était intact, et ne promettait aucune reprise.
 *
 * ══ LA RÈGLE QU'ON PAIE LE PLUS CHER SI ON LA RATE ══════════════════════════
 *
 * `navigator.onLine` MENT DANS LES DEUX SENS. Un test qui se contenterait de
 * vérifier « hors ligne ⇒ message hors ligne » validerait une implémentation
 * qui le lit tout seul — et cette implémentation-là dirait « vous êtes hors
 * ligne » à quelqu'un dont le coffre vient de le geler, et « le coffre a
 * refusé » à quelqu'un derrière un portail captif. Les tests ci-dessous le
 * mettent donc en CONTRADICTION avec le fait à chaque fois qu'ils le peuvent,
 * et exigent que le fait gagne.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  classifyVaultSaveFailure,
  vaultSaveRetryDelay,
  vaultSaveRetryLives,
  vaultSaveRetryMayFire,
  VAULT_SAVE_RETRY_STEPS_MS,
  type VaultSaveFailureInput,
  type VaultSaveRetryGate,
} from '../vaultSaveFailure';
import { VAULT_ERROR_KEYS } from '../../../../services/vault/vaultErrorMessages';

const classe = (patch: Partial<VaultSaveFailureInput>) =>
  classifyVaultSaveFailure({ reason: '', onLine: null, ...patch });

// ─────────────────────────────────────────────────────────────────────────────

describe('LA PREUVE EST LA REQUÊTE, PAS LE NAVIGATEUR', () => {
  it('une requête revenue sans réponse est une coupure — même si le navigateur se croit en ligne', () => {
    /**
     * LE CAS RÉEL, ET IL EST LE PLUS FRÉQUENT DES DEUX MENSONGES : DNS mort,
     * portail captif, VPN qui vient de tomber. `navigator.onLine` répond `true`
     * parce qu'une interface est active, et il a tort. Le fait, c'est que
     * `classifyVaultFailure` n'a trouvé AUCUN objet `response` : personne n'a
     * répondu.
     */
    expect(classe({ reason: 'network_unavailable', onLine: true })).toBe('unreachable');
    expect(classe({ reason: 'network_unavailable', onLine: false })).toBe('unreachable');
    expect(classe({ reason: 'network_unavailable', onLine: null })).toBe('unreachable');
  });

  it('un refus NOMMÉ par le serveur reste un refus — même si le navigateur se croit hors ligne', () => {
    /**
     * L'AUTRE SENS DU MENSONGE, et le plus coûteux. Le serveur a répondu : il a
     * gelé le coffre, retiré le membre, épuisé le quota. Requalifier ça en
     * « hors ligne, on réessaiera » armerait une reprise silencieuse contre une
     * décision qui ne bougera pas, et l'écran promettrait un enregistrement
     * impossible.
     */
    for (const code of ['pooled_quota_exceeded', 'legal_hold_active', 'session_expired']) {
      expect(classe({ reason: code, onLine: false }), code).toBe('refused');
      expect(classe({ reason: code, onLine: true }), code).toBe('refused');
    }
    // Le gel, la révocation et le rang disent tous « ce coffre n'accepte pas
    // VOTRE écriture » : une phrase à part, jamais « vous êtes hors ligne ».
    for (const code of ['vault_frozen', 'vault_forbidden', 'org_read_only', 'not_a_member']) {
      expect(classe({ reason: code, onLine: false }), code).toBe('read-only');
      expect(classe({ reason: code, onLine: true }), code).toBe('read-only');
    }
  });

  it('un refus prononcé par le CLIENT lui-même n’est pas non plus une coupure', () => {
    // Un coffre verrouillé ne se déverrouille pas au retour du réseau : une
    // reprise silencieuse n'y écrirait jamais rien, et le badge aurait promis.
    for (const local of ['Vault is locked', 'Unknown vault', 'grantee_key_changed']) {
      expect(classe({ reason: local, onLine: false }), local).toBe('refused');
    }
  });

  it('L’INDICE NE SERT QU’À TRANCHER UNE IGNORANCE — et il ne peut rien de plus', () => {
    /**
     * Le seul pouvoir concédé à `navigator.onLine` : un motif qu'AUCUNE table ne
     * sait lire, qui ne ressemble à aucun transport, et sur lequel on n'aurait
     * donc rien à dire. C'est peu, et c'est exactement ce qu'on veut : la
     * différence entre les deux lignes ci-dessous est la seule que cette valeur
     * puisse produire dans tout le module.
     */
    expect(classe({ reason: 'quelque chose d’illisible', onLine: false })).toBe('unreachable');
    expect(classe({ reason: 'quelque chose d’illisible', onLine: true })).toBe('refused');
    expect(classe({ reason: 'quelque chose d’illisible', onLine: null })).toBe('refused');
  });

  it('le FILET de forme de transport tient sans lui', () => {
    // Une couche qui relaie l'erreur brute d'un `fetch` n'a pas de code
    // canonique à poser. Le message, lui, dit tout — et il le dit même quand le
    // navigateur se croit parfaitement en ligne.
    for (const brut of [
      'TypeError: Failed to fetch',
      'Network Error',
      'net::ERR_NAME_NOT_RESOLVED',
      'timeout of 8000ms exceeded',
    ]) {
      expect(classe({ reason: brut, onLine: true }), brut).toBe('unreachable');
    }
  });

  it('les deux verdicts que la phrase distinguait DÉJÀ survivent au tri', () => {
    // L'ancien `catch` lisait deux formes à la regex ; les perdre aurait remplacé
    // deux messages précis par le repli générique.
    expect(classe({ reason: 'vault_epoch_conflict', onLine: true })).toBe('epoch');
    expect(classe({ reason: 'epoch mismatch', onLine: true })).toBe('epoch');
    expect(classe({ reason: 'Request failed with status code 403', onLine: true })).toBe(
      'read-only'
    );
  });

  it('L’AUTORITÉ SUR « LE SERVEUR A NOMMÉ CE REFUS » EST LA TABLE, PAS UNE COPIE', () => {
    /**
     * Une seconde liste de codes tenue à la main ici finirait par diverger de
     * celle qui traduit les messages — et la divergence se lirait à l'écran
     * comme « hors ligne » sur un refus de plan. On confronte donc à l'autorité :
     * TOUT code de la table (sauf celui qui EST la coupure) doit résister à un
     * `onLine` menteur.
     */
    let vus = 0;
    for (const code of Object.keys(VAULT_ERROR_KEYS)) {
      if (code === 'network_unavailable') continue;
      vus++;
      expect(classe({ reason: code, onLine: false }), code).not.toBe('unreachable');
    }
    expect(vus).toBeGreaterThan(20);
  });

  it('le suffixe `:qui` de certains thunks ne masque pas le code', () => {
    expect(classe({ reason: 'network_unavailable:u42', onLine: true })).toBe('unreachable');
    expect(classe({ reason: 'vault_frozen:u42', onLine: false })).toBe('read-only');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('LA REPRISE EST BORNÉE — une promesse qui dure toujours est un mensonge', () => {
  it('le recul est progressif et strictement croissant', () => {
    for (let i = 1; i < VAULT_SAVE_RETRY_STEPS_MS.length; i++) {
      expect(VAULT_SAVE_RETRY_STEPS_MS[i]).toBeGreaterThan(VAULT_SAVE_RETRY_STEPS_MS[i - 1]);
    }
    // Assez espacé pour ne pas battre la même requête en boucle contre un
    // réseau absent : c'est ce que le premier palier garantit.
    expect(VAULT_SAVE_RETRY_STEPS_MS[0]).toBeGreaterThanOrEqual(3_000);
  });

  it('le PREMIER échec arme le premier palier, et pas le zéroième', () => {
    expect(vaultSaveRetryDelay(1)).toBe(VAULT_SAVE_RETRY_STEPS_MS[0]);
    expect(vaultSaveRetryDelay(2)).toBe(VAULT_SAVE_RETRY_STEPS_MS[1]);
  });

  it('ET ELLE S’ARRÊTE — passé la borne, plus rien n’est armé', () => {
    const n = VAULT_SAVE_RETRY_STEPS_MS.length;
    expect(vaultSaveRetryLives(n)).toBe(true);
    expect(vaultSaveRetryDelay(n + 1)).toBeNull();
    expect(vaultSaveRetryLives(n + 1)).toBe(false);
    expect(vaultSaveRetryLives(999)).toBe(false);
    // « zéro échec » n'arme rien non plus : sans tentative ratée, il n'y a rien
    // en attente, et une reprise programmée là serait une écriture spontanée.
    expect(vaultSaveRetryDelay(0)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('LA PORTE DE LA REPRISE — les raisons de ne PAS repartir', () => {
  const ouvert: VaultSaveRetryGate = {
    open: true,
    mayWrite: true,
    hasConflict: false,
    guardVersion: 7,
    saving: false,
    dirty: true,
  };

  it('tout ouvert : la reprise part', () => {
    expect(vaultSaveRetryMayFire(ouvert)).toBe(true);
  });

  it('chaque veto suffit, à lui seul', () => {
    const vetos: Array<[string, Partial<VaultSaveRetryGate>]> = [
      ['la note est fermée', { open: false }],
      ['le coffre refuse l’écriture', { mayWrite: false }],
      ['un conflit possède l’écran', { hasConflict: true }],
      ['un envoi est déjà en vol', { saving: true }],
      ['plus rien à écrire', { dirty: false }],
      ['aucune version de garde', { guardVersion: null }],
    ];
    for (const [nom, patch] of vetos) {
      expect(vaultSaveRetryMayFire({ ...ouvert, ...patch }), nom).toBe(false);
    }
  });

  it('LE CONFLIT EST UN VETO, ET C’EST LE PLUS IMPORTANT', () => {
    /**
     * Une reprise qui partirait sur un conflit ouvert renverrait la MÊME version
     * périmée : un second 409, cette fois sans écran pour le dire — et, si elle
     * adoptait la version du serveur pour « réussir », une écriture par-dessus
     * le travail de quelqu'un, décidée par un minuteur.
     */
    expect(vaultSaveRetryMayFire({ ...ouvert, hasConflict: true })).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

/**
 * LES SOURCES SONT LUES EN FINS DE LIGNE NORMALISÉES, et ce n'est pas de la
 * coquetterie.
 *
 * Les fichiers TypeScript de ce dépôt sont sur le disque en CRLF. Les ancres
 * multilignes de ces gardes sont, elles, écrites en LF dans le test — un
 * `indexOf` rendait donc -1, et `slice.slice(-1, …)` une chaîne VIDE : le garde
 * échouait sur « bloc de 0 caractère » en accusant un code parfaitement correct.
 * C'est le même piège que celui déjà consigné pour les fichiers de traduction,
 * et il se referme d'un `replace` à la lecture.
 */
const sansCRLF = (chemin: string): string => readFileSync(chemin, 'utf8').replace(/\r\n/g, '\n');

const editeur = sansCRLF(join(__dirname, '..', 'VaultNoteEditor.tsx'));
const slice = sansCRLF(
  join(__dirname, '..', '..', '..', '..', 'store', 'slices', 'vaultsSlice.ts')
);

describe('LE BRANCHEMENT — un modèle juste branché de travers ne garde rien', () => {
  it('LE THUNK CANONISE L’ÉCHEC : sans lui, une coupure arrive en « Network Error »', () => {
    /**
     * LA CAUSE RACINE. `updateVaultItem` renvoyait `(e as Error).message` :
     * hors ligne, l'écran recevait le message brut d'axios, qu'aucune table ne
     * traduit, et servait donc son repli — « rien n'a été modifié dans le
     * coffre ». `classifyVaultFailure` est la couche qui SAIT qu'une erreur sans
     * objet `response` n'a rencontré personne.
     */
    const bloc = slice.slice(
      slice.indexOf("createAsyncThunk(\n  'vaults/updateItem'"),
      slice.indexOf('export async function downloadVaultItemContent')
    );
    expect(bloc.length).toBeGreaterThan(500);
    expect(bloc).toMatch(/classifyVaultFailure\(e\) \?\? \(e as Error\)\.message/);
  });

  it('l’éditeur CLASSE au lieu de retomber sur une seule phrase', () => {
    expect(editeur).toMatch(/classifyVaultSaveFailure\(\{ reason: errorText\(e\), onLine:/);
    // L'ancienne cascade de regex sur `String(e)` ne doit plus décider seule.
    expect(editeur).not.toMatch(/const msg = String\(e\);/);
  });

  it('LA COUPURE NE PARLE PAS LE LANGAGE D’UNE ERREUR', () => {
    // `error()` est rouge et terminal ; une coupure n'est ni l'un ni l'autre.
    // Et une seule fois : répéter la phrase à chaque palier ferait lire une
    // panne qui s'aggrave là où il ne se passe rien de nouveau.
    expect(editeur).toMatch(/if \(echecs === 1\) warning\(t\('teamVaults\.noteEditor\.pane\./);
  });

  it('LA REPRISE NE FORCE JAMAIS — elle repart sous la version de garde', () => {
    /**
     * C'est la garantie qui empêche la reprise d'être une perte de données : si
     * quelqu'un a écrit pendant la coupure, elle récolte un 409 ordinaire et
     * l'écran d'arbitrage bloc par bloc s'ouvre. Une reprise qui adopterait
     * `serverVersion` pour « réussir » écraserait le travail d'un autre, sans
     * qu'aucun humain n'ait rien vu.
     */
    const bloc = editeur.slice(
      editeur.indexOf('porteDeRepriseRef.current = () => {'),
      editeur.indexOf('const armerReprise = useCallback(')
    );
    expect(bloc.length).toBeGreaterThan(200);
    expect(bloc).toMatch(/vaultSaveRetryMayFire\(\{/);
    expect(bloc).toMatch(/doSaveRef\.current\(input\.guardVersion, \{ close: false \}\)/);
    expect(bloc).not.toMatch(/serverVersion/);
  });

  it('ELLE S’ARRÊTE NET au démontage — fermeture de la note, verrouillage du coffre', () => {
    // Le panneau démonte dans les deux cas. Un minuteur qui y survivrait
    // écrirait dans un coffre qu'on vient de fermer à clé, minutes plus tard.
    const bloc = editeur.slice(
      editeur.indexOf('  const armerRepriseRef = useRef<(echecs: number) => void>'),
      editeur.indexOf('const autoSave = useDebouncedCallback(')
    );
    expect(bloc).toMatch(/return \(\) => \{[\s\S]*?clearTimeout\(repriseTimerRef\.current\)/);
  });

  it('le RETOUR DU RÉSEAU avance une tentative, il n’en invente aucune', () => {
    /**
     * `online` ment aussi. On lui concède donc le droit de RACCOURCIR une
     * attente déjà programmée, jamais celui de déclencher une écriture : sans
     * minuteur en cours, il ne se passe rien — ni parce qu'il n'y a rien en
     * attente, ni parce qu'on a délibérément renoncé après la borne.
     */
    const bloc = editeur.slice(
      editeur.indexOf('const auRetour = () => {'),
      editeur.indexOf("window.addEventListener('online', auRetour);")
    );
    expect(bloc).toMatch(/if \(repriseTimerRef\.current === null\) return;/);
    expect(editeur).toMatch(/window\.removeEventListener\('online', auRetour\)/);
  });

  it('UN 409 N’EST PAS UNE COUPURE : il désarme la reprise', () => {
    const bloc = editeur.slice(
      editeur.indexOf('if (isVaultItemConflict(e)) {'),
      editeur.indexOf('const echec = classifyVaultSaveFailure(')
    );
    expect(bloc).toMatch(/repriseEchecsRef\.current = 0;/);
    expect(bloc).toMatch(/annulerReprise\(\);/);
  });

  it('L’AVEU EST À L’ÉCRAN, PAS SEULEMENT DANS UN TOAST QUI S’EFFACE', () => {
    // Le brouillon n'est écrit nulle part : c'est au moment où l'écran dit
    // « attendez » que quelqu'un est tenté de fermer l'onglet.
    // La phrase est RENDUE, et sous la garde du modèle — pas seulement citée
    // quelque part dans le fichier.
    expect(editeur).toMatch(
      /\{state === 'ready' && vaultPaneWarnsDraftIsNowhere\(paneSaveState\) && \([\s\S]{0,400}?pane\.offlineDraftNowhere/
    );
    // Et la demande de sortie ne répète pas « rien ne les enregistrera tout
    // seul » alors qu'une reprise est armée.
    expect(editeur).toMatch(/pane\.exitMessageOffline/);
  });

  it('AUCUNE PERSISTANCE LOCALE N’EST PROMISE — parce qu’il n’y en a pas', () => {
    /**
     * L'aveu affiché doit rester VRAI. Le jour où quelqu'un poserait un
     * brouillon dans `localStorage` sans revoir la phrase, l'écran dirait le
     * contraire du code — et, pire, du contenu de coffre existerait en clair au
     * repos. Ce garde-fou tombe alors, et c'est ce qu'on veut : la décision doit
     * être prise, pas improvisée.
     */
    const corps = editeur.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(corps).not.toMatch(/localStorage/);
    expect(corps).not.toMatch(/sessionStorage/);
    expect(corps).not.toMatch(/indexedDB/i);
  });
});
