/**
 * LE DÉPLACEMENT DES PROFILS RENOMMÉS — la moitié IDENTITÉ de la bascule.
 *
 * ═══ POURQUOI CE MODULE EXISTE ═══
 *
 * Quand un UUID neuf a dû être frappé (`relocated === true`), la bascule change
 * la CLÉ mais le contenu publié vit désormais sous un AUTRE identifiant de
 * profil. Si l'appareil garde l'ancien identifiant actif, le cycle ordinaire
 * lit le manifeste nuage de l'ANCIEN profil — scellé sous l'ANCIENNE clé — avec
 * la NOUVELLE clé, échoue, et conclut « clé forkée ». C'est la panne constatée
 * sur mobile (`profile_key_mismatch`) : la clé du compte, mais l'identité
 * d'avant. Le déplacement doit donc faire TOUT, ou lever :
 *
 *   1. le RÉPERTOIRE du profil (qui emporte avec lui la copie de clé par-profil
 *      — `wrapped_fek.json` / `.fek_safe` — déjà PROMUE par S4, qui précède ce
 *      module dans `finishSwitch`) ;
 *   2. l'ENTRÉE du registre local des profils (`profiles.json`) : identifiant
 *      ET nom ;
 *   3. le PROFIL ACTIF, s'il pointait sur l'ancien identifiant.
 *
 * ═══ LES DEUX RÈGLES DE CONDUITE ═══
 *
 * R-A — UN ÉCHEC LÈVE, IL NE SE LOGGE PAS. Ce module court entre S4 et S6 : si
 *   le déplacement échoue, la bascule NE DOIT PAS conclure `DONE` — un `DONE`
 *   avec une identité à moitié déplacée est exactement la maladie décrite plus
 *   haut. En levant, le journal reste `SWITCHING` (pivot posé), et la reprise
 *   au démarrage rejoue `finishSwitch`, donc CE module, jusqu'à convergence.
 *
 * R-B — LA RÉPARATION DU REGISTRE EST TOUJOURS DUE. Une mort de l'application
 *   entre le renommage du répertoire et l'écriture du registre laisse un
 *   déplacement à moitié fait : répertoire au nouvel emplacement, registre
 *   pointant encore sur l'ancien identifiant. À la reprise, « le répertoire
 *   cible existe déjà » signifie « le renommage est acquis », JAMAIS « tout est
 *   fait » : la réparation du registre est tentée à chaque passe, et elle est
 *   idempotente (une entrée déjà réparée est un no-op).
 *
 * Module PUR : disque et registre entrent par des ports, pour que les morts
 * simulées se testent sans process principal.
 */

import type { PublishTargetProfile } from './types';

/**
 * La forme MINIMALE du registre des profils que le déplacement doit corriger.
 * Structurellement compatible avec le `ProfilesManifest` de `profileManager` —
 * le module mute l'objet reçu et le repasse tel quel à `writeRegistry`.
 */
export interface RelocatableRegistry {
  activeProfileId: string | null;
  profiles: Array<{ id: string; name: string }>;
}

export interface RelocationPorts {
  /** Chemin du répertoire d'un profil (même dérivation que l'orchestrateur). */
  profileDir(profileId: string): string;
  dirExists(dir: string): Promise<boolean>;
  /** DOIT lever en cas d'échec — voir R-A : jamais d'échec silencieux ici. */
  renameDir(from: string, to: string): Promise<void>;
  /** `null` = pas de registre lisible (coffre monolithique hérité). */
  readRegistry(): Promise<RelocatableRegistry | null>;
  /** Reçoit LE MÊME objet que `readRegistry` a rendu, mutations comprises. */
  writeRegistry(registry: RelocatableRegistry): Promise<void>;
}

export interface RelocationReport {
  /** Répertoires effectivement renommés lors de CETTE passe. */
  movedDirs: string[];
  /** Entrées de registre corrigées (id, nom ou profil actif) lors de cette passe. */
  repairedRegistryIds: string[];
}

/**
 * Déplace chaque profil `relocated` : répertoire, registre, profil actif.
 *
 * Idempotent de bout en bout — c'est la même règle que la promotion de clés :
 * la reprise rejoue la passe entière, et une passe déjà convergée ne touche
 * plus rien (aucun renommage, aucune écriture de registre).
 */
export async function relocatePublishedProfiles(
  targets: readonly PublishTargetProfile[],
  ports: RelocationPorts
): Promise<RelocationReport> {
  const report: RelocationReport = { movedDirs: [], repairedRegistryIds: [] };
  const relocated = targets.filter((t) => t.relocated);
  if (relocated.length === 0) return report;

  const registry = await ports.readRegistry();

  for (const target of relocated) {
    const from = ports.profileDir(target.localProfileId);
    const to = ports.profileDir(target.targetProfileId);

    // ── 1. Le répertoire ──
    if (!(await ports.dirExists(to))) {
      if (await ports.dirExists(from)) {
        // Lève en cas d'échec (R-A). Le renommage emporte le répertoire ENTIER,
        // donc la copie de clé par-profil promue par S4 voyage avec lui.
        await ports.renameDir(from, to);
        report.movedDirs.push(target.localProfileId);
      }
      // Ni `from` ni `to` : aucun répertoire à déplacer (profil sans données
      // locales sur le disque) — la réparation du registre reste due.
    }
    // `to` existe déjà : DEUX lectures possibles, et on ne tranche pas à
    // l'aveugle. Ou bien le renommage est ACQUIS (reprise après une mort
    // entre le renommage et l'écriture du registre) — `from` n'existe plus.
    // Ou bien `from` existe ENCORE : le répertoire cible a été créé par un
    // AUTRE chemin (profil cible adopté par la découverte pendant la
    // fenêtre de migration — l'artéfact exact du défaut D). Dans ce second
    // cas le répertoire local porte des données que la cible n'a pas
    // forcément en local ; on ne fusionne jamais des octets à l'aveugle et
    // on n'écrase rien — le répertoire local reste en place, orphelin
    // lisible (clé conservée), et la réparation du REGISTRE reste due.

    // ── 2 et 3. Le registre : entrée + profil actif ──
    if (!registry) continue; // Coffre hérité sans registre : rien à réparer.
    let changed = false;
    const entry = registry.profiles.find((p) => p.id === target.localProfileId);
    if (entry) {
      const duplicate = registry.profiles.find((p) => p.id === target.targetProfileId);
      if (duplicate) {
        // FUSION, comme au mobile (`renameProfileEntry`) : le registre a
        // déjà une entrée à l'identifiant cible — adoptée pendant la
        // fenêtre de migration. Renommer l'entrée locale par-dessus
        // créerait DEUX entrées au même identifiant, et le sélecteur de
        // profils montrerait deux fois le même coffre. L'entrée adoptée
        // reste (elle porte déjà le bon identifiant) ; l'entrée locale
        // disparaît du registre — ses octets, eux, ne bougent pas.
        registry.profiles = registry.profiles.filter((p) => p.id !== target.localProfileId);
        duplicate.name = target.targetName;
      } else {
        entry.id = target.targetProfileId;
        entry.name = target.targetName;
      }
      changed = true;
    }
    if (registry.activeProfileId === target.localProfileId) {
      registry.activeProfileId = target.targetProfileId;
      changed = true;
    }
    if (changed) {
      // Écrit APRÈS le renommage du répertoire, par profil : une mort entre
      // les deux laisse l'état que R-B sait réparer à la passe suivante.
      await ports.writeRegistry(registry);
      report.repairedRegistryIds.push(target.localProfileId);
    }
  }

  return report;
}
