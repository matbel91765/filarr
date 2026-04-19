/**
 * Service de chiffrement
 *
 * Ce module encapsule la logique de chiffrement et de déchiffrement des données,
 * en fournissant une interface cohérente indépendante de l'implémentation sous-jacente.
 *
 * Note: Dans cette version, nous utilisons l'adaptateur de stockage qui délègue
 * le chiffrement au processus principal d'Electron. Dans une future version,
 * ce service pourrait implémenter le chiffrement côté client en utilisant
 * l'API Web Crypto pour une meilleure compatibilité avec une version web/mobile.
 *
 * SÉCURITÉ: Les fonctions bcrypt sont déléguées à l'API Electron côté serveur
 * pour éviter d'inclure des modules Node.js dans le bundle navigateur.
 */

import errorService from '../platform/errorService';

/**
 * Convertit un Uint8Array en base64 sans exploser la pile d'appels
 * (String.fromCharCode(...bigArray) cause un stack overflow pour les gros tableaux)
 */
function uint8ArrayToBase64(bytes: Uint8Array): string {
  const CHUNK_SIZE = 8192;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    const chunk = bytes.subarray(i, i + CHUNK_SIZE);
    binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
  }
  return btoa(binary);
}

/**
 * Type pour les données qui peuvent être chiffrées/déchiffrées
 */
export type EncryptableData = string | Buffer;

/**
 * Résultat de la dérivation de clé
 */
export interface KeyDerivationResult {
  key: string;
  salt: string;
}

/**
 * Interface pour un élément protégé par mot de passe
 */
export interface ProtectedItem {
  id: string;
  protected?: boolean;
  password?: string;
  [key: string]: any;
}

/**
 * Chiffre des données
 * @param data - Données à chiffrer
 * @param password - Mot de passe optionnel pour le chiffrement
 * @returns Données chiffrées
 */
export const encrypt = async (
  data: EncryptableData,
  password: string | null = null
): Promise<EncryptableData> => {
  if (!data) {
    throw errorService.createValidationError('Données à chiffrer requises');
  }

  try {
    // Utilisation de l'API IPC Electron pour le chiffrement
    if (typeof window !== 'undefined' && (window as any).electronAPI?.encryptData) {
      return await (window as any).electronAPI.encryptData(data, password);
    }

    // Fallback Web Crypto API pour le mode navigateur
    if (!password) {
      throw new Error('Mot de passe requis pour le chiffrement navigateur');
    }

    const encoder = new TextEncoder();
    const dataBuffer = typeof data === 'string' ? encoder.encode(data) : new Uint8Array(data as any);

    // Dériver une clé à partir du mot de passe
    const { key: keyHex, salt } = await deriveKeyFromPassword(password);
    const keyBytes = new Uint8Array(keyHex.match(/.{2}/g)!.map(b => parseInt(b, 16)));
    const cryptoKey = await window.crypto.subtle.importKey(
      'raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt']
    );

    // Générer un IV aléatoire
    const iv = window.crypto.getRandomValues(new Uint8Array(12));

    // Chiffrer les données
    const encrypted = await window.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv }, cryptoKey, dataBuffer
    );

    // Format: webcrypto:salt:iv(hex):ciphertext(base64)
    const ivHex = Array.from(iv).map(b => b.toString(16).padStart(2, '0')).join('');
    const encryptedBase64 = uint8ArrayToBase64(new Uint8Array(encrypted));
    return `webcrypto:${salt}:${ivHex}:${encryptedBase64}`;
  } catch (error) {
    throw errorService.createEncryptionError('Impossible de chiffrer les données', error as Error);
  }
};

/**
 * Déchiffre des données
 * @param encryptedData - Données chiffrées
 * @param password - Mot de passe optionnel pour le déchiffrement
 * @returns Données déchiffrées
 */
