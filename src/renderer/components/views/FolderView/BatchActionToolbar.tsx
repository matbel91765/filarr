/**
 * BatchActionToolbar Component
 *
 * Barre flottante d'actions batch, affichee quand des items sont selectionnes.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';

interface BatchActionToolbarProps {
  selectedCount: number;
  totalCount: number;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onDelete: () => void;
  onMove?: () => void;
  onCopy?: () => void;
  onDownload?: () => void;
  onAddToFavorites?: () => void;
  onAddToVault?: () => void;
  onMakeOffline?: () => void;
}

const MoveIcon: React.FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={2}
    stroke="currentColor"
    className="w-4 h-4"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 00-1.883 2.542l.857 6a2.25 2.25 0 002.227 1.932H19.05a2.25 2.25 0 002.227-1.932l.857-6a2.25 2.25 0 00-1.883-2.542m-16.5 0V6A2.25 2.25 0 016 3.75h3.879a1.5 1.5 0 011.06.44l2.122 2.12a1.5 1.5 0 001.06.44H18A2.25 2.25 0 0120.25 9v.776"
    />
  </svg>
);

const CopyIcon: React.FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={2}
    stroke="currentColor"
    className="w-4 h-4"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 01-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 011.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 00-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 01-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 00-3.375-3.375h-1.5a1.125 1.125 0 01-1.125-1.125v-1.5a3.375 3.375 0 00-3.375-3.375H9.75"
    />
  </svg>
);

const DeleteIcon: React.FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={2}
    stroke="currentColor"
    className="w-4 h-4"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
    />
  </svg>
);

const StarIcon: React.FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={2}
    stroke="currentColor"
    className="w-4 h-4"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z"
    />
  </svg>
);

const DownloadIcon: React.FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={2}
    stroke="currentColor"
    className="w-4 h-4"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"
    />
  </svg>
);

const VaultIcon: React.FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={2}
    stroke="currentColor"
    className="w-4 h-4"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"
    />
  </svg>
);

const OfflinePinIcon: React.FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={2}
    stroke="currentColor"
    className="w-4 h-4"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M12 16.5V9.75m0 6.75l-3-3m3 3l3-3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.338-2.338 3.75 3.75 0 013.572 5.363M6.75 19.5h10.5"
    />
  </svg>
);

interface ActionButtonProps {
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
  danger?: boolean;
  disabled?: boolean;
}

const ActionButton: React.FC<ActionButtonProps> = ({ icon, label, onClick, danger, disabled }) => (
  <button
    onClick={onClick}
    disabled={disabled || !onClick}
    title={label}
    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors
      ${
        disabled || !onClick
          ? 'opacity-40 cursor-not-allowed'
          : danger
            ? 'hover:bg-red-500/20 text-red-300'
            : 'hover:bg-white/10'
      }`}
  >
    {icon}
    <span className="hidden sm:inline">{label}</span>
  </button>
);

export const BatchActionToolbar: React.FC<BatchActionToolbarProps> = ({
  selectedCount,
  totalCount,
  onSelectAll,
  onDeselectAll,
  onDelete,
  onMove,
  onCopy,
  onDownload,
  onAddToFavorites,
  onAddToVault,
  onMakeOffline,
}) => {
  const { t } = useTranslation();

  if (selectedCount === 0) return null;

  return (
    <div
      className="sticky bottom-4 mx-auto w-fit z-40
        flex items-center gap-1 px-4 py-2 rounded-xl
        bg-gray-800 text-white shadow-2xl
        animate-[slideUp_200ms_ease-out]"
      style={{ animation: 'slideUp 200ms ease-out' }}
    >
      {/* Count */}
      <span className="text-sm font-medium pr-2 border-r border-white/20 mr-1">
        {t('batch.selectedCount', { count: selectedCount })}
      </span>

      {/* Select/Deselect */}
      <button
        onClick={selectedCount === totalCount ? onDeselectAll : onSelectAll}
        className="text-xs px-2 py-1 rounded hover:bg-white/10 transition-colors text-blue-300"
      >
        {selectedCount === totalCount ? t('batch.deselectAll') : t('batch.selectAll')}
      </button>

      {/* Separator */}
      <div className="w-px h-5 bg-white/20 mx-1" />

      {/* Actions */}
      <ActionButton icon={<MoveIcon />} label={t('batch.move')} onClick={onMove} />
      <ActionButton icon={<CopyIcon />} label={t('batch.copy')} onClick={onCopy} />
      <ActionButton icon={<DownloadIcon />} label={t('batch.download')} onClick={onDownload} />
      <ActionButton icon={<StarIcon />} label={t('batch.favorites')} onClick={onAddToFavorites} />
      <ActionButton icon={<VaultIcon />} label={t('batch.vault')} onClick={onAddToVault} />
      {onMakeOffline && (
        <ActionButton icon={<OfflinePinIcon />} label={t('batch.offline')} onClick={onMakeOffline} />
      )}

      {/* Separator */}
      <div className="w-px h-5 bg-white/20 mx-1" />

      <ActionButton icon={<DeleteIcon />} label={t('batch.delete')} onClick={onDelete} danger />
    </div>
  );
};

export default BatchActionToolbar;
