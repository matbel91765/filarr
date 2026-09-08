/**
 * QUI PUBLIE — le nom revendique, et le badge qui, lui, se prouve.
 *
 * ── LA REGLE QUI TIENT TOUT ─────────────────────────────────────────────────
 *
 * Le PSEUDONYME est ecrit par celui qui publie. Il voyage dans l'enveloppe
 * signee, donc personne ne peut le modifier apres coup — mais rien n'empeche de
 * le choisir trompeur. « Equipe Filarr » se tape en dix secondes.
 *
 * Le BADGE, lui, ne vient jamais du nom : il vient d'une liste d'EMPREINTES
 * embarquee dans l'application (`OFFICIAL_FINGERPRINTS`). Une empreinte ne
 * s'emprunte pas, et le serveur ne peut pas accorder ce badge.
 *
 * C'est pourquoi les deux ne se separent jamais a l'ecran : un nom sans son
 * empreinte serait une affirmation sans preuve, et c'est exactement ce qu'un
 * usurpateur voudrait afficher.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';

import { isOfficialPublisher } from './trustModel';
import './marketplace.css';

export interface PublisherLineProps {
  /** Le pseudonyme, s'il y en a un. */
  author: string | null | undefined;
  fingerprint: string;
  /** `true` sur une fiche de detail : l'empreinte s'affiche en entier. */
  full?: boolean;
}

export const PublisherLine: React.FC<PublisherLineProps> = ({ author, fingerprint, full }) => {
  const { t } = useTranslation();
  const official = isOfficialPublisher(fingerprint);

  return (
    <span className={`mkt-publisher${official ? ' mkt-publisher--official' : ''}`}>
      {official && (
        <span className="mkt-publisher__badge" title={t('marketplace.publisher.officialHint')}>
          {t('marketplace.publisher.official')}
        </span>
      )}
      {/* Le nom vient du serveur : texte brut, isole, et jamais du HTML. */}
      <bdi className="mkt-publisher__name">
        {author && author !== '' ? author : t('marketplace.publisher.anonymous')}
      </bdi>
      {full && <span className="mkt-publisher__fp">{fingerprint}</span>}
    </span>
  );
};

export default PublisherLine;
