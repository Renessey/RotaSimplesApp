/**
 * RoutingService (TASKS 8.1, 8.8).
 *
 * Facade principal de roteamento. Coordena:
 *
 *   - TASK 8.1: "RoutingService" (classe central exposta).
 *   - TASK 8.8: Conversão de entrada (Entrega / Coordinates / Waypoint)
 *               para o formato interno (RoutingWaypoint[]) antes da
 *               consulta ao provider.
 *   - Cache offline (TTL 24h) usando o OfflineCache existente. A chave
 *     é um hash determinístico dos waypoints + perfil, garantindo que
 *     rotas iguais não sejam recalculadas em rede repetidamente.
 *   - Tratamento de erro genérico (acima do provider): relatórios via
 *     errorReporting e fallback para status FAILED com código genérico.
 *
 * A camada de apresentação (telas) NÃO deve usar o provider diretamente.
 * Use sempre este serviço.
 */

import type { Entrega } from '../types/entrega';
import type { Coordinates } from '../types/location';
import { offlineCache } from '../cache/OfflineCache';
import { errorReporting } from '../services/errorReporting';
import { osrmRoutingProvider } from './OsrmRoutingProvider';
import { hasValidCoordinates } from '../geocoding/GeocodingService';
import type {
  RoutingProfile,
  RoutingProvider,
  RoutingResult,
  RoutingWaypoint,
} from './types';

/* ------------------------------------------------------------------ *
 * Constantes de cache.
 * ------------------------------------------------------------------ */

/** Tempo de vida do cache de roteamento (24h, em ms). */
const CACHE_TTL_MS = 1000 * 60 * 60 * 24;

/** Prefixo das chaves de cache de roteamento. */
const CACHE_KEY_PREFIX = 'routing_v1';

/* ------------------------------------------------------------------ *
 * Valor armazenado no cache.
 * ------------------------------------------------------------------ */

interface CacheEntry {
  result: RoutingResult;
  cachedAt: number;
}

/* ------------------------------------------------------------------ *
 * Opções de construção do serviço.
 * ------------------------------------------------------------------ */

export interface RoutingServiceOptions {
  provider?: RoutingProvider;
  /** TTL do cache em ms (padrão 24h). */
  cacheTtlMs?: number;
  /** Perfil padrão usado quando nenhum perfil é informado (padrão driving). */
  defaultProfile?: RoutingProfile;
}

/* ------------------------------------------------------------------ *
 * Helpers: hash de chave de cache (mesmo algoritmo do AddressNormalizer).
 * ------------------------------------------------------------------ */

/**
 * Hash leve e determinístico (djb2 xor), igual ao usado no geocoding.
 * Produz uma string hex de 8 caracteres — suficiente para colisão
 * desprezível no contexto de cache local de rotas.
 */
function hashWaypoints(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i += 1) {
    // eslint-disable-next-line no-bitwise
    hash = ((hash << 5) + hash) ^ input.charCodeAt(i);
  }
  // eslint-disable-next-line no-bitwise
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Monta a string de entrada para o hash.
 * Normaliza latitude/longitude para 6 casas decimais (≈10cm de precisão)
 * garantindo que valores idênticos tenham hashes iguais, mesmo que
 * a entrada original viesse com mais casas decimais.
 */
function buildCacheKeySource(
  waypoints: RoutingWaypoint[],
  profile: RoutingProfile,
): string {
  const parts = [profile];
  for (const wp of waypoints) {
    const lat = Number.isFinite(wp.latitude) ? wp.latitude.toFixed(6) : '?';
    const lng = Number.isFinite(wp.longitude) ? wp.longitude.toFixed(6) : '?';
    parts.push(`${lng},${lat}`);
  }
  return parts.join('|').toLowerCase();
}

/* ------------------------------------------------------------------ *
 * Helpers: normalização de entrada (TASK 8.8 — conversão para
 * formato interno).
 * ------------------------------------------------------------------ */

