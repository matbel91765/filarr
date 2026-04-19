/**
 * Card Component
 *
 * Composant carte réutilisable pour afficher du contenu groupé
 */

import React, { HTMLAttributes } from 'react';
import clsx from 'clsx';
import './Card.css';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Variante de la carte */
  variant?: 'default' | 'elevated' | 'outlined' | 'filled';
  /** Effet hover avec élévation */
  hoverable?: boolean;
  /** Clickable (affiche un curseur pointer) */
  clickable?: boolean;
  /** Padding de la carte */
  padding?: 'none' | 'sm' | 'md' | 'lg';
  /** Classe CSS additionnelle */
  className?: string;
  /** Enfants */
  children?: React.ReactNode;
}

/**
 * Composant Card
 */
export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  (
    {
      variant = 'default',
      hoverable = false,
      clickable = false,
      padding = 'md',
      className,
      children,
      ...props
    },
    ref
  ) => {
    const cardClasses = clsx(
      'card',
      `card--${variant}`,
      `card--padding-${padding}`,
      {
        'card--hoverable': hoverable,
        'card--clickable': clickable,
      },
      className
    );

    return (
      <div ref={ref} className={cardClasses} {...props}>
        {children}
      </div>
    );
  }
);

Card.displayName = 'Card';

/**
 * CardHeader Component
 */
export interface CardHeaderProps extends HTMLAttributes<HTMLDivElement> {
  title?: string;
  subtitle?: string;
  action?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}

export const CardHeader = React.forwardRef<HTMLDivElement, CardHeaderProps>(
  ({ title, subtitle, action, className, children, ...props }, ref) => {
    const headerClasses = clsx('card-header', className);

    return (
      <div ref={ref} className={headerClasses} {...props}>
        {(title || subtitle) && (
          <div className="card-header__content">
            {title && <h3 className="card-header__title">{title}</h3>}
            {subtitle && <p className="card-header__subtitle">{subtitle}</p>}
          </div>
        )}
        {children}
        {action && <div className="card-header__action">{action}</div>}
      </div>
    );
  }
);

CardHeader.displayName = 'CardHeader';

/**
 * CardBody Component
 */
export interface CardBodyProps extends HTMLAttributes<HTMLDivElement> {
  className?: string;
  children?: React.ReactNode;
}

export const CardBody = React.forwardRef<HTMLDivElement, CardBodyProps>(
  ({ className, children, ...props }, ref) => {
    const bodyClasses = clsx('card-body', className);

    return (
      <div ref={ref} className={bodyClasses} {...props}>
        {children}
      </div>
    );
  }
);

CardBody.displayName = 'CardBody';

/**
 * CardFooter Component
 */
export interface CardFooterProps extends HTMLAttributes<HTMLDivElement> {
  className?: string;
  children?: React.ReactNode;
}

export const CardFooter = React.forwardRef<HTMLDivElement, CardFooterProps>(
  ({ className, children, ...props }, ref) => {
    const footerClasses = clsx('card-footer', className);

    return (
      <div ref={ref} className={footerClasses} {...props}>
        {children}
      </div>
    );
  }
);

CardFooter.displayName = 'CardFooter';

export default Card;
