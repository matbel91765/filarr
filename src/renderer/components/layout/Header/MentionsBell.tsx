import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import type { AppDispatch, RootState } from '../../../../store';
import { loadVaultItems } from '../../../../store/slices/vaultsSlice';
import { vaultFolderRoute } from '../RouteContent/routeCompat';
import {
  apiListMentions,
  apiMarkMentionsRead,
  type MentionDTO,
} from '../../../../services/vault/mentionsApi';
import { publishMentionInbox } from '../../../../services/vault/mentionInbox';

/**
 * « ON VOUS A NOMMÉ » — la boîte, dans la barre du haut.
 *
 * ═══ LE SERVEUR NE SAIT PAS DE QUOI IL PARLE, ET C'EST NOUS QUI LE SAVONS ═══
 *
 * Une mention arrive du serveur avec un identifiant de coffre et un identifiant
 * d'élément, et RIEN d'autre : le contenu d'un coffre est chiffré de bout en
 * bout, le serveur n'a jamais vu ni le titre ni le texte. Une notification qui
 * s'en tiendrait là dirait « quelqu'un vous a nommé » et laisserait la personne
 * chercher où — ce qui n'est pas une notification, c'est une énigme.
 *
 * C'est donc ICI que le nom se fabrique : le nom du coffre et le titre de
 * l'élément sont déchiffrés sur cet appareil, avec ses clés, et le clic ouvre
 * l'élément. Quand le coffre n'a pas encore été ouvert de la session, ses
 * éléments ne sont pas en mémoire : on les charge à l'ouverture du panneau, une
 * fois par coffre cité. Un coffre verrouillé ne rend rien — on le dit, on ne
 * fabrique pas un titre.
 *
 * ═══ PAS DE PUSH DANS CE LOT ═══
 *
 * On interroge à l'ouverture, toutes les cinq minutes, et au retour de l'onglet
 * au premier plan. Un push qui viserait un COMPTE (et non un profil) demande
 * une diffusion que le canal actuel ne sait pas faire ; il viendra avec le push
 * mobile.
 */
const REFRESH_MS = 5 * 60 * 1000;

function ilYA(iso: string, t: (k: string, d: string, o?: object) => string): string {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  const min = Math.round(ms / 60000);
  if (min < 1) return t('mentions.now', 'à l’instant');
  if (min < 60) return t('mentions.minutes', 'il y a {{n}} min', { n: min });
  const h = Math.round(min / 60);
  if (h < 24) return t('mentions.hours', 'il y a {{n}} h', { n: h });
  return t('mentions.days', 'il y a {{n}} j', { n: Math.round(h / 24) });
}

