/**
 * Test suite for EmptyState component
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  EmptyState,
  EmptyFileIcon,
  EmptyChartIcon,
  EmptyInboxIcon,
} from '../EmptyState/EmptyState';

describe('EmptyState', () => {
  it('should render title', () => {
    render(<EmptyState title="No items" />);
    expect(screen.getByText('No items')).toBeInTheDocument();
  });

  it('should render description when provided', () => {
    render(<EmptyState title="No items" description="Try adding something." />);
    expect(screen.getByText('Try adding something.')).toBeInTheDocument();
  });

  it('should not render description when not provided', () => {
    const { container } = render(<EmptyState title="No items" />);
    const paragraphs = container.querySelectorAll('p');
    expect(paragraphs).toHaveLength(0);
  });

  it('should render icon when provided', () => {
    const { container } = render(<EmptyState title="No data" icon={<EmptyChartIcon />} />);
    const svgs = container.querySelectorAll('svg');
    expect(svgs.length).toBeGreaterThan(0);
  });

  it('should render action button and trigger callback', () => {
    const onClick = jest.fn();
    render(<EmptyState title="Empty" action={{ label: 'Add item', onClick }} />);

    const button = screen.getByRole('button', { name: 'Add item' });
    expect(button).toBeInTheDocument();
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  /**
   * L'action est un `Button` DU DESIGN SYSTEM, plus un `<button>` natif habillé
   * de classes utilitaires : c'est ce qui lui donne le thème, l'anneau de focus
   * et l'état désactivé du reste de l'application. Le contrôle porte sur la
   * classe que le composant pose lui-même — un état vide reconstruit à la main
   * la perdrait sans que rien d'autre ne bouge à l'écran.
   */
  it('should render the action with the design-system Button', () => {
    render(<EmptyState title="Empty" action={{ label: 'Add item', onClick: () => {} }} />);
    const button = screen.getByRole('button', { name: 'Add item' });
    expect(button.className).toContain('button');
    expect(button.className).toContain('button--primary');
  });

  it('should honour the requested Button variant', () => {
    render(
      <EmptyState
        title="Empty"
        action={{ label: 'Upgrade', onClick: () => {}, variant: 'secondary' }}
      />
    );
    expect(screen.getByRole('button', { name: 'Upgrade' }).className).toContain(
      'button--secondary'
    );
  });

  it('should disable the action when asked', () => {
    const onClick = jest.fn();
    render(<EmptyState title="Empty" action={{ label: 'Retry', onClick, disabled: true }} />);
    const button = screen.getByRole('button', { name: 'Retry' });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('should not render action button when not provided', () => {
    render(<EmptyState title="Empty" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('should apply custom className', () => {
    const { container } = render(<EmptyState title="Test" className="custom-class" />);
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toContain('custom-class');
  });
});

describe('EmptyState Icons', () => {
  it('should render EmptyFileIcon as SVG', () => {
    const { container } = render(<EmptyFileIcon />);
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('should render EmptyChartIcon as SVG', () => {
    const { container } = render(<EmptyChartIcon />);
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('should render EmptyInboxIcon as SVG', () => {
    const { container } = render(<EmptyInboxIcon />);
    expect(container.querySelector('svg')).toBeInTheDocument();
  });
});
