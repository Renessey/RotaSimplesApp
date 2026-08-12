/**
 * GeocodingService (TASKS 6.1, 6.9, 6.10).
 *
 * Facade principal de geocodificação. Coordena:
 *
 *   - TASK 6.1: "GeocodingService" (classe central exposta).
 *   - TASK 6.5: Normaliza endereços via AddressNormalizer.
 *   - TASK 6.9: Pula entrega que já possui coordenadas válidas.
 *   - TASK 6.10: Consulta cache offline (OfflineCache) antes do provedor.
 *   - TASK 6.15 / 6.16: Resultado consolidado com status FAILED ou
 *     AMBIGUOUS, dependendo dos candidatos e confiança.
 *   - TASK 6.2 / 6.6: Delega a consulta real para o GeocodingProvider
 *     injetado (atualmente NominatimGeocodingProvider; futuro backend
 *     HTTP ou outro provedor basta implementar a mesma interface).
 *
 * A camada de apresentação (telas) NÃO deve usar o provider diretamente.
 * Use sempre este serviço.
 */

import type { Entrega } from '../types/entrega';
import { offlineCache } from '../cache/OfflineCache';
import { errorReporting } from '../services/errorReporting';
import { normalizeAddress } from './AddressNormalizer';
import { nominatimGeocodingProvider } from './NominatimGeocodingProvider';
import {
  GEOCODING_MIN_CONFIDENCE,
  type GeocodeResult,
  type GeocodingCandidate,
  type GeocodingProvider,
  type NormalizedAddress,
} from './types';

/** Tempo de vida do cache de geocodificação (7 dias, em ms). */
const CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 7;

/** Prefixo das chaves de cache de geocodificação. */
const CACHE_KEY_PREFIX = 'geocode_v1';

/** Valor armazenado no cache. */
interface CacheEntry {
  result: GeocodeResult;
  cachedAt: number;
}

/** Opções de construção do serviço. */
export interface GeocodingServiceOptions {
  provider?: GeocodingProvider;
  /** Valor de confiança mínimo para aceitar GEOCODED direto (padrão 0.7). */
  minConfidence?: number;
  /** TTL do cache em ms (padrão 7 dias). */
  cacheTtlMs?: number;
}

/**
 * Coordenadas válidas: números finitos, latitude -90..90, longitude -180..180.
 * Usado para implementar o TASK 6.9 (não re-geocodificar quem já tem).
 */
export function hasValidCoordinates(entrega: Entrega): boolean {
  const { latitude, longitude } = entrega;
  if (latitude == null || longitude == null) return false;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
  return (
    latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180
  );
}

/**
 * Seleciona o candidato mais adequado dentro da lista retornada pelo
 * provedor. Retorna o candidato e o status final (GEOCODED / AMBIGUOUS).
 */
function chooseCandidate(
  candidates: GeocodingCandidate[],
  minConfidence: number,
): { candidate?: GeocodingCandidate; status: 'GEOCODED' | 'AMBIGUOUS' | 'FAILED'; note?: string } {
  if (!candidates || candidates.length === 0) {
    return { status: 'FAILED', note: 'Nenhum resultado encontrado para o endereço.' };
  }

  const sorted = [...candidates].sort((a, b) => b.confidence - a.confidence);
  const best = sorted[0];
  const second = sorted[1];

  // Múltiplos candidatos com confiança similar = ambíguo
  if (second && best.confidence - second.confidence < 0.1) {
    return {
      candidate: best,
      status: 'AMBIGUOUS',
      note: `Resultado ambíguo: ${candidates.length} candidatos retornados (melhor confiança ${best.confidence.toFixed(2)}).`,
    };
  }

  if (best.confidence < minConfidence) {
    return {
      candidate: best,
      status: 'AMBIGUOUS',
      note: `Baixa confiança (${best.confidence.toFixed(2)} < ${minConfidence.toFixed(2)}).`,
    };
  }

  return { candidate: best, status: 'GEOCODED' };
}

/**
 * "GeocodingService no backend" — camada de serviço local do app
 * que cumpre as mesmas responsabilidades de normalização e cache
 * que um backend dedicado, mantendo a API idêntica para quando o
 * backend HTTP existir (basta trocar o provider injetado).
 */
export class GeocodingService {
  private readonly provider: GeocodingProvider;
  private readonly minConfidence: number;
  private readonly cacheTtlMs: number;