export const MentionsBell: React.FC = () => {
  const { t } = useTranslation();
  const dispatch = useDispatch<AppDispatch>();
  const navigate = useNavigate();
  const isCloud = useSelector((s: RootState) => s.auth?.accountMode === 'cloud');
  const vaults = useSelector((s: RootState) => s.vaults?.vaults);
  const itemsByVault = useSelector((s: RootState) => s.vaults?.itemsByVault);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<MentionDTO[]>([]);
  const [unread, setUnread] = useState(0);
  const zoneRef = useRef<HTMLDivElement>(null);
  /** Coffres dont on a déjà demandé le contenu : une fois suffit par session. */
  const demandes = useRef<Set<string>>(new Set());

  const rafraichir = useCallback(async (): Promise<void> => {
    try {
      const boite = await apiListMentions({ limit: 20 });
      setItems(boite.mentions);
      setUnread(boite.unread);
    } catch {
      /* hors ligne, session fermée : la cloche se tait, elle n'alarme pas */
    }
  }, []);

  useEffect(() => {
    if (!isCloud) return undefined;
    void rafraichir();
    const timer = setInterval(() => void rafraichir(), REFRESH_MS);
    const auReveil = () => {
      if (document.visibilityState === 'visible') void rafraichir();
    };
    document.addEventListener('visibilitychange', auReveil);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', auReveil);
    };
  }, [isCloud, rafraichir]);

  // L'ÉPINGLE DE NOTIFICATION (volet A) : l'explorateur décore la ligne d'un
  // élément qui porte une mention non lue. Il lit CETTE boîte — rien à
  // stocker, et marquer lu (ici) retire la pastille (là-bas) dans la foulée.
  useEffect(() => {
    publishMentionInbox(items);
  }, [items]);

  /**
   * DE QUOI NOMMER CE QUI EST CITÉ. Les éléments d'un coffre ne sont en mémoire
   * qu'une fois le coffre ouvert : sans cette demande, la liste dirait « un
   * document » pour tout coffre qu'on n'a pas visité depuis le démarrage. Le
   * chargement échoue proprement si le coffre est verrouillé — c'est le cas que
   * l'affichage nomme, plutôt que d'inventer.
   */
  useEffect(() => {
    if (!open) return;
    for (const m of items) {
      if (demandes.current.has(m.vaultId)) continue;
      if (!vaults?.[m.vaultId]) continue;
      if (itemsByVault?.[m.vaultId]?.some((i) => i.id === m.itemId)) continue;
      demandes.current.add(m.vaultId);
      void dispatch(loadVaultItems({ vaultId: m.vaultId }));
    }
  }, [open, items, vaults, itemsByVault, dispatch]);

  // Un clic ailleurs referme : un panneau qui reste ouvert derrière une note
  // masque ce qu'on est venu lire.
  useEffect(() => {
    if (!open) return undefined;
    const dehors = (e: MouseEvent) => {
      if (!zoneRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', dehors);
    return () => document.removeEventListener('mousedown', dehors);
  }, [open]);

  /**
   * Ce qu'on sait dire de l'élément cité, dans l'ordre de ce qui aide le plus :
   * son titre et son coffre ; à défaut son coffre seul ; à défaut rien, et on
   * le dit. Une note sans titre garde le mot « sans titre » plutôt qu'un vide
   * qui ressemblerait à un bogue.
   */
  const decrire = useCallback(
    (m: MentionDTO): { ligne: string; ouvrable: boolean } => {
      const coffre = vaults?.[m.vaultId];
      const element = itemsByVault?.[m.vaultId]?.find((i) => i.id === m.itemId);
      const titre = (element?.meta?.title || element?.meta?.fileName || '').trim();
      const nomCoffre = (coffre?.name || '').trim();

      if (!coffre) {
        return {
          ligne: t('mentions.inUnknownVault', 'dans un coffre auquel vous n’avez plus accès'),
          ouvrable: false,
        };
      }
      if (titre && nomCoffre) {
        return {
          ligne: t('mentions.inItem', 'dans « {{titre}} » · {{coffre}}', {
            titre,
            coffre: nomCoffre,
          }),
          ouvrable: true,
        };
      }
      // L'ÉLÉMENT N'EXISTE PLUS. `itemKind` vient d'une jointure serveur sur la
      // table des éléments : nul, la ligne a été purgée. Le dire, et ne pas
      // proposer d'ouvrir ce qui n'est plus là — une mention peut survivre à ce
      // qu'elle désignait.
      if (m.itemKind === null) {
        return {
          ligne: nomCoffre
            ? t('mentions.inDeletedItem', 'dans un élément supprimé du coffre « {{coffre}} »', {
                coffre: nomCoffre,
              })
            : t('mentions.inDeletedItemBare', 'dans un élément supprimé'),
          ouvrable: false,
        };
      }
      if (nomCoffre) {
        return {
          ligne: t('mentions.inVault', 'dans le coffre « {{coffre}} »', { coffre: nomCoffre }),
          ouvrable: true,
        };
      }
      // Nom vide = coffre verrouillé (il se déchiffre sur cet appareil).
      return {
        ligne: t('mentions.inLockedVault', 'dans un coffre verrouillé — ouvrez-le pour voir'),
        ouvrable: true,
      };
    },
    [vaults, itemsByVault, t]
  );

  const decrits = useMemo(() => items.map((m) => ({ m, ...decrire(m) })), [items, decrire]);

  if (!isCloud) return null;

  const ouvrir = async (): Promise<void> => {
    const suivant = !open;
    setOpen(suivant);
    if (suivant) await rafraichir();
  };

  const toutLire = async (): Promise<void> => {
    setUnread(0);
    setItems((prev) => prev.map((m) => ({ ...m, readAt: m.readAt ?? new Date().toISOString() })));
    try {
      await apiMarkMentionsRead(null);
    } catch {
      void rafraichir();
    }
  };

  const ouvrirElement = async (m: MentionDTO, ouvrable: boolean): Promise<void> => {
    setOpen(false);
    if (!m.readAt) {
      setUnread((n) => Math.max(0, n - 1));
      setItems((prev) =>
        prev.map((x) => (x.id === m.id ? { ...x, readAt: new Date().toISOString() } : x))
      );
      try {
        await apiMarkMentionsRead([m.id]);
      } catch {
        /* on réessaiera au prochain rafraîchissement */
      }
    }
    // `open: true` = ouvrir l'élément, pas seulement le montrer dans la liste.
    // Sans coffre accessible il n'y a nulle part où aller : on a marqué lu, on
    // s'arrête là plutôt que de router vers une page vide.
    if (ouvrable) navigate(vaultFolderRoute(m.vaultId, { itemId: m.itemId, open: true }));
  };

  return (
    <div ref={zoneRef} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => void ouvrir()}
        className="w-10 h-10 hidden sm:flex items-center justify-center rounded-full
          text-[var(--color-text-secondary)] hover:bg-[var(--color-hover-overlay)]
          transition-colors duration-150"
        aria-label={t('mentions.title', 'Mentions')}
        aria-expanded={open}
      >
        <span style={{ position: 'relative', lineHeight: 0 }}>
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
          {unread > 0 && (
            <span
              aria-hidden="true"
              style={{
                position: 'absolute',
                top: -4,
                right: -6,
                minWidth: 16,
                height: 16,
                padding: '0 4px',
                borderRadius: 999,
                background: 'var(--color-primary-600, #36648b)',
                color: '#fff',
                fontSize: 10,
                fontWeight: 700,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={t('mentions.title', 'Mentions')}
          style={{
            position: 'absolute',
            top: 44,
            right: 0,
            width: 340,
            maxHeight: 440,
            overflowY: 'auto',
            borderRadius: 12,
            background: 'var(--color-background)',
            border: '1px solid var(--color-border)',
            boxShadow: '0 12px 32px rgba(0,0,0,0.18)',
            zIndex: 9999,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '10px 12px',
              borderBottom: '1px solid var(--color-border-light, var(--color-border))',
            }}
          >
            <strong style={{ fontSize: 13, color: 'var(--color-text-primary)' }}>
              {t('mentions.title', 'Mentions')}
            </strong>
            {unread > 0 && (
              <button
                type="button"
                onClick={() => void toutLire()}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: 12,
                  color: 'var(--color-primary-600, #36648b)',
                }}
              >
                {t('mentions.markAllRead', 'Tout marquer comme lu')}
              </button>
            )}
          </div>

          {decrits.length === 0 ? (
            <p
              style={{
                padding: '18px 12px',
                margin: 0,
                fontSize: 13,
                color: 'var(--color-text-tertiary)',
              }}
            >
              {t('mentions.empty', 'Personne ne vous a nommé pour l’instant.')}
            </p>
          ) : (
            decrits.map(({ m, ligne, ouvrable }) => (
              <button
                key={m.id}
                type="button"
                onClick={() => void ouvrirElement(m, ouvrable)}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '10px 12px',
                  background: m.readAt
                    ? 'transparent'
                    : 'var(--color-primary-50, rgba(135,206,235,0.10))',
                  border: 'none',
                  borderBottom: '1px solid var(--color-border-light, var(--color-border))',
                  cursor: ouvrable ? 'pointer' : 'default',
                }}
              >
                <span
                  style={{ display: 'block', fontSize: 13, color: 'var(--color-text-primary)' }}
                >
                  {t('mentions.line', '{{who}} vous a nommé', { who: m.fromLabel })}
                </span>
                <span
                  style={{
                    display: 'block',
                    fontSize: 12,
                    color: 'var(--color-text-secondary)',
                    marginTop: 2,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {ligne}
                </span>
                <span
                  style={{
                    display: 'block',
                    fontSize: 11,
                    color: 'var(--color-text-tertiary)',
                    marginTop: 2,
                  }}
                >
                  {ilYA(m.createdAt, t as never)}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
};

export default MentionsBell;