export const decrypt = async (
  encryptedData: EncryptableData,
  password: string | null = null
): Promise<EncryptableData> => {
  if (!encryptedData) {
    throw errorService.createValidationError('Données chiffrées requises');
  }

  try {
    // Utilisation de l'API IPC Electron pour le déchiffrement
    if (typeof window !== 'undefined' && (window as any).electronAPI?.decryptData) {
      return await (window as any).electronAPI.decryptData(encryptedData, password);
    }

    // Fallback Web Crypto API pour le mode navigateur
    if (!password) {
      throw new Error('Mot de passe requis pour le déchiffrement navigateur');
    }

    const dataStr = typeof encryptedData === 'string'
      ? encryptedData
      : new TextDecoder().decode(encryptedData as any);
    const parts = dataStr.split(':');
    if (parts[0] !== 'webcrypto' || parts.length !== 4) {
      throw new Error('Format de données chiffrées invalide');
    }

    const [, salt, ivHex, ciphertextBase64] = parts;

    // Dériver la même clé
    const { key: keyHex } = await deriveKeyFromPassword(password, salt);
    const keyBytes = new Uint8Array(keyHex.match(/.{2}/g)!.map(b => parseInt(b, 16)));
    const cryptoKey = await window.crypto.subtle.importKey(
      'raw', keyBytes, { name: 'AES-GCM' }, false, ['decrypt']
    );

    // Reconstituer IV et ciphertext
    const iv = new Uint8Array(ivHex.match(/.{2}/g)!.map(b => parseInt(b, 16)));
    const ciphertext = Uint8Array.from(atob(ciphertextBase64), c => c.charCodeAt(0));

    // Déchiffrer
    const decrypted = await window.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv }, cryptoKey, ciphertext
    );

    return new TextDecoder().decode(decrypted);
  } catch (error) {
    throw errorService.createEncryptionError('Impossible de déchiffrer les données', error as Error);
  }
};

/**
 * Chiffre des données binaires
 * @param data - Données binaires à chiffrer
 * @param password - Mot de passe optionnel pour le chiffrement
 * @returns Données chiffrées
 */
export const encryptBinary = async (
  data: Buffer,
  password: string | null = null
): Promise<Buffer> => {
  if (!data) {
    throw errorService.createValidationError('Données binaires à chiffrer requises');
  }

  try {
    // Utilisation de l'API IPC Electron pour le chiffrement binaire
    if (typeof window !== 'undefined' && (window as any).electronAPI?.encryptBinary) {
      return await (window as any).electronAPI.encryptBinary(data, password);
    }

    // Fallback Web Crypto API - chiffrer via encrypt() puis encoder en string
    if (!password) {
      throw new Error('Mot de passe requis pour le chiffrement binaire navigateur');
    }

    const dataArray = new Uint8Array(data as any);
    const { key: keyHex, salt } = await deriveKeyFromPassword(password);
    const keyBytes = new Uint8Array(keyHex.match(/.{2}/g)!.map(b => parseInt(b, 16)));
    const cryptoKey = await window.crypto.subtle.importKey(
      'raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt']
    );
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await window.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv }, cryptoKey, dataArray
    );
    const ivHex = Array.from(iv).map(b => b.toString(16).padStart(2, '0')).join('');
    const encryptedBase64 = uint8ArrayToBase64(new Uint8Array(encrypted));
    const result = `webcrypto:${salt}:${ivHex}:${encryptedBase64}`;
    const encoder = new TextEncoder();
    return encoder.encode(result) as any;
  } catch (error) {
    throw errorService.createEncryptionError('Impossible de chiffrer les données binaires', error as Error);
  }
};

/**
 * Déchiffre des données binaires
 * @param encryptedData - Données binaires chiffrées
 * @param password - Mot de passe optionnel pour le déchiffrement
 * @returns Données déchiffrées
 */