  constructor(options: GeocodingServiceOptions = {}) {
    this.provider = options.provider ?? nominatimGeocodingProvider;
    this.minConfidence = options.minConfidence ?? GEOCODING_MIN_CONFIDENCE;
    this.cacheTtlMs = options.cacheTtlMs ?? CACHE_TTL_MS;
  }

  /* ------------------------------------------------------------------ *
   * API de alto nível: geocodifica uma Entrega (entrada do domínio).
   * ------------------------------------------------------------------ */

  /**
   * TASK 6.9: Se a entrega já tem coordenadas válidas e status MANUAL
   * ou GEOCODED, retorna "GEOCODED" imediatamente, sem custo de rede.
   */
  async geocodeEntrega(entrega: Entrega): Promise<GeocodeResult> {
    if (hasValidCoordinates(entrega) &&
        (entrega.geocodingStatus === 'GEOCODED' || entrega.geocodingStatus === 'MANUAL')) {
      return {
        status: 'GEOCODED',
        latitude: entrega.latitude,
        longitude: entrega.longitude,
        confidence: entrega.geocodingConfidence ?? 1.0,
        matchedAddress: `${entrega.endereco}${entrega.numero ? ', ' + entrega.numero : ''}, ${entrega.cidade ?? ''}`,
        note: undefined,
        processedAt: entrega.geocodedAt ?? new Date().toISOString(),
        provider: 'cached-entrega',
      };
    }

    const normalized = normalizeAddress({
      endereco: entrega.endereco,
      numero: entrega.numero,
      complemento: entrega.complemento,
      bairro: entrega.bairro,
      cidade: entrega.cidade,
      cep: entrega.cep,
    });

    return this.geocodeNormalized(normalized);
  }

  /**
   * TASK 6.5 + TASK 6.6 + TASK 6.10: Normaliza, consulta cache offline e,
   * em caso de miss, chama o provider. Persiste resultado de volta no cache.
   */
  async geocodeNormalized(address: NormalizedAddress): Promise<GeocodeResult> {
    const cacheKey = this.cacheKey(address.hash);

    // 1. Consulta cache (TASK 6.10)
    const cached = await this.readCache(cacheKey);
    if (cached) {
      return cached;
    }

    let result: GeocodeResult;
    try {
      // 2. Consulta provider (Nominatim) — TASK 6.6
      const candidates = await this.provider.geocode(address);

      // 3. Seleciona melhor candidato + detecta ambiguidade (TASK 6.16)
      const choice = chooseCandidate(candidates, this.minConfidence);

      result = {
        status: choice.status,
        latitude: choice.candidate?.latitude,
        longitude: choice.candidate?.longitude,
        confidence: choice.candidate?.confidence,
        candidates,
        matchedAddress: choice.candidate?.displayName,
        note: choice.note,
        processedAt: new Date().toISOString(),
        provider: this.provider.name,
      };
    } catch (error) {
      errorReporting.report(error, {
        context: 'GeocodingService.geocodeNormalized',
        query: address.query,
      });
      result = {
        status: 'FAILED',
        note: error instanceof Error ? error.message : 'Erro desconhecido ao geocodificar.',
        processedAt: new Date().toISOString(),
        provider: this.provider.name,
      };
    }

    // 4. Escreve cache inclusive de falhas/ambíguos (para não repetir
    //    requisições caras em um curto intervalo)
    void this.writeCache(cacheKey, result).catch(() => undefined);

    return result;
  }

  /* ------------------------------------------------------------------ *
   * Cache offline (TASK 6.10).
   * ------------------------------------------------------------------ */

  private cacheKey(hash: string): string {
    return `${CACHE_KEY_PREFIX}:${hash}`;
  }

  private async readCache(key: string): Promise<GeocodeResult | null> {
    try {
      const entry = await offlineCache.get<CacheEntry>(key);
      if (!entry) return null;
      if (Date.now() - entry.cachedAt > this.cacheTtlMs) {
        void offlineCache.remove(key).catch(() => undefined);
        return null;
      }
      return entry.result;
    } catch (error) {
      errorReporting.report(error, { context: 'GeocodingService.readCache', key });
      return null;
    }
  }

  private async writeCache(key: string, result: GeocodeResult): Promise<void> {
    try {
      const entry: CacheEntry = { result, cachedAt: Date.now() };
      await offlineCache.set(key, entry);
    } catch (error) {
      errorReporting.report(error, { context: 'GeocodingService.writeCache', key });
    }
  }
}

/** Instância singleton pronta para uso em todo o app. */
export const geocodingService = new GeocodingService();
