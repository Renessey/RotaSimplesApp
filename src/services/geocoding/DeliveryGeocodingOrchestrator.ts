/**
 * DeliveryGeocodingOrchestrator (TASKS 6.7, 6.8, 6.15, 6.16, 6.18, 6.20).
 *
 * Orquestra o fluxo completo de geocodificação de entregas:
 *
 *   - Pega a lista de entregas a geocodificar (PENDING / FAILED).
 *   - Coloca em uma GeocodingQueue (concorrência=1, yield entre itens).
 *   - Cada item é processado pelo GeocodingService (normalização + cache).
 *   - O resultado é persistido imediatamente na tabela `entregas`
 *     (TASK 6.8 e 6.20: coords persistidas ANTES de chegar na UI).
 *   - Falhas e ambiguidades são registradas com nota (TASK 6.15, 6.16).
 *   - Expõe método específico para reprocessar FAILED/AMBIGUOUS (TASK 6.18).
 *   - Emite progresso por callback (usado pela GeocodingProgressBar UI).
 */

import { errorReporting } from '../errorReporting';
import {
  getEntregasFailedGeocoding,
  getEntregasPendingGeocoding,
  updateEntregaGeocoding,
} from '../../database/DeliveryRepository';
import type { Entrega } from '../../types/entrega';
import type { GeocodeResult, GeocodingProgress, GeocodingStatus } from '../../geocoding/types';
import { geocodingService, hasValidCoordinates } from '../../geocoding/GeocodingService';
import { GeocodingQueue, type QueueProgress } from '../../geocoding/GeocodingQueue';

/** Resultado agregado do processamento em lote. */
export interface GeocodingBatchSummary {
  total: number;
  completed: number;
  geocoded: number;
  ambiguous: number;
  failed: number;
  skipped: number;
  startedAt: string;
  finishedAt: string;
}

/** Opções do orquestrador. */
export interface OrchestratorOptions {
  /** Callback com o progresso corrente (atualizado a cada item). */
  onProgress?: (progress: GeocodingProgress) => void;
  /** Delay adicional entre itens (soma com throttle do provider). */
  delayBetweenMs?: number;
  /** Se true, interrompe no primeiro erro (padrão = false). */
  stopOnError?: boolean;
}

/**
 * Converte o progresso da Queue em GeocodingProgress do domínio,
 * com contadores específicos de ambiguidade.
 */
class ProgressAggregator {
  ambiguousCount = 0;
  geocodedCount = 0;
  skippedCount = 0;

  onProgress(queueProgress: QueueProgress<Entrega, GeocodeResult>): GeocodingProgress {
    const last = queueProgress.lastResult;
    if (last?.success && last.result) {
      if (last.result.status === 'GEOCODED') this.geocodedCount += 1;
      if (last.result.status === 'AMBIGUOUS') this.ambiguousCount += 1;
    }

    return {
      total: queueProgress.total,
      completed: queueProgress.completed,
      successCount: queueProgress.successCount, // geocoded + ambiguous (ambos com resposta do provedor)
      failedCount: queueProgress.failedCount +
        (last?.success && last.result?.status === 'FAILED' ? 0 : 0),
      ambiguousCount: this.ambiguousCount,
      currentName: queueProgress.currentLabel,
      fraction: queueProgress.fraction,
    };
  }
}

/**
 * Orquestrador de ponta-a-ponta do processo de geocodificação.
 *
 * Não armazena estado de instância (exceto queue em andamento),
 * então o mesmo objeto pode ser reutilizado em múltiplas execuções.
 */
export class DeliveryGeocodingOrchestrator {
  private readonly onProgress: OrchestratorOptions['onProgress'];
  private readonly delayBetweenMs: number;

  private activeQueue: GeocodingQueue<Entrega, GeocodeResult> | null = null;

  constructor(options: OrchestratorOptions = {}) {
    this.onProgress = options.onProgress;
    this.delayBetweenMs = options.delayBetweenMs ?? 0;
  }

  /** Verdadeiro enquanto há um processamento em andamento. */
  get isRunning(): boolean {
    return this.activeQueue?.isRunning ?? false;
  }

  /** Cancela uma execução em andamento. */
  cancel(): void {
    this.activeQueue?.cancel();
  }

  /* ------------------------------------------------------------------ *
   * Entradas públicas.
   * ------------------------------------------------------------------ */

  /**
   * TASK 6.9 + TASK 6.11 + TASK 6.20: Geocodifica todas as entregas
   * pendentes (geocoding_status = PENDING). Útil para rodar logo
   * após importar uma planilha.
   */
  async runForPending(): Promise<GeocodingBatchSummary> {
    const entregas = await getEntregasPendingGeocoding();
    return this.runBatch(entregas);
  }

