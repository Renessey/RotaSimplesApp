/**
 * Tipos centrais para o sistema de tratamento de erros da aplicação.
 */

export type ErrorCategory =
  | 'network'
  | 'api'
  | 'validation'
  | 'database'
  | 'geocoding'
  | 'maps'
  | 'import'
  | 'storage'
  | 'unknown';

export type ErrorSeverity = 'info' | 'warning' | 'error' | 'critical';

export interface AppError extends Error {
  /** Categorização do erro para agrupamento e tratamento específico */
  category: ErrorCategory;
  /** Severidade do erro */
  severity: ErrorSeverity;
  /** Código de erro estável (ex.: NETWORK_TIMEOUT) */
  code?: string;
  /** Dados adicionais úteis para diagnóstico */
  metadata?: Record<string, unknown>;
  /** Causa raiz, quando encadeada */
  cause?: Error;
  /** Mensagem amigável para exibição ao usuário */
  userMessage?: string;
}

export interface ErrorInfo {
  message: string;
  category: ErrorCategory;
  severity: ErrorSeverity;
  code?: string;
  metadata?: Record<string, unknown>;
  stack?: string;
  occurredAt: Date;
}

export const knownErrorCodes = [
  'NETWORK_UNAVAILABLE',
  'NETWORK_TIMEOUT',
  'API_UNAUTHORIZED',
  'API_FORBIDDEN',
  'API_NOT_FOUND',
  'API_SERVER_ERROR',
  'API_UNKNOWN',
  'VALIDATION_REQUIRED',
  'VALIDATION_INVALID',
  'DATABASE_ERROR',
  'GEOCODING_FAILED',
  'MAPS_FAILED',
  'IMPORT_PARSE_ERROR',
  'STORAGE_ERROR',
  'UNKNOWN_ERROR',
] as const;

export type KnownErrorCode = (typeof knownErrorCodes)[number];
