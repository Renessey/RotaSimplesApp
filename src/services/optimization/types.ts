import type { Feature, LineString } from 'geojson';
import type { Entrega } from '../../types/entrega';
import type { RoutingErrorCode, RoutingProfile } from '../../routing/types';
import type { UserLocation } from '../../types/location';

/**
 * Tipos públicos do serviço de otimização de entregas (FASE 9).
 *
 * Estratégia padrão: Nearest Neighbor com fallback a distância Euclidiana
 * (Haversine). Quando disponível (poucos waypoints e rede disponível) o
 * OSRM `table` service pode fornecer distâncias reais para melhorar a
 * qualidade da ordenação.
 */

/** Origem: localização atual do entregador. */
export type OptimizationOrigin =
  | UserLocation
  | { latitude: number; longitude: number }
  | Entrega;

/** Estratégia de otimização (TASK 9.4). */
export type OptimizationStrategy =
  | 'NEAREST_NEIGHBOR'
  | 'NEAREST_NEIGHBOR_OSRM'
  | 'INSERTION';

/** Progresso do otimizador (para UI). */
export interface OptimizationProgress {
  /** Fase atual. */
  phase: 'PREPARING' | 'BUILDING_DISTANCES' | 'ORDERING' | 'SAVING' | 'ROUTING';
  /** 0..1 da fase atual (opcional). */
  ratio?: number;
  /** Informação textual curta para UI. */
  message?: string;
}

/** Resultado da otimização (TASK 9.5). */
export interface OptimizationResult {
  /** Status final. */
  status: 'OPTIMIZED' | 'FAILED';
  /** Entregas ordenadas pela otimização (apenas as GEOCODED válidas). */
  ordered: Entrega[];
  /** Número de entregas skippadas (sem coords ou já ENTREGUES/FINALIZADAS). */
  skipped: number;
  /** Código de erro se status = FAILED. */
  errorCode?: RoutingErrorCode | 'NO_DELIVERIES' | 'NO_ORIGIN';
  /** Mensagem de erro se status = FAILED. */
  errorMessage?: string;
  /** Distância TOTAL estimada em METROS (após recálculo de rota, se rodou). */
  distanceMeters?: number;
  /** Duração TOTAL estimada em SEGUNDOS (após recálculo). */
  durationSeconds?: number;
  /** Geometria GeoJSON completa (após recálculo, se rodou). */
  geometry?: Feature<LineString> | null;
  /** Estratégia usada. */
  strategy: OptimizationStrategy;
  /** Timestamp ISO. */
  processedAt: string;
}

/** Opções para o OptimizationService (TASK 9.1). */
export interface OptimizationServiceOptions {
  /** Perfil padrão (se for rodar rota após a otimização). */
  defaultProfile?: RoutingProfile;
  /** Se verdadeiro, re-calcular rota completa após otimização (TASK 9.10). */
  recalculateRouteAfter?: boolean;
  /** Callback de progresso, se desejado. */
  onProgress?: (p: OptimizationProgress) => void;
}

/** Par de IDs com a ordem a ser aplicada. */
export interface OrderAssignment {
  /** ID da entrega (tabela entregas.id). */
  entregaId: number;
  /** Número da ordem (iniciando em 1). */
  ordem: number;
}
