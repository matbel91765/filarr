/**
 * La clé d'accès à créer chez le fournisseur, GÉNÉRÉE — plus jamais « une clé
 * lecture/écriture » laissée à l'interprétation.
 *
 * Le vrai risque que ceci ferme : l'utilisateur qui colle sa clé ROOT parce
 * que composer une politique IAM est pénible. On lui donne l'artefact exact :
 * un JSON IAM borné à SON préfixe (`users/<id>/…`) pour les fournisseurs qui
 * parlent IAM, la commande CLI pour B2 (qui borne par `namePrefix`), la marche
 * à suivre console pour ceux qui ne scopent que par bucket.
 *
 * NOTE sur ListBucket : il est accordé sur TOUT le bucket, sans condition de
 * préfixe — HeadBucket (le « Tester » de l'écran) passe par cette permission
 * et une condition `s3:prefix` le ferait refuser. Conséquence assumée : la clé
 * peut LISTER les noms d'objets du bucket entier, mais ne lit/écrit que sous
 * le préfixe. Sur un bucket dédié à Filarr (recommandé), c'est sans objet.
 */

import type { StorageProvider } from './storageTargetApi';

export interface IamRecipe {
  /** 'json' = politique à coller ; 'command' = ligne CLI ; 'console' = marche à suivre seule. */
  kind: 'json' | 'command' | 'console';
  /** Le contenu copiable (JSON ou commande) — absent pour 'console'. */
  content?: string;
  /** Clé i18n de la note qui accompagne (settings.accountSync.byos.*). */
  noteKey: 'iamNoteJson' | 'iamNoteB2' | 'iamNoteR2' | 'iamNoteConsole';
}

const BUCKET_PLACEHOLDER = 'VOTRE_BUCKET';

function awsPolicyJson(bucket: string, userId: string): string {
  const b = bucket || BUCKET_PLACEHOLDER;
  return JSON.stringify(
    {
      Version: '2012-10-17',
      Statement: [
        {
          Sid: 'FilarrHeadAndList',
          Effect: 'Allow',
          Action: ['s3:ListBucket'],
          Resource: `arn:aws:s3:::${b}`,
        },
        {
          Sid: 'FilarrObjectsOwnPrefixOnly',
          Effect: 'Allow',
          Action: [
            's3:GetObject',
            's3:PutObject',
            's3:DeleteObject',
            's3:AbortMultipartUpload',
            's3:ListMultipartUploadParts',
          ],
          Resource: `arn:aws:s3:::${b}/users/${userId}/*`,
        },
      ],
    },
    null,
    2
  );
}

export function buildIamRecipe(
  provider: StorageProvider,
  bucket: string,
  userId: string | null
): IamRecipe | null {
  // Sans identifiant de compte, le préfixe est inconnaissable : pas de recette
  // approximative — le bloc ne s'affiche pas.
  if (!userId) return null;
  switch (provider) {
    case 's3':
    case 'wasabi':
    case 'custom': // MinIO, Garage : dialecte IAM AWS
      return { kind: 'json', content: awsPolicyJson(bucket, userId), noteKey: 'iamNoteJson' };
    case 'b2':
      return {
        kind: 'command',
        content: `b2 key create --bucket ${bucket || BUCKET_PLACEHOLDER} --name-prefix "users/${userId}/" cle-filarr listFiles,readFiles,writeFiles,deleteFiles`,
        noteKey: 'iamNoteB2',
      };
    case 'r2':
      return { kind: 'console', noteKey: 'iamNoteR2' };
    case 'scaleway':
    case 'ovh':
      return { kind: 'console', noteKey: 'iamNoteConsole' };
    default:
      return null;
  }
}
