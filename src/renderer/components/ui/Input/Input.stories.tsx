/**
 * Input Component Stories
 */

import type { Meta, StoryObj } from '@storybook/react';
import { Input } from './Input';

const meta: Meta<typeof Input> = {
  title: 'UI/Input',
  component: Input,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Composant input réutilisable avec support des labels, messages d\'erreur, icônes et différentes variantes.',
      },
    },
  },
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: ['default', 'filled', 'outlined'],
      description: 'Variante visuelle de l\'input',
    },
    size: {
      control: 'select',
      options: ['sm', 'md', 'lg'],
      description: 'Taille de l\'input',
    },
    disabled: {
      control: 'boolean',
      description: 'Input désactivé',
    },
    fullWidth: {
      control: 'boolean',
      description: 'Input pleine largeur',
    },
  },
};

export default meta;
type Story = StoryObj<typeof Input>;

// Default
export const Default: Story = {
  args: {
    placeholder: 'Enter text...',
  },
};

// With Label
export const WithLabel: Story = {
  args: {
    label: 'Email Address',
    placeholder: 'you@example.com',
  },
};

// With Error
export const WithError: Story = {
  args: {
    label: 'Email Address',
    placeholder: 'you@example.com',
    error: 'This field is required',
  },
};

// With Helper Text
export const WithHelperText: Story = {
  args: {
    label: 'Password',
    type: 'password',
    placeholder: '••••••••',
    helperText: 'Must be at least 8 characters',
  },
};

// Required Field
export const Required: Story = {
  args: {
    label: 'Username',
    placeholder: 'johndoe',
    required: true,
  },
};

// With Left Icon
export const WithLeftIcon: Story = {
  args: {
    label: 'Search',
    placeholder: 'Search...',
    leftIcon: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={2}
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
        />
      </svg>
    ),
  },
};

// With Right Icon
export const WithRightIcon: Story = {
  args: {
    label: 'Email',
    placeholder: 'you@example.com',
    rightIcon: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={2}
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
    ),
  },
};

// Variants
export const DefaultVariant: Story = {
  args: {
    label: 'Default Variant',
    placeholder: 'Enter text...',
    variant: 'default',
  },
};

export const FilledVariant: Story = {
  args: {
    label: 'Filled Variant',
    placeholder: 'Enter text...',
    variant: 'filled',
  },
};

export const OutlinedVariant: Story = {
  args: {
    label: 'Outlined Variant',
    placeholder: 'Enter text...',
    variant: 'outlined',
  },
};

// Sizes
export const Small: Story = {
  args: {
    label: 'Small Input',
    placeholder: 'Small size',
    size: 'sm',
  },
};

export const Medium: Story = {
  args: {
    label: 'Medium Input',
    placeholder: 'Medium size',
    size: 'md',
  },
};

export const Large: Story = {
  args: {
    label: 'Large Input',
    placeholder: 'Large size',
    size: 'lg',
  },
};

// States
export const Disabled: Story = {
  args: {
    label: 'Disabled Input',
    placeholder: 'Cannot edit',
    disabled: true,
    value: 'Disabled value',
  },
};

// Types
export const Password: Story = {
  args: {
    label: 'Password',
    type: 'password',
    placeholder: '••••••••',
  },
};

export const Email: Story = {
  args: {
    label: 'Email',
    type: 'email',
    placeholder: 'you@example.com',
  },
};

export const Number: Story = {
  args: {
    label: 'Age',
    type: 'number',
    placeholder: '25',
  },
};

// Full Width
export const FullWidth: Story = {
  args: {
    label: 'Full Width Input',
    placeholder: 'This input is full width',
    fullWidth: true,
  },
  parameters: {
    layout: 'padded',
  },
};

// Form Example
export const FormExample: Story = {
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', width: '400px' }}>
      <Input
        label="Full Name"
        placeholder="John Doe"
        required
      />
      <Input
        label="Email Address"
        type="email"
        placeholder="you@example.com"
        required
        leftIcon={
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
              d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75"
            />
          </svg>
        }
      />
      <Input
        label="Password"
        type="password"
        placeholder="••••••••"
        required
        helperText="Must be at least 8 characters"
      />
      <Input
        label="Confirm Password"
        type="password"
        placeholder="••••••••"
        required
      />
    </div>
  ),
};
