/**
 * Modal Component
 *
 * Composant modal accessible avec gestion du focus trap, animations et sous-composants
 */

import React, {
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  forwardRef,
  HTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import './Modal.css';

/**
 * L'identifiant du titre, descendu du Modal vers SON ModalHeader.
 *
 * POURQUOI PAS UN `id` CONSTANT. `id="modal-title"` était codé en dur : deux
 * fenêtres montées en même temps — ce qui arrive, l'écran d'invitation étant
 * monté à la racine de l'arbre, sous n'importe quelle autre modale — se
 * disputaient l'identifiant, et `aria-labelledby` désignait alors le titre de
 * l'autre. L'identifiant est donc engendré par fenêtre, et le lien se fait ici
 * plutôt que par une prop que chaque appelant devrait penser à passer.
 *
 * POURQUOI L'ANNONCE. `aria-labelledby` doit pointer vers un élément QUI EXISTE :
 * un IDREF pendant ne nomme pas la fenêtre, il la laisse anonyme tout en donnant
 * l'apparence du contraire. Or le titre peut arriver par la prop `title` — que la
 * fenêtre connaît — ou par un enfant `ModalHeader` — qu'elle ne peut pas deviner.
 * Sans cette annonce, les deux seules fenêtres du produit qui n'ont ni l'un ni
 * l'autre portaient une référence dans le vide.
 */
interface ModalTitleContext {
  titleId: string;
  registerTitle?: (present: boolean) => void;
}

const ModalTitleIdContext = React.createContext<ModalTitleContext | undefined>(undefined);

export interface ModalProps {
  /** Modal ouvert ou fermé */
  isOpen: boolean;
  /** Callback de fermeture */
  onClose: () => void;
  /** Titre du modal */
  title?: string;
  /** Contenu du modal */
  children: React.ReactNode;
  /**
   * Taille du modal.
   *
   * `full` occupe TOUT l'écran (ni marge, ni coins, ni bordure) : c'est la
   * taille d'une fenêtre qui n'est plus une boîte de dialogue mais un espace
   * de travail — un éditeur de document, par exemple. Elle passe par le Modal
   * plutôt que par un montage à part pour hériter du portail, du piège à
   * focus, de la fermeture par Échap et du verrou de défilement du corps.
   */
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  /** Permettre la fermeture en cliquant sur le backdrop */
  closeOnBackdrop?: boolean;
  /** Permettre la fermeture avec la touche ESC */
  closeOnEsc?: boolean;
  /** Classe CSS additionnelle */
  className?: string;
  /** ID aria-labelledby pour accessibilité */
  ariaLabelledBy?: string;
  /** ID aria-describedby pour accessibilité */
  ariaDescribedBy?: string;
  /** Nom accessible du bouton de fermeture (voir ModalHeaderProps.closeLabel). */
  closeLabel?: string;
}

export interface ModalHeaderProps extends HTMLAttributes<HTMLDivElement> {
  /** Contenu du header */
  children: React.ReactNode;
  /** Afficher le bouton de fermeture */
  showCloseButton?: boolean;
  /** Callback de fermeture */
  onClose?: () => void;
  /** Classe CSS additionnelle */
  className?: string;
  /**
   * Nom accessible du bouton de fermeture.
   *
   * POURQUOI UNE PROP ET PAS UN `useTranslation` ICI. Ce bouton portait
   * `aria-label="Fermer le modal"` EN DUR, en français, et c'est le seul bouton
   * de plusieurs de ces fenêtres : un anglophone à la synthèse vocale
   * n'entendait que du français au seul endroit qui lui dit comment sortir.
   * Brancher i18n dans le composant imposerait react-i18next à tout le design
   * system — y compris aux vitrines et aux tests qui le montent sans provider.
   * L'appelant, lui, a déjà son `t`. Le repli reste la chaîne d'origine, pour
   * qu'aucune fenêtre existante ne perde son nom accessible.
   */
  closeLabel?: string;
}

export interface ModalBodyProps extends HTMLAttributes<HTMLDivElement> {
  /** Contenu du body */
  children: React.ReactNode;
  /** Classe CSS additionnelle */
  className?: string;
}

export interface ModalFooterProps extends HTMLAttributes<HTMLDivElement> {
  /** Contenu du footer */
  children: React.ReactNode;
  /** Classe CSS additionnelle */
  className?: string;
}

/**
 * Hook pour gérer le focus trap dans le modal
 */
const useFocusTrap = (isOpen: boolean, modalRef: React.RefObject<HTMLDivElement>) => {
  useEffect(() => {
    if (!isOpen || !modalRef.current) return;

    // Remember what was focused so we can hand focus back on close — otherwise
    // keyboard/SR users are dumped to the top of the DOM, losing their place.
    const previouslyFocused = document.activeElement as HTMLElement | null;

    const modalElement = modalRef.current;

    /**
     * Recalculé À CHAQUE Tab, jamais figé au montage. Ces fenêtres changent leur
     * pied de page SUR PLACE — un refus définitif retire « Réessayer », un envoi
     * en cours désactive tout — si bien qu'une liste prise une seule fois
     * enfermait le focus sur des boutons disparus, ou laissait sortir de la
     * fenêtre par le dernier bouton devenu inaccessible.
     */
    const focusables = (): HTMLElement[] =>
      Array.from(
        modalElement.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => !el.hasAttribute('disabled') && el.getAttribute('aria-hidden') !== 'true');

    // Focus: prefer [autofocus] element, fallback to first focusable
    const autoFocusEl = modalElement.querySelector<HTMLElement>('[autofocus], [data-autofocus]');
    (autoFocusEl || focusables()[0])?.focus();

    const handleTabKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;

      const elements = focusables();
      if (elements.length === 0) return;
      const firstElement = elements[0];
      const lastElement = elements[elements.length - 1];

      if (e.shiftKey) {
        // Shift + Tab
        if (document.activeElement === firstElement) {
          e.preventDefault();
          lastElement.focus();
        }
      } else {
        // Tab
        if (document.activeElement === lastElement) {
          e.preventDefault();
          firstElement.focus();
        }
      }
    };

    modalElement.addEventListener('keydown', handleTabKey);

    return () => {
      modalElement.removeEventListener('keydown', handleTabKey);
      // Restore focus to the trigger element on close.
      if (previouslyFocused && previouslyFocused.isConnected) {
        previouslyFocused.focus();
      }
    };
  }, [isOpen, modalRef]);
};

