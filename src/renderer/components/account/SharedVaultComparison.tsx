/**
 * SharedVaultComparison — ce qu'on perd à partager un compte, mis à côté de ce
 * qu'on gagne à partager un coffre.
 *
 * ═══ POURQUOI CET ÉCRAN, ET PAS UN ARGUMENTAIRE ═══
 *
 * Partager un compte marche. C'est même la raison pour laquelle personne ne
 * cherche autre chose — jusqu'au jour où quelqu'un part, où une note disparaît
 * sans qu'on sache qui l'a supprimée, ou où il faut changer le mot de passe de
 * tout le monde d'un coup. La plupart des gens qui le font ne savent pas ce
 * qu'ils y perdent, parce que personne ne le leur a jamais dit.
 *
 * L'écran énonce donc des CONSÉQUENCES, pas des fonctionnalités : chaque ligne
 * de gauche est un ennui réel, et celle d'en face est ce qui le supprime.
 *
 * ═══ CE QU'IL NE FAIT PAS ═══
 *
 * Il n'accuse personne et ne bloque rien. Partager un compte reste possible —
 * la FEK dérive du mot de passe, le serveur ne voit que du chiffré, aucun
 * garde-fou technique n'existera jamais.
 *
 * Et il n'affiche AUCUN PRIX. Un montant en dur dans l'application se périme
 * sans que personne ne s'en aperçoive, ne se traduit pas, et ne connaît ni les
 * devises ni les remises annuelles. Le site le porte déjà ; le dupliquer ici,
 * c'est garantir qu'un des deux mentira.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';

import Modal, { ModalBody, ModalFooter } from '../ui/Modal/Modal';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

const Cross: React.FC = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="var(--color-error-on-background)"
    strokeWidth="2"
    strokeLinecap="round"
    className="shrink-0"
    style={{ marginTop: 1 }}
    aria-hidden="true"
  >
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);

const Check: React.FC = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="var(--color-success-on-background)"
    strokeWidth="2.2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="shrink-0"
    style={{ marginTop: 1 }}
    aria-hidden="true"
  >
    <path d="m20 6-11 11-5-5" />
  </svg>
);

export const SharedVaultComparison: React.FC<Props> = ({ isOpen, onClose }) => {
  const { t } = useTranslation();

  const perdu = [
    t('account.compare.lost1', 'Personne ne sait qui a écrit ou supprimé quoi.'),
    t(
      'account.compare.lost2',
      'Retirer quelqu’un veut dire changer le mot de passe — et déconnecter tout le monde.'
    ),
    t('account.compare.lost3', 'Celui qui part garde une copie de tout, pour toujours.'),
    t(
      'account.compare.lost4',
      'Une seule corbeille, un seul historique : l’erreur d’un autre efface votre travail.'
    ),
    t('account.compare.lost5', 'Trois appareils à la fois, sans frappe en direct.'),
  ];

  const gagne = [
    t('account.compare.won1', 'Chaque modification porte un nom.'),
    t('account.compare.won2', 'Retirer quelqu’un prend un clic. Personne d’autre n’est touché.'),
    t('account.compare.won3', 'Celui qui part perd l’accès : le coffre est rescellé.'),
    t('account.compare.won4', 'Lecture seule, écriture, administration — au cas par cas.'),
    t('account.compare.won5', 'Écriture à plusieurs en direct, sans plafond d’appareils.'),
  ];

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('account.compare.title', 'Vous partagez un compte ? Il y a mieux.')}
      size="lg"
    >
      <ModalBody>
        <p className="text-sm" style={{ color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>
          {t(
            'account.compare.intro',
            'Donner son mot de passe marche — jusqu’au jour où quelqu’un part, où une note disparaît sans qu’on sache qui l’a supprimée, ou où il faut tout changer d’un coup.'
          )}
        </p>

        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
          <section
            className="p-4 rounded-lg"
            style={{
              backgroundColor: 'var(--color-background-secondary)',
              border: '1px solid var(--color-border)',
            }}
          >
            <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
              {t('account.compare.sharedAccount', 'Un compte partagé')}
            </h3>
            <p className="text-xs mt-1" style={{ color: 'var(--color-text-tertiary)' }}>
              {t('account.compare.sharedAccountSub', 'Tout le monde connaît le même mot de passe')}
            </p>
            <ul className="mt-4 space-y-3">
              {perdu.map((ligne) => (
                <li key={ligne} className="flex items-start gap-2.5 text-sm">
                  <Cross />
                  <span style={{ color: 'var(--color-text-secondary)', lineHeight: 1.55 }}>
                    {ligne}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section
            className="p-4 rounded-lg"
            style={{
              backgroundColor: 'var(--color-background-secondary)',
              border: '1px solid color-mix(in srgb, var(--color-primary-300) 34%, transparent)',
            }}
          >
            <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
              {t('account.compare.sharedVault', 'Un coffre partagé')}
            </h3>
            <p className="text-xs mt-1" style={{ color: 'var(--color-text-tertiary)' }}>
              {t('account.compare.sharedVaultSub', 'Chacun son compte, un coffre en commun')}
            </p>
            <ul className="mt-4 space-y-3">
              {gagne.map((ligne) => (
                <li key={ligne} className="flex items-start gap-2.5 text-sm">
                  <Check />
                  <span style={{ color: 'var(--color-text-secondary)', lineHeight: 1.55 }}>
                    {ligne}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <p
          className="text-xs mt-4"
          style={{ color: 'var(--color-text-tertiary)', lineHeight: 1.6 }}
        >
          {t(
            'account.compare.e2ee',
            'Le chiffrement de bout en bout ne change pas : nous ne pouvons toujours pas lire ce que vous écrivez, à plusieurs comme à un.'
          )}
        </p>
        <p
          className="text-xs mt-2"
          style={{ color: 'var(--color-text-tertiary)', lineHeight: 1.6 }}
        >
          {t(
            'account.compare.noPressure',
            'Rien ne vous oblige à changer : partager un compte reste possible. Cet écran existe parce que la plupart des gens qui le font ne savent pas ce qu’ils y perdent.'
          )}
        </p>
      </ModalBody>

      <ModalFooter>
        <div className="flex justify-end w-full">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium rounded-lg"
            style={{
              border: '1px solid var(--color-border)',
              color: 'var(--color-text-primary)',
              backgroundColor: 'transparent',
              cursor: 'pointer',
            }}
          >
            {t('common.close', 'Fermer')}
          </button>
        </div>
      </ModalFooter>
    </Modal>
  );
};

export default SharedVaultComparison;