export const decryptBinary = async (
  encryptedData: Buffer,
  password: string | null = null
): Promise<Buffer> => {
  if (!encryptedData) {
    throw errorService.createValidationError('Données binaires chiffrées requises');
  }

  try {
    // Utilisation de l'API IPC Electron pour le déchiffrement binaire
    if (typeof window !== 'undefined' && (window as any).electronAPI?.decryptBinary) {
      return await (window as any).electronAPI.decryptBinary(encryptedData, password);
    }

    // Fallback Web Crypto API
    if (!password) {
      throw new Error('Mot de passe requis pour le déchiffrement binaire navigateur');
    }

    const dataStr = new TextDecoder().decode(encryptedData as any);
    const parts = dataStr.split(':');
    if (parts[0] !== 'webcrypto' || parts.length !== 4) {
      throw new Error('Format de données binaires chiffrées invalide');
    }
    const [, salt, ivHex, ciphertextBase64] = parts;
    const { key: keyHex } = await deriveKeyFromPassword(password, salt);
    const keyBytes = new Uint8Array(keyHex.match(/.{2}/g)!.map(b => parseInt(b, 16)));
    const cryptoKey = await window.crypto.subtle.importKey(
      'raw', keyBytes, { name: 'AES-GCM' }, false, ['decrypt']
    );
    const iv = new Uint8Array(ivHex.match(/.{2}/g)!.map(b => parseInt(b, 16)));
    const ciphertext = Uint8Array.from(atob(ciphertextBase64), c => c.charCodeAt(0));
    const decrypted = await window.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv }, cryptoKey, ciphertext
    );
    return new Uint8Array(decrypted) as any;
  } catch (error) {
    throw errorService.createEncryptionError('Impossible de déchiffrer les données binaires', error as Error);
  }
};

/**
 * Génère une clé de chiffrement aléatoire
 * @param length - Longueur de la clé en octets
 * @returns Clé de chiffrement en format hexadécimal
 */
export const generateEncryptionKey = async (length: number = 32): Promise<string> => {
  try {
    // Utiliser l'API Web Crypto pour générer une clé aléatoire
    const array = new Uint8Array(length);
    window.crypto.getRandomValues(array);

    // Convertir en chaîne hexadécimale
    return Array.from(array)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  } catch (error) {
    console.error('Erreur lors de la génération de la clé de chiffrement:', error);
    throw new Error('Impossible de générer la clé de chiffrement', { cause: error });
  }
};

/**
 * Dérive une clé de chiffrement à partir d'un mot de passe
 * @param password - Mot de passe
 * @param salt - Sel pour la dérivation (généré aléatoirement si non fourni)
 * @returns Objet contenant la clé dérivée et le sel utilisé
 */
export const deriveKeyFromPassword = async (
  password: string,
  salt: string | null = null
): Promise<KeyDerivationResult> => {
  try {
    // Générer un sel aléatoire si non fourni
    let finalSalt = salt;
    if (!finalSalt) {
      const saltArray = new Uint8Array(16);
      window.crypto.getRandomValues(saltArray);
      finalSalt = Array.from(saltArray)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
    }

    // Convertir le mot de passe et le sel en ArrayBuffer
    const encoder = new TextEncoder();
    const passwordBuffer = encoder.encode(password);
    const saltBuffer = encoder.encode(finalSalt);

    // Importer la clé
    const keyMaterial = await window.crypto.subtle.importKey(
      'raw',
      passwordBuffer,
      { name: 'PBKDF2' },
      false,
      ['deriveBits', 'deriveKey']
    );

    // Dériver la clé avec 600k iterations (OWASP recommendation)
    const derivedKey = await window.crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: saltBuffer,
        iterations: 600000, // SÉCURITÉ: 600k iterations comme recommandé par OWASP
        hash: 'SHA-256'
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt']
    );

    // Exporter la clé en format brut
    const rawKey = await window.crypto.subtle.exportKey('raw', derivedKey);

    // Convertir en chaîne hexadécimale
    const keyHex = Array.from(new Uint8Array(rawKey))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    return { key: keyHex, salt: finalSalt };
  } catch (error) {
    console.error('Erreur lors de la dérivation de la clé:', error);
    throw new Error('Impossible de dériver la clé à partir du mot de passe', { cause: error });
  }
};

