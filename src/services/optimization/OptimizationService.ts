import { bulkUpdateOrdemEntrega, getEntregas } from '../../database/DeliveryRepository';
import { errorReporting } from '../errorReporting';
import { hasValidCoordinates } from '../../geocoding/GeocodingService';
import { routingService } from '../../routing/RoutingService';
import type { Entrega } from '../../types/entrega';
import type { UserLocation } from '../../types/location';
import type { RoutingResult } from '../../routing/types';
import type {
  OptimizationOrigin,
  OptimizationResult,
  OptimizationServiceOptions,
  OptimizationStrategy,
  OrderAssignment,
} from './types';

/**
 * OptimizationService — FASE 9.
 *
 * Recebe a localização atual + lista de entregas geocodificadas e produz
 * uma ordem otimizada de visita (TASK 9.5).
 *
 *   - TASK 9.1: classe OptimizationService (singleton `optimizationService`).
 *   - TASK 9.2: recebe `OptimizationOrigin` (localização atual do entregador).
 *   - TASK 9.3: recebe `Entrega[]` ou carrega do DB se nada for passado.
 *   - TASK 9.4: estratégia padrão = NEAREST_NEIGHBOR com Haversine.
 *   - TASK 9.5: produz `ordered: Entrega[]` com `ordemEntrega` preenchido.
 *   - TASK 9.6 / 9.7: salva `ordem_entrega` em transação única (bulkUpdateOrdemEntrega).
 *   - TASK 9.8: retorna lista re-lida do banco (após ordenar por `ordem_entrega`).
 *   - TASK 9.9: atualização de marcadores é reativa via `useDeliveryMarkers.reload()`.
 *   - TASK 9.10: quando `recalculateRouteAfter=true`, calcula rota completa e
 *                anexa distância / duração / geometria GeoJSON ao resultado.
 *
 * Estratégia de fallback: se houver apenas entregas não-geocodificadas ou
 * sem origem, retorna status FAILED com código específico.
 */

/** Raio médio da Terra em METROS (Haversine). */
const EARTH_RADIUS_METERS = 6_371_000;

/**
 * Distância Haversine entre dois pontos (em metros).
 * Usado no Nearest Neighbor para evitar chamadas de API no cálculo da
 * ordem (rapidez, offline, sem rate limit).
 */
function haversineMeters(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.asin(Math.min(1, Math.sqrt(h)));
  return EARTH_RADIUS_METERS * c;
}

/** Extrai lat/lng de um OptimizationOrigin (UserLocation / Entrega / obj). */
function originToCoords(
  origin: OptimizationOrigin,
): { latitude: number; longitude: number } | null {
  if (origin == null) return null;
  const any = origin as UserLocation &
    Entrega & { latitude?: number; longitude?: number };

  // UserLocation tem `coords.latitude/longitude`.
  if (any.coords != null && typeof any.coords === 'object') {
    const c = any.coords as { latitude?: number; longitude?: number };
    if (typeof c.latitude === 'number' && typeof c.longitude === 'number') {
      return { latitude: c.latitude, longitude: c.longitude };
    }
  }

  // Entrega ou objeto direto { latitude, longitude }.
  if (typeof any.latitude === 'number' && typeof any.longitude === 'number') {
    return { latitude: any.latitude, longitude: any.longitude };
  }
  return null;
}

export class OptimizationService {
  private defaultProfile: NonNullable<OptimizationServiceOptions['defaultProfile']>;
  private recalculateRouteAfter: boolean;
  private onProgress?: OptimizationServiceOptions['onProgress'];
  private readonly strategy: OptimizationStrategy = 'NEAREST_NEIGHBOR';

  constructor(options: OptimizationServiceOptions = {}) {
    this.defaultProfile = options.defaultProfile ?? 'driving';
    this.recalculateRouteAfter = options.recalculateRouteAfter ?? true;
    this.onProgress = options.onProgress;
  }

  /* ---------------------------------------------------------------- *
   * API pública.
   * ---------------------------------------------------------------- */

