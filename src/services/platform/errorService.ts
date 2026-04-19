/**
 * Service de gestion des erreurs
 *
 * Ce module encapsule la logique de gestion des erreurs de l'application,
 * en fournissant une interface cohérente pour enregistrer, formater et
 * traiter les erreurs de manière standardisée.
 */

// Types d'erreurs
export enum ErrorTypes {
  // Erreurs fonctionnelles (peuvent être affichées à l'utilisateur)
  VALIDATION = 'VALIDATION',
  AUTHENTICATION = 'AUTHENTICATION',
  PERMISSION = 'PERMISSION',
  NOT_FOUND = 'NOT_FOUND',

  // Erreurs techniques (à logger, mais pas forcément à montrer telles quelles à l'utilisateur)
  NETWORK = 'NETWORK',
  STORAGE = 'STORAGE',
  ENCRYPTION = 'ENCRYPTION',
  FILE_SYSTEM = 'FILE_SYSTEM',

  // Erreur générique
  UNKNOWN = 'UNKNOWN'
}

// Niveaux de gravité
export enum ErrorSeverity {
  INFO = 'INFO',         // Information simple
  WARNING = 'WARNING',   // Avertissement
  ERROR = 'ERROR',       // Erreur qui peut être gérée
  CRITICAL = 'CRITICAL'  // Erreur critique qui requiert l'attention de l'utilisateur
}

/**
 * Type pour les métadonnées d'erreur
 */
export type ErrorMetadata = Record<string, any>;

/**
 * Type pour la représentation objet d'une erreur
 */
export interface ErrorObject {
  name: string;
  message: string;
  type: ErrorTypes;
  severity: ErrorSeverity;
  timestamp: string;
  metadata: ErrorMetadata;
  stack?: string;
  originalError?: {
    name: string;
    message: string;
    stack?: string;
  };
}

/**
 * Type pour les messages de secours par type d'erreur
 */
export type FallbackMessages = Partial<Record<ErrorTypes, string>>;

/**
 * Type pour une fonction d'affichage de message à l'utilisateur
 */
export type ShowToUserFunction = (message: string, severity: ErrorSeverity) => void;

/**
 * Classe d'erreur personnalisée pour l'application
 */
export class AppError extends Error {
  name: string = 'AppError';
  type: ErrorTypes;
  severity: ErrorSeverity;
  originalError: Error | null;
  metadata: ErrorMetadata;
  timestamp: Date;

  /**
   * Constructeur
   * @param message - Message d'erreur
   * @param type - Type d'erreur (voir ErrorTypes)
   * @param severity - Niveau de gravité (voir ErrorSeverity)
   * @param originalError - Erreur d'origine (si cette erreur en enveloppe une autre)
   * @param metadata - Données supplémentaires sur le contexte de l'erreur
   */
  constructor(
    message: string,
    type: ErrorTypes = ErrorTypes.UNKNOWN,
    severity: ErrorSeverity = ErrorSeverity.ERROR,
    originalError: Error | null = null,
    metadata: ErrorMetadata = {}
  ) {
    super(message);
    this.name = 'AppError';
    this.type = type;
    this.severity = severity;
    this.originalError = originalError;
    this.metadata = metadata;
    this.timestamp = new Date();

    // Capture de la stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AppError);
    }
  }

  /**
   * Obtient le message d'erreur complet, y compris les détails de l'erreur d'origine
   * @returns Message d'erreur complet
   */
  getFullMessage(): string {
    if (this.originalError) {
      return `${this.message} | Cause originale: ${this.originalError.message}`;
    }
    return this.message;
  }

  /**
   * Convertit l'erreur en objet pour l'affichage ou le logging
   * @param includeStack - Indique si la stack trace doit être incluse
   * @returns Représentation de l'erreur sous forme d'objet
   */
  toObject(includeStack: boolean = false): ErrorObject {
    const result: ErrorObject = {
      name: this.name,
      message: this.message,
      type: this.type,
      severity: this.severity,
      timestamp: this.timestamp.toISOString(),
      metadata: this.metadata
    };

    if (includeStack) {
      result.stack = this.stack;
    }

    if (this.originalError) {
      result.originalError = {
        name: this.originalError.name,
        message: this.originalError.message
      };

      if (includeStack && this.originalError.stack) {
        result.originalError.stack = this.originalError.stack;
      }
    }

    return result;
  }

  /**
   * Convertit l'erreur en JSON
   * @returns Représentation JSON de l'erreur
   */
  toJSON(): string {
    return JSON.stringify(this.toObject());
  }
}

/**
 * Crée une erreur de validation
 * @param message - Message d'erreur
 * @param metadata - Métadonnées sur les champs en erreur
 * @returns Erreur de validation
 */
