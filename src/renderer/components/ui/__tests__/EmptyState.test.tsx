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
    const { container } = render(
      <EmptyState title="No data" icon={<EmptyChartIcon />} />
    );
    const svgs = container.querySelectorAll('svg');
    expect(svgs.length).toBeGreaterThan(0);
  });

  it('should render action button and trigger callback', () => {
    const onClick = jest.fn();
    render(
      <EmptyState
        title="Empty"
        action={{ label: 'Add item', onClick }}
      />
    );

    const button = screen.getByText('Add item');
    expect(button).toBeInTheDocument();
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
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
