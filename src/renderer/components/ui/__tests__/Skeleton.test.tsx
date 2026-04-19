/**
 * Test suite for Skeleton components
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import {
  Skeleton,
  SkeletonText,
  SkeletonCard,
  SkeletonTable,
  SkeletonList,
  SkeletonDashboard,
} from '../Skeleton/Skeleton';

describe('Skeleton', () => {
  it('should render with default props', () => {
    const { container } = render(<Skeleton />);
    const el = container.firstChild as HTMLElement;
    expect(el).toHaveStyle({ width: '100%', height: '1rem', borderRadius: '0.375rem' });
    expect(el).toHaveAttribute('aria-hidden', 'true');
  });

  it('should apply custom dimensions', () => {
    const { container } = render(<Skeleton width="50%" height="2rem" />);
    const el = container.firstChild as HTMLElement;
    expect(el).toHaveStyle({ width: '50%', height: '2rem' });
  });

  it('should accept custom className', () => {
    const { container } = render(<Skeleton className="my-class" />);
    const el = container.firstChild as HTMLElement;
    expect(el.className).toContain('my-class');
    expect(el.className).toContain('animate-pulse');
  });
});

describe('SkeletonText', () => {
  it('should render 3 lines by default', () => {
    const { container } = render(<SkeletonText />);
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.children).toHaveLength(3);
    expect(wrapper).toHaveAttribute('aria-hidden', 'true');
  });

  it('should render custom line count', () => {
    const { container } = render(<SkeletonText lines={5} />);
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.children).toHaveLength(5);
  });

  it('should make last line shorter (60% width)', () => {
    const { container } = render(<SkeletonText lines={2} />);
    const wrapper = container.firstChild as HTMLElement;
    const lastLine = wrapper.children[1] as HTMLElement;
    expect(lastLine).toHaveStyle({ width: '60%' });
  });
});

describe('SkeletonCard', () => {
  it('should render a card with skeleton elements', () => {
    const { container } = render(<SkeletonCard />);
    const card = container.firstChild as HTMLElement;
    expect(card).toHaveAttribute('aria-hidden', 'true');
    expect(card.className).toContain('rounded-xl');
  });
});

describe('SkeletonTable', () => {
  it('should render header + rows', () => {
    const { container } = render(<SkeletonTable rows={3} cols={2} />);
    const table = container.firstChild as HTMLElement;
    // 1 header + 3 rows = 4 child divs
    expect(table.children).toHaveLength(4);
  });

  it('should use defaults of 5 rows and 4 cols', () => {
    const { container } = render(<SkeletonTable />);
    const table = container.firstChild as HTMLElement;
    // 1 header + 5 rows = 6 child divs
    expect(table.children).toHaveLength(6);
  });
});

describe('SkeletonList', () => {
  it('should render 4 items by default', () => {
    const { container } = render(<SkeletonList />);
    const list = container.firstChild as HTMLElement;
    expect(list.children).toHaveLength(4);
    expect(list).toHaveAttribute('aria-hidden', 'true');
  });

  it('should render custom item count', () => {
    const { container } = render(<SkeletonList items={2} />);
    const list = container.firstChild as HTMLElement;
    expect(list.children).toHaveLength(2);
  });
});

describe('SkeletonDashboard', () => {
  it('should render the full dashboard skeleton', () => {
    const { container } = render(<SkeletonDashboard />);
    const dashboard = container.firstChild as HTMLElement;
    expect(dashboard).toHaveAttribute('aria-hidden', 'true');
    expect(dashboard.className).toContain('space-y-6');
  });
});
