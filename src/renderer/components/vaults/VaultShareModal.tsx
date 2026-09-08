/**
 * VaultShareModal — créer un lien public depuis UN élément de coffre.
 *
 * CE QUE SON ABSENCE COÛTAIT. Le produit a deux mondes de partage — le coffre
 * (par personne, membership) et le lien (public, K_share dans le fragment
 * d'URL) — sans AUCUN pont entre eux : donner un seul fichier de coffre à
 * quelqu'un d'extérieur imposait de le télécharger en clair puis de le
 * re-partager depuis l'espace personnel. La cryptographie n'y était pour rien :
 * le membre détient K_item, le Worker ingère des chunks opaques d'où qu'ils
 * viennent. Il manquait la variante de `createShare` qui accepte des octets en
 * mémoire — c'est elle qu'on appelle ici.
 *
 * LE LIEN EST UN INSTANTANÉ, et l'écran le dit : re-chiffré sous une K_share
 * fraîche au moment du geste, il ne suit pas les éditions ultérieures du
 * coffre. C'est aussi ce qui le rend révocable sans toucher au coffre, et ce
 * qui évite l'écueil du « lien vers le coffre entier » — refusé par l'audit :
 * il faudrait embarquer K_vault dans l'URL, des porteurs anonymes détenant la
 * clé pour toujours.
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Input } from '../ui';
import { Modal, ModalHeader, ModalBody, ModalFooter } from '../ui/Modal/Modal';
import { useNotification } from '../ui/Notification';
import { createShareFromBytes, type CreatedShare } from '../../../services/sharing/shareService';
import { buildShareMailto, openMailto } from '../../../services/sharing/mailtoLink';
import { downloadVaultItemContent, type VaultItemSummary } from '../../../store/slices/vaultsSlice';

interface Props {
  vaultId: string;
  item: VaultItemSummary;
  fileName: string;
  onClose: () => void;
}

type Expiry = '24h' | '7d' | '30d';
const EXPIRY_SECONDS: Record<Expiry, number> = {
  '24h': 24 * 3600,
  '7d': 7 * 24 * 3600,
  '30d': 30 * 24 * 3600,
};

export const VaultShareModal: React.FC<Props> = ({ vaultId, item, fileName, onClose }) => {
  const { t } = useTranslation();
  const { success, error } = useNotification();
  const [expiry, setExpiry] = useState<Expiry>('7d');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<[number, number] | null>(null);
  const [created, setCreated] = useState<CreatedShare | null>(null);

  const create = async () => {
    setBusy(true);
    setProgress(null);
    try {
      // Les octets déchiffrés de l'élément, en mémoire — jamais sur disque.
      const bytes = await downloadVaultItemContent(vaultId, item);
      const share = await createShareFromBytes(bytes, {
        // L'identifiant d'élément est déjà opaque (UUID) ; le préfixe dit au
        // tableau de bord d'où vient le lien sans révéler quoi que ce soit.
        fileId: `vault-${item.id}`,
        fileName,
        mimeType: item.meta.mime || 'application/octet-stream',
        expiresInSeconds: EXPIRY_SECONDS[expiry],
        maxViews: null,
        password: password.trim() || null,
        oneDownloadPerIp: false,
        onProgress: (uploaded, total) => setProgress([uploaded, total]),
      });
      setCreated(share);
    } catch (e) {
      error((e as Error).message || t('teamVaults.share.failed'));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const copier = async () => {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.publicUrl);
      success(t('teamVaults.share.copied'));
    } catch {
      error(t('teamVaults.share.copyFailed'));
    }
  };

  // Par la messagerie de l'expéditeur, jamais par nous — voir mailtoLink.ts.
  const envoyerParEmail = () => {
    if (!created) return;
    const mailto = buildShareMailto({
      url: created.publicUrl,
      subject: t('sharing.email.subject', { name: fileName }),
      intro: t('sharing.email.intro', { name: fileName }),
      expiry: t('sharing.email.expiry', { date: new Date(created.expiresAt).toLocaleDateString() }),
      keyNote: t('sharing.email.keyNote'),
    });
    if (!mailto || !openMailto(mailto)) error(t('sharing.email.unavailable'));
  };

  return (
    <Modal isOpen onClose={onClose} size="md">
      <ModalHeader onClose={onClose}>{t('teamVaults.share.title', { name: fileName })}</ModalHeader>
      <ModalBody>
        {created ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-[var(--color-text-secondary)] m-0">
              {t('teamVaults.share.ready')}
            </p>
            <div className="flex gap-2 items-center">
              <Input value={created.publicUrl} readOnly fullWidth aria-label="URL" />
              <Button size="sm" variant="primary" onClick={copier}>
                {t('teamVaults.share.copy')}
              </Button>
              <Button size="sm" variant="secondary" onClick={envoyerParEmail}>
                {t('sharing.email.button')}
              </Button>
            </div>
            <p className="text-xs text-[var(--color-text-tertiary)] m-0">
              {t('teamVaults.share.snapshotNotice')}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-[var(--color-text-secondary)] m-0">
              {t('teamVaults.share.intro')}
            </p>
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-[var(--color-text-secondary)]">
                {t('teamVaults.share.expiry')}
              </span>
              <div className="flex gap-2">
                {(Object.keys(EXPIRY_SECONDS) as Expiry[]).map((k) => (
                  <Button
                    key={k}
                    size="sm"
                    variant={expiry === k ? 'primary' : 'secondary'}
                    onClick={() => setExpiry(k)}
                  >
                    {t(`teamVaults.share.expiry_${k}`)}
                  </Button>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-[var(--color-text-secondary)]">
                {t('teamVaults.share.password')}
              </span>
              <Input
                type="password"
                value={password}
                fullWidth
                placeholder={t('teamVaults.share.passwordPlaceholder')}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {progress && progress[1] > 0 && (
              <p className="text-xs text-[var(--color-text-tertiary)] m-0" role="status">
                {t('teamVaults.share.uploading', {
                  pct: Math.round((progress[0] / progress[1]) * 100),
                })}
              </p>
            )}
            <p className="text-xs text-[var(--color-text-tertiary)] m-0">
              {t('teamVaults.share.snapshotNotice')}
            </p>
          </div>
        )}
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" onClick={onClose}>
          {created ? t('common.close') : t('common.cancel')}
        </Button>
        {!created && (
          <Button variant="primary" loading={busy} onClick={() => void create()}>
            {t('teamVaults.share.create')}
          </Button>
        )}
      </ModalFooter>
    </Modal>
  );
};

export default VaultShareModal;
