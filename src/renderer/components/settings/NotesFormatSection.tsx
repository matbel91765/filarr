/**
 * NotesFormatSection — le bouton qui fait passer les notes au rangement v2.
 *
 * ═══ CE QUE LA BASCULE CHANGE, ET CE QU'ELLE NE CHANGE PAS ═══
 *
 * Elle change le RANGEMENT, pas le modèle : toutes les notes vivaient dans un
 * seul fichier chiffré, elles auront chacune le leur. Rien d'autre ne bouge —
 * ni le contenu, ni les carnets, ni l'historique, ni le chiffrement.
 *
 * Ce que ça gagne : aujourd'hui, taper une virgule dans une note fait repartir
 * la bibliothèque entière (dix mégaoctets sur un coffre chargé d'images, et
 * autant à déchiffrer, fusionner et resceller). Après, seule la note touchée
 * bouge.
 *
 * ═══ TROIS CHOSES QUE CET ÉCRAN DOIT DIRE, ET QU'IL DIT ═══
 *
 * 1. QUE C'EST RÉVERSIBLE. L'ancien fichier n'est jamais supprimé. Personne ne
 *    devrait avoir à deviner si un bouton de migration détruit quelque chose.
 * 2. POURQUOI C'EST PARFOIS REFUSÉ, en toutes lettres. Un bouton grisé sans
 *    raison est indiscernable d'une panne — et la raison est ici toujours utile :
 *    « un autre appareil écrit encore à l'ancien format », c'est-à-dire « migrez
 *    celui-là d'abord ».
 * 3. QU'IL FAUT MIGRER TOUS SES APPAREILS. Le garde-fou couvre le cas courant,
 *    pas un ordinateur rallumé après deux mois.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  migrateNotesToV2,
  readNotesFormat,
  type NotesFormatState as FormatState,
} from '../../../services/notes/notesFormatGateway';

export const NotesFormatSection: React.FC = () => {
  const { t } = useTranslation();
  const [state, setState] = useState<FormatState | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    // La couture décide seule où poser la question — IPC au bureau, IndexedDB
    // dans le navigateur. Cet écran n'a pas à savoir laquelle il a obtenue.
    setState(await readNotesFormat());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // `null` = on n'a pas su lire le format. Ce n'est PAS « v1 » : plutôt se
  // cacher que proposer de réécrire un coffre dont on ignore l'état.
  if (!state || state.format === 'none') return null;

  const migrer = async (acknowledgeLegacyWriter = false): Promise<void> => {
    setBusy(true);
    setOutcome(null);
    try {
      const res = await migrateNotesToV2({ acknowledgeLegacyWriter });
      setOutcome(
        res?.ok
          ? t('settings.notesFormat.done', '{{count}} notes rangées une par une.', {
              count: res.noteCount ?? 0,
            })
          : t('settings.notesFormat.failed', 'La bascule n’a pas eu lieu ({{why}}).', {
              why: res?.why ?? 'inconnu',
            })
      );
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const dejaV2 = state.format === 'v2';
  const bloque = state.verdict !== 'safe';
  // Un ecrivain v1 actif n'est plus une impasse : le pont le sert. La bascule
  // reste un geste explicite, apres avoir lu pourquoi elle etait retenue.
  const franchissable = state.verdict === 'legacy-active';

  return (
    <div
      className="p-4 rounded-lg"
      style={{
        backgroundColor: 'var(--color-background-secondary)',
        border: '1px solid var(--color-border)',
      }}
    >
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
          {t('settings.notesFormat.title', 'Rangement des notes')}
        </h3>
        <span
          className="text-xs px-2 py-0.5 rounded-full"
          style={{
            backgroundColor: dejaV2
              ? 'color-mix(in srgb, var(--color-success-500) 14%, transparent)'
              : 'var(--color-background-tertiary)',
            color: dejaV2 ? 'var(--color-success-on-background)' : 'var(--color-text-tertiary)',
          }}
        >
          {dejaV2
            ? t('settings.notesFormat.badgeV2', 'Une note, un fichier')
            : t('settings.notesFormat.badgeV1', 'Un seul fichier')}
        </span>
      </div>

      <p className="text-sm mt-2" style={{ color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>
        {dejaV2
          ? t(
              'settings.notesFormat.bodyV2',
              'Chaque note a son propre fichier chiffré. Une modification ne fait repartir que la note touchée.'
            )
          : t(
              'settings.notesFormat.bodyV1',
              'Toutes vos notes vivent dans un seul fichier chiffré : modifier une note fait repartir la bibliothèque entière, à chaque enregistrement. Les ranger une par une ne change que cela — ni le contenu, ni les carnets, ni l’historique, ni le chiffrement.'
            )}
      </p>

      {!dejaV2 && (
        <>
          <p
            className="text-xs mt-2"
            style={{ color: 'var(--color-text-tertiary)', lineHeight: 1.6 }}
          >
            {t(
              'settings.notesFormat.reversible',
              'L’ancien fichier est conservé tel quel : rien n’est supprimé.'
            )}
          </p>

          {/*
            UN BOUTON GRISÉ SANS RAISON EST INDISCERNABLE D'UNE PANNE. Et ici la
            raison est toujours actionnable : soit il faut migrer l'autre
            appareil d'abord, soit il faut laisser une synchronisation se faire.
          */}
          {bloque && (
            <p
              className="text-xs mt-2"
              style={{ color: 'var(--color-warning-on-background)', lineHeight: 1.6 }}
            >
              {state.verdict === 'legacy-active'
                ? t(
                    'settings.notesFormat.blockedLegacy',
                    'Un autre de vos appareils a écrit à l’ancien format ces 30 derniers jours. Le plus sûr est de faire la bascule là-bas d’abord. Vous pouvez aussi ranger ici quand même : cet appareil continuera d’écrire l’ancien fichier pour l’autre, et lira ce qu’il y écrit, jusqu’à ce qu’il bascule à son tour.'
                  )
                : t(
                    'settings.notesFormat.blockedUnknown',
                    'En attente d’une première synchronisation : Filarr doit voir ce que le nuage contient avant de déplacer quoi que ce soit.'
                  )}
            </p>
          )}

          <button
            type="button"
            onClick={() => migrer(false)}
            disabled={busy || bloque}
            className="mt-3 px-4 py-2 text-sm font-medium rounded-lg text-white"
            style={{
              backgroundColor: 'var(--color-primary-600)',
              cursor: busy || bloque ? 'not-allowed' : 'pointer',
              opacity: busy || bloque ? 0.5 : 1,
              border: 'none',
            }}
          >
            {busy
              ? t('settings.notesFormat.working', 'Bascule en cours…')
              : t('settings.notesFormat.action', 'Ranger les notes une par une')}
          </button>

          {franchissable && (
            <button
              type="button"
              onClick={() => migrer(true)}
              disabled={busy}
              className="mt-3 ml-2 px-4 py-2 text-sm font-medium rounded-lg"
              style={{
                backgroundColor: 'transparent',
                color: 'var(--color-text-secondary)',
                border: '1px solid var(--color-border)',
                cursor: busy ? 'not-allowed' : 'pointer',
                opacity: busy ? 0.5 : 1,
              }}
            >
              {t('settings.notesFormat.actionAnyway', 'Ranger quand même')}
            </button>
          )}
        </>
      )}

      {outcome && (
        <p className="text-xs mt-2" style={{ color: 'var(--color-text-secondary)' }}>
          {outcome}
        </p>
      )}

      <p className="text-xs mt-3" style={{ color: 'var(--color-text-tertiary)', lineHeight: 1.6 }}>
        {t(
          'settings.notesFormat.allDevices',
          'Faites la même bascule sur tous vos appareils. Filarr refuse de la faire pendant qu’un autre écrit encore à l’ancien format, mais il ne peut rien contre un appareil éteint depuis des mois qu’on rallume.'
        )}
      </p>
    </div>
  );
};

export default NotesFormatSection;
