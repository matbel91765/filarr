/**
 * vaultActivityExport (F12) — filtrer le fil, puis l'emporter. Sans React, sans
 * réseau, sans i18n.
 *
 * DEUX SUJETS, UN SEUL FICHIER, ET C'EST DÉLIBÉRÉ : ce que l'écran affiche et ce
 * que l'export contient doivent être LA MÊME sélection. Deux modules auraient
 * fini par répondre différemment à « qu'est-ce qu'un événement de la famille
 * clés ? », et le fichier aurait alors démenti l'écran qui l'a produit.
 *
 * ─── LES FILTRES ────────────────────────────────────────────────────────────
 *
 * LA FAMILLE EST CELLE QUE LE FIL DESSINE DÉJÀ. `VaultActivityPanel` peignait
 * trois pastilles (📄 éléments, 🔐 coffre et clés, 👤 personnes) à partir du
 * préfixe du type. Le filtre reprend EXACTEMENT ce découpage plutôt que d'en
 * inventer un second : un menu « éléments » qui ne rendrait pas les lignes à
 * pastille 📄 serait un mensonge que rien ne signale.
 *
 * `member.remove` EST DANS LA FAMILLE, et il faut le dire : la route le sert
 * (il cible la PERSONNE, le coffre voyageant en métadonnée) et le worker
 * l'accepte au filtre. L'omettre en ferait la seule ligne infiltrable — présente
 * dans toutes les sélections, absente d'aucune.
 *
 * DEUX GARDES QUI VIENNENT DU CONTRAT DU WORKER :
 *   · `types=` VIDE est un 400 (`bad_request`). Une sélection qui ne résout rien
 *     — un type resté coché alors que sa famille ne l'est plus — retombe donc
 *     sur les familles, jamais sur une liste vide ; sinon l'écran afficherait
 *     « impossible de lire le fil » à quelqu'un qui vient de cliquer un filtre.
 *   · une sélection qui COUVRE TOUT ne s'envoie pas : le paramètre absent est
 *     déjà le fil complet, et l'envoyer coûterait vingt paramètres liés par
 *     requête (D1 en refuse cent) pour le même résultat.
 *
 * ─── L'EXPORT ───────────────────────────────────────────────────────────────
 *
 * LES NOMS SONT RÉSOLUS ICI, LES IDENTIFIANTS RESTENT. Le serveur ne journalise
 * que des identifiants opaques — c'est une propriété du produit, pas une lacune.
 * L'adresse et le titre sont donc reconstitués SUR CET APPAREIL, et la colonne
 * d'identifiant reste à côté : deux exports faits sur deux postes doivent
 * pouvoir se recouper, y compris quand l'un des deux n'a pas su nommer.
 *
 * L'INJECTION DE FORMULE N'EST PAS UNE COQUETTERIE. Les titres d'éléments et les
 * adresses sont des chaînes que des humains ont tapées. Ouvert dans un tableur,
 * `=HYPERLINK("http://…"&A1)` exfiltre la ligne voisine au premier clic, et
 * `=cmd|…` a fait pire. Le préfixe `'` neutralise la formule SANS altérer ce
 * qu'un humain lit — c'est le seul remède qui ne perde pas la donnée. On préfixe
 * les quatre amorces classiques (`=`, `+`, `-`, `@`) et les deux que les
 * tableurs avalent silencieusement (tabulation, retour chariot).
 *
 * LES EN-TÊTES DE COLONNES SONT EN ANGLAIS, ET C'EST UN CHOIX. Un fichier de
 * données dont les noms de colonnes changent avec la langue de l'interface ne se
 * script pas, ne se compare pas d'un export à l'autre, et casse toute formule
 * qu'on aurait écrite dessus. Le contenu, lui, est celui de l'utilisateur.
 *
 * CE QUE LE FICHIER AVOUE : une page tronquée (il reste un curseur) et une offre
 * qui ne journalise pas. Sans ces deux lignes, un export court se lit « il ne
 * s'est rien passé » — le silence exact que cette fiche existe pour supprimer.
 */

import type { VaultActivityEventDTO } from '../../../../services/vault/vaultApi';
import { memberEpochCoverage, type MemberEpochRow } from './epochCoverage';

// ─────────────────────────────────────────────────────────────────────────────
// Les familles
// ─────────────────────────────────────────────────────────────────────────────