/**
 * TASK 8.8: Converte uma `Entrega` em RoutingWaypoint usando suas
 * coordenadas já geocodificadas. Se a entrega NÃO tiver coordenadas
 * válidas, retorna undefined (o RoutingService deve pular ou falhar).
 */
function entregaToWaypoint(entrega: Entrega, fallbackName?: string): RoutingWaypoint | undefined {
  if (!hasValidCoordinates(entrega)) return undefined;
  return {
    latitude: entrega.latitude!,
    longitude: entrega.longitude!,
    name: entrega.nomeDestinatario || fallbackName,
  };
}

/**
 * TASK 8.8: Converte Coordinates (do GPS) em RoutingWaypoint.
 */
function coordinatesToWaypoint(
  coords: Coordinates | { latitude: number; longitude: number },
  fallbackName?: string,
): RoutingWaypoint {
  return {
    latitude: coords.latitude,
    longitude: coords.longitude,
    name: fallbackName,
  };
}

/**
 * TASK 8.8: Valida e converte uma lista arbitrária de entregas em
 * waypoints. Falha se alguma entrega não tiver coordenadas.
 */
function entregasToWaypoints(
  origin: Entrega | Coordinates | { latitude: number; longitude: number } | RoutingWaypoint,
  destinations: Entrega[],
): { waypoints: RoutingWaypoint[]; missingFor?: number } {
  let originWp: RoutingWaypoint;
  if ('nomeDestinatario' in origin || 'geocodingStatus' in origin) {
    const wp = entregaToWaypoint(origin as Entrega, 'Origem');
    if (!wp) return { waypoints: [], missingFor: 0 };
    originWp = wp;
  } else if ('latitude' in origin && 'longitude' in origin) {
    originWp = coordinatesToWaypoint(origin, 'Origem');
  } else {
    originWp = origin as RoutingWaypoint;
  }

  const destinationWps: RoutingWaypoint[] = [];
  for (let i = 0; i < destinations.length; i++) {
    const wp = entregaToWaypoint(destinations[i], `Entrega #${i + 1}`);
    if (!wp) {
      return { waypoints: [], missingFor: i + 1 };
    }
    destinationWps.push(wp);
  }

  return { waypoints: [originWp, ...destinationWps] };
}

/* ------------------------------------------------------------------ *
 * Implementação do serviço.
 * ------------------------------------------------------------------ */

export class RoutingService {
  private readonly provider: RoutingProvider;
  private readonly cacheTtlMs: number;
  private readonly defaultProfile: RoutingProfile;

  constructor(options: RoutingServiceOptions = {}) {
    this.provider = options.provider ?? osrmRoutingProvider;
    this.cacheTtlMs = options.cacheTtlMs ?? CACHE_TTL_MS;
    this.defaultProfile = options.defaultProfile ?? 'driving';
  }

  /* ------------------------------------------------------------------ *
   * API de alto nível: cálculo de rotas para entregas (caso de uso
   * principal do EntregaApp).
   * ------------------------------------------------------------------ */

  /**
   * Calcula a rota para uma lista de `Entrega`, partindo de `origin`.
   * A rota visita as entregas na ORDEM fornecida (sem otimização TSP —
   * esta será uma FASE futura).
   *
   * Falha imediatamente se alguma entrega não tiver coordenadas
   * geocodificadas válidas. Use `GeocodingService` antes se necessário.
   */
  async calculateRouteForDeliveries(
    origin: Entrega | Coordinates | { latitude: number; longitude: number } | RoutingWaypoint,
    destinations: Entrega[],
    profile: RoutingProfile = this.defaultProfile,
  ): Promise<RoutingResult> {
    const conversion = entregasToWaypoints(origin, destinations);
    if (conversion.missingFor !== undefined) {
      const idx = conversion.missingFor;
      const ref =
        idx === 0
          ? 'A entrega de ORIGEM não possui coordenadas válidas.'
          : `A entrega #${idx} (${destinations[idx - 1]?.nomeDestinatario ?? 'sem nome'}) não possui coordenadas válidas.`;
      return this.failureFromMissingCoords(ref, conversion.waypoints.length > 0 ? conversion.waypoints : this.fallbackWaypoints(), profile);
    }
    return this.calculateRoute(conversion.waypoints, profile);
  }

