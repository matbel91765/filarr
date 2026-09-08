/**
 * PairingSasConfirm — le point d'attente humaine du protocole d'appairage v2.
 *
 * POURQUOI CET ÉCRAN EXISTE. Le transfert de la FEK repose sur un ECDH
 * éphémère. Un ECDH NON AUTHENTIFIÉ ne protège que d'un écoutant passif : le
 * serveur, qui achemine les messages, peut substituer sa propre clé publique à
 * celle du pair, déballer la clé du coffre, puis la ré-emballer vers le vrai
 * destinataire — qui ne verrait rien. Le chiffrement serait correct ; c'est
 * l'authentification qui manquerait.
 *
 * Le nombre affiché ici — le SAS — est dérivé du secret ECDH ET des deux clés
 * publiques réellement utilisées. Un intercepteur détient deux secrets
 * distincts et ne peut donc pas faire coïncider les deux écrans. La
 * comparaison faite par l'utilisateur est, à cet instant, LA SEULE AUTORITÉ
 * disponible : il n'existe aucune tierce partie à qui déléguer la question,
 * puisque c'est précisément le serveur qu'on soupçonne.
 *
 * D'où trois règles d'interface qui sont NORMATIVES et non ergonomiques :
 *
 *  1. Le nombre est groupé `NN NN NN`, alors que le code d'appairage est
 *     affiché en six chiffres accolés. Deux nombres à six chiffres coexistent
 *     pendant la cérémonie ; un groupement identique conduirait à comparer le
 *     mauvais, ou à saisir le SAS dans le champ « code ».
 *  2. Il n'y a PAS DE BOUTON PAR DÉFAUT et pas d'autofocus. Un délai, un
 *     focus, une touche Entrée réflexe ne doivent pas valoir confirmation. La
 *     confirmation est un geste positif ou n'est pas.
 *  3. En mode manuel — l'autre appareil a tapé le code au lieu de scanner —
 *     le SAS est la SEULE protection : le secret du QR n'a jamais existé. On
 *     le dit explicitement, avec un encadré distinct. L'interface ne doit pas
 *     présenter la comparaison comme une formalité.
 *
 * Le composant est PARTAGÉ par les deux rôles et par les trois écrans
 * (initiation, jonction, intégration). Ce n'est pas de la mutualisation de
 * confort : les deux appareils doivent rendre la même chaîne AU CARACTÈRE
 * PRÈS. Un `04 18 27` face à un `4 18 27` ferait refuser un appairage
 * légitime — ou, pire, habituerait l'utilisateur à valider des écarts.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/Button/Button';

export interface PairingSasConfirmProps {
  /** Le nombre déjà groupé `NN NN NN`, tel que calculé par le process principal. */
  sasDisplay: string;
  /** Mode déclaré par l'appareil d'en face : `qr` s'il a scanné, `manual` s'il a tapé. */
  mode: 'qr' | 'manual';
  /** Nom de l'appareil d'en face, pour que l'utilisateur sache où regarder. */
  peerDeviceName: string;
  onConfirm: () => void;
  onReject: () => void;
  /** Vrai pendant que le verdict est acheminé : évite un double envoi. */
  busy?: boolean;
}

const PairingSasConfirm: React.FC<PairingSasConfirmProps> = ({
  sasDisplay,
  mode,
  peerDeviceName,
  onConfirm,
  onReject,
  busy = false,
}) => {
  const { t } = useTranslation();

  return (
    <div className="py-2 text-center">
      <p className="text-sm mb-1" style={{ color: 'var(--color-text-primary)' }}>
        {t('pairing.sas.instruction', 'Comparez ce nombre avec celui affiché sur')}{' '}
        <strong>{peerDeviceName}</strong>
      </p>
      <p className="text-xs mb-4" style={{ color: 'var(--color-text-tertiary)' }}>
        {t(
          'pairing.sas.explanation',
          "S'ils sont identiques, personne ne s'est interposé entre vos deux appareils."
        )}
      </p>

      {/*
        Libellé DISTINCT de celui du code d'appairage : « Nombre de
        vérification » contre « Code d'appairage ». Sans cette distinction, les
        deux nombres se confondent à l'usage.
      */}
      <p
        className="text-xs font-medium uppercase mb-2"
        style={{ color: 'var(--color-text-tertiary)', letterSpacing: '0.08em' }}
      >
        {t('pairing.sas.label', 'Nombre de vérification')}
      </p>

      {/*
        Le nombre n'est ni sélectionnable ni copiable : il ne se compare qu'à
        l'œil. Le rendre copiable inviterait à le coller dans le champ « code »
        de l'autre appareil, ce qui n'a aucun sens et détruirait la session.
        `aria-label` épelle les groupes pour un lecteur d'écran, sinon
        « 147386 » serait annoncé comme un seul grand nombre, impossible à
        comparer à l'oreille.
      */}
      <div
        role="status"
        aria-label={`${t('pairing.sas.label', 'Nombre de vérification')} ${sasDisplay
          .split('')
          .join(' ')}`}
        className="inline-flex items-center justify-center rounded-lg mb-5 px-5 py-3"
        style={{
          backgroundColor: 'var(--color-background-secondary)',
          border: '2px solid var(--color-border)',
          color: 'var(--color-text-primary)',
          fontFamily: 'monospace',
          fontSize: '2.25rem',
          fontWeight: 700,
          letterSpacing: '0.12em',
          userSelect: 'none',
        }}
      >
        {sasDisplay}
      </div>

      {mode === 'manual' && (
        <div
          className="rounded-lg p-3 mb-4 text-left"
          style={{ backgroundColor: '#fef3c7', border: '1px solid #f59e0b' }}
        >
          <p className="text-xs font-medium" style={{ color: '#92400e' }}>
            {t(
              'pairing.sas.manualWarning',
              'Cet appareil a saisi le code à la main. Comparez les deux nombres avec attention.'
            )}
          </p>
        </div>
      )}

      {/*
        Deux actions explicites, aucune n'est « par défaut » : pas
        d'`autoFocus`, pas de `type="submit"`. Le refus n'est pas une sortie de
        secours discrète — c'est la réponse attendue quand les nombres
        diffèrent, et il doit être aussi visible que l'acceptation.
      */}
      <div className="flex flex-col gap-2">
        <Button variant="primary" fullWidth disabled={busy} onClick={onConfirm}>
          {t('pairing.sas.match', 'Les nombres sont identiques')}
        </Button>
        <Button variant="danger" fullWidth disabled={busy} onClick={onReject}>
          {t('pairing.sas.mismatch', 'Ils sont différents')}
        </Button>
      </div>
    </div>
  );
};

export default PairingSasConfirm;