export type ActivityFamilyId = 'members' | 'keys' | 'items';

/** L'ordre des menus, partout — un filtre ne change pas d'ordre selon l'écran. */
export const ACTIVITY_FAMILY_IDS = ['members', 'keys', 'items'] as const;

/**
 * TOUT ce que `GET /vaults/:id/activity` peut rendre, `member.remove` compris.
 *
 * Recopié du worker (`VAULT_FAMILY_EVENT_TYPES`) parce que le renderer ne peut
 * pas importer `infra/` — et gardé par le test de partition ci-contre, qui
 * échouerait au premier type rangé nulle part.
 */
export const ACTIVITY_EVENT_TYPES = [
  'vault.create',
  'vault.rename',
  // REPEINDRE N'EST PAS RENOMMER. L'apparence PARTAGÉE voyage dans la même
  // enveloppe scellée que le nom : le serveur, qui ne déchiffre rien, écrivait
  // « a renommé le coffre » à chaque changement de couleur. Le client dit
  // désormais lequel des deux gestes il fait (`apiRenameVault(..., 'appearance')`),
  // et le worker écrit ce type. Voir CHANGES-2026-09.md, §2.
  'vault.appearance',
  'vault.settings.update',
  'member.invite',
  'member.invite.revoke',
  'member.invite.decline',
  'member.invite.resend',
  'member.invite.auto_resend',
  'member.join',
  'member.leave',
  'member.remove',
  'vault.rotate',
  'member.item.add',
  'member.item.remove',
  'member.item.restore',
  'member.item.update',
  // Une mention prévient une personne nommément (jamais son texte) : le fil
  // d'activité doit pouvoir la montrer comme le worker la journalise.
  'member.mention',
  'member.item.purge',
  'vault.trash.empty',
  'vault.purge',
  'vault.delete',
  'vault.restore',
  'vault.freeze',
  'vault.unfreeze',
  'role.change',
] as const;

/**
 * La famille d'un type — LE MÊME découpage que la pastille du fil
 * (`VaultActivityPanel.familyGlyph`), qui délègue désormais ici.
 *
 * L'ordre des tests compte : `member.item.*` avant `member.*`, sinon les quatre
 * événements les plus fréquents d'un coffre habité (remplacement, renommage,
 * corbeille, restauration) tomberaient dans « personnes ».
 *
 * ── DEUX ALIGNEMENTS SUR LE TÉLÉPHONE (`services/vaults/activityModel.ts`) ──
 *
 * 1. `vault.trash.empty` EST UN GESTE SUR DES ÉLÉMENTS. Il était rangé dans
 *    « coffre et clés » par la seule vertu de son préfixe `vault.`, alors que
 *    vider la corbeille détruit des FICHIERS — et rien d'autre. Quelqu'un qui
 *    cherche « qu'est-il arrivé à mes documents ? » coche « Éléments » : la
 *    ligne qui les a effacés pour de bon n'y était pas.
 *
 *    `vault.purge` reste dans « coffre et clés » : il détruit le COFFRE, pas
 *    une sélection d'éléments. (Le commentaire de tête du modèle mobile annonce
 *    les deux ; son CODE, qui est la référence, ne déplace que celui-là.)
 *
 * 2. LE REPLI PENCHE VERS « COFFRE ET CLÉS », plus vers « personnes ». Un type
 *    inconnu vient forcément d'une version plus récente du serveur, et les
 *    gestes de coffre y sont bien plus probables qu'un geste sur une personne.
 *    Surtout : un inconnu rangé dans « personnes » se serait glissé dans une
 *    liste de noms, là où il ne raconte rien de personne.
 */
export function activityFamily(eventType: string): ActivityFamilyId {
  if (eventType.startsWith('member.item.') || eventType.startsWith('vault.trash')) return 'items';
  if (eventType.startsWith('member.') || eventType === 'role.change') return 'members';
  return 'keys';
}

/** Les types d'une famille, dans l'ordre de la taxonomie. */
export function familyEventTypes(family: ActivityFamilyId): string[] {
  return ACTIVITY_EVENT_TYPES.filter((t) => activityFamily(t) === family);
}

const KNOWN_TYPES: ReadonlySet<string> = new Set(ACTIVITY_EVENT_TYPES);