export const createValidationError = (message: string, metadata: ErrorMetadata = {}): AppError => {
  return new AppError(
    message,
    ErrorTypes.VALIDATION,
    ErrorSeverity.WARNING,
    null,
    metadata
  );
};

/**
 * Crée une erreur d'authentification
 * @param message - Message d'erreur
 * @param originalError - Erreur d'origine
 * @returns Erreur d'authentification
 */
export const createAuthenticationError = (message: string, originalError: Error | null = null): AppError => {
  return new AppError(
    message,
    ErrorTypes.AUTHENTICATION,
    ErrorSeverity.ERROR,
    originalError
  );
};

/**
 * Crée une erreur de stockage
 * @param message - Message d'erreur
 * @param originalError - Erreur d'origine
 * @param metadata - Métadonnées supplémentaires
 * @returns Erreur de stockage
 */
export const createStorageError = (message: string, originalError: Error | null = null, metadata: ErrorMetadata = {}): AppError => {
  return new AppError(
    message,
    ErrorTypes.STORAGE,
    ErrorSeverity.ERROR,
    originalError,
    metadata
  );
};

/**
 * Crée une erreur de chiffrement
 * @param message - Message d'erreur
 * @param originalError - Erreur d'origine
 * @returns Erreur de chiffrement
 */
export const createEncryptionError = (message: string, originalError: Error | null = null): AppError => {
  return new AppError(
    message,
    ErrorTypes.ENCRYPTION,
    ErrorSeverity.ERROR,
    originalError
  );
};

/**
 * Crée une erreur de système de fichiers
 * @param message - Message d'erreur
 * @param originalError - Erreur d'origine
 * @param metadata - Métadonnées supplémentaires
 * @returns Erreur de système de fichiers
 */
export const createFileSystemError = (message: string, originalError: Error | null = null, metadata: ErrorMetadata = {}): AppError => {
  return new AppError(
    message,
    ErrorTypes.FILE_SYSTEM,
    ErrorSeverity.ERROR,
    originalError,
    metadata
  );
};

/**
 * Crée une erreur indiquant qu'une ressource n'a pas été trouvée
 * @param message - Message d'erreur
 * @param metadata - Métadonnées sur la ressource
 * @returns Erreur "not found"
 */
export const createNotFoundError = (message: string, metadata: ErrorMetadata = {}): AppError => {
  return new AppError(
    message,
    ErrorTypes.NOT_FOUND,
    ErrorSeverity.WARNING,
    null,
    metadata
  );
};

/**
 * Crée une erreur à partir d'une erreur générique
 * @param error - Erreur d'origine
 * @param customMessage - Message personnalisé
 * @param type - Type d'erreur
 * @param metadata - Métadonnées supplémentaires
 * @returns Erreur enrichie
 */
export const createFromError = (
  error: unknown,
  customMessage: string | null = null,
  type: ErrorTypes = ErrorTypes.UNKNOWN,
  metadata: ErrorMetadata = {}
): AppError => {
  // Si c'est déjà une AppError, la retourner telle quelle
  if (error instanceof AppError) {
    return error;
  }

  // Si c'est une Error standard
  if (error instanceof Error) {
    return new AppError(
      customMessage || error.message,
      type,
      ErrorSeverity.ERROR,
      error,
      metadata
    );
  }

  // Si c'est un autre type (string, object, etc.)
  const errorMessage = customMessage || String(error);
  return new AppError(
    errorMessage,
    type,
    ErrorSeverity.ERROR,
    null,
    metadata
  );
};

/**
 * Enregistre une erreur dans la console avec un format standardisé
 * @param error - Erreur à enregistrer
 * @param context - Contexte où l'erreur s'est produite
 */
export const logError = (error: AppError | Error, context: string = ''): void => {
  // Préparation du message de log
  const timestamp = new Date().toISOString();
  const contextInfo = context ? `[${context}] ` : '';
  let logMessage = `${timestamp} ${contextInfo}`;

  // Si c'est une AppError, utilisez ses méthodes spécifiques
  if (error instanceof AppError) {
    const errorDetails = error.toObject(true);

    // Choisir le niveau de log approprié selon la gravité
    let logFunction: (...args: any[]) => void = console.error;
    switch (errorDetails.severity) {
      case ErrorSeverity.INFO:
        logFunction = console.info;
        break;
      case ErrorSeverity.WARNING:
        logFunction = console.warn;
        break;
      case ErrorSeverity.ERROR:
      case ErrorSeverity.CRITICAL:
        logFunction = console.error;
        break;
    }

    logFunction(`${logMessage}Erreur [${errorDetails.type}] [${errorDetails.severity}]: ${error.getFullMessage()}`);

    // Log des métadonnées si présentes
    if (Object.keys(errorDetails.metadata).length > 0) {
      logFunction('Métadonnées:', errorDetails.metadata);
    }

    // Log de la stack trace
    if (errorDetails.stack) {
      logFunction('Stack trace:', errorDetails.stack);
    }
  } else {
    // Log standard pour les erreurs non-AppError
    console.error(`${logMessage}Erreur: ${error.message}`);
    if (error.stack) {
      console.error('Stack trace:', error.stack);
    }
  }
};

