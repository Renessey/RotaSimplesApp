import { getDatabase } from '../database/database';
import { createAppError } from '../utils/errorHandler';
import { errorReporting } from '../services/errorReporting';

/**
 * Cache offline (Task 5.6).
 *
 * Persiste pares chave→valor em uma tabela SQLite (`offline_cache`),
 * permitindo que a aplicação funcione sem conexão e guarde resultados
 * de operações caras (ex.: geocodificação, payloads de sincronização,
 * coordenadas de destinos) para reuso posterior.
 *
 * O valor é armazenado como string JSON para aceitar qualquer tipo
 * serializável (objetos, arrays, números, strings e booleanos).
 */

/** Entrada armazenada no cache. */
interface CacheEntry<T> {
  key: string;
  value: T;
  createdAt: number;
  updatedAt: number;
}

/** Serializa um valor arbitrário para armazenamento. */
function serialize(value: unknown): string {
  return JSON.stringify(value);
}

/** Desserializa um valor armazenado, com fallback seguro. */
function deserialize<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * Grava (ou atualiza) um valor no cache.
 * @returns true se a operação foi bem-sucedida.
 */
export async function setCacheItem<T>(key: string, value: T): Promise<boolean> {
  const db = getDatabase();
  const now = Date.now();
  try {
    const result = await db.execute(
      `INSERT INTO offline_cache (key, value, created_at, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         value = excluded.value,
         updated_at = excluded.updated_at;`,
      [key, serialize(value), now, now],
    );
    return (result.rowsAffected ?? 0) > 0;
  } catch (error) {
    errorReporting.report(error, { context: 'OfflineCache.set', key });
    return false;
  }
}

/**
 * Lê um valor do cache.
 * @returns o valor cacheado, ou null se não existir.
 */
export async function getCacheItem<T>(key: string): Promise<T | null> {
  const db = getDatabase();
  try {
    const result = await db.execute(
      'SELECT value FROM offline_cache WHERE key = ? LIMIT 1;',
      [key],
    );
    const row = result.rows[0];
    if (!row || row.value == null) {
      return null;
    }
    return deserialize<T>(String(row.value));
  } catch (error) {
    errorReporting.report(error, { context: 'OfflineCache.get', key });
    return null;
  }
}

/**
 * Lê uma entrada completa do cache (valor + metadados).
 */
export async function getCacheEntry<T>(
  key: string,
): Promise<CacheEntry<T> | null> {
  const db = getDatabase();
  try {
    const result = await db.execute(
      'SELECT key, value, created_at, updated_at FROM offline_cache WHERE key = ? LIMIT 1;',
      [key],
    );
    const row = result.rows[0];
    if (!row || row.value == null) {
      return null;
    }
    return {
      key: String(row.key),
      value: deserialize<T>(String(row.value)) as T,
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    };
  } catch (error) {
    errorReporting.report(error, { context: 'OfflineCache.getEntry', key });
    return null;
  }
}

/** Atualiza apenas o valor (mantendo createdAt original). */
export async function updateCacheItem<T>(
  key: string,
  value: T,
): Promise<boolean> {
  const db = getDatabase();
  try {
    const result = await db.execute(
      'UPDATE offline_cache SET value = ?, updated_at = ? WHERE key = ?;',
      [serialize(value), Date.now(), key],
    );
    return (result.rowsAffected ?? 0) > 0;
  } catch (error) {
    errorReporting.report(error, { context: 'OfflineCache.update', key });
    return false;
  }
}

/** Remove um item do cache. Retorna true se existia. */
export async function removeCacheItem(key: string): Promise<boolean> {
  const db = getDatabase();
  try {
    const result = await db.execute('DELETE FROM offline_cache WHERE key = ?;', [
      key,
    ]);
    return (result.rowsAffected ?? 0) > 0;
  } catch (error) {
    errorReporting.report(error, { context: 'OfflineCache.remove', key });
    return false;
  }
}

/** Verifica se uma chave existe no cache. */
export async function hasCacheItem(key: string): Promise<boolean> {
  const db = getDatabase();
  try {
    const result = await db.execute(
      'SELECT 1 AS found FROM offline_cache WHERE key = ? LIMIT 1;',
      [key],
    );
    return result.rows.length > 0;
  } catch (error) {
    errorReporting.report(error, { context: 'OfflineCache.has', key });
    return false;
  }
}

/** Retorna todas as chaves armazenadas (para diagnóstico). */
export async function listCacheKeys(): Promise<string[]> {
  const db = getDatabase();
  try {
    const result = await db.execute('SELECT key FROM offline_cache;');
    return result.rows.map((row) => String(row.key));
  } catch (error) {
    errorReporting.report(error, { context: 'OfflineCache.keys' });
    return [];
  }
}

/** Limpa todo o cache. Retorna a quantidade de itens removidos. */
export async function clearCache(): Promise<number> {
  const db = getDatabase();
  try {
    const result = await db.execute('DELETE FROM offline_cache;');
    return result.rowsAffected ?? 0;
  } catch (error) {
    errorReporting.report(error, { context: 'OfflineCache.clear' });
    throw createAppError('Não foi possível limpar o cache offline.', {
      category: 'storage',
      severity: 'error',
      code: 'STORAGE_ERROR',
    });
  }
}

/**
 * API get-or-set (cache-aside): se a chave existir, retorna o valor;
 * caso contrário, executa a função `producer` e armazena o resultado.
 */
export async function getOrSetCacheItem<T>(
  key: string,
  producer: () => Promise<T>,
): Promise<T | null> {
  const cached = await getCacheItem<T>(key);
  if (cached != null) {
    return cached;
  }
  try {
    const value = await producer();
    await setCacheItem(key, value);
    return value;
  } catch (error) {
    errorReporting.report(error, { context: 'OfflineCache.getOrSet', key });
    return null;
  }
}

/** Instância exportada para uso como singleton de serviço. */
export const offlineCache = {
  set: setCacheItem,
  get: getCacheItem,
  update: updateCacheItem,
  remove: removeCacheItem,
  has: hasCacheItem,
  keys: listCacheKeys,
  clear: clearCache,
  getOrSet: getOrSetCacheItem,
};
