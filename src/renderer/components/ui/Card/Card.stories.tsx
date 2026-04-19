/**
 * Card Component Stories
 */

import type { Meta, StoryObj } from '@storybook/react';
import { Card, CardHeader, CardBody, CardFooter } from './Card';
import { Button } from '../Button';

const meta: Meta<typeof Card> = {
  title: 'UI/Card',
  component: Card,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Composant carte réutilisable pour afficher du contenu groupé. Support de plusieurs variantes et composants enfants (CardHeader, CardBody, CardFooter).',
      },
    },
  },
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: ['default', 'elevated', 'outlined', 'filled'],
      description: 'Variante visuelle de la carte',
    },
    padding: {
      control: 'select',
      options: ['none', 'sm', 'md', 'lg'],
      description: 'Espacement interne',
    },
    hoverable: {
      control: 'boolean',
      description: 'Effet d\'élévation au survol',
    },
    clickable: {
      control: 'boolean',
      description: 'Curseur pointer et état actif au clic',
    },
  },
};

export default meta;
type Story = StoryObj<typeof Card>;

// Default
export const Default: Story = {
  args: {
    children: 'Simple card content',
    padding: 'md',
  },
};

// Variants
export const DefaultVariant: Story = {
  args: {
    variant: 'default',
    padding: 'md',
    children: 'Default variant card',
  },
};

export const Elevated: Story = {
  args: {
    variant: 'elevated',
    padding: 'md',
    children: 'Elevated variant card',
  },
};

export const Outlined: Story = {
  args: {
    variant: 'outlined',
    padding: 'md',
    children: 'Outlined variant card',
  },
};

export const Filled: Story = {
  args: {
    variant: 'filled',
    padding: 'md',
    children: 'Filled variant card',
  },
};

// Interactive
export const Hoverable: Story = {
  args: {
    variant: 'elevated',
    hoverable: true,
    padding: 'md',
    children: 'Hover over me!',
  },
};

export const Clickable: Story = {
  args: {
    variant: 'elevated',
    clickable: true,
    hoverable: true,
    padding: 'md',
    children: 'Click me!',
    onClick: () => alert('Card clicked!'),
  },
};

// With Header, Body, Footer
export const WithHeaderAndBody: Story = {
  render: () => (
    <Card variant="elevated" padding="none" style={{ width: '350px' }}>
      <CardHeader title="Card Title" subtitle="Card subtitle" />
      <CardBody>
        <p style={{ margin: 0 }}>
          This is the card body content. You can put any content here.
        </p>
      </CardBody>
    </Card>
  ),
};

export const WithHeaderAction: Story = {
  render: () => (
    <Card variant="elevated" padding="none" style={{ width: '350px' }}>
      <CardHeader
        title="Card with Actions"
        subtitle="Header actions example"
        action={
          <Button variant="ghost" size="sm">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6.75 12a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM12.75 12a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM18.75 12a.75.75 0 11-1.5 0 .75.75 0 011.5 0z"
              />
            </svg>
          </Button>
        }
      />
      <CardBody>
        <p style={{ margin: 0 }}>Card content goes here.</p>
      </CardBody>
    </Card>
  ),
};

export const FullCard: Story = {
  render: () => (
    <Card variant="elevated" padding="none" style={{ width: '400px' }}>
      <CardHeader
        title="Complete Card Example"
        subtitle="With header, body, and footer"
      />
      <CardBody>
        <p style={{ margin: 0, marginBottom: '16px' }}>
          This is a complete card example with all sections: header, body, and footer.
        </p>
        <p style={{ margin: 0, color: 'var(--color-text-secondary)', fontSize: '14px' }}>
          The footer typically contains actions related to the card content.
        </p>
      </CardBody>
      <CardFooter>
        <Button variant="ghost" size="md">
          Cancel
        </Button>
        <Button variant="primary" size="md">
          Confirm
        </Button>
      </CardFooter>
    </Card>
  ),
};

// Folder Card Example (from Home view)
export const FolderCard: Story = {
  render: () => (
    <Card
      variant="elevated"
      hoverable
      clickable
      padding="md"
      style={{ width: '280px' }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div
          style={{
            width: '64px',
            height: '64px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: '12px',
            backgroundColor: 'var(--color-primary-50)',
            color: 'var(--color-primary-600)',
          }}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="currentColor"
            viewBox="0 0 24 24"
            style={{ width: '40px', height: '40px' }}
          >
            <path d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
          </svg>
        </div>
        <div>
          <h3 style={{ margin: '0 0 8px 0', fontSize: '20px', fontWeight: 600 }}>
            Documents
          </h3>
          <p style={{ margin: 0, fontSize: '14px', color: 'var(--color-text-secondary)' }}>
            42 items
          </p>
        </div>
      </div>
    </Card>
  ),
};

// Padding Variants
export const PaddingVariants: Story = {
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <Card variant="outlined" padding="none">
        <p style={{ margin: 0 }}>No padding</p>
      </Card>
      <Card variant="outlined" padding="sm">
        <p style={{ margin: 0 }}>Small padding</p>
      </Card>
      <Card variant="outlined" padding="md">
        <p style={{ margin: 0 }}>Medium padding</p>
      </Card>
      <Card variant="outlined" padding="lg">
        <p style={{ margin: 0 }}>Large padding</p>
      </Card>
    </div>
  ),
};
