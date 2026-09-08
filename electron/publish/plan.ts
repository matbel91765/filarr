/**
 * LE PLAN DE MIGRATION — l'inventaire, son ordre, et la preuve qu'il est complet.
 *
 * CE QUE CE MODULE GARANTIT, ET POURQUOI C'EST VITAL. La FEK est GLOBALE à
 * l'appareil : il n'existe pas une clé par profil, tous les profils locaux sont
 * scellés sous la MÊME clé, et basculer la clé les casse TOUS à la fois. Un
 * plan qui couvrirait un seul profil puis autoriserait la bascule serait une
 * destruction déguisée en succès. D'où la règle centrale d'ici : tout profil
 * local est soit COUVERT, soit ABANDONNÉ EXPLICITEMENT — jamais implicitement,
 * jamais « et le reste ».
 *
 * Module PUR : il reçoit un inventaire déjà énuméré (`inventoryScan.ts` fait le
 * disque) et rend un ordre, des compteurs et des verdicts.
 */

import type {
  PublishAbandonedProfile,
  PublishBlocker,
  PublishCounters,
  PublishItem,
  PublishLocalProfile,
  PublishTargetProfile,
} from './types';

export interface TargetAssignment {
  targetProfileId: string;
  targetName: string;
}

export interface PublishPlanInput {
  /** Union du manifeste de profils ET des répertoires trouvés sur le disque. */
  profiles: PublishLocalProfile[];
  /** Tous les éléments énumérés, dans n'importe quel ordre. */
  items: PublishItem[];
  /** Profils que l'utilisateur a explicitement, nommément, renoncé à publier. */
  abandonedProfileIds: readonly string[];
  /** Assignation profil local → profil cible NEUF. Une par profil non abandonné. */
  targets: Readonly<Record<string, TargetAssignment>>;
  /**
   * Plafond par élément. `null` sur le bureau : le transcodage streame, il n'y
   * a rien à plafonner. Le mobile passe 64 Mio (aucun scellement par morceaux
   * n'y existe encore).
   */
  maxItemBytes: number | null;
  now: string;
}

export interface PublishPlan {
  /** L'ordre canonique de traitement. Reproductible à l'identique. */
  order: PublishItem[];
  /**
   * Éléments qu'AUCUNE clé n'ouvre. Ils ne sont pas « à migrer » : on ne tente
   * rien sur eux, on les compte, on les nomme, et leurs octets restent
   * strictement intacts sur le disque.
   */
  damagedAtScan: PublishItem[];
  targetProfiles: PublishTargetProfile[];
  abandonedProfiles: PublishAbandonedProfile[];
  blockers: PublishBlocker[];
  counters: PublishCounters;
}

/**
 * Ordre canonique — et la raison de chaque critère :
 *
 *  1. profils par `order` croissant, puis identifiant croissant à égalité :
 *     deux constructions successives donnent la même suite, donc la reprise
 *     reprend au même endroit.
 *  2. dans un profil : les `folder-meta` d'abord (petites, et leur perte serait
 *     silencieuse), puis le `notes-bundle`, puis les blobs PAR TAILLE
 *     CROISSANTE.
 *
 * Les petits d'abord, c'est la décision qui fait qu'une migration interrompue
 * au bout de deux minutes a déjà mis à l'abri le plus grand nombre d'éléments —
 * et que la barre de progression bouge tôt, ce qui n'est pas cosmétique : une
 * barre immobile pousse l'utilisateur à tuer l'application.
 */