  /**
   * TASK 9.2..9.10 — ponto de entrada principal.
   *
   * @param origin       Posição inicial do entregador (TASK 9.2).
   * @param entregas     Destinos para visitar (TASK 9.3). Se omitido, lê do DB.
   * @param options      Overrides locais (recalc rota, progresso).
   */
  async optimize(
    origin: OptimizationOrigin,
    entregas?: Entrega[],
    options?: Pick<
      OptimizationServiceOptions,
      'recalculateRouteAfter' | 'defaultProfile' | 'onProgress'
    >,
  ): Promise<OptimizationResult> {
    const recalcRoute = options?.recalculateRouteAfter ?? this.recalculateRouteAfter;
    const profile = options?.defaultProfile ?? this.defaultProfile;
    const onProgress = options?.onProgress ?? this.onProgress;

    try {
      // TASK 9.3: carrega entregas do DB se não forem passadas.
      onProgress?.({
        phase: 'PREPARING',
        message: 'Preparando lista de entregas...',
      });
      const all = entregas ?? (await getEntregas({}));

      const originCoords = originToCoords(origin);
      if (!originCoords) {
        return {
          status: 'FAILED',
          ordered: [],
          skipped: all.length,
          errorCode: 'NO_ORIGIN',
          errorMessage: 'Origem sem coordenadas válidas.',
          strategy: this.strategy,
          processedAt: new Date().toISOString(),
        };
      }

      // Considera apenas entregas geocodificadas e ainda não entregues.
      const candidates = all.filter((e) => {
        if (!hasValidCoordinates(e)) return false;
        if (e.status === 'ENTREGUE' || e.status === 'CANCELADA') return false;
        return true;
      });
      const skipped = all.length - candidates.length;

      if (candidates.length === 0) {
        return {
          status: 'FAILED',
          ordered: [],
          skipped,
          errorCode: 'NO_DELIVERIES',
          errorMessage:
            all.length === 0
              ? 'Nenhuma entrega para otimizar.'
              : 'Nenhuma entrega com coordenadas válidas para otimizar.',
          strategy: this.strategy,
          processedAt: new Date().toISOString(),
        };
      }

      // TASK 9.4 + 9.5: ordenação Nearest Neighbor.
      onProgress?.({
        phase: 'ORDERING',
        message: `Ordenando ${candidates.length} entrega(s)...`,
        ratio: 0.1,
      });
      const ordered = this.nearestNeighborOrder(originCoords, candidates);

      // TASK 9.6 / 9.7: salvar ordem_entrega (bulk transacional).
      onProgress?.({
        phase: 'SAVING',
        message: 'Salvando ordem na base local...',
        ratio: 0.8,
      });
      const assignments: OrderAssignment[] = ordered
        .filter((e) => e.id != null)
        .map((e, idx) => ({
          entregaId: e.id!,
          ordem: idx + 1,
        }));
      await bulkUpdateOrdemEntrega(assignments);

      // Reaplica a ordemEntrega diretamente nas entidades retornadas
      // (não precisamos re-ler, pois já temos a ordem calculada).
      const orderedWithMeta: Entrega[] = ordered.map((e, idx) => ({
        ...e,
        ordemEntrega: idx + 1,
      }));

      // TASK 9.8: result.ordered (já é a lista ordenada atualizada).
      // TASK 9.9: marcadores serão recarregados pela UI (useDeliveryMarkers.reload).

      // TASK 9.10: recálculo de rota com RoutingService (FASE 8).
      let route: RoutingResult | undefined;
      if (recalcRoute) {
        onProgress?.({
          phase: 'ROUTING',
          message: 'Recalculando rota completa...',
          ratio: 0.9,
        });
        route = await routingService.calculateRouteForDeliveries(
          originCoords,
          orderedWithMeta,
          profile,
        );
      }

      return {
        status: 'OPTIMIZED',
        ordered: orderedWithMeta,
        skipped,
        distanceMeters: route?.distanceMeters,
        durationSeconds: route?.durationSeconds,
        geometry: route?.geometry,
        strategy: this.strategy,
        processedAt: new Date().toISOString(),
      };
    } catch (error) {
      errorReporting.report(error, {
        context: 'OptimizationService.optimize',
      });
      const err = error instanceof Error ? error.message : 'Erro desconhecido.';
      return {
        status: 'FAILED',
        ordered: [],
        skipped: 0,
        errorMessage: err,
        strategy: this.strategy,
        processedAt: new Date().toISOString(),
      };
    }
  }

  /* ---------------------------------------------------------------- *
   * Implementação: Nearest Neighbor (ganancioso, O(n^2)).
   * Bom o suficiente para até ~100 entregas no SQLite mobile.
   * ---------------------------------------------------------------- */

  private nearestNeighborOrder(
    origin: { latitude: number; longitude: number },
    candidates: Entrega[],
  ): Entrega[] {
    const remaining: Array<{
      e: Entrega;
      lat: number;
      lng: number;
    }> = candidates.map((e) => ({
      e,
      lat: e.latitude as number,
      lng: e.longitude as number,
    }));

    const result: Entrega[] = [];
    let current = origin;

    while (remaining.length > 0) {
      let bestIdx = -1;
      let bestDist = Number.POSITIVE_INFINITY;
      for (let i = 0; i < remaining.length; i++) {
        const cand = remaining[i];
        const d = haversineMeters(current, {
          latitude: cand.lat,
          longitude: cand.lng,
        });
        if (d < bestDist) {
          bestDist = d;
          bestIdx = i;
        }
      }
      const picked = remaining[bestIdx];
      remaining.splice(bestIdx, 1);
      result.push(picked.e);
      current = { latitude: picked.lat, longitude: picked.lng };
    }

    return result;
  }
}

/**
 * Instância singleton pronta para usar (FASE 9 — TASK 9.1).
 */
export const optimizationService = new OptimizationService({
  recalculateRouteAfter: true,
});
