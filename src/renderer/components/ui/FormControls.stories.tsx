/**
 * Form Controls Stories
 *
 * Stories pour Checkbox, Radio et Toggle
 */

import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import { Checkbox } from './Checkbox/Checkbox';
import { Radio } from './Radio/Radio';
import { RadioGroup } from './Radio/RadioGroup';
import { Toggle } from './Toggle/Toggle';

// Wrapper pour les exemples interactifs
const CheckboxWrapper = ({ checked: initialChecked = false, ...args }: any) => {
  const [checked, setChecked] = useState(initialChecked);
  return (
    <Checkbox
      {...args}
      checked={checked}
      onChange={(e) => setChecked(e.target.checked)}
    />
  );
};

const RadioWrapper = ({ checked: initialChecked = false, ...args }: any) => {
  const [checked, setChecked] = useState(initialChecked);
  return (
    <Radio
      {...args}
      checked={checked}
      onChange={(e) => setChecked(e.target.checked)}
    />
  );
};

const ToggleWrapper = ({ checked: initialChecked = false, ...args }: any) => {
  const [checked, setChecked] = useState(initialChecked);
  return (
    <Toggle
      {...args}
      checked={checked}
      onChange={(e) => setChecked(e.target.checked)}
    />
  );
};

const RadioGroupWrapper = ({ value: initialValue = '', ...args }: any) => {
  const [value, setValue] = useState(initialValue);
  return (
    <RadioGroup
      {...args}
      value={value}
      onChange={(val) => setValue(val)}
    />
  );
};

// ===== CHECKBOX STORIES =====

const metaCheckbox: Meta<typeof Checkbox> = {
  title: 'Form Controls/Checkbox',
  component: Checkbox,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'Composant Checkbox personnalisé avec support indeterminate, erreurs et tailles.',
      },
    },
  },
  tags: ['autodocs'],
  argTypes: {
    size: {
      control: 'select',
      options: ['sm', 'md', 'lg'],
    },
    label: {
      control: 'text',
    },
    error: {
      control: 'text',
    },
    indeterminate: {
      control: 'boolean',
    },
    disabled: {
      control: 'boolean',
    },
  },
};

export default metaCheckbox;

type CheckboxStory = StoryObj<typeof Checkbox>;

export const Default: CheckboxStory = {
  render: (args) => <CheckboxWrapper {...args} />,
  args: {
    label: 'Accept terms and conditions',
    size: 'md',
  },
};

export const Checked: CheckboxStory = {
  render: (args) => <CheckboxWrapper {...args} />,
  args: {
    label: 'I agree',
    checked: true,
    size: 'md',
  },
};

export const Indeterminate: CheckboxStory = {
  render: (args) => <CheckboxWrapper {...args} />,
  args: {
    label: 'Select all',
    indeterminate: true,
    size: 'md',
  },
};

export const WithError: CheckboxStory = {
  render: (args) => <CheckboxWrapper {...args} />,
  args: {
    label: 'Accept terms',
    error: 'You must accept the terms and conditions',
    size: 'md',
  },
};

export const Disabled: CheckboxStory = {
  render: (args) => <CheckboxWrapper {...args} />,
  args: {
    label: 'Disabled checkbox',
    disabled: true,
    size: 'md',
  },
};

export const DisabledChecked: CheckboxStory = {
  render: (args) => <CheckboxWrapper {...args} />,
  args: {
    label: 'Disabled checked',
    disabled: true,
    checked: true,
    size: 'md',
  },
};

export const WithoutLabel: CheckboxStory = {
  render: (args) => <CheckboxWrapper {...args} />,
  args: {
    size: 'md',
  },
};

export const Sizes: CheckboxStory = {
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <CheckboxWrapper label="Small checkbox" size="sm" />
      <CheckboxWrapper label="Medium checkbox" size="md" />
      <CheckboxWrapper label="Large checkbox" size="lg" />
    </div>
  ),
};

export const CheckboxList: CheckboxStory = {
  render: () => {
    const [options, setOptions] = useState({
      option1: true,
      option2: false,
      option3: true,
      option4: false,
    });

    const handleChange = (key: string) => (e: React.ChangeEvent<HTMLInputElement>) => {
      setOptions((prev) => ({ ...prev, [key]: e.target.checked }));
    };

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        <h3 style={{ margin: 0, marginBottom: '0.5rem' }}>Select your preferences</h3>
        <Checkbox
          label="Email notifications"
          checked={options.option1}
          onChange={handleChange('option1')}
        />
        <Checkbox
          label="SMS notifications"
          checked={options.option2}
          onChange={handleChange('option2')}
        />
        <Checkbox
          label="Push notifications"
          checked={options.option3}
          onChange={handleChange('option3')}
        />
        <Checkbox
          label="Weekly newsletter"
          checked={options.option4}
          onChange={handleChange('option4')}
        />
      </div>
    );
  },
};

// ===== RADIO STORIES =====

export const RadioDefault: StoryObj = {
  render: () => <RadioWrapper label="Option 1" name="radio-default" />,
};