/**
 * Vérifie si un mot de passe est correct pour un élément protégé
 * @param password - Mot de passe à vérifier
 * @param item - Élément protégé
 * @returns Vrai si le mot de passe est correct
 */
export const verifyPassword = async (
  password: string,
  item: ProtectedItem
): Promise<boolean> => {
  if (!item) {
    throw errorService.createValidationError('Élément requis');
  }

  if (!item.protected) {
    return true; // L'élément n'est pas protégé
  }

  if (!password) {
    throw errorService.createValidationError('Mot de passe requis');
  }

  if (!item.password) {
    throw errorService.createValidationError('Mot de passe haché manquant dans l\'élément protégé');
  }

  try {
    // SÉCURITÉ: Utilise l'API Electron pour la vérification côté serveur avec bcrypt
    if (typeof window !== 'undefined' && (window as any).electronAPI?.verifyPassword) {
      return await (window as any).electronAPI.verifyPassword(password, item.password);
    }

    // Fallback navigateur: utiliser comparePasswordBcrypt avec PBKDF2
    return await comparePasswordBcrypt(password, item.password);
  } catch (error) {
    throw errorService.createEncryptionError('Erreur lors de la vérification du mot de passe', error as Error);
  }
};

/**
 * Hache un mot de passe avec PBKDF2 (fallback sécurisé compatible navigateur)
 * Utilise 600,000 itérations comme recommandé par OWASP 2024
 * @param password - Mot de passe à hacher
 * @param saltRounds - Nombre de tours (utilisé pour compatibilité, ignoré pour PBKDF2)
 * @returns Hash du mot de passe au format "pbkdf2:iterations:salt:hash"
 */
export const hashPasswordBcrypt = async (
  password: string,
  saltRounds: number = 12
): Promise<string> => {
  if (!password) {
    throw errorService.createValidationError('Mot de passe requis');
  }

  try {
    // Utiliser Web Crypto API avec PBKDF2 (compatible navigateur)
    const crypto = window.crypto || (globalThis as any).crypto;
    if (!crypto || !crypto.subtle) {
      throw new Error('Web Crypto API non disponible');
    }

    // Générer un sel aléatoire de 32 bytes
    const salt = crypto.getRandomValues(new Uint8Array(32));
    const iterations = 600000; // OWASP 2024 recommandation

    // Encoder le mot de passe
    const encoder = new TextEncoder();
    const passwordData = encoder.encode(password);

    // Importer la clé
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      passwordData,
      'PBKDF2',
      false,
      ['deriveBits']
    );

    // Dériver les bits
    const derivedBits = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: salt,
        iterations: iterations,
        hash: 'SHA-256',
      },
      keyMaterial,
      256
    );

    // Convertir en hex
    const hashArray = Array.from(new Uint8Array(derivedBits));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    const saltHex = Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join('');

    // Format: pbkdf2:iterations:salt:hash
    return `pbkdf2:${iterations}:${saltHex}:${hashHex}`;
  } catch (error) {
    throw errorService.createEncryptionError('Erreur lors du hachage du mot de passe', error as Error);
  }
};

/**
 * Compare un mot de passe avec un hash PBKDF2
 * @param password - Mot de passe en clair
 * @param hash - Hash au format "pbkdf2:iterations:salt:hash"
 * @returns Vrai si le mot de passe correspond au hash
 */
