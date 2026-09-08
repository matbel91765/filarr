/**
 * Bloc « Bannière d'accueil » — le bandeau de bienvenue.
 *
 * Il ne lit RIEN du store : c'est le seul bloc entièrement statique, et c'est
 * pour ça qu'il ne re-rend jamais. Le sous-titre est un réglage — sur un accueil
 * qu'on a soi-même rangé, la phrase d'explication devient du bruit.
 *
 * ── DEUX STYLES, ET LE REPLI EST L'ANCIEN ───────────────────────────────────
 *
 *  · `welcome` — « Bienvenue dans Filarr » + sa phrase. C'est ce que le bloc a
 *    toujours affiché, et c'est le REPLI : un accueil déjà scellé ne porte pas
 *    l'option, et son bandeau ne doit pas changer sous les yeux de quelqu'un qui
 *    n'a rien demandé.
 *  · `live` — la salutation de l'heure et la date longue. C'est ce que le modèle
 *    « Essentiel » demande : une bannière qui dit la même chose tous les jours
 *    est un logo ; une qui dit le jour est un repère.
 *
 * La salutation et la date sont calculées AU RENDU. Elles ne se rafraîchissent
 * donc pas toutes seules à minuit — un minuteur qui réveillerait l'accueil
 * chaque minute pour surveiller le passage de « bonsoir » à « bonjour »
 * coûterait bien plus qu'il ne rapporte, et le prochain aller-retour sur la page
 * corrige l'affichage.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';

import {
  readBoolOption,
  readEnumOption,
  type WidgetOptionSchema,
  type WidgetProps,
} from '../widgetOptions';
import '../presets/homePresets.css';
import './blocks.css';

export const GREETING_OPTIONS: WidgetOptionSchema = [
  {
    kind: 'boolean',
    key: 'showSubtitle',
    labelKey: 'home.widgets.opt.showSubtitle',
    fallback: true,
  },
  {
    kind: 'enum',
    key: 'style',
    labelKey: 'home.widgets.opt.greetingStyle',
    fallback: 'welcome',
    choices: [
      { value: 'welcome', labelKey: 'home.widgets.opt.greetingWelcome' },
      { value: 'live', labelKey: 'home.widgets.opt.greetingLive' },
      // MINIMAL : le seul mot, en grand, rien d'autre. Une page d'accueil dont
      // le haut est occupe par trois lignes de politesse repousse d'autant ce
      // qu'on est venu chercher.
      { value: 'minimal', labelKey: 'home.widgets.opt.greetingMinimal' },
      // EMPILE : la date d'abord, en gros, le bonjour en dessous. Pour qui
      // ouvre son accueil pour savoir quel jour on est avant de savoir qu'on
      // lui dit bonjour.
      { value: 'stacked', labelKey: 'home.widgets.opt.greetingStacked' },
    ],
  },
];

/** Matin, après-midi, soir — les trois seuils habituels, en heure locale. */
function greetingKey(hour: number): 'morning' | 'afternoon' | 'evening' {
  if (hour < 12) return 'morning';
  if (hour < 18) return 'afternoon';
  return 'evening';
}

export const GreetingWidget: React.FC<WidgetProps> = React.memo(function GreetingWidget({
  options,
}) {
  const { t, i18n } = useTranslation();
  const showSubtitle = readBoolOption(GREETING_OPTIONS, options, 'showSubtitle');
  const style = readEnumOption(GREETING_OPTIONS, options, 'style');

  if (style === 'minimal' || style === 'stacked') {
    const now = new Date();
    const moment = greetingKey(now.getHours());
    const longDate = new Intl.DateTimeFormat(i18n.language, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    }).format(now);

    // Les deux variantes ont exactement le meme contenu et n'echangent que
    // l'ordre et les tailles. Ecrire deux blocs separes aurait donne deux
    // formats de date a maintenir.
    const hello = (
      <h1 key="hello" className="blk-greet__hello">
        {t(`home.greeting.${moment}`, 'Bonjour')}
      </h1>
    );
    const date = (
      <p key="date" className="blk-greet__date">
        {longDate}
      </p>
    );

    return (
      <div className={`home-column h-full blk-greet blk-greet--${style}`}>
        {style === 'stacked' ? [date, hello] : [hello]}
      </div>
    );
  }

  if (style === 'live') {
    const now = new Date();
    const moment = greetingKey(now.getHours());
    // La date longue est FORMATÉE PAR LE MOTEUR : « lundi 23 août » ne
    // s'assemble pas de la même façon d'une langue à l'autre, et une chaîne de
    // traduction à trous produirait « Monday 23 August » en anglais américain.
    const longDate = new Intl.DateTimeFormat(i18n.language, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    }).format(now);

    return (
      <div className="home-column h-full flex flex-col justify-center">
        <h1 className="text-2xl font-normal text-[var(--color-text-primary)] mb-1">
          {t(`home.greeting.${moment}`, 'Bonjour')}
        </h1>
        <p className="text-sm text-[var(--color-text-tertiary)] m-0 first-letter:uppercase">
          {longDate}
        </p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col justify-center">
      <h1 className="text-2xl font-normal text-[var(--color-text-primary)] mb-1">
        {t('home.welcome', 'Bienvenue dans Filarr')}
      </h1>
      {showSubtitle && (
        <p className="text-sm text-[var(--color-text-tertiary)] m-0">
          {t('home.subtitle', 'Gérez vos fichiers de manière simple et sécurisée')}
        </p>
      )}
    </div>
  );
});

export default GreetingWidget;