function compareItems(a: PublishItem, b: PublishItem): number {
  const rank = (k: PublishItem['kind']): number =>
    k === 'folder-meta' ? 0 : k === 'notes-bundle' ? 1 : 2;
  const dr = rank(a.kind) - rank(b.kind);
  if (dr !== 0) return dr;
  if (a.kind === 'blob') {
    if (a.size !== b.size) return a.size - b.size;
  }
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

function compareProfiles(a: PublishLocalProfile, b: PublishLocalProfile): number {
  if (a.order !== b.order) return a.order - b.order;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Construit le plan.
 *
 * Lève quand un profil non abandonné n'a pas de profil cible : c'est un
 * invariant, pas une erreur d'utilisateur, et le laisser passer produirait
 * exactement le plan silencieusement incomplet que ce module existe pour
 * empêcher.
 */
export function buildPublishPlan(input: PublishPlanInput): PublishPlan {
  const abandoned = new Set(input.abandonedProfileIds);
  const profiles = [...input.profiles].sort(compareProfiles);

  const byProfile = new Map<string, PublishItem[]>();
  for (const item of input.items) {
    const bucket = byProfile.get(item.localProfileId);
    if (bucket) bucket.push(item);
    else byProfile.set(item.localProfileId, [item]);
  }

  const order: PublishItem[] = [];
  const damagedAtScan: PublishItem[] = [];
  const blockers: PublishBlocker[] = [];
  const targetProfiles: PublishTargetProfile[] = [];
  const abandonedProfiles: PublishAbandonedProfile[] = [];
  const counters: PublishCounters = {
    totalItems: 0,
    doneItems: 0,
    damagedItems: 0,
    totalBytes: 0,
    doneBytes: 0,
  };

  for (const profile of profiles) {
    const items = (byProfile.get(profile.id) ?? []).slice().sort(compareItems);

    if (abandoned.has(profile.id)) {
      // Un profil NON PUBLIÉ n'entre NI dans l'ordre NI dans les compteurs —
      // mais il reste nommé, compté et affiché jusque dans le reçu final. Un
      // choix qui disparaîtrait de l'écran serait un choix qu'on ne peut plus
      // relire ni regretter.
      //
      // CE QUE « NON PUBLIÉ » VEUT DIRE, EXACTEMENT. Depuis que l'ancienne clé
      // est conservée en lecture après la bascule (`retiredKey.ts`), ce profil
      // n'est PAS condamné : ses octets restent scellés sous une clé que
      // l'appareil détient toujours, donc il continue de s'ouvrir. Il reste
      // simplement LOCAL — sa copie nuage n'existe pas sous la clé du compte,
      // et les autres appareils ne le verront pas. C'est cette information-là
      // que l'écran doit donner, et non plus un avertissement de destruction.
      abandonedProfiles.push({
        localProfileId: profile.id,
        name: profile.name,
        itemCount: items.length,
        byteCount: items.reduce((sum, it) => sum + it.size, 0),
        acceptedAt: input.now,
      });
      continue;
    }

    const target = input.targets[profile.id];
    if (!target) {
      throw new Error(
        `[publish] Profil local ${profile.id} sans profil cible et non abandonné — ` +
          'plan refusé (la bascule casserait ce profil sans que personne ne l ait décidé).'
      );
    }

    let itemCount = 0;
    let byteCount = 0;
    let notesBundle = false;

    for (const item of items) {
      // Trop volumineux pour l'outillage de cette plateforme : ni scellement ni
      // chiffrement de transport par morceaux. Ce N'EST PAS un `damaged` — le
      // fichier est parfaitement lisible, c'est l'outil qui manque — donc il
      // n'est jamais proposé à l'abandon : il BLOQUE, et l'utilisateur le sort
      // du coffre ou annule.
      if (input.maxItemBytes !== null && item.kind === 'blob' && item.size > input.maxItemBytes) {
        blockers.push({
          kind: 'oversize',
          localProfileId: profile.id,
          itemKey: item.key,
          name: item.localPath.split('/').pop() ?? item.localPath,
          size: item.size,
        });
        continue;
      }

      itemCount += 1;
      byteCount += item.size;
      if (item.kind === 'notes-bundle') notesBundle = true;

      if (item.keyClass === 'none') {
        // Déjà illisible AVANT la migration. On le compte pour que le total ne
        // mente pas, on le nomme, et on ne le touche pas.
        damagedAtScan.push(item);
      } else {
        order.push(item);
      }
    }

    counters.totalItems += itemCount;
    counters.totalBytes += byteCount;

    targetProfiles.push({
      localProfileId: profile.id,
      targetProfileId: target.targetProfileId,
      targetName: target.targetName,
      itemCount,
      byteCount,
      notesBundle,
      relocated: target.targetProfileId !== profile.id,
    });
  }

  return { order, damagedAtScan, targetProfiles, abandonedProfiles, blockers, counters };
}

export type CoverageVerdict =
  | { ok: true }
  | { ok: false; uncoveredProfileIds: string[] };

/**
 * TOUS les profils locaux sont-ils traités ?
 *
 * Le verdict qui garde [R2]. Un profil ni couvert ni abandonné INTERDIT la
 * bascule : la clé est globale, l'oublier c'est le condamner. On rend la liste
 * des identifiants pour que l'écran puisse les NOMMER — un message qui dirait
 * « certains profils » laisserait l'utilisateur consentir à l'aveugle.
 */
export function verifyProfileCoverage(
  profiles: readonly PublishLocalProfile[],
  plan: Pick<PublishPlan, 'targetProfiles' | 'abandonedProfiles'>
): CoverageVerdict {
  const covered = new Set<string>();
  for (const t of plan.targetProfiles) covered.add(t.localProfileId);
  for (const a of plan.abandonedProfiles) covered.add(a.localProfileId);

  const uncovered = profiles.map((p) => p.id).filter((id) => !covered.has(id));
  return uncovered.length === 0 ? { ok: true } : { ok: false, uncoveredProfileIds: uncovered };
}

/**
 * Comparaison de nom de profil pour une confirmation tapée.
 *
 * CE QU'ELLE N'EST PLUS. Elle gardait autrefois la BASCULE : il fallait retaper
 * le nom d'un profil non publié pour consentir à le rendre illisible. Cette
 * cérémonie n'a plus d'objet — un profil non publié reste parfaitement lisible
 * sur cet appareil (l'ancienne clé est conservée, voir `retiredKey.ts`) ; il
 * reste seulement local. Confirmer une destruction qui n'a pas lieu serait
 * mentir à l'utilisateur sur ce qu'il consent.
 *
 * Elle demeure pour la décision INDIVIDUELLE « ne pas publier ce profil », qui,
 * elle, reste un choix explicite et nommé.
 *
 * La comparaison est exacte après `trim` + NFC — la même règle que la
 * désambiguïsation des noms cibles, pour qu'un utilisateur qui voit « Perso »
 * à l'écran et tape « Perso » soit accepté quelle que soit la forme Unicode
 * que porte la chaîne stockée.
 */
export function acceptsAbandonConfirmation(profileName: string, typed: string): boolean {
  return profileName.normalize('NFC').trim() === typed.normalize('NFC').trim();
}