/**
 * Hook pour gérer la fermeture avec ESC
 */
const useEscapeKey = (isOpen: boolean, onClose: () => void, closeOnEsc: boolean = true) => {
  useEffect(() => {
    if (!isOpen || !closeOnEsc) return;

    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEsc);

    return () => {
      document.removeEventListener('keydown', handleEsc);
    };
  }, [isOpen, onClose, closeOnEsc]);
};

/**
 * Hook pour gérer le scroll du body
 */
const useBodyScrollLock = (isOpen: boolean) => {
  useEffect(() => {
    if (isOpen) {
      const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
      document.body.style.overflow = 'hidden';
      document.body.style.paddingRight = `${scrollbarWidth}px`;
    } else {
      document.body.style.overflow = '';
      document.body.style.paddingRight = '';
    }

    return () => {
      document.body.style.overflow = '';
      document.body.style.paddingRight = '';
    };
  }, [isOpen]);
};

/**
 * Composant Modal Principal
 */
export const Modal = forwardRef<HTMLDivElement, ModalProps>(
  (
    {
      isOpen,
      onClose,
      title,
      children,
      size = 'md',
      closeOnBackdrop = false,
      closeOnEsc = true,
      className,
      ariaLabelledBy,
      ariaDescribedBy,
      closeLabel,
    },
    ref
  ) => {
    const modalRef = useRef<HTMLDivElement>(null);
    const internalRef = (ref as React.RefObject<HTMLDivElement>) || modalRef;
    const titleId = useId();
    const [headerRendered, setHeaderRendered] = useState(false);
    const titleContext = useMemo<ModalTitleContext>(
      () => ({ titleId, registerTitle: setHeaderRendered }),
      [titleId]
    );

    // Hooks personnalisés
    useFocusTrap(isOpen, internalRef);
    useEscapeKey(isOpen, onClose, closeOnEsc);
    useBodyScrollLock(isOpen);

    const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
      if (closeOnBackdrop && e.target === e.currentTarget) {
        onClose();
      }
    };

    if (!isOpen) return null;

    const modalClasses = clsx('modal', `modal--${size}`, className);

    const modalContent = (
      // Le titre peut arriver par la prop `title` OU comme enfant `ModalHeader` :
      // les deux portent le même identifiant engendré, si bien qu'une fenêtre
      // construite avec des sous-composants a un nom accessible sans que
      // l'appelant ait à passer quoi que ce soit.
      <ModalTitleIdContext.Provider value={titleContext}>
        <div className="modal-backdrop" onClick={handleBackdropClick}>
          <div
            ref={internalRef}
            className={modalClasses}
            role="dialog"
            aria-modal="true"
            // Aucun titre rendu ⇒ AUCUN `aria-labelledby` : mieux vaut une
            // fenêtre sans nom qu'une référence vers un élément inexistant.
            aria-labelledby={ariaLabelledBy || (title || headerRendered ? titleId : undefined)}
            aria-describedby={ariaDescribedBy}
          >
            {title && (
              <ModalHeader onClose={onClose} showCloseButton closeLabel={closeLabel}>
                {title}
              </ModalHeader>
            )}
            {children}
          </div>
        </div>
      </ModalTitleIdContext.Provider>
    );

    return createPortal(modalContent, document.body);
  }
);