export const comparePasswordBcrypt = async (
  password: string,
  hash: string
): Promise<boolean> => {
  if (!password || !hash) {
    throw errorService.createValidationError('Mot de passe et hash requis');
  }

  try {
    // Parser le format du hash
    const parts = hash.split(':');
    if (parts.length !== 4 || parts[0] !== 'pbkdf2') {
      throw new Error('Format de hash invalide');
    }

    const iterations = parseInt(parts[1], 10);
    const saltHex = parts[2];
    const expectedHashHex = parts[3];

    // Convertir le sel de hex en Uint8Array
    const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map(byte => parseInt(byte, 16)));

    // Utiliser Web Crypto API
    const crypto = window.crypto || (globalThis as any).crypto;
    if (!crypto || !crypto.subtle) {
      throw new Error('Web Crypto API non disponible');
    }

    // Encoder le mot de passe
    const encoder = new TextEncoder();
    const passwordData = encoder.encode(password);

    // Importer la clé
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      passwordData,
      'PBKDF2',
      false,
      ['deriveBits']
    );

    // Dériver les bits avec les mêmes paramètres
    const derivedBits = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: salt,
        iterations: iterations,
        hash: 'SHA-256',
      },
      keyMaterial,
      256
    );

    // Convertir en hex et comparer
    const hashArray = Array.from(new Uint8Array(derivedBits));
    const computedHashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    // Comparaison en temps constant pour éviter les timing attacks
    if (computedHashHex.length !== expectedHashHex.length) {
      return false;
    }

    let result = 0;
    for (let i = 0; i < computedHashHex.length; i++) {
      result |= computedHashHex.charCodeAt(i) ^ expectedHashHex.charCodeAt(i);
    }

    return result === 0;
  } catch (error) {
    throw errorService.createEncryptionError('Erreur lors de la comparaison du mot de passe', error as Error);
  }
};

/**
 * Génère un sel aléatoire pour le hachage de mot de passe
 * @param length - Longueur du sel en octets
 * @returns Sel en format hexadécimal
 */
export const generateSalt = (length: number = 16): string => {
  try {
    // Utiliser la source de randomisation du navigateur
    const crypto = typeof window !== 'undefined' ? window.crypto :
                   typeof global !== 'undefined' && (global as any).crypto ? (global as any).crypto : null;

    if (!crypto) {
      throw new Error('Aucune API crypto disponible dans cet environnement');
    }

    const array = new Uint8Array(length);

    if (crypto.getRandomValues) {
      crypto.getRandomValues(array);
    } else {
      throw new Error('crypto.getRandomValues is required but not available — cannot generate secure random bytes');
    }

    // Convertir en chaîne hexadécimale
    return Array.from(array)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  } catch (error) {
    throw errorService.createEncryptionError('Impossible de générer un sel aléatoire', error as Error);
  }
};

/**
 * Hache un mot de passe avec un sel
 * @param password - Mot de passe à hacher
 * @param salt - Sel pour le hachage (généré aléatoirement si non fourni)
 * @returns Hachage du mot de passe
 */
export const hashPassword = async (
  password: string,
  salt: string | null = null
): Promise<string> => {
  if (!password) {
    throw errorService.createValidationError('Mot de passe requis');
  }

  try {
    // Générer un sel aléatoire si non fourni
    const finalSalt = salt || generateSalt();

    // En environnement de test ou sans window.crypto, utiliser une implémentation simplifiée
    if (typeof window === 'undefined' || !window.crypto || !window.crypto.subtle) {
      // Implémentation simple pour les tests (non sécurisée pour la production)
      const hashInput = password + finalSalt;
      let hash = 0;
      for (let i = 0; i < hashInput.length; i++) {
        const char = hashInput.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Conversion en 32 bits
      }
      // Convertir en chaîne hexadécimale
      return (hash >>> 0).toString(16).padStart(64, '0');
    }

    // Utiliser l'API Web Crypto pour dériver une clé à partir du mot de passe
    const encoder = new TextEncoder();
    const passwordBuffer = encoder.encode(password);
    const saltBuffer = encoder.encode(finalSalt);

    // Importer la clé
    const keyMaterial = await window.crypto.subtle.importKey(
      'raw',
      passwordBuffer,
      { name: 'PBKDF2' },
      false,
      ['deriveBits']
    );

    // Dériver des bits avec 600k iterations (OWASP recommendation)
    const derivedBits = await window.crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: saltBuffer,
        iterations: 600000, // SÉCURITÉ: 600k iterations comme recommandé par OWASP
        hash: 'SHA-256'
      },
      keyMaterial,
      256
    );

    // Convertir en chaîne hexadécimale
    const hash = Array.from(new Uint8Array(derivedBits))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    return hash;
  } catch (error) {
    throw errorService.createEncryptionError('Erreur lors du hachage du mot de passe', error as Error);
  }
};