  /**
   * TASK 6.18: Reprocessa apenas entregas que falharam ou ficaram
   * ambíguas em execuções anteriores.
   */
  async runForFailed(): Promise<GeocodingBatchSummary> {
    const entregas = await getEntregasFailedGeocoding();
    return this.runBatch(entregas);
  }

  /**
   * Processa uma lista específica de entregas.
   * Usado por `runForPending` e `runForFailed`; também pode ser chamado
   * diretamente quando o usuário selecionar entregas específicas.
   */
  async runBatch(entregas: Entrega[]): Promise<GeocodingBatchSummary> {
    const startedAt = new Date().toISOString();
    const aggregator = new ProgressAggregator();
    let skippedCount = 0;

    const queue = new GeocodingQueue<Entrega, GeocodeResult>({
      delayBetweenMs: this.delayBetweenMs,
      swallowErrors: true,
      onProgress: (qp: QueueProgress<Entrega, GeocodeResult>) => {
        const geocodingProgress = aggregator.onProgress(qp);
        // failedCount do aggregator = FAILED status + erros de queue
        const failed =
          (qp.completed - aggregator.geocodedCount - aggregator.ambiguousCount - aggregator.skippedCount);
        this.onProgress?.({
          ...geocodingProgress,
          failedCount: Math.max(0, failed),
        });
      },
    });

    this.activeQueue = queue;

    try {
      for (const entrega of entregas) {
        if (entrega.id == null) continue;

        // TASK 6.9: Já tem coords válidas e status final → pula.
        if (this.shouldSkip(entrega)) {
          skippedCount += 1;
          continue;
        }

        queue.enqueue({
          id: entrega.id,
          item: entrega,
          label: entrega.nomeDestinatario,
          process: (e: Entrega) => this.processOne(e),
        });
      }

      const results = await queue.start();

      // Contagem final correta: percorre resultados já consolidados
      let geocoded = 0;
      let ambiguous = 0;
      let failed = 0;

      for (const r of results) {
        if (!r.success || !r.result) {
          failed += 1;
          continue;
        }
        if (r.result.status === 'GEOCODED') geocoded += 1;
        else if (r.result.status === 'AMBIGUOUS') ambiguous += 1;
        else failed += 1; // FAILED
      }

      return {
        total: entregas.length,
        completed: results.length,
        geocoded,
        ambiguous,
        failed,
        skipped: skippedCount,
        startedAt,
        finishedAt: new Date().toISOString(),
      };
    } finally {
      this.activeQueue = null;
    }
  }

  /**
   * Persiste uma correção manual de coordenadas (TASK 6.17).
   *
   * Atualiza diretamente a entrega como status MANUAL e grava as
   * coords fornecidas pelo usuário (via mapa, edição manual, etc.).
   */
  async applyManualCoordinates(
    entregaId: number,
    latitude: number,
    longitude: number,
    note?: string,
  ): Promise<void> {
    await updateEntregaGeocoding(entregaId, {
      latitude,
      longitude,
      geocodingStatus: 'MANUAL',
      geocodingConfidence: 1.0,
      geocodingNote: note ?? 'Coordenadas definidas manualmente.',
      geocodedAt: new Date().toISOString(),
    });
  }

  /* ------------------------------------------------------------------ *
   * Internos.
   * ------------------------------------------------------------------ */

  /** TASK 6.9: Decide se uma entrega deve ser pulada. */
  private shouldSkip(entrega: Entrega): boolean {
    if (entrega.geocodingStatus === 'MANUAL' && hasValidCoordinates(entrega)) {
      return true;
    }
    if (
      entrega.geocodingStatus === 'GEOCODED' &&
      hasValidCoordinates(entrega)
    ) {
      return true;
    }
    return false;
  }

  /**
   * Processa UMA entrega: geocodifica + persiste imediatamente.
   * TASK 6.8 + TASK 6.20: coords são persistidas antes de retornar.
   */
  private async processOne(entrega: Entrega): Promise<GeocodeResult> {
    const id = entrega.id!;
    const result = await geocodingService.geocodeEntrega(entrega);

    try {
      const status = result.status as GeocodingStatus;
      await updateEntregaGeocoding(id, {
        latitude: result.latitude ?? null,
        longitude: result.longitude ?? null,
        geocodingStatus: status,
        geocodingConfidence: result.confidence ?? null,
        geocodingNote: result.note ?? null,
        geocodedAt: result.status === 'GEOCODED' ? result.processedAt : null,
      });
    } catch (error) {
      errorReporting.report(error, {
        context: 'DeliveryGeocodingOrchestrator.persist',
        entregaId: id,
        entregaName: entrega.nomeDestinatario,
      });
      return {
        status: 'FAILED',
        note: 'Falha ao salvar coordenadas no banco local.',
        processedAt: new Date().toISOString(),
        provider: 'local-db',
      };
    }

    return result;
  }
}

/** Instância singleton pronta para uso. */
export const deliveryGeocodingOrchestrator = new DeliveryGeocodingOrchestrator();
