/**
 * Utilitaire pour la génération d'identifiants uniques
 */

/**
 * Génère un identifiant unique basé sur le timestamp et un nombre aléatoire
 * @returns {string} Identifiant unique
 */
export const generateUniqueId = () => {
  return Date.now().toString() + Math.random().toString(36).substring(2, 9);
};

/**
 * Génère un identifiant unique au format UUID v4
 * @returns {string} UUID v4
 */
export const generateUUID = () => {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
};

/**
 * Alias pour generateUUID - génère un ID au format UUID v4
 * @returns {string} UUID v4
 */
export const generateId = generateUUID;

/**
 * Génère un identifiant court sans tirets
 * @returns {string} Identifiant court
 */
export const generateShortId = () => {
  return generateUUID().replace(/-/g, '');
};
