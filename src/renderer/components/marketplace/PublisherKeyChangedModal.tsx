/**
 * PublisherKeyChangedModal — « ce n'est plus la même personne qui signe ».
 *
 * ── LE MOT « TOFU » N'APPARAÎT PAS ──────────────────────────────────────────
 *
 * Trust On First Use décrit fidèlement le mécanisme, et ne veut rien dire pour
 * qui doit décider maintenant. L'ancienne modale s'intitulait « La clé de
 * l'éditeur a changé » et posait deux pavés monospace de trente chiffres sous
 * les intitulés « Empreinte épinglée » et « Nouvelle empreinte ». Trois termes
 * de spécialité dans un écran dont l'unique but est d'obtenir une décision
 * éclairée d'une personne qui n'en est pas une.
 *
 * ── CE QUE CET ÉCRAN DOIT FAIRE ─────────────────────────────────────────────
 *
 *   · dire le fait en une phrase que tout le monde comprend ;
 *   · dire ce que cela peut signifier — les DEUX possibilités, honnêtement :
 *     un auteur qui a changé de clé, ou un compte pris par quelqu'un d'autre ;
 *   · dire ce qu'il faut faire pour trancher (demander à l'auteur, hors de
 *     cette application) ;
 *   · MONTRER la différence, groupe par groupe, au lieu de demander à l'œil de
 *     comparer deux nombres de trente chiffres ;
 *   · rendre le refus facile et l'acceptation délibérée.
 *
 * La version installée continue de fonctionner si l'on refuse : c'est dit, parce
 * que sans cela « Annuler » ressemble à « perdre l'extension ».
 */

import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { Button } from '../ui';
import { Modal, ModalHeader, ModalBody, ModalFooter } from '../ui/Modal/Modal';
import type { RootState } from '../../../store';
import { diffFingerprints } from './trustModel';
import { Notice } from './MarketplaceNotices';
import { ShieldAlertGlyph } from './icons';
import './marketplace.css';

export interface PublisherKeyChangedModalProps {
  slug: string;
  version: string;
  /** Le nom lisible, pour ne pas parler d'un slug à quelqu'un qui a vu un nom. */
  name: string;
  onCancel: () => void;
  onConfirm: () => void;
}

export const PublisherKeyChangedModal: React.FC<PublisherKeyChangedModalProps> = ({
  slug,
  version,
  name,
  onCancel,
  onConfirm,
}) => {
  const { t } = useTranslation();
  const userId = useSelector((s: RootState) => s.auth.cloudUser?.id ?? null);
  const [pinned, setPinned] = useState<string | null>(null);
  const [offered, setOffered] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { installedPluginGet } = await import('../../../services/plugins/pluginStorage');
      const { apiGetMarketplacePlugin } = await import('../../../services/plugins/marketplaceApi');
      const { computeFingerprint } = await import('../../../services/auth/userKeypair');
      const toBytes = (b64: string) => {
        const bin = atob(b64);
        const out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out;
      };
      if (userId) {
        const rec = await installedPluginGet(userId, slug);
        if (rec && !cancelled)
          setPinned(await computeFingerprint(toBytes(rec.pinnedSignPublicKey)));
      }
      try {
        const detail = await apiGetMarketplacePlugin(slug);
        const dto = detail.versions.find((v) => v.version === version);
        if (dto && !cancelled) setOffered(await computeFingerprint(toBytes(dto.signPublicKey)));
      } catch {
        /* l'écran reste utile avec la seule empreinte épinglée */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, slug, version]);

  const rows = diffFingerprints(pinned, offered);
  const ready = pinned !== null || offered !== null;

  return (
    <Modal isOpen onClose={onCancel} size="lg">
      <ModalHeader onClose={onCancel}>{t('marketplace.keyChange.title')}</ModalHeader>
      <ModalBody>
        <p className="mkt-keychange__lead">{t('marketplace.keyChange.lead', { name })}</p>

        <Notice
          tone="warn"
          live="none"
          glyph={<ShieldAlertGlyph />}
          title={t('marketplace.keyChange.meansTitle')}
          text={t('marketplace.keyChange.meansText')}
        />

        <ul className="mkt-advice">
          <li>{t('marketplace.keyChange.advice1')}</li>
          <li>{t('marketplace.keyChange.advice2')}</li>
          <li>{t('marketplace.keyChange.advice3')}</li>
        </ul>

        <details className="mkt-adv">
          <summary>{t('marketplace.keyChange.compareTitle')}</summary>
          <div className="mkt-adv__body">
            <p className="mkt-adv__hint">{t('marketplace.keyChange.compareHint')}</p>
            {!ready ? (
              <p className="mkt-adv__hint">{t('marketplace.keyChange.loading')}</p>
            ) : (
              <div className="mkt-keychange__cols">
                <div className="mkt-keychange__col">
                  <p className="mkt-keychange__col-title">{t('marketplace.keyChange.pinned')}</p>
                  <div className="mkt-keychange__fp">
                    {rows.map((r) => (
                      <span className="mkt-fp__group" key={`p${r.index}`}>
                        {r.pinned || '—'}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="mkt-keychange__col">
                  <p className="mkt-keychange__col-title">{t('marketplace.keyChange.offered')}</p>
                  <div className="mkt-keychange__fp">
                    {rows.map((r) => (
                      <span
                        className={`mkt-fp__group${r.differs ? ' mkt-fp__group--differs' : ''}`}
                        key={`o${r.index}`}
                      >
                        {r.offered || '—'}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </details>
      </ModalBody>
      <ModalFooter>
        <Button variant="primary" onClick={onCancel}>
          {t('marketplace.keyChange.keepCurrent')}
        </Button>
        <Button variant="danger" onClick={onConfirm}>
          {t('marketplace.keyChange.trustNew')}
        </Button>
      </ModalFooter>
    </Modal>
  );
};
