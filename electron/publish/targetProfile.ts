/**
 * LE PROFIL CIBLE — un profil NEUF, jamais une fusion.
 *
 * LE CAS RÉEL, celui qui a motivé la règle : le profil local s'appelle
 * « Mathis » et le compte contient déjà un « Mathis ». MÊME NOM NE VEUT PAS
 * DIRE MÊME PROFIL. Les réunir mélangerait deux arborescences sans que
 * personne l'ait demandé, et rien ne permettrait de les redéfaire. On crée
 * donc un profil distinct, au nom désambiguïsé ; le rapprochement éventuel
 * reste un geste explicite et ultérieur, hors de ce parcours.
 *
 * Module PUR. Les sondes réseau (manifeste nul ? noms occupés ?) sont faites
 * par l'appelant et entrent ici sous forme de faits.
 */

/**
 * Choix de l'identifiant du profil cible.
 *
 * LE TEST D'OCCUPATION EST « LE MANIFESTE EST NUL », JAMAIS « L'IDENTIFIANT
 * FIGURE DANS /sync/profiles » : le worker CRÉE la ligne `profiles_sync` au
 * premier GET de manifeste (`getOrCreateProfileSync`), donc l'identifiant de
 * cet appareil y figure toujours, y compris quand rien n'a jamais été monté.
 * Se fier à cette liste ferait frapper un UUID neuf à chaque migration — et
 * imposerait un déplacement de répertoire parfaitement inutile.
 *
 * Réutiliser l'identifiant local, quand il est libre, est de loin le meilleur
 * résultat : aucun déplacement de répertoire de blobs, aucune réécriture
 * d'identifiant, aucune migration de chemin.
 */
export function chooseTargetProfileId(
  localProfileId: string,
  remoteManifestIsNull: boolean,
  mintUuid: () => string
): string {
  return remoteManifestIsNull ? localProfileId : mintUuid();
}

/** Le worker impose ce format aux identifiants de profil. */
export const PROFILE_ID_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;

export function isValidTargetProfileId(id: string): boolean {
  return PROFILE_ID_REGEX.test(id);
}

/** Plafond de nom, aligné sur `profileMeta.name` côté manifeste. */
export const TARGET_NAME_MAX = 64;

export interface DisambiguateInput {
  /** Nom du profil local. */
  base: string;
  /**
   * Noms DÉJÀ occupés dans le compte — uniquement ceux dont le manifeste s'est
   * déchiffré sous la clé entrante. Un manifeste illisible sous cette clé
   * appartient à un autre domaine de clés : son nom ne contraint pas le nôtre.
   */
  occupiedNames: readonly string[];
  /**
   * FAUX dès qu'un manifeste a été injoignable ou illisible. On ne peut alors
   * PAS déduire un numéro : « (2) » affirmerait qu'il existe exactement un
   * « Mathis », ce qu'on ignore. On bascule sur le nom d'appareil, qui est vrai
   * quoi qu'il arrive.
   */
  complete: boolean;
  deviceName: string;
}

function norm(s: string): string {
  return s.normalize('NFC').trim();
}

/**
 * Tronque `base` — et JAMAIS le suffixe.
 *
 * Le suffixe est précisément ce qui distingue les deux profils ; le rogner
 * rendrait « Mathis (2) » et « Mathis (3) » identiques, c'est-à-dire
 * exactement le mélange que toute cette règle existe pour éviter.
 */
function fit(base: string, suffix: string): string {
  const room = TARGET_NAME_MAX - suffix.length;
  if (room <= 0) return suffix.slice(0, TARGET_NAME_MAX);
  return base.length <= room ? base + suffix : base.slice(0, room) + suffix;
}

/**
 * Nom du profil cible.
 *
 * La comparaison est EXACTE après NFC + trim, SENSIBLE À LA CASSE : « Mathis »
 * et « mathis » sont deux noms distincts. L'insensibilité imposerait une règle
 * de casse dépendante de la locale (le İ turc, pour ne citer que lui), donc un
 * comportement qui changerait avec la langue du système — inacceptable pour une
 * décision qui détermine où atterrissent des fichiers.
 */