/**
 * Obtenir un message d'erreur convivial pour l'utilisateur
 * @param error - Erreur
 * @param fallbackMessages - Messages par défaut par type d'erreur
 * @returns Message d'erreur convivial
 */
export const getUserFriendlyMessage = (error: AppError | Error, fallbackMessages: FallbackMessages = {}): string => {
  // Messages par défaut
  const defaultMessages: Record<ErrorTypes, string> = {
    [ErrorTypes.VALIDATION]: 'Les informations saisies sont incorrectes.',
    [ErrorTypes.AUTHENTICATION]: 'Erreur d\'authentification. Veuillez vous reconnecter.',
    [ErrorTypes.PERMISSION]: 'Vous n\'avez pas les droits nécessaires pour effectuer cette action.',
    [ErrorTypes.NOT_FOUND]: 'La ressource demandée n\'a pas été trouvée.',
    [ErrorTypes.NETWORK]: 'Problème de connexion réseau. Veuillez vérifier votre connexion Internet.',
    [ErrorTypes.STORAGE]: 'Erreur lors de l\'accès au stockage.',
    [ErrorTypes.ENCRYPTION]: 'Erreur de chiffrement ou de déchiffrement.',
    [ErrorTypes.FILE_SYSTEM]: 'Erreur lors de l\'accès aux fichiers.',
    [ErrorTypes.UNKNOWN]: 'Une erreur inattendue s\'est produite.'
  };

  // Fusionner les messages par défaut avec les messages personnalisés
  const messages = { ...defaultMessages, ...fallbackMessages };

  // Si c'est une AppError, utilisez son type pour déterminer le message
  if (error instanceof AppError) {
    // Pour les erreurs de validation, utiliser le message d'origine car il est généralement destiné à l'utilisateur
    // SAUF si un message de fallback personnalisé a été fourni
    if (error.type === ErrorTypes.VALIDATION && !fallbackMessages[ErrorTypes.VALIDATION]) {
      return error.message;
    }

    return messages[error.type] || messages[ErrorTypes.UNKNOWN];
  }

  // Pour les erreurs standard, retourner le message générique
  return messages[ErrorTypes.UNKNOWN];
};

/**
 * Gère une erreur de manière globale et standardisée
 * @param error - Erreur à gérer
 * @param context - Contexte où l'erreur s'est produite
 * @param showToUser - Fonction pour afficher un message à l'utilisateur
 * @returns Erreur enrichie et standardisée
 */
export const handleError = (
  error: Error,
  context: string = '',
  showToUser: ShowToUserFunction | null = null
): AppError => {
  // Convertir en AppError si ce n'est pas déjà le cas
  const appError = error instanceof AppError
    ? error
    : createFromError(error);

  // Enregistrer l'erreur
  logError(appError, context);

  // Afficher un message à l'utilisateur si nécessaire et si une fonction d'affichage est fournie
  if (showToUser && typeof showToUser === 'function') {
    const userMessage = getUserFriendlyMessage(appError);
    showToUser(userMessage, appError.severity);
  }

  return appError;
};

// Fonction par défaut pour afficher une alerte
export const showAlert = (message: string, _severity: ErrorSeverity = ErrorSeverity.ERROR): void => {
  alert(message);
};

/**
 * Détermine si une erreur est de type opérationnel (erreur attendue/gérée)
 * vs. technique (erreur système)
 * @param error - Erreur à vérifier
 * @returns Vrai si l'erreur est opérationnelle
 */
export const isOperationalError = (error: AppError | Error): boolean => {
  if (!(error instanceof AppError)) {
    return false;
  }

  const operationalTypes = [
    ErrorTypes.VALIDATION,
    ErrorTypes.AUTHENTICATION,
    ErrorTypes.PERMISSION,
    ErrorTypes.NOT_FOUND
  ];

  return operationalTypes.includes(error.type);
};

export default {
  ErrorTypes,
  ErrorSeverity,
  AppError,
  createValidationError,
  createAuthenticationError,
  createStorageError,
  createEncryptionError,
  createFileSystemError,
  createNotFoundError,
  createFromError,
  logError,
  getUserFriendlyMessage,
  handleError,
  showAlert,
  isOperationalError
};
