/**
 * NewVaultAccessNotice — « X vous a donné accès à … », dans le bandeau d'accueil.
 *
 * LA MOITIÉ MANQUANTE DE L'AJOUT DIRECT (F06). Depuis la décision D1, donner
 * l'accès à quelqu'un qui est déjà membre de l'espace crée sa place
 * immédiatement : pas de jeton, pas d'acceptation, pas d'attente de sept jours.
 * C'est voulu — mais la personne n'apprenait RIEN. Aucune invitation dans sa
 * boîte de réception (il n'y en a pas), aucun accès promis (il est déjà
 * arrivé) : juste un dossier de plus à l'accueil, qu'il fallait remarquer. La
 * promesse « elle est prévenue dans l'application » n'était tenue nulle part.
 * Trois gestes passent par ce chemin — la ligne d'invitation quand l'adresse
 * est déjà dans l'espace, « Réinviter » sur une invitation échue, et le
 * balayage automatique des intentions d'accès — et aucun ne disait rien.
 *
 * COMMENT ON SAIT QU'UN COFFRE EST NOUVEAU, SANS RIEN DEMANDER AU SERVEUR : par
 * la différence entre ce qu'il liste et un registre LOCAL, par profil, des
 * coffres déjà vus (`vaultAccessSeen` + `newVaultAccessModel`). Le serveur n'a
 * pas de notion de « déjà vu » et ne doit pas en acquérir une.
 *
 * LE NOM DU COFFRE EST DÉCHIFFRÉ ICI, CHEZ ELLE. `vault.name` sort de
 * `toVaultSummary`, qui ouvre le scellé avec sa clé personnelle : le serveur
 * n'en apprend rien, et c'est pour cela que l'e-mail jumeau, lui, ne peut nommer
 * que l'espace.
 *
 * QUI A DONNÉ L'ACCÈS : `vault.invitedBy` est un identifiant OPAQUE ; l'adresse
 * se résout par le trombinoscope, qui la porte pour tout membre. Si rien ne se
 * résout, la phrase se passe de nom — jamais de nom deviné.
 *
 * POURQUOI UN HOOK EN PLUS DU COMPOSANT. Le bandeau d'accueil décide seul de
 * s'afficher ou de rendre `null`, et cette décision a besoin de savoir s'il y a
 * du neuf ICI. Deux instances du calcul auraient deux registres en mémoire, qui
 * divergeraient au premier « Écarter » : le bandeau appelle donc le hook une
 * fois et lui passe le résultat.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { Button } from '../ui';
import type { RootState } from '../../../store';
import type { VaultSummary } from '../../../store/slices/vaultsSlice';
import { apiListVaultMembers } from '../../../services/vault/vaultApi';
import { markKnown, resolveNewVaults, type KnownVaultsRegistry } from './newVaultAccessModel';
import { readKnownVaults, writeKnownVaults } from './vaultAccessSeen';

export interface NewVaultAccess {
  /** Les coffres arrivés sans qu'on ait rien accepté, dans l'ordre du serveur. */
  vaults: VaultSummary[];
  /** L'adresse de celui qui a donné l'accès, par coffre. `''` = irrésolue. */
  inviterEmails: Record<string, string>;
  /** Marquer un coffre vu — durablement, par profil. */
  markSeen: (vaultId: string) => void;
}

const VIDE: NewVaultAccess = { vaults: [], inviterEmails: {}, markSeen: () => {} };