export interface ActivityFilterSelection {
  /** Les familles cochées — VIDE veut dire « toutes », jamais « aucune ». */
  families: readonly ActivityFamilyId[];
  /** Les types cochés dans le menu — vide = toute la famille. */
  types: readonly string[];
}

/**
 * Ce qu'il faut passer en `?types=` — ou `null` quand il ne faut rien passer.
 *
 * Trois règles, dans cet ordre :
 *   1. les types explicites l'emportent, RÉDUITS aux familles cochées (un type
 *      resté coché d'une famille décochée montrerait des lignes que le filtre
 *      affiché prétend exclure) ;
 *   2. si cette réduction ne laisse rien, on retombe sur les familles — jamais
 *      sur une liste vide, que le worker refuse par 400 ;
 *   3. une sélection qui couvre TOUTE la taxonomie ne s'envoie pas.
 */
export function activityQueryTypes(sel: ActivityFilterSelection): string[] | null {
  const families: ActivityFamilyId[] =
    sel.families.length === 0 ? [...ACTIVITY_FAMILY_IDS] : [...new Set(sel.families)];
  const familyUnion = ACTIVITY_EVENT_TYPES.filter((t) => families.includes(activityFamily(t)));

  const wanted = [...new Set(sel.types)].filter(
    (t) => KNOWN_TYPES.has(t) && families.includes(activityFamily(t))
  );
  const types = wanted.length > 0 ? wanted : familyUnion;

  // Tout demander, c'est ne rien préciser : le fil complet est le défaut.
  if (types.length === ACTIVITY_EVENT_TYPES.length) return null;
  return types;
}

// ─────────────────────────────────────────────────────────────────────────────
// Les périodes
// ─────────────────────────────────────────────────────────────────────────────

export type ActivityPeriodId = '7d' | '30d' | '90d' | 'all';

export const ACTIVITY_PERIOD_IDS = ['7d', '30d', '90d', 'all'] as const;

const PERIOD_DAYS: Record<Exclude<ActivityPeriodId, 'all'>, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
};

/**
 * Les bornes d'une période. On ne pose JAMAIS `until` : la borne haute serait
 * « maintenant », c'est-à-dire l'instant du clic — un événement arrivé pendant
 * qu'on lit disparaîtrait de la page suivante sans que rien ne le dise.
 */
export function periodRange(
  period: ActivityPeriodId,
  nowMs: number
): { since?: number; until?: number } {
  if (period === 'all') return {};
  return { since: nowMs - PERIOD_DAYS[period] * 86_400_000 };
}

// ─────────────────────────────────────────────────────────────────────────────
// Le fichier
// ─────────────────────────────────────────────────────────────────────────────

/** Les amorces qu'un tableur interprète — voir l'en-tête. */
const FORMULA_LEADERS = new Set(['=', '+', '-', '@', '\t', '\r']);

/**
 * Une cellule CSV : anti-injection D'ABORD, guillemets ENSUITE.
 *
 * L'ordre est le fond du sujet. Préfixer après avoir mis entre guillemets
 * poserait le `'` hors du champ, où il ne protège rien et casse la ligne.
 *
 * Un NOMBRE sort tel quel : le préfixer ferait de la colonne « époque » du texte
 * qu'aucun tableur ne trie plus, et un nombre ne peut pas être une formule.
 */
