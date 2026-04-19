/**
 * Form Controls Usage Examples
 *
 * Exemples d'utilisation des composants Checkbox, Radio et Toggle
 */

import { useState } from 'react';
import { Checkbox, RadioGroup, Toggle } from './index';

/**
 * Exemple 1: Checkbox simple
 */
export const CheckboxExample = () => {
  const [checked, setChecked] = useState(false);

  return (
    <div>
      <h3>Checkbox Simple</h3>
      <Checkbox
        label="J'accepte les conditions générales"
        checked={checked}
        onChange={(e) => setChecked(e.target.checked)}
      />
      <p>État: {checked ? 'Accepté' : 'Non accepté'}</p>
    </div>
  );
};

/**
 * Exemple 2: Checkbox avec erreur
 */
export const CheckboxErrorExample = () => {
  const [accepted, setAccepted] = useState(false);
  const [showError, setShowError] = useState(false);

  const handleSubmit = () => {
    if (!accepted) {
      setShowError(true);
    } else {
      setShowError(false);
      alert('Formulaire soumis !');
    }
  };

  return (
    <div>
      <h3>Checkbox avec validation</h3>
      <Checkbox
        label="J'accepte les conditions"
        checked={accepted}
        onChange={(e) => {
          setAccepted(e.target.checked);
          setShowError(false);
        }}
        error={showError ? 'Vous devez accepter les conditions' : undefined}
      />
      <button onClick={handleSubmit}>Soumettre</button>
    </div>
  );
};

/**
 * Exemple 3: RadioGroup pour sélection de plan
 */
export const RadioGroupExample = () => {
  const [selectedPlan, setSelectedPlan] = useState('basic');

  return (
    <div>
      <h3>Sélection de plan</h3>
      <RadioGroup
        label="Choisissez votre forfait"
        name="plan"
        value={selectedPlan}
        onChange={setSelectedPlan}
        options={[
          { value: 'free', label: 'Gratuit - 0€/mois' },
          { value: 'basic', label: 'Basic - 10€/mois' },
          { value: 'pro', label: 'Pro - 25€/mois' },
          { value: 'enterprise', label: 'Enterprise - Sur mesure' },
        ]}
        orientation="vertical"
      />
      <p>Plan sélectionné: {selectedPlan}</p>
    </div>
  );
};

/**
 * Exemple 4: Toggle pour paramètres
 */
export const ToggleExample = () => {
  const [settings, setSettings] = useState({
    notifications: true,
    darkMode: false,
    autoSave: true,
  });

  const handleToggle = (key: keyof typeof settings) => {
    setSettings((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  return (
    <div>
      <h3>Paramètres d'application</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <Toggle
          label="Activer les notifications"
          checked={settings.notifications}
          onChange={() => handleToggle('notifications')}
        />
        <Toggle
          label="Mode sombre"
          checked={settings.darkMode}
          onChange={() => handleToggle('darkMode')}
        />
        <Toggle
          label="Sauvegarde automatique"
          checked={settings.autoSave}
          onChange={() => handleToggle('autoSave')}
        />
      </div>
      <pre>{JSON.stringify(settings, null, 2)}</pre>
    </div>
  );
};

/**
 * Exemple 5: Formulaire complet
 */
export const CompleteFormExample = () => {
  const [formData, setFormData] = useState({
    newsletter: false,
    terms: false,
    plan: 'basic',
    notifications: true,
  });

  const [errors, setErrors] = useState({
    terms: '',
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.terms) {
      setErrors({ terms: 'Vous devez accepter les conditions' });
      return;
    }

    setErrors({ terms: '' });
    alert('Formulaire soumis avec succès !');
  };

  return (
    <form onSubmit={handleSubmit} style={{ maxWidth: '500px' }}>
      <h3>Créer un compte</h3>

      {/* Checkboxes */}
      <div style={{ marginBottom: '1.5rem' }}>
        <Checkbox
          label="S'abonner à la newsletter"
          checked={formData.newsletter}
          onChange={(e) =>
            setFormData((prev) => ({ ...prev, newsletter: e.target.checked }))
          }
        />
      </div>

      <div style={{ marginBottom: '1.5rem' }}>
        <Checkbox
          label="J'accepte les conditions générales"
          checked={formData.terms}
          onChange={(e) => {
            setFormData((prev) => ({ ...prev, terms: e.target.checked }));
            setErrors({ terms: '' });
          }}
          error={errors.terms}
        />
      </div>

      {/* Radio Group */}
      <div style={{ marginBottom: '1.5rem' }}>
        <RadioGroup
          label="Sélectionnez votre plan"
          name="plan"
          value={formData.plan}
          onChange={(value) => setFormData((prev) => ({ ...prev, plan: value }))}
          options={[
            { value: 'free', label: 'Gratuit' },
            { value: 'basic', label: 'Basic - 10€/mois' },
            { value: 'pro', label: 'Pro - 25€/mois' },
          ]}
          orientation="vertical"
        />
      </div>

      {/* Toggle */}
      <div style={{ marginBottom: '1.5rem' }}>
        <Toggle
          label="Recevoir les notifications par email"
          checked={formData.notifications}
          onChange={(e) =>
            setFormData((prev) => ({ ...prev, notifications: e.target.checked }))
          }
        />
      </div>

      <button type="submit" style={{ padding: '0.5rem 1rem' }}>
        Créer mon compte
      </button>
    </form>
  );
};
