/**
 * Une clé absente DES DEUX LANGUES passe la parité — et c'est une classe entière
 * de défauts que rien ne voyait.
 *
 * LE DÉFAUT QUI L'A RÉVÉLÉE. `Settings.tsx` appelait
 * `t('settings.account', 'Compte & Synchronisation')` et la clé n'existait ni en
 * EN ni en FR. `scripts/i18n-parity.cjs` compare les deux ARBRES : une clé
 * absente des deux est parfaitement « à parité ». Le repli — écrit en français —
 * s'affichait donc à tout le monde, y compris à l'anglophone que le site vitrine
 * envoie chercher « Settings → Account & Sync ».
 *
 * UNE VARIANTE PLUS SOURNOISE, trouvée par le même balayage :
 * `t('settings.security.noFekWarning', …)`, alors que `settings.security` est une
 * CHAÎNE (« Sécurité »). Aucune clé ne peut vivre sous une feuille : celle-là
 * était inatteignable par construction, et le serait restée quoi qu'on ajoute au
 * fichier de traduction. Le contrôle ci-dessous la voit aussi, puisqu'il
 * RÉSOUT le chemin au lieu de le comparer.
 *
 * PORTÉE. Les écrans traversés par le parcours d'acceptation d'invitation, de
 * l'onboarding à l'écran de réglages où l'on colle le lien. Le reste de
 * l'application en compte encore près de deux cents, hors sujet ici : les
 * ajouter d'un coup ferait passer ce contrôle pour une dette plutôt que pour un
 * garde-fou. Élargir la liste au fur et à mesure est le mode d'emploi.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const LOCALES = join(__dirname, '../locales');
const SRC = join(__dirname, '../..');

const en = JSON.parse(readFileSync(join(LOCALES, 'en/translation.json'), 'utf8'));
const fr = JSON.parse(readFileSync(join(LOCALES, 'fr/translation.json'), 'utf8'));

/** Résout un chemin pointé — `undefined` si un maillon manque OU n'est pas un objet. */
function lookup(dict: unknown, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (acc, part) =>
        acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[part] : undefined,
      dict
    );
}

/** Les écrans que le parcours d'invitation traverse réellement. */
const JOURNEY_FILES = [
  'renderer/components/views/Settings/Settings.tsx',
  'renderer/components/settings/AccountSyncSection.tsx',
  'renderer/components/settings/CloudStorageTargetSection.tsx',
  'renderer/components/settings/OrgSwitcher.tsx',
  'renderer/components/settings/TwoFAChallengeModal.tsx',
  'renderer/components/vaults/PendingInviteHost.tsx',
  'renderer/components/vaults/InviteCodeEntry.tsx',
  // Le bandeau d'attente et le bandeau de l'accueil portent tous deux des phrases
  // du parcours : le premier est la SEULE trace de l'invitation avant que l'écran
  // d'acceptation puisse exister, le second est l'endroit où l'on cherche
  // naturellement « j'ai été invité ». La page des coffres (VaultsList) a
  // disparu en C6 : ses invitations vivent dans le bandeau, ses cartes dans
  // VaultCards — les deux héritent de sa place ici.
  'renderer/components/vaults/PendingInviteBanner.tsx',
  'renderer/components/vaults/VaultInboxBanner.tsx',
  'renderer/components/vaults/VaultCards.tsx',
  // La boîte de réception /me — le chemin d'acceptation SANS lien e-mail.
  'renderer/components/vaults/MyInvitationsList.tsx',
  'renderer/components/layout/RouteContent/RouteContent.tsx',
  'renderer/components/auth/VaultPasswordLock.tsx',
  'renderer/components/profiles/ProfilePicker.tsx',
  'renderer/components/profiles/ManageProfilesModal.tsx',
  'renderer/components/layout/Layout/Layout.tsx',
  'renderer/components/features/Onboarding.tsx',
  'renderer/components/features/OnboardingPairingStep.tsx',
  'renderer/components/views/Profile/Profile.tsx',
  /**
   * LA PAGE « GÉRER LE COFFRE » ET SA LIGNE D'INVITATION (F01→F05). C'est le
   * bout du parcours : l'hôte y invite, y voit ce qui a échoué, y réémet — et
   * F05 vient d'y écrire les phrases qui disent quoi faire quand il n'y a rien.
   * Un repli qui masquerait une de ces clés-là s'afficherait en français à
   * l'anglophone, sur l'écran même où l'on tente de réparer un accès. Plusieurs
   * de ces fichiers n'ont AUCUN appel à repli aujourd'hui : ils sont inscrits
   * pour le jour où quelqu'un en ajoutera un.
   */
  'renderer/components/vaults/settings/VaultSettingsView.tsx',
  'renderer/components/vaults/settings/OverviewTab.tsx',
  'renderer/components/vaults/settings/MembersTab.tsx',
  'renderer/components/vaults/settings/InvitationsTab.tsx',
  'renderer/components/vaults/settings/ActivityTab.tsx',
  'renderer/components/vaults/settings/DangerTab.tsx',
  'renderer/components/vaults/settings/AccessJourneyPanel.tsx',
  'renderer/components/vaults/VaultActivityPanel.tsx',
  'renderer/components/sharing/InviteRow.tsx',
  'renderer/components/sharing/ShareDialog.tsx',
];

/** `t('une.clé', 'un repli')` — la seule forme qui peut masquer une clé absente. */
const CALL_WITH_FALLBACK = /\bt\(\s*'([A-Za-z0-9_.-]+)'\s*,\s*'(?:[^'\\]|\\.)*'/g;

describe('les replis ne masquent aucune clé absente', () => {
  it('trouve bien des appels à contrôler (garde du garde)', () => {
    const total = JOURNEY_FILES.reduce(
      (n, f) => n + [...readFileSync(join(SRC, f), 'utf8').matchAll(CALL_WITH_FALLBACK)].length,
      0
    );
    // Si l'extraction cesse silencieusement de fonctionner, ce test le dit —
    // sans lui, une suite verte ne prouverait plus rien.
    expect(total).toBeGreaterThan(50);
  });

  it.each(JOURNEY_FILES)('%s : chaque clé existe dans les DEUX langues', (file) => {
    const source = readFileSync(join(SRC, file), 'utf8');
    const orphans = [...source.matchAll(CALL_WITH_FALLBACK)]
      .map((m) => m[1])
      .filter((key) => lookup(en, key) === undefined && lookup(fr, key) === undefined);

    expect([...new Set(orphans)], `clés absentes des deux locales : ${orphans.join(', ')}`).toEqual(
      []
    );
  });
});