export const RadioChecked: StoryObj = {
  render: () => <RadioWrapper label="Selected option" name="radio-checked" checked={true} />,
};

export const RadioWithError: StoryObj = {
  render: () => (
    <RadioWrapper
      label="Option with error"
      name="radio-error"
      error="This option is not available"
    />
  ),
};

export const RadioDisabled: StoryObj = {
  render: () => <RadioWrapper label="Disabled option" name="radio-disabled" disabled={true} />,
};

export const RadioSizes: StoryObj = {
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <RadioWrapper label="Small radio" name="radio-size" size="sm" />
      <RadioWrapper label="Medium radio" name="radio-size" size="md" />
      <RadioWrapper label="Large radio" name="radio-size" size="lg" />
    </div>
  ),
};

// ===== RADIO GROUP STORIES =====

export const RadioGroupVertical: StoryObj = {
  render: () => (
    <RadioGroupWrapper
      label="Choose your plan"
      name="plan-vertical"
      options={[
        { value: 'free', label: 'Free - $0/month' },
        { value: 'basic', label: 'Basic - $10/month' },
        { value: 'pro', label: 'Pro - $25/month' },
        { value: 'enterprise', label: 'Enterprise - Custom pricing' },
      ]}
      value="basic"
      orientation="vertical"
    />
  ),
};

export const RadioGroupHorizontal: StoryObj = {
  render: () => (
    <RadioGroupWrapper
      label="Select size"
      name="size-horizontal"
      options={[
        { value: 'xs', label: 'XS' },
        { value: 's', label: 'S' },
        { value: 'm', label: 'M' },
        { value: 'l', label: 'L' },
        { value: 'xl', label: 'XL' },
      ]}
      value="m"
      orientation="horizontal"
    />
  ),
};

export const RadioGroupWithError: StoryObj = {
  render: () => (
    <RadioGroupWrapper
      label="Payment method"
      name="payment-error"
      options={[
        { value: 'card', label: 'Credit Card' },
        { value: 'paypal', label: 'PayPal' },
        { value: 'crypto', label: 'Cryptocurrency', disabled: true },
      ]}
      error="Please select a payment method"
      orientation="vertical"
    />
  ),
};

export const RadioGroupDisabled: StoryObj = {
  render: () => (
    <RadioGroupWrapper
      label="Disabled group"
      name="disabled-group"
      options={[
        { value: 'opt1', label: 'Option 1' },
        { value: 'opt2', label: 'Option 2' },
        { value: 'opt3', label: 'Option 3' },
      ]}
      disabled={true}
      orientation="vertical"
    />
  ),
};

export const RadioGroupSizes: StoryObj = {
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      <RadioGroupWrapper
        label="Small size"
        name="radio-group-sm"
        size="sm"
        options={[
          { value: 'opt1', label: 'Option 1' },
          { value: 'opt2', label: 'Option 2' },
        ]}
        value="opt1"
        orientation="vertical"
      />
      <RadioGroupWrapper
        label="Medium size"
        name="radio-group-md"
        size="md"
        options={[
          { value: 'opt1', label: 'Option 1' },
          { value: 'opt2', label: 'Option 2' },
        ]}
        value="opt1"
        orientation="vertical"
      />
      <RadioGroupWrapper
        label="Large size"
        name="radio-group-lg"
        size="lg"
        options={[
          { value: 'opt1', label: 'Option 1' },
          { value: 'opt2', label: 'Option 2' },
        ]}
        value="opt1"
        orientation="vertical"
      />
    </div>
  ),
};

// ===== TOGGLE STORIES =====

export const ToggleDefault: StoryObj = {
  render: () => <ToggleWrapper label="Enable notifications" />,
};

export const ToggleChecked: StoryObj = {
  render: () => <ToggleWrapper label="Dark mode" checked={true} />,
};

export const ToggleDisabled: StoryObj = {
  render: () => <ToggleWrapper label="Disabled toggle" disabled={true} />,
};

export const ToggleDisabledChecked: StoryObj = {
  render: () => <ToggleWrapper label="Disabled checked" disabled={true} checked={true} />,
};

export const ToggleWithoutLabel: StoryObj = {
  render: () => <ToggleWrapper />,
};

export const ToggleLabelLeft: StoryObj = {
  render: () => <ToggleWrapper label="Label on left" labelPosition="left" />,
};

export const ToggleLabelRight: StoryObj = {
  render: () => <ToggleWrapper label="Label on right" labelPosition="right" />,
};

export const ToggleSizes: StoryObj = {
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <ToggleWrapper label="Small toggle" size="sm" />
      <ToggleWrapper label="Medium toggle" size="md" />
      <ToggleWrapper label="Large toggle" size="lg" />
    </div>
  ),
};