export function useNewVaultAccess(userId: string | null): NewVaultAccess {
  const vaults = useSelector((s: RootState) => s.vaults.vaults);
  const vaultIds = useSelector((s: RootState) => s.vaults.vaultIds);
  /**
   * LA LISTE A-T-ELLE ABOUTI ? Semer le registre sur une liste pas encore
   * arrivée le remplirait de rien, et le chargement d'après annoncerait TOUS
   * les coffres du compte d'un coup — la salve exacte qu'on cherche à éviter.
   * `initialLoadRequested` ne suffit pas : il est posé dès `pending`.
   */
  const loadedOnce = useSelector((s: RootState) => s.vaults.listLoadedOnce);

  const [registre, setRegistre] = useState<{
    userId: string | null;
    value: KnownVaultsRegistry | null;
  }>(() => ({ userId, value: userId ? readKnownVaults(userId) : null }));

  if (registre.userId !== userId) {
    /**
     * LE REGISTRE SUIT LE COMPTE, ET IL LE SUIT PENDANT LE RENDU. Motif React
     * d'ajustement d'état : le relire dans un effet laisserait un rendu entier
     * calculé avec le registre du compte PRÉCÉDENT — donc, à la connexion, un
     * semis fait sur les coffres de quelqu'un d'autre. React jette ce rendu-ci
     * et recommence avant de valider quoi que ce soit : aucun effet ne part.
     */
    setRegistre({ userId, value: userId ? readKnownVaults(userId) : null });
  }
  const known = registre.userId === userId ? registre.value : null;

  const [inviterEmails, setInviterEmails] = useState<Record<string, string>>({});

  const outcome = useMemo(
    () => (loadedOnce && userId ? resolveNewVaults(vaultIds, known) : null),
    [loadedOnce, userId, vaultIds, known]
  );

  /**
   * LE SEMIS ET L'ÉLAGAGE SONT DES ÉCRITURES : hors du rendu. Le modèle ne rend
   * `nextKnownIds` que lorsqu'il y a vraiment quelque chose à écrire, donc la
   * boucle se referme d'elle-même — le calcul suivant rend `null`.
   */
  useEffect(() => {
    if (!userId || !outcome || outcome.nextKnownIds === null) return;
    const suivant: KnownVaultsRegistry = { ids: outcome.nextKnownIds, seeded: true };
    writeKnownVaults(userId, suivant);
    setRegistre({ userId, value: suivant });
  }, [outcome, userId]);

  /**
   * CE QU'ON ANNONCE VRAIMENT : un coffre neuf DONT L'ADHÉSION A ÉTÉ CRÉÉE PAR
   * QUELQU'UN D'AUTRE.
   *
   * Un coffre qu'on a créé soi-même porte `invited_by = soi` (c'est l'adhésion
   * fondatrice qui l'écrit) : sans ce filtre, créer un coffre sur un autre
   * appareil se lirait « on vous a donné accès à votre propre coffre ». Un
   * `invitedBy` absent — worker antérieur au champ — ne dit rien : on se tait
   * plutôt que d'annoncer à tort.
   *
   * Un accès reçu par invitation ACCEPTÉE tombe aussi ici, et c'est acceptable :
   * la phrase reste vraie, et un seul geste l'écarte.
   */
  const nouveaux = useMemo(() => {
    if (!outcome || !userId) return [];
    return outcome.newVaultIds
      .map((id) => vaults[id])
      .filter((v): v is VaultSummary => !!v && !!v.invitedBy && v.invitedBy !== userId);
  }, [outcome, vaults, userId]);

  /** Résout les adresses manquantes par le trombinoscope, une fois par coffre. */
  useEffect(() => {
    let vivant = true;
    const àRésoudre = nouveaux.filter((v) => inviterEmails[v.id] === undefined);
    if (àRésoudre.length > 0) {
      void Promise.all(
        àRésoudre.map(async (v) => {
          try {
            const membres = await apiListVaultMembers(v.id);
            // `email` est optionnel de bout en bout : un worker qui ne le sert
            // pas laisse la phrase sans nom, ce qui est le repli voulu.
            return [v.id, membres.find((m) => m.userId === v.invitedBy)?.email ?? ''] as const;
          } catch {
            return [v.id, ''] as const;
          }
        })
      ).then((paires) => {
        if (!vivant) return;
        setInviterEmails((e) => ({ ...e, ...Object.fromEntries(paires) }));
      });
    }
    // TOUJOURS un nettoyage, sur toutes les branches : un `return` conditionnel
    // dans un `useEffect` fait échouer la compilation (TS7030).
    return () => {
      vivant = false;
    };
  }, [nouveaux, inviterEmails]);

  const markSeen = useCallback(
    (vaultId: string) => {
      if (!userId) return;
      setRegistre((courant) => {
        const suivant = markKnown(courant.userId === userId ? courant.value : null, vaultId);
        writeKnownVaults(userId, suivant);
        return { userId, value: suivant };
      });
    },
    [userId]
  );

  return useMemo(
    () => (userId ? { vaults: nouveaux, inviterEmails, markSeen } : VIDE),
    [userId, nouveaux, inviterEmails, markSeen]
  );
}

interface Props {
  access: NewVaultAccess;
  /** Ouvrir le coffre — la suite naturelle de l'annonce. */
  onOpenVault: (vaultId: string) => void;
}

export const NewVaultAccessNotice: React.FC<Props> = ({ access, onOpenVault }) => {
  const { t } = useTranslation();
  const { vaults, inviterEmails, markSeen } = access;

  const ouvrir = useCallback(
    (vaultId: string) => {
      // Ouvrir VAUT écarter : l'annonce a été lue, et la laisser reviendrait à
      // redemander le même geste à chaque retour sur l'accueil.
      markSeen(vaultId);
      onOpenVault(vaultId);
    },
    [markSeen, onOpenVault]
  );

  if (vaults.length === 0) return null;

  return (
    <section aria-labelledby="vault-new-access-title" data-testid="new-vault-access">
      <p
        id="vault-new-access-title"
        className="text-sm font-medium text-[var(--color-text-primary)] m-0 mb-1"
      >
        {t('teamVaults.access.newTitle')}
      </p>
      <ul className="list-none m-0 p-0 flex flex-col gap-1.5">
        {vaults.map((v) => {
          // Le coffre peut être encore verrouillé (clé pas en mémoire) : on
          // annonce quand même, avec le mot que les cartes emploient déjà.
          const nom = v.name || t('teamVaults.locked');
          const email = inviterEmails[v.id];
          return (
            <li key={v.id} className="flex items-center justify-between gap-3">
              <span className="text-xs text-[var(--color-text-secondary)]">
                {email
                  ? t('teamVaults.access.newLine', { email, vault: nom })
                  : t('teamVaults.access.newLineUnknownWho', { vault: nom })}
                {' · '}
                {t(`teamVaults.role.${v.role}`, v.role)}
              </span>
              <span className="flex items-center gap-1 shrink-0">
                <Button variant="ghost" size="sm" onClick={() => ouvrir(v.id)}>
                  {t('teamVaults.access.openVault')}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => markSeen(v.id)}>
                  {t('teamVaults.access.newDismiss')}
                </Button>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
};

export default NewVaultAccessNotice;