  /**
   * API de mais baixo nível: calcula rota diretamente a partir de
   * waypoints já preparados. Útil para rotas arbitrárias (não-entregas).
   *
   * TASK 8.3: waypoints[0] = origem, waypoints[1..N] = destinos.
   */
  async calculateRoute(
    waypoints: RoutingWaypoint[],
    profile: RoutingProfile = this.defaultProfile,
  ): Promise<RoutingResult> {
    const cacheKey = this.cacheKey(waypoints, profile);

    // 1. Consulta cache (TASK 6.10 equivalente da FASE 8)
    const cached = await this.readCache(cacheKey);
    if (cached) return cached;

    let result: RoutingResult;
    try {
      // 2. Consulta provider (OSRM) — TASKS 8.4 a 8.8
      result = await this.provider.route(waypoints, profile);
    } catch (error) {
      errorReporting.report(error, {
        context: 'RoutingService.calculateRoute',
        waypointCount: waypoints.length,
        profile,
      });
      result = {
        status: 'FAILED',
        distanceMeters: 0,
        durationSeconds: 0,
        geometry: null,
        legs: [],
        waypoints,
        profile,
        errorCode: 'UNKNOWN',
        errorMessage: error instanceof Error ? error.message : 'Erro desconhecido ao rotear.',
        processedAt: new Date().toISOString(),
        provider: this.provider.name,
      };
    }

    // 3. Armazena em cache (incluindo falhas, para evitar repetição
    //    de requisições que falham consistentemente em 24h).
    void this.writeCache(cacheKey, result).catch(() => undefined);

    return result;
  }

  /* ------------------------------------------------------------------ *
   * Helpers: cache offline.
   * ------------------------------------------------------------------ */

  private cacheKey(waypoints: RoutingWaypoint[], profile: RoutingProfile): string {
    const src = buildCacheKeySource(waypoints, profile);
    return `${CACHE_KEY_PREFIX}:${profile}:${hashWaypoints(src)}`;
  }

  private async readCache(key: string): Promise<RoutingResult | null> {
    try {
      const entry = await offlineCache.get<CacheEntry>(key);
      if (!entry) return null;
      if (Date.now() - entry.cachedAt > this.cacheTtlMs) {
        void offlineCache.remove(key).catch(() => undefined);
        return null;
      }
      return entry.result;
    } catch (error) {
      errorReporting.report(error, { context: 'RoutingService.readCache', key });
      return null;
    }
  }

  private async writeCache(key: string, result: RoutingResult): Promise<void> {
    try {
      const entry: CacheEntry = { result, cachedAt: Date.now() };
      await offlineCache.set(key, entry);
    } catch (error) {
      errorReporting.report(error, { context: 'RoutingService.writeCache', key });
    }
  }

  /* ------------------------------------------------------------------ *
   * Helpers: montagem de falhas amigáveis.
   * ------------------------------------------------------------------ */

  /** Waypoints vazios usados apenas para preencher campos obrigatórios em falhas. */
  private fallbackWaypoints(): RoutingWaypoint[] {
    return [
      { latitude: 0, longitude: 0, name: 'N/A' },
      { latitude: 0, longitude: 0, name: 'N/A' },
    ];
  }

  private failureFromMissingCoords(
    message: string,
    waypoints: RoutingWaypoint[],
    profile: RoutingProfile,
  ): RoutingResult {
    return {
      status: 'FAILED',
      distanceMeters: 0,
      durationSeconds: 0,
      geometry: null,
      legs: [],
      waypoints,
      profile,
      errorCode: 'INVALID_COORDINATES',
      errorMessage: message,
      processedAt: new Date().toISOString(),
      provider: this.provider.name,
    };
  }
}

/** Instância singleton pronta para uso em todo o app. */
export const routingService = new RoutingService();
