/**
 * ReportPluginModal — signaler une extension.
 *
 * Le geste est irréversible et unique (un signalement par compte et par
 * extension), donc l'écran dit AVANT : ce qui part, à qui, et qu'on ne pourra
 * pas recommencer. L'ancienne modale n'affichait qu'un `<textarea>` nu et une
 * borne « entre 10 et 500 caractères » — avec un bouton grisé tant que la borne
 * n'était pas atteinte, et aucun compteur pour savoir où l'on en était.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui';
import { Modal, ModalHeader, ModalBody, ModalFooter } from '../ui/Modal/Modal';
import './marketplace.css';

/** Bornes du signalement — miroir du worker (MIN/MAX_REPORT_REASON). */
export const REPORT_MIN = 10;
export const REPORT_MAX = 500;

/**
 * Les quatre phrases qui NOMMENT l'objet signalé.
 *
 * Les autres (compteur, borne, bouton) ne disent pas ce qu'on signale : elles
 * sont partagées telles quelles. Seules celles-ci parlent d'« extension » ou de
 * « modèle », et servir la mauvaise ferait douter de tout l'écran — c'est la
 * raison pour laquelle cette modale n'a pas été réutilisée telle quelle pour
 * les modèles de mise en page.
 */
export interface ReportSubjectKeys {
  title: string;
  lead: string;
  reason: string;
  hint: string;
}

const PLUGIN_KEYS: ReportSubjectKeys = {
  title: 'marketplace.report.title',
  lead: 'marketplace.report.lead',
  reason: 'marketplace.report.reason',
  hint: 'marketplace.report.hint',
};

export interface ReportPluginModalProps {
  name: string;
  reason: string;
  busy: boolean;
  /** Les phrases propres à l'objet signalé. Par défaut : une extension. */
  subject?: ReportSubjectKeys;
  onChange: (reason: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}

export const ReportPluginModal: React.FC<ReportPluginModalProps> = ({
  name,
  reason,
  busy,
  subject = PLUGIN_KEYS,
  onChange,
  onCancel,
  onSubmit,
}) => {
  const { t } = useTranslation();
  const length = reason.trim().length;
  const tooShort = length < REPORT_MIN;
  const valid = !tooShort && length <= REPORT_MAX;

  return (
    <Modal isOpen onClose={onCancel} size="md">
      <ModalHeader onClose={onCancel}>{t(subject.title)}</ModalHeader>
      <ModalBody>
        <p className="mkt-section__lead">{t(subject.lead, { name })}</p>
        <label className="mkt-section__title" htmlFor="mkt-report-reason">
          {t(subject.reason)}
        </label>
        <textarea
          id="mkt-report-reason"
          className="mkt-report-textarea"
          value={reason}
          maxLength={REPORT_MAX}
          autoFocus
          onChange={(e) => onChange(e.target.value)}
        />
        <p className="mkt-adv__hint" style={{ marginTop: 'var(--spacing-1)' }}>
          {t('marketplace.report.counter', { count: length, max: REPORT_MAX })}
          {tooShort && length > 0
            ? ` · ${t('marketplace.report.tooShort', { min: REPORT_MIN })}`
            : ''}
        </p>
        <p className="mkt-adv__hint">{t(subject.hint, { min: REPORT_MIN, max: REPORT_MAX })}</p>
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button variant="primary" loading={busy} disabled={!valid} onClick={onSubmit}>
          {t('marketplace.report.submit')}
        </Button>
      </ModalFooter>
    </Modal>
  );
};
