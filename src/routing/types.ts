/**
 * Tipos centrais do sistema de routing online (FASE 8).
 *
 * Define o contrato entre provedores (OSRM, backend futuro, etc.),
 * a camada de serviço e o cache offline. A geometria da rota é
 * entregue em formato GeoJSON LineString, compatível com MapLibre.
 */

import type { Feature, LineString } from 'geojson';

/**
 * Perfil de veículo/modo de transporte usado pelo roteador.
 * Impacta velocidades, restrições de via e cálculo de tempo.
 */
export type RoutingProfile =
  | 'driving'
  | 'driving-traffic'
  | 'cycling'
  | 'walking';

/** Perfis válidos (usado em validação). */
export const ROUTING_PROFILE_VALUES: readonly RoutingProfile[] = [
  'driving',
  'driving-traffic',
  'cycling',
  'walking',
];

/**
 * Ponto de passagem da rota (origem, destino ou waypoint intermediário).
 * A ordem dos waypoints define a sequência a ser percorrida.
 */
export interface RoutingWaypoint {
  latitude: number;
  longitude: number;
  /** Nome/label opcional para exibição (ex.: "Depósito", "Entrega #3"). */
  name?: string;
}

/**
 * Um passo manobrável da rota (instrução de direção).
 * Usado para listas de navegação textual na UI.
 */
export interface RouteStep {
  /** Distância do passo em METROS. */
  distanceMeters: number;
  /** Duração estimada do passo em SEGUNDOS. */
  durationSeconds: number;
  /** Instrução textual (ex.: "Vire à direita na Av. Brasil"). */
  instruction?: string;
  /** Tipo de manobra (turn, merge, on ramp, off ramp, fork, end of road, etc.). */
  maneuverType?: string;
  /** Modificador da manobra (left, right, straight, slight left, etc.). */
  maneuverModifier?: string;
  /** Nome da via deste passo. */
  roadName?: string;
  /** Coordenadas do ponto onde a manobra ocorre. */
  location?: { latitude: number; longitude: number };
}

/**
 * Um trecho (leg) da rota entre dois waypoints consecutivos.
 * Uma rota com N waypoints tem N-1 trechos.
 */
export interface RouteLeg {
  /** Distância total do trecho em METROS. */
  distanceMeters: number;
  /** Duração estimada do trecho em SEGUNDOS. */
  durationSeconds: number;
  /** Passos manobráveis do trecho. */
  steps: RouteStep[];
  /** Nome/resumo do trecho (ex.: trecho entre "Depósito" e "João Silva"). */
  summary?: string;
}

/**
 * Resultado final da consulta de roteamento.
 * Formato interno, consolidado a partir da resposta do provider.
 */
export interface RoutingResult {
  /** Status final da operação. */
  status: 'ROUTED' | 'FAILED';
  /** Distância TOTAL da rota em METROS (soma de todos os trechos). */
  distanceMeters: number;
  /** Duração TOTAL estimada em SEGUNDOS (soma de todos os trechos). */
  durationSeconds: number;
  /**
   * Geometria completa da rota em GeoJSON LineString.
   * Coordenadas: [longitude, latitude] (padrão GeoJSON / RFC 7946).
   */
  geometry: Feature<LineString> | null;
  /** Trechos entre waypoints consecutivos (origem → d1 → d2 → ...). */
  legs: RouteLeg[];
  /** Waypoints usados na consulta (origem + destinos), normalizados. */
  waypoints: RoutingWaypoint[];
  /** Perfil usado na consulta. */
  profile: RoutingProfile;
  /** Motivo da falha, se status = FAILED (TASK 8.9). */
  errorCode?: RoutingErrorCode;
  /** Mensagem detalhada da falha (para logs/UI). */
  errorMessage?: string;
  /** Timestamp ISO da consulta. */
  processedAt: string;
  /** Nome do provider usado (ex.: "osrm", "backend"). */
  provider: string;
}

/**
 * Classificação de erros do roteador (TASK 8.9 — tratamento de erros).
 * Usado para permitir que a camada de UI trate cada tipo de falha
 * de forma específica (ex.: 429 = "Muitas requisições, aguarde...").
 */
export type RoutingErrorCode =
  /** Nenhuma rota encontrada para os waypoints fornecidos. */
  | 'NO_ROUTE'
  /** Coordenadas inválidas ou fora da área de cobertura do roteador. */
  | 'INVALID_COORDINATES'
  /** Limite de requisições atingido (429 Too Many Requests). */
  | 'RATE_LIMITED'
  /** Erro de rede / offline / timeout. */
  | 'NETWORK_ERROR'
  /** Erro interno do provedor (5xx). */
  | 'PROVIDER_ERROR'
  /** Erro de cliente (4xx exceto 429 — ex.: requisição malformada). */
  | 'CLIENT_ERROR'
  /** Erro desconhecido. */
  | 'UNKNOWN';

/**
 * Estratégia/Interface de um provedor de roteamento.
 *
 * Implementado atualmente por `OsrmRoutingProvider`.
 * No futuro pode ser implementado por `BackendRoutingProvider`,
 * GraphHopper, Valhalla, Google, etc.
 *
 * A implementação DEVE respeitar rate-limits do provedor alvo.
 */
export interface RoutingProvider {
  /** Identificador legível do provedor (aparece em logs e resultados). */
  readonly name: string;

  /**
   * Calcula a rota completa entre origem e uma lista de destinos.
   * Os waypoints são visitados na ordem fornecida (sem otimização).
   * Não trata cache nem retry de alto nível — a camada RoutingService cuida disso.
   *
   * @param waypoints Lista com 2+ pontos (o primeiro é a origem).
   * @param profile   Perfil de transporte.
   *
   * @throws {Error} Quando houver erro de rede ou do provedor (será tratado
   *                 com retry pela camada superior).
   */
  route(
    waypoints: RoutingWaypoint[],
    profile: RoutingProfile,
  ): Promise<RoutingResult>;
}
