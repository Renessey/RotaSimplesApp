import { config } from '../config/env';
import type { ErrorInfo } from '../types/error';
import { toErrorInfo } from '../utils/errorHandler';

/**
 * Serviço central de report de erros.
 * Em desenvolvimento, loga no console.
 * Em produção, envia para o DSN configurado (ex.: Sentry, Bugsnag).
 * Substitua o corpo do método `report` pela integração real desejada.
 */
class ErrorReportingService {
  private enabled = true;

  enable(): void {
    this.enabled = true;
  }

  disable(): void {
    this.enabled = false;
  }

  /**
   * Registra um erro no serviço de report.
   */
  report(error: unknown, context?: Record<string, unknown>): void {
    if (!this.enabled) {
      return;
    }

    const info: ErrorInfo = toErrorInfo(error);

    const payload = {
      ...info,
      metadata: {
        ...info.metadata,
        ...context,
      },
    };

    if (config.isProduction && config.errorReportingDsn) {
      this.sendToRemote(payload);
      return;
    }

    this.logToConsole(payload);
  }

  /**
   * Loga o erro no console de forma estruturada.
   */
  private logToConsole(payload: ErrorInfo): void {
    const tag = `[${payload.severity.toUpperCase()}][${payload.category}]`;

    if (__DEV__) {
      console.error(`${tag} ${payload.message}`, {
        code: payload.code,
        metadata: payload.metadata,
        stack: payload.stack,
      });
      return;
    }

    console.error(`${tag} ${payload.message}`);
  }

  /**
   * Envia o erro para um serviço remoto de monitoramento.
   * PONTO DE EXTENSÃO: integrar aqui com Sentry, Bugsnag, etc.
   */
  private async sendToRemote(payload: ErrorInfo): Promise<void> {
    try {
      await fetch(config.errorReportingDsn as string, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch (e) {
      console.error('[errorReporting] Falha ao enviar erro para o serviço remoto', e);
    }
  }
}

export const errorReporting = new ErrorReportingService();