export function csvField(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  let s = typeof value === 'string' ? value : String(value);
  if (s.length > 0 && FORMULA_LEADERS.has(s[0])) s = `'${s}`;
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

const csvRow = (cells: readonly unknown[]): string => cells.map(csvField).join(',');

/** L'état de confiance LOCAL d'un membre (C3) — jamais envoyé nulle part. */
export interface ActivityExportTrustRow {
  userId: string;
  state: string;
  reason: string;
  /** L'instant de la comparaison hors bande, quand elle vaut encore. */
  verifiedAt: number | null;
}

/** La couverture d'époques (C4) — le calcul est celui d'`epochCoverage`. */
export interface ActivityExportEpochs {
  currentEpoch: number;
  members: readonly MemberEpochRow[];
}

export interface ActivityExportInput {
  vaultId: string;
  vaultName: string;
  format: 'csv' | 'json';
  generatedAt: number;
  period: { since?: number; until?: number };
  filters: {
    families: readonly ActivityFamilyId[];
    types: readonly string[];
    actor: string | null;
  };
  events: readonly VaultActivityEventDTO[];
  /** Les adresses résolues sur CET appareil (annuaire + trombinoscope). */
  emailByUserId: ReadonlyMap<string, string>;
  /** Les titres déchiffrés sur CET appareil (store + corbeille). */
  nameByItemId: ReadonlyMap<string, string>;
  /** L'offre journalise-t-elle ? `false` = le fil est structurellement vide. */
  recorded: boolean;
  /** La lecture s'est arrêtée avant la fin (plafond de pages) — on l'avoue. */
  truncated: boolean;
  trust?: readonly ActivityExportTrustRow[] | null;
  epochs?: ActivityExportEpochs | null;
}

export interface ActivityExportFile {
  filename: string;
  mime: string;
  content: string;
}

/** L'instant en ISO, ou une cellule vide — jamais « Invalid Date ». */
const iso = (ms: number | null | undefined): string | null =>
  typeof ms === 'number' && Number.isFinite(ms) ? new Date(ms).toISOString() : null;

const metaString = (m: Record<string, unknown> | null, key: string): string | null =>
  typeof m?.[key] === 'string' ? (m[key] as string) : null;

const metaNumber = (m: Record<string, unknown> | null, key: string): number | null =>
  typeof m?.[key] === 'number' ? (m[key] as number) : null;

/** Les clés déjà sorties en colonnes : le reste part dans « Details ». */
const BROKEN_OUT = new Set(['item_id', 'role', 'new_epoch']);

interface ExportEventRow {
  occurredAt: string | null;
  occurredAtMs: number;
  eventType: string;
  family: ActivityFamilyId;
  actorUserId: string | null;
  actorEmail: string | null;
  targetId: string | null;
  itemId: string | null;
  itemName: string | null;
  role: string | null;
  epoch: number | null;
  details: Record<string, unknown> | null;
}

function toExportRow(
  e: VaultActivityEventDTO,
  emailByUserId: ReadonlyMap<string, string>,
  nameByItemId: ReadonlyMap<string, string>
): ExportEventRow {
  const meta = e.metadata ?? null;
  const itemId = metaString(meta, 'item_id');
  const rest: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta ?? {})) {
    if (!BROKEN_OUT.has(k)) rest[k] = v;
  }
  return {
    occurredAt: iso(e.occurredAt),
    occurredAtMs: e.occurredAt,
    eventType: e.eventType,
    family: activityFamily(e.eventType),
    actorUserId: e.actorUserId,
    actorEmail: e.actorUserId ? (emailByUserId.get(e.actorUserId) ?? null) : null,
    targetId: e.targetId,
    itemId,
    itemName: itemId ? (nameByItemId.get(itemId) ?? null) : null,
    role: metaString(meta, 'role'),
    epoch: metaNumber(meta, 'new_epoch'),
    details: Object.keys(rest).length > 0 ? rest : null,
  };
}

/** Le statut d'époque d'un membre — `epochCoverage` fait autorité. */
function epochStatuses(
  epochs: ActivityExportEpochs
): Array<{ userId: string; wrappedEpoch: number | null; status: string }> {
  const c = memberEpochCoverage(epochs.members, epochs.currentEpoch);
  const out: Array<{ userId: string; wrappedEpoch: number | null; status: string }> = [];
  for (const m of c.upToDate)
    out.push({ userId: m.userId, wrappedEpoch: m.wrappedEpoch ?? null, status: 'up_to_date' });
  for (const m of c.behind)
    out.push({ userId: m.userId, wrappedEpoch: m.wrappedEpoch ?? null, status: 'behind' });
  for (const m of c.unknown) out.push({ userId: m.userId, wrappedEpoch: null, status: 'unknown' });
  return out;
}

/**
 * Un nom de coffre → un morceau de nom de fichier. Le nom vit chiffré ; il
 * n'atterrit ici que parce que c'est l'utilisateur lui-même qui choisit où
 * enregistrer. Tout ce qui n'est pas une lettre latine ou un chiffre devient un
 * tiret : un nom exotique ne doit ni fabriquer un chemin (`../`) ni produire un
 * fichier que le système refuse d'écrire.
 */
function slug(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
}