/**
 * Compare un mot de passe avec un hachage
 * @param password - Mot de passe à comparer
 * @param hash - Hachage à comparer
 * @param salt - Sel utilisé pour le hachage
 * @returns Vrai si le mot de passe correspond au hachage
 */
export const comparePasswords = async (
  password: string,
  hash: string,
  salt: string
): Promise<boolean> => {
  if (!password || !hash) {
    throw errorService.createValidationError('Mot de passe et hachage requis');
  }

  if (!salt) {
    throw errorService.createValidationError('Sel requis');
  }

  try {
    // Hacher le mot de passe avec le sel fourni
    const passwordHash = await hashPassword(password, salt);

    // Comparer les hachages
    return passwordHash === hash;
  } catch (error) {
    if ((error as any).name === 'AppError') {
      throw error; // Renvoyer l'erreur de validation si c'en est une
    }
    throw errorService.createEncryptionError('Erreur lors de la comparaison des mots de passe', error as Error);
  }
};

// ==================== ARGON2 FUNCTIONS (via Electron IPC) ====================

/**
 * Hash un mot de passe avec Argon2id via le processus principal Electron.
 * Format retourne: $argon2id$v=19$m=65536,t=3,p=4$salt$hash
 */
export const hashPasswordArgon2 = async (password: string): Promise<string> => {
  if (typeof window !== 'undefined' && window.electron?.ipcRenderer) {
    return await window.electron.ipcRenderer.invoke('crypto:argon2Hash', password);
  }
  throw new Error('Argon2 necessite le processus principal Electron');
};

/**
 * Verifie un mot de passe contre un hash Argon2id via Electron IPC.
 */
export const comparePasswordArgon2 = async (password: string, hash: string): Promise<boolean> => {
  if (typeof window !== 'undefined' && window.electron?.ipcRenderer) {
    return await window.electron.ipcRenderer.invoke('crypto:argon2Verify', hash, password);
  }
  throw new Error('Argon2 necessite le processus principal Electron');
};

/**
 * Derive une cle 256-bit avec Argon2id via Electron IPC.
 * Retourne le meme format que deriveKeyFromPassword: { key: hex, salt: hex }
 */
export const deriveKeyArgon2 = async (
  password: string,
  salt: string
): Promise<KeyDerivationResult> => {
  if (typeof window !== 'undefined' && window.electron?.ipcRenderer) {
    const key = await window.electron.ipcRenderer.invoke('crypto:argon2DeriveKey', password, salt);
    return { key, salt };
  }
  throw new Error('Argon2 necessite le processus principal Electron');
};

/**
 * Detecte le type de KDF utilise a partir du format du hash.
 * - $argon2id$ -> argon2id
 * - pbkdf2: -> pbkdf2
 */
export const detectKdfType = (hash: string): 'argon2id' | 'pbkdf2' => {
  if (hash.startsWith('$argon2id$') || hash.startsWith('$argon2i$') || hash.startsWith('$argon2d$')) {
    return 'argon2id';
  }
  return 'pbkdf2';
};

/**
 * Verifie si Argon2 est disponible (necessite Electron IPC).
 */
export const isArgon2Available = (): boolean => {
  return typeof window !== 'undefined' && !!window.electron?.ipcRenderer;
};
