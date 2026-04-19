/**
 * Modal Component
 *
 * Composant modal accessible avec gestion du focus trap, animations et sous-composants
 */

import React, { useEffect, useRef, forwardRef, HTMLAttributes } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import './Modal.css';

export interface ModalProps {
  /** Modal ouvert ou fermé */
  isOpen: boolean;
  /** Callback de fermeture */
  onClose: () => void;
  /** Titre du modal */
  title?: string;
  /** Contenu du modal */
  children: React.ReactNode;
  /** Taille du modal */
  size?: 'sm' | 'md' | 'lg' | 'xl';
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

    const modalElement = modalRef.current;
    const focusableElements = modalElement.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    // Focus: prefer [autofocus] element, fallback to first focusable
    const autoFocusEl = modalElement.querySelector<HTMLElement>('[autofocus], [data-autofocus]');
    (autoFocusEl || firstElement)?.focus();

    const handleTabKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;

      if (e.shiftKey) {
        // Shift + Tab
        if (document.activeElement === firstElement) {
          e.preventDefault();
          lastElement?.focus();
        }
      } else {
        // Tab
        if (document.activeElement === lastElement) {
          e.preventDefault();
          firstElement?.focus();
        }
      }
    };

    modalElement.addEventListener('keydown', handleTabKey);

    return () => {
      modalElement.removeEventListener('keydown', handleTabKey);
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
    },
    ref
  ) => {
    const modalRef = useRef<HTMLDivElement>(null);
    const internalRef = (ref as React.RefObject<HTMLDivElement>) || modalRef;

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
      <div className="modal-backdrop" onClick={handleBackdropClick}>
        <div
          ref={internalRef}
          className={modalClasses}
          role="dialog"
          aria-modal="true"
          aria-labelledby={ariaLabelledBy || (title ? 'modal-title' : undefined)}
          aria-describedby={ariaDescribedBy}
        >
          {title && (
            <ModalHeader onClose={onClose} showCloseButton>
              {title}
            </ModalHeader>
          )}
          {children}
        </div>
      </div>
    );

    return createPortal(modalContent, document.body);
  }
);

Modal.displayName = 'Modal';

/**
 * Composant ModalHeader
 */
export const ModalHeader = forwardRef<HTMLDivElement, ModalHeaderProps>(
  ({ children, showCloseButton = true, onClose, className, ...props }, ref) => {
    const headerClasses = clsx('modal-header', className);

    return (
      <div ref={ref} className={headerClasses} {...props}>
        <h2 id="modal-title" className="modal-header__title">
          {children}
        </h2>
        {showCloseButton && onClose && (
          <button
            type="button"
            className="modal-header__close"
            onClick={onClose}
            aria-label="Fermer le modal"
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
