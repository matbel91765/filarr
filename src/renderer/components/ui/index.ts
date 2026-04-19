/**
 * UI Components Index
 *
 * Export centralisé de tous les composants UI réutilisables
 */

// Button
export { Button } from './Button';
export type { ButtonProps } from './Button';

// Input
export { Input } from './Input';
export type { InputProps } from './Input';

// Card
export { Card, CardHeader, CardBody, CardFooter } from './Card';
export type { CardProps, CardHeaderProps, CardBodyProps, CardFooterProps } from './Card';

// Modal
export { Modal, ModalHeader, ModalBody, ModalFooter } from './Modal';
export type { ModalProps, ModalHeaderProps, ModalBodyProps, ModalFooterProps } from './Modal';

// Notification
export { Notification, NotificationProvider, useNotification } from './Notification';
export type {
  NotificationProps,
  NotificationType,
  NotificationAction,
  NotificationProviderProps,
  NotificationContextValue,
  NotificationOptions,
} from './Notification';

// ProgressBar
export { ProgressBar, CircularProgress } from './ProgressBar';
export type {
  ProgressBarProps,
  ProgressBarVariant,
  ProgressBarSize,
  CircularProgressProps,
  CircularProgressVariant,
  CircularProgressSize,
  CircularProgressThickness,
} from './ProgressBar';

// Dropdown (Select, Dropdown, Combobox)
export { Select, Dropdown, Combobox } from './Dropdown';
export type {
  SelectProps,
  SelectOption,
  DropdownProps,
  DropdownItem,
  ComboboxProps,
  ComboboxOption,
} from './Dropdown';

// Checkbox
export { Checkbox } from './Checkbox';
export type { CheckboxProps } from './Checkbox';

// Radio
export { Radio, RadioGroup } from './Radio';
export type { RadioProps, RadioGroupProps, RadioOption } from './Radio';

// Toggle
export { Toggle } from './Toggle';
export type { ToggleProps } from './Toggle';

// ContextMenu
export { ContextMenu } from './ContextMenu';
export type { ContextMenuProps, ContextMenuItem } from './ContextMenu';

// PromptModal
export { PromptModal } from './PromptModal';

// ConfirmModal
export { ConfirmModal } from './ConfirmModal';

// ColorPickerModal
export { ColorPickerModal } from './ColorPickerModal';

// ReminderModal
export { ReminderModal } from './ReminderModal';
export type { ReminderData } from './ReminderModal';

// ErrorBoundary
export { ErrorBoundary } from './ErrorBoundary';

// PomodoroWidget
export { PomodoroWidget } from './PomodoroWidget';
