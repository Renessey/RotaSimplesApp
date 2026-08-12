import type { AppError, ErrorCategory, ErrorInfo, ErrorSeverity } from '../types/error';

/**
 * Utilitários centrais para criar, normalizar e inspecionar erros da aplicação.
 */

const DEFAULT_CATEGORY: ErrorCategory = 'unknown';
const DEFAULT_SEVERITY: ErrorSeverity = 'error';

/**
 * Cria um AppError tipado com categoria, severidade e metadados opcionais.
 */
export function createAppError(
  message: string,
  options: {
    category?: ErrorCategory;
    severity?: ErrorSeverity;
    code?: string;
    metadata?: Record<string, unknown>;
    cause?: Error;
    userMessage?: string;
  } = {},
): AppError {
  const { category, severity, code, metadata, cause, userMessage } = options;

  const error = new Error(message) as AppError;
  error.name = 'AppError';
  if (cause) {
    error.cause = cause;
  }
  error.category = category ?? DEFAULT_CATEGORY;
  error.severity = severity ?? DEFAULT_SEVERITY;
  error.code = code;
  error.metadata = metadata;
  error.userMessage = userMessage;

  return error;
}

/**
 * Normaliza qualquer valor desconhecido (throw, rejection, etc.) em um AppError.
 * Usado como ponto único de entrada para captura de erros.
 */
export function toAppError(
  unknown: unknown,
  fallbackMessage = 'Ocorreu um erro inesperado.',
): AppError {
  if (unknown instanceof Error && 'category' in unknown) {
    return unknown as AppError;
  }

  if (unknown instanceof Error) {
    return createAppError(unknown.message || fallbackMessage, {
      category: DEFAULT_CATEGORY,
      cause: unknown,
    });
  }

  if (typeof unknown === 'string') {
    return createAppError(unknown || fallbackMessage, {
      category: DEFAULT_CATEGORY,
    });
  }

  return createAppError(fallbackMessage, {
    category: DEFAULT_CATEGORY,
    metadata: { raw: unknown },
  });
}

/**
 * Extrai uma mensagem amigável para exibição ao usuário.
 * Prefere userMessage, senão a mensagem do erro, senão um fallback genérico.
 */
export function getUserMessage(error: unknown, fallback = 'Algo deu errado.'): string {
  const appError = toAppError(error);
  return appError.userMessage || appError.message || fallback;
}

/**
 * Converte um AppError em um objeto serializável (útil para logs e reporting).
 */
export function toErrorInfo(error: unknown): ErrorInfo {
  const appError = toAppError(error);

  return {
    message: appError.message,
    category: appError.category,
    severity: appError.severity,
    code: appError.code,
    metadata: appError.metadata,
    stack: appError.stack,
    occurredAt: new Date(),
  };
}

/**
 * Verifica se um erro pertence a um código específico.
 */
export function isError(error: unknown, code: string): boolean {
  const appError = toAppError(error);
  return appError.code === code;
}
