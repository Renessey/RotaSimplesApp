/**
 * retry.ts (TASK 6.13 — Retry controlado).
 *
 * Implementa retry com backoff exponencial + jitter. Usado pelo
 * `NominatimGeocodingProvider` para lidar com erros transitórios
 * de rede, 5xx e 429 (rate limit).
 *
 * Critérios atendidos:
 *   - Número máximo de tentativas configurável (padrão 3).
 *   - Backoff exponencial: baseDelay * 2^(attempt-1).
 *   - Jitter de ±20% para evitar "thundering herd".
 *   - 429 (Too Many Requests) dobra o delay base da próxima tentativa.
 *   - Apenas tenta novamente se for um erro de rede / 5xx / 429.
 *     Erros 4xx de cliente não são repetidos.
 */

/** Opções do retry. */
export interface RetryOptions {
  /** Máximo de tentativas (default: 3). */
  maxAttempts?: number;
  /** Delay base em ms (default: 1500). */
  baseDelayMs?: number;
  /** Delay máximo acumulado em ms (default: 15000). */
  maxDelayMs?: number;
  /** Função que decide se um erro é retriável. */
  isRetryable?: (error: unknown, attempt: number) => boolean;
  /** Callback chamado em cada tentativa fracassada (para logs). */
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
}

/** Sleep não-bloqueante usando setTimeout + Promise. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, Math.max(0, Math.floor(ms)));
  });
}

/** Verifica se um valor é um Response-like (tem `status` numérico). */
function hasStatus(error: unknown): error is { status: number } {
  return (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as { status?: unknown }).status === 'number'
  );
}

/**
 * Detecta se o erro HTTP é "transitório" (5xx) ou rate-limit (429).
 * 4xx (exceto 429) são erros do cliente e NÃO são retriáveis.
 */
export function isHttpRetryable(error: unknown): boolean {
  if (hasStatus(error)) {
    const { status } = error;
    return status === 429 || status >= 500 || status === 0;
  }
  // TypeError / Network request failed / timeout são retriáveis
  if (error instanceof TypeError) return true;
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /network|timeout|econnreset|socket hang up|fetch failed/i.test(message);
}

/** Implementação padrão de decisão. */
function defaultIsRetryable(error: unknown, _attempt: number): boolean {
  return isHttpRetryable(error);
}

/**
 * Aplica jitter de ±20% no valor de delay, para evitar que várias
 * requisições retentem sincronizadas (thundering herd).
 */
function applyJitter(delayMs: number): number {
  const minFactor = 0.8;
  const maxFactor = 1.2;
  const factor = minFactor + Math.random() * (maxFactor - minFactor);
  return delayMs * factor;
}

/**
 * TASK 6.13: Executa `producer` com retry controlado.
 *
 * @template T Tipo do valor retornado pelo produtor.
 */
export async function retryWithBackoff<T>(
  producer: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const {
    maxAttempts = 3,
    baseDelayMs = 1500,
    maxDelayMs = 15000,
    isRetryable = defaultIsRetryable,
    onRetry,
  } = options;

  let attempt = 0;
  let effectiveBaseDelay = baseDelayMs;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    attempt += 1;
    try {
      return await producer();
    } catch (error) {
      const isLastAttempt = attempt >= maxAttempts;
      if (isLastAttempt || !isRetryable(error, attempt)) {
        throw error;
      }

      // 429 = rate limit → dobra o delay base para ser mais conservador
      if (hasStatus(error) && error.status === 429) {
        effectiveBaseDelay = Math.min(effectiveBaseDelay * 2, maxDelayMs);
      }

      // Backoff exponencial: baseDelay * 2^(attempt-1)
      const exponent = attempt - 1;
      const exponential = effectiveBaseDelay * Math.pow(2, exponent);
      const capped = Math.min(exponential, maxDelayMs);
      const jittered = applyJitter(capped);

      onRetry?.(error, attempt, jittered);

      await sleep(jittered);
    }
  }
}