export const ToggleList: StoryObj = {
  render: () => {
    const [settings, setSettings] = useState({
      notifications: true,
      darkMode: false,
      autoSave: true,
      syncData: false,
      betaFeatures: false,
    });

    const handleToggle = (key: string) => (e: React.ChangeEvent<HTMLInputElement>) => {
      setSettings((prev) => ({ ...prev, [key]: e.target.checked }));
    };

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', minWidth: '300px' }}>
        <h3 style={{ margin: 0, marginBottom: '0.5rem' }}>Settings</h3>
        <Toggle
          label="Enable notifications"
          checked={settings.notifications}
          onChange={handleToggle('notifications')}
        />
        <Toggle
          label="Dark mode"
          checked={settings.darkMode}
          onChange={handleToggle('darkMode')}
        />
        <Toggle
          label="Auto-save"
          checked={settings.autoSave}
          onChange={handleToggle('autoSave')}
        />
        <Toggle
          label="Sync data"
          checked={settings.syncData}
          onChange={handleToggle('syncData')}
        />
        <Toggle
          label="Beta features"
          checked={settings.betaFeatures}
          onChange={handleToggle('betaFeatures')}
        />
      </div>
    );
  },
};

// ===== COMPLETE FORM EXAMPLE =====

export const CompleteForm: StoryObj = {
  render: () => {
    const [formData, setFormData] = useState({
      agreedToTerms: false,
      newsletter: false,
      plan: 'basic',
      notifications: true,
      autoUpdate: false,
    });

    return (
      <div
        style={{
          maxWidth: '500px',
          padding: '2rem',
          backgroundColor: 'var(--color-background-secondary)',
          borderRadius: 'var(--radius-lg)',
          display: 'flex',
          flexDirection: 'column',
          gap: '2rem',
        }}
      >
        <h2 style={{ margin: 0 }}>Account Settings</h2>

        {/* Checkboxes Section */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <h3 style={{ margin: 0, fontSize: 'var(--font-size-lg)' }}>Preferences</h3>
          <Checkbox
            label="I agree to the terms and conditions"
            checked={formData.agreedToTerms}
            onChange={(e) =>
              setFormData((prev) => ({ ...prev, agreedToTerms: e.target.checked }))
            }
          />
          <Checkbox
            label="Subscribe to newsletter"
            checked={formData.newsletter}
            onChange={(e) =>
              setFormData((prev) => ({ ...prev, newsletter: e.target.checked }))
            }
          />
        </div>

        {/* Radio Group Section */}
        <div>
          <RadioGroup
            label="Choose your plan"
            name="plan"
            value={formData.plan}
            onChange={(value) => setFormData((prev) => ({ ...prev, plan: value }))}
            options={[
              { value: 'free', label: 'Free - $0/month' },
              { value: 'basic', label: 'Basic - $10/month' },
              { value: 'pro', label: 'Pro - $25/month' },
            ]}
            orientation="vertical"
          />
        </div>

        {/* Toggles Section */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <h3 style={{ margin: 0, fontSize: 'var(--font-size-lg)' }}>Notifications</h3>
          <Toggle
            label="Enable notifications"
            checked={formData.notifications}
            onChange={(e) =>
              setFormData((prev) => ({ ...prev, notifications: e.target.checked }))
            }
          />
          <Toggle
            label="Auto-update applications"
            checked={formData.autoUpdate}
            onChange={(e) =>
              setFormData((prev) => ({ ...prev, autoUpdate: e.target.checked }))
            }
          />
        </div>

        {/* Summary */}
        <div
          style={{
            padding: '1rem',
            backgroundColor: 'var(--color-surface)',
            borderRadius: 'var(--radius-md)',
            fontSize: 'var(--font-size-sm)',
          }}
        >
          <strong>Current Settings:</strong>
          <pre style={{ marginTop: '0.5rem', fontSize: 'var(--font-size-sm)' }}>
            {JSON.stringify(formData, null, 2)}
          </pre>
        </div>
      </div>
    );
  },
};

// ===== DARK MODE SHOWCASE =====

export const DarkMode: StoryObj = {
  render: () => (
    <div data-theme="dark" style={{ padding: '2rem', backgroundColor: '#0A0E1A' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
        <div>
          <h3 style={{ color: '#F0F8FF', marginBottom: '1rem' }}>Checkboxes</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <CheckboxWrapper label="Unchecked checkbox" />
            <CheckboxWrapper label="Checked checkbox" checked={true} />
            <CheckboxWrapper label="Indeterminate checkbox" indeterminate={true} />
            <CheckboxWrapper label="Disabled checkbox" disabled={true} />
          </div>
        </div>

        <div>
          <h3 style={{ color: '#F0F8FF', marginBottom: '1rem' }}>Radio Buttons</h3>
          <RadioGroupWrapper
            label="Select an option"
            name="dark-mode-radio"
            options={[
              { value: 'opt1', label: 'Option 1' },
              { value: 'opt2', label: 'Option 2' },
              { value: 'opt3', label: 'Option 3' },
            ]}
            value="opt2"
            orientation="vertical"
          />
        </div>

        <div>
          <h3 style={{ color: '#F0F8FF', marginBottom: '1rem' }}>Toggles</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <ToggleWrapper label="Toggle off" checked={false} />
            <ToggleWrapper label="Toggle on" checked={true} />
            <ToggleWrapper label="Toggle disabled" disabled={true} />
          </div>
        </div>
      </div>
    </div>
  ),
};
