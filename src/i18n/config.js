/**
 * Configuration i18next pour l'internationalisation
 */

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

// Import des fichiers de traduction
import translationFR from './locales/fr/translation.json';
import translationEN from './locales/en/translation.json';

// Configuration des ressources de traduction
const resources = {
  fr: {
    translation: translationFR
  },
  en: {
    translation: translationEN
  }
};

i18n
  // Détection automatique de la langue
  .use(LanguageDetector)
  // Intégration avec React
  .use(initReactI18next)
  // Initialisation
  .init({
    resources,
    fallbackLng: 'fr', // Langue par défaut
    debug: process.env.NODE_ENV === 'development',

    // Options de détection de langue
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
    },

    interpolation: {
      escapeValue: false // React échappe déjà les valeurs
    },

    react: {
      useSuspense: true
    }
  });

export default i18n;
