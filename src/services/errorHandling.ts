/**
 * Barrel do sistema centralizado de tratamento de erros.
 * Re-exporta tipos, utilitários e o serviço de reporting.
 */
export * from '../types/error';
export * from '../utils/errorHandler';
export { errorReporting } from './errorReporting';
export { default as ErrorBoundary } from '../components/ErrorBoundary';