Modal.displayName = 'Modal';

/**
 * Composant ModalHeader
 */
export const ModalHeader = forwardRef<HTMLDivElement, ModalHeaderProps>(
  ({ children, showCloseButton = true, onClose, className, closeLabel, ...props }, ref) => {
    const headerClasses = clsx('modal-header', className);
    const context = useContext(ModalTitleIdContext);
    const registerTitle = context?.registerTitle;

    // Annonce à la fenêtre qu'un titre existe bel et bien — voir ModalTitleContext.
    useEffect(() => {
      registerTitle?.(true);
      return () => registerTitle?.(false);
    }, [registerTitle]);

    return (
      <div ref={ref} className={headerClasses} {...props}>
        <h2 id={context?.titleId} className="modal-header__title">
          {children}
        </h2>
        {showCloseButton && onClose && (
          <button
            type="button"
            className="modal-header__close"
            onClick={onClose}
            aria-label={closeLabel ?? 'Fermer le modal'}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>
    );
  }
);

ModalHeader.displayName = 'ModalHeader';

/**
 * Composant ModalBody
 */
export const ModalBody = forwardRef<HTMLDivElement, ModalBodyProps>(
  ({ children, className, ...props }, ref) => {
    const bodyClasses = clsx('modal-body', className);

    return (
      <div ref={ref} className={bodyClasses} {...props}>
        {children}
      </div>
    );
  }
);

ModalBody.displayName = 'ModalBody';

/**
 * Composant ModalFooter
 */
export const ModalFooter = forwardRef<HTMLDivElement, ModalFooterProps>(
  ({ children, className, ...props }, ref) => {
    const footerClasses = clsx('modal-footer', className);

    return (
      <div ref={ref} className={footerClasses} {...props}>
        {children}
      </div>
    );
  }
);

ModalFooter.displayName = 'ModalFooter';

export default Modal;
