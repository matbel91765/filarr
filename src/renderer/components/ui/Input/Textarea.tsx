/**
 * Textarea Component
 *
 * Le pendant multiligne de `Input`, avec le même label, le même message d'erreur,
 * le même texte d'aide et la MÊME feuille de style (`Input.css`).
 *
 * ── POURQUOI IL FALLAIT L'ÉCRIRE ─────────────────────────────────────────────
 *
 * Le design system n'avait pas de champ multiligne. Chaque écran qui en voulait
 * un posait donc un `<textarea>` natif — ce que la règle du produit interdit,
 * parce qu'un champ natif sur le thème sombre garde les couleurs du système :
 * fond blanc, bordure grise, anneau de focus étranger. Ce n'est pas une question
 * d'esthétique mais de lisibilité, et cela se voit surtout sur les thèmes que
 * l'utilisateur a choisis précisément pour être sombres.
 *
 * Il ne redéfinit aucune couleur : il réemploie les classes de `Input`, si bien
 * qu'une retouche de la palette des champs le suit sans que personne y pense.
 */

import React, { forwardRef, TextareaHTMLAttributes } from 'react';
import clsx from 'clsx';
import './Input.css';

export interface TextareaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'size'> {
  /** Label du champ */
  label?: string;
  /** Message d'erreur */
  error?: string;
  /** Message d'aide */
  helperText?: string;
  /** Taille (hauteur de ligne + rembourrage), alignée sur Input */
  size?: 'sm' | 'md' | 'lg';
  /** Variante */
  variant?: 'default' | 'filled' | 'outlined';
  /** Pleine largeur */
  fullWidth?: boolean;
  /** Classe CSS additionnelle */
  className?: string;
  /** Classe CSS pour le conteneur */
  containerClassName?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  (
    {
      label,
      error,
      helperText,
      size = 'md',
      variant = 'default',
      fullWidth = true,
      className,
      containerClassName,
      disabled,
      required,
      rows = 4,
      id,
      ...props
    },
    ref
  ) => {
    const fieldId = id || `textarea-${Math.random().toString(36).substr(2, 9)}`;
    const hasError = Boolean(error);

    return (
      <div
        className={clsx(
          'input-container',
          {
            'input-container--full-width': fullWidth,
            'input-container--disabled': disabled,
          },
          containerClassName
        )}
      >
        {label && (
          <label htmlFor={fieldId} className="input-label">
            {label}
            {required && <span className="input-label__required">*</span>}
          </label>
        )}

        <div
          className={clsx(
            'input-wrapper',
            'input-wrapper--textarea',
            `input-wrapper--${size}`,
            `input-wrapper--${variant}`,
            {
              'input-wrapper--error': hasError,
              'input-wrapper--disabled': disabled,
            }
          )}
        >
          <textarea
            ref={ref}
            id={fieldId}
            rows={rows}
            className={clsx('input', 'input--textarea', `input--${size}`, className)}
            disabled={disabled}
            required={required}
            aria-invalid={hasError}
            aria-describedby={
              error ? `${fieldId}-error` : helperText ? `${fieldId}-helper` : undefined
            }
            {...props}
          />
        </div>

        {error && (
          <p id={`${fieldId}-error`} className="input-message input-message--error">
            {error}
          </p>
        )}

        {!error && helperText && (
          <p id={`${fieldId}-helper`} className="input-message input-message--helper">
            {helperText}
          </p>
        )}
      </div>
    );
  }
);

Textarea.displayName = 'Textarea';

export default Textarea;