export function disambiguateTargetName(input: DisambiguateInput): string {
  const base = norm(input.base) || 'Profil';
  const occupied = new Set(input.occupiedNames.map(norm));

  if (input.complete) {
    if (!occupied.has(fit(base, ''))) return fit(base, '');
    for (let n = 2; n < 1000; n++) {
      const candidate = fit(base, ` (${n})`);
      if (!occupied.has(candidate)) return candidate;
    }
    // 998 homonymes : on retombe sur la branche « incomplète », qui ne dépend
    // d'aucun décompte.
  }

  const device = norm(input.deviceName) || 'cet appareil';
  const withDevice = fit(base, ` (${device})`);
  if (!occupied.has(withDevice)) return withDevice;
  for (let n = 2; n < 1000; n++) {
    const candidate = fit(base, ` (${device} ${n})`);
    if (!occupied.has(candidate)) return candidate;
  }
  return withDevice;
}

// ── L'assignation complète, REPRISE COMPRISE ────────────────────────────────

export interface TargetAssignment {
  targetProfileId: string;
  targetName: string;
}

export interface AssignTargetsInput {
  /** Profils locaux, dans l'ordre de l'inventaire. */
  profiles: ReadonlyArray<{ id: string; name: string; orphan?: boolean }>;
  abandonedProfileIds: ReadonlySet<string>;
  /**
   * ASSIGNATIONS DÉJÀ CONSIGNÉES AU JOURNAL — elles font autorité, et ce n'est
   * pas un raccourci de performance.
   *
   * Sur une reprise après redémarrage, re-dériver l'identifiant cible
   * produirait un UUID NEUF dès qu'un manifeste a été poussé (le test
   * d'occupation verrait la place prise… par nous-mêmes), et tout ce qui a
   * déjà été monté deviendrait orphelin dans un profil que plus personne ne
   * viserait. Le journal est la mémoire de cette décision : pour un profil qui
   * y figure, NI la sonde distante NI le tirage d'UUID ne sont consultés.
   */
  previousAssignments: ReadonlyMap<string, TargetAssignment>;
  /** Noms déjà occupés dans le compte (manifestes lisibles sous la clé entrante). */
  occupiedNames: readonly string[];
  /** FAUX dès qu'un manifeste distant a été injoignable ou illisible. */
  complete: boolean;
  deviceName: string;
  /** Renommages décidés à l'écran, par profil local. */
  renames?: Record<string, string>;
}

export interface AssignTargetsPorts {
  /**
   * Sonde distante : le manifeste de cet identifiant est-il NUL ? N'est
   * consultée QUE pour un profil sans décision antérieure.
   */
  remoteManifestIsNull(profileId: string): Promise<boolean>;
  mintUuid(): string;
}

/**
 * Assigne un profil cible à chaque profil local non abandonné.
 *
 * Module pur : les sondes réseau entrent par les ports, et le test qui garde
 * la reprise (`publishTargetAssignment.test.ts`) les fait LEVER pour prouver
 * qu'une décision déjà consignée n'est jamais re-tirée au sort.
 */
export async function assignTargets(
  input: AssignTargetsInput,
  ports: AssignTargetsPorts
): Promise<Record<string, TargetAssignment>> {
  const targets: Record<string, TargetAssignment> = {};
  const takenNames = [...input.occupiedNames];

  for (const profile of input.profiles) {
    if (input.abandonedProfileIds.has(profile.id)) continue;

    const previous = input.previousAssignments.get(profile.id);
    if (previous) {
      targets[profile.id] = {
        targetProfileId: previous.targetProfileId,
        targetName: previous.targetName,
      };
      takenNames.push(previous.targetName);
      continue;
    }

    const remoteIsNull = await ports.remoteManifestIsNull(profile.id);
    const targetProfileId = chooseTargetProfileId(profile.id, remoteIsNull, ports.mintUuid);
    const baseName =
      input.renames?.[profile.id] ??
      (profile.orphan ? `Coffre retrouvé (${profile.id.slice(0, 6)})` : profile.name);
    const targetName = disambiguateTargetName({
      base: baseName,
      occupiedNames: takenNames,
      complete: input.complete,
      deviceName: input.deviceName,
    });
    takenNames.push(targetName);
    targets[profile.id] = { targetProfileId, targetName };
  }

  return targets;
}