export function buildActivityExport(input: ActivityExportInput): ActivityExportFile {
  const rows = input.events.map((e) => toExportRow(e, input.emailByUserId, input.nameByItemId));
  const jour = new Date(input.generatedAt).toISOString().slice(0, 10);
  const morceau = slug(input.vaultName);
  const base = morceau ? `filarr-activite-${morceau}-${jour}` : `filarr-activite-${jour}`;

  const trust = input.trust
    ? input.trust.map((r) => ({
        userId: r.userId,
        email: input.emailByUserId.get(r.userId) ?? null,
        state: r.state,
        reason: r.reason,
        verifiedAt: iso(r.verifiedAt),
      }))
    : null;
  const epochs = input.epochs
    ? {
        currentEpoch: input.epochs.currentEpoch,
        members: epochStatuses(input.epochs).map((m) => ({
          ...m,
          email: input.emailByUserId.get(m.userId) ?? null,
        })),
      }
    : null;

  if (input.format === 'json') {
    const doc = {
      schema: 'filarr.vault-activity/1',
      generatedAt: iso(input.generatedAt),
      vault: { id: input.vaultId, name: input.vaultName },
      period: { since: iso(input.period.since), until: iso(input.period.until) },
      filters: {
        families: [...input.filters.families],
        types: [...input.filters.types],
        actorUserId: input.filters.actor,
      },
      recorded: input.recorded,
      truncated: input.truncated,
      events: rows,
      ...(trust ? { trust } : {}),
      ...(epochs ? { keyEpochs: epochs } : {}),
    };
    return {
      filename: `${base}.json`,
      mime: 'application/json;charset=utf-8',
      content: JSON.stringify(doc, null, 2),
    };
  }

  const lines: string[] = [];
  lines.push(csvRow(['Key', 'Value']));
  lines.push(csvRow(['Vault', input.vaultName]));
  lines.push(csvRow(['Vault ID', input.vaultId]));
  lines.push(csvRow(['Generated', iso(input.generatedAt)]));
  lines.push(csvRow(['Period from', iso(input.period.since)]));
  lines.push(csvRow(['Period to', iso(input.period.until)]));
  lines.push(csvRow(['Families', input.filters.families.join(' ')]));
  lines.push(csvRow(['Types', input.filters.types.join(' ')]));
  lines.push(csvRow(['Actor', input.filters.actor]));
  lines.push(csvRow(['Recorded', input.recorded ? 'yes' : 'no']));
  // Écrit en toutes lettres : un export court ne doit pas se lire « il ne s'est
  // rien passé » quand il veut dire « on s'est arrêté là ».
  lines.push(csvRow(['Truncated', input.truncated ? 'yes' : 'no']));
  lines.push('');

  lines.push(csvRow(['Events']));
  lines.push(
    csvRow([
      'Date (UTC)',
      'Timestamp (ms)',
      'Event',
      'Family',
      'Actor',
      'Actor ID',
      'Target ID',
      'Item',
      'Item ID',
      'Role',
      'Key epoch',
      'Details',
    ])
  );
  for (const r of rows) {
    lines.push(
      csvRow([
        r.occurredAt,
        r.occurredAtMs,
        r.eventType,
        r.family,
        r.actorEmail,
        r.actorUserId,
        r.targetId,
        r.itemName,
        r.itemId,
        r.role,
        r.epoch,
        r.details ? JSON.stringify(r.details) : null,
      ])
    );
  }

  if (trust) {
    lines.push('');
    lines.push(csvRow(['Trust (this device only)']));
    lines.push(csvRow(['Member', 'User ID', 'Trust state', 'Reason', 'Verified at']));
    for (const r of trust) {
      lines.push(csvRow([r.email, r.userId, r.state, r.reason, r.verifiedAt]));
    }
  }

  if (epochs) {
    lines.push('');
    lines.push(csvRow([`Key epochs (current: ${epochs.currentEpoch})`]));
    lines.push(csvRow(['Member', 'User ID', 'Sealed epoch', 'Status']));
    for (const m of epochs.members) {
      lines.push(csvRow([m.email, m.userId, m.wrappedEpoch, m.status]));
    }
  }

  return {
    filename: `${base}.csv`,
    mime: 'text/csv;charset=utf-8',
    // La marque d'ordre d'octets : sans elle, Excel lit un CSV UTF-8 en
    // codage local et rend « éléments » illisible. CRLF : RFC 4180.
    content: `\uFEFF${lines.join('\r\n')}\r\n`,
  };
}
