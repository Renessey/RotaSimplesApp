/**
 * GeocodingQueue (TASK 6.11 — Processamento em fila para grandes
 * importações e TASK 6.12 — não travar a interface).
 *
 * Implementa uma fila assíncrona de tarefas com:
 *
 *   - Concorrência FIXA em 1 (uma geocodificação por vez). Cumpre a
 *     política do Nominatim (1 req/s) e evita sobrecarregar o app.
 *   - Yield entre itens (processamento em microtasks/setTimeout) para
 *     manter a interface responsiva (TASK 6.12 — JS thread não trava).
 *   - Emissão de progresso por callback a cada item processado.
 *   - Suporte a cancelamento (pausar / limpar).
 *   - Evita duplicatas: se o mesmo id de item já estiver na fila ou
 *     já tiver sido processado na execução atual, ignora.
 */

export interface QueueItem<TItem, TResult> {
  /** Identificador único para deduplicação (ex.: id da entrega). */
  id: string | number;
  /** Payload da tarefa. */
  item: TItem;
  /** Nome opcional para exibição na UI de progresso. */
  label?: string;
  /** Função de processamento (retorna Promise do resultado). */
  process: (item: TItem) => Promise<TResult>;
}

/** Resultado de cada item processado. */
export interface QueueResult<TItem, TResult> {
  id: string | number;
  item: TItem;
  label?: string;
  success: boolean;
  result?: TResult;
  error?: Error;
}

/** Progresso da fila (compatível com GeocodingProgress em types.ts). */
export interface QueueProgress<TItem, TResult> {
  total: number;
  completed: number;
  successCount: number;
  failedCount: number;
  currentLabel?: string;
  fraction: number;
  lastResult?: QueueResult<TItem, TResult>;
}

/** Opções de construção da fila. */
export interface GeocodingQueueOptions<TItem, TResult> {
  /** Chamado ao terminar de processar cada item. */
  onProgress?: (progress: QueueProgress<TItem, TResult>) => void;
  /** Delay adicional entre itens, em ms (padrão 0 — provider já throttla). */
  delayBetweenMs?: number;
  /** Se true, não rejeita em erros individuais (continua processando). */
  swallowErrors?: boolean;
}

/**
 * TASK 6.11: Fila de processamento assíncrono para geocodificação.
 *
 * @example
 *   const queue = new GeocodingQueue({ onProgress: ui.update });
 *   queue.enqueueMany(entregas.map(e => ({
 *     id: e.id!,
 *     item: e,
 *     label: e.nomeDestinatario,
 *     process: (entrega) => service.geocodeEntrega(entrega),
 *   })));
 *   const results = await queue.start();
 */
export class GeocodingQueue<TItem, TResult> {
  private readonly items: Array<QueueItem<TItem, TResult>> = [];
  private readonly seenIds = new Set<string | number>();
  private readonly onProgress;
  private readonly delayBetweenMs: number;
  private readonly swallowErrors: boolean;

  private running = false;
  private cancelled = false;
  private cursor = 0;

  private completed = 0;
  private successCount = 0;
  private failedCount = 0;

  constructor(options: GeocodingQueueOptions<TItem, TResult> = {}) {
    this.onProgress = options.onProgress ?? (() => undefined);
    this.delayBetweenMs = options.delayBetweenMs ?? 0;
    this.swallowErrors = options.swallowErrors ?? true;
  }

  /** Quantidade de itens atualmente na fila. */
  get pendingCount(): number {
    return this.items.length - this.cursor;
  }

  /** Verdadeiro enquanto a fila está sendo processada. */
  get isRunning(): boolean {
    return this.running;
  }

  /** Adiciona um item à fila, ignorando se o id já foi visto. */
  enqueue(item: QueueItem<TItem, TResult>): boolean {
    if (this.seenIds.has(item.id)) return false;
    this.seenIds.add(item.id);
    this.items.push(item);
    return true;
  }

  /** Adiciona vários itens de uma vez. Retorna quantos foram adicionados. */
  enqueueMany(items: Array<QueueItem<TItem, TResult>>): number {
    let added = 0;
    for (const item of items) {
      if (this.enqueue(item)) added += 1;
    }
    return added;
  }

  /** Limpa a fila e reseta contadores (não cancela tarefa em andamento). */
  clear(): void {
    this.items.length = 0;
    this.seenIds.clear();
    this.cursor = 0;
    this.completed = 0;
    this.successCount = 0;
    this.failedCount = 0;
  }

  /** Solicita o cancelamento da execução após o item atual terminar. */
  cancel(): void {
    this.cancelled = true;
  }

  /**
   * Inicia o processamento da fila.
   *
   * TASK 6.12: Cada item é processado em uma microtask separada
   * (via Promise.resolve().then) para não travar a JS thread.
   */
  async start(): Promise<Array<QueueResult<TItem, TResult>>> {
    if (this.running) {
      throw new Error('GeocodingQueue já está rodando.');
    }
    this.running = true;
    this.cancelled = false;

    const results: Array<QueueResult<TItem, TResult>> = [];
    const total = this.items.length;

    try {
      while (this.cursor < this.items.length) {
        if (this.cancelled) break;

        const entry = this.items[this.cursor];
        const result = await this.yieldAndProcess(entry);
        results.push(result);

        this.completed += 1;
        if (result.success) this.successCount += 1;
        else this.failedCount += 1;

        this.emitProgress(total, entry.label, result);

        this.cursor += 1;

        if (this.delayBetweenMs > 0 && this.cursor < this.items.length) {
          await new Promise<void>((resolve) => setTimeout(() => resolve(), this.delayBetweenMs));
        }
      }
    } finally {
      this.running = false;
    }

    return results;
  }

  /* ------------------------------------------------------------------ *
   * Internos.
   * ------------------------------------------------------------------ */

  /**
   * Yield: agenda o processamento da próxima microtask para o
   * event loop não travar (garante que animações e toques rodem).
   */
  private async yieldAndProcess(
    entry: QueueItem<TItem, TResult>,
  ): Promise<QueueResult<TItem, TResult>> {
    await new Promise<void>((resolve) => setTimeout(() => resolve(), 0));
    try {
      const value = await entry.process(entry.item);
      return {
        id: entry.id,
        item: entry.item,
        label: entry.label,
        success: true,
        result: value,
      };
    } catch (error) {
      const result: QueueResult<TItem, TResult> = {
        id: entry.id,
        item: entry.item,
        label: entry.label,
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
      if (!this.swallowErrors) {
        throw error;
      }
      return result;
    }
  }

  /** Emite callback de progresso com estatísticas atuais. */
  private emitProgress(
    total: number,
    currentLabel: string | undefined,
    lastResult: QueueResult<TItem, TResult>,
  ): void {
    const fraction = total === 0 ? 1 : this.completed / total;
    this.onProgress({
      total,
      completed: this.completed,
      successCount: this.successCount,
      failedCount: this.failedCount,
      currentLabel,
      fraction,
      lastResult,
    });
  }
}
