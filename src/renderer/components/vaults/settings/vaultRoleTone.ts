/**
 * La teinte du badge d'un rôle DE COFFRE.
 *
 * `RoleBadge` d'`AdminPrimitives` ne convient pas : il est typé `OrgRole`
 * (owner / admin / security_admin / editor / viewer), qui est la matrice de
 * l'ESPACE. Un coffre a la sienne — owner / admin / member / viewer — et lui
 * passer un rôle de coffre compilerait sans erreur (les deux unions partagent
 * trois mots) puis afficherait une clé de traduction absente pour `member`.
 *
 * D'où cette carte locale, la même que celle que portait `VaultMembersPanel`.
 */

import type { BadgeTone } from '../../settings/enterprise/AdminPrimitives';

export const VAULT_ROLE_TONE: Record<string, BadgeTone> = {
  owner: 'brand',
  admin: 'info',
  member: 'neutral',
  viewer: 'neutral',
};
