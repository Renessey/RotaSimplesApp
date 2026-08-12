/**
 * OsrmRoutingProvider (TASKS 8.3–8.10).
 *
 * Provedor de roteamento baseado na API pública do OSRM
 * (Open Source Routing Machine, OpenStreetMap). Implementa a
 * interface `RoutingProvider` e cumpre as regras de uso do serviço:
 *
 *   - User-Agent identificando o app (obrigatório pela política OSM).
 *   - Limit de no máximo 1 requisição por segundo (TASK 8.10).
 *     Controlado por throttle interno nesta classe.
 *   - Retry automático com backoff exponencial.
 *   - Respeita 429 Too Many Requests com backoff dobrado.
 *   - Perfil "driving" usado por padrão para entregas de carro/van.
 *
 * TASKS implementados:
 *   8.3  – Envia origem + destinos (waypoints em sequência).
 *   8.4  – Recebe rota do OSRM (response.routes[0]).
 *   8.5  – Recebe distância (distanceMeters).
 *   8.6  – Recebe duração (durationSeconds).
 *   8.7  – Recebe geometria GeoJSON LineString (geometries=geojson).
 *   8.8  – Converte resposta para formato interno (RoutingResult).
 *   8.9  – Trata erros mapeando códigos OSRM para RoutingErrorCode.
 *   8.10 – Throttle + retry + 429 → RATE_LIMITED.
 *
 * Documentação:
 *   https://project-osrm.org/docs/v5.24.0/api/#route-service
 * Política de uso do OSRM público: mesma do Nominatim (1 req/s).
 */

import { errorReporting } from '../services/errorReporting';
import { retryWithBackoff } from '../geocoding/retry';
import type {
  Feature,
  LineString,
} from 'geojson';
import type {
  RouteLeg,
  RouteStep,
  RoutingErrorCode,
  RoutingProfile,
  RoutingProvider,
  RoutingResult,
  RoutingWaypoint,
} from './types';

/* ------------------------------------------------------------------ *
 * Tipos internos da resposta do OSRM /route/v1/{profile}/{coords}
 * ------------------------------------------------------------------ */

/** Manobra de um passo da rota. */
interface OsrmManeuver {
  bearing_after?: number;
  bearing_before?: number;
  location?: [number, number];
  modifier?: string;
  type?: string;
  instruction?: string;
  exit?: number | string;
}

/** Um passo (step) de um trecho (leg) da resposta OSRM. */
interface OsrmRouteStep {
  distance: number;
  duration: number;
  geometry?: unknown;
  name?: string;
  ref?: string;
  rotary_name?: string;
  destinations?: string;
  exits?: string;
  driving_side?: 'left' | 'right' | 'straight';
  mode?: string;
  maneuver?: OsrmManeuver;
  weight?: number;
}

/** Um trecho entre dois waypoints consecutivos. */
interface OsrmRouteLeg {
  distance: number;
  duration: number;
  steps: OsrmRouteStep[];
  summary?: string;
  weight?: number;
  annotation?: unknown;
}

/** Uma rota candidata retornada pelo OSRM. */
interface OsrmRoute {
  distance: number;
  duration: number;
  geometry: LineString | string;
  legs: OsrmRouteLeg[];
  weight_name?: string;
  weight?: number;
}

/** Waypoint de origem/destino reconhecido pelo OSRM. */
interface OsrmWaypoint {
  hint?: string;
  distance?: number;
  name?: string;
  location: [number, number];
}

/** Resposta completa do /route/v1. */
interface OsrmRouteResponse {
  code: string;
  message?: string;
  routes?: OsrmRoute[];
  waypoints?: OsrmWaypoint[];
  data_version?: string;
}

/** Erro HTTP do OSRM quando a requisição falha com status ruim. */
class OsrmHttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'OsrmHttpError';
    this.status = status;
  }
}

/**
 * Erro lógico do OSRM quando a requisição retorna 200 mas com
 * `code` diferente de "Ok" (ex.: "NoRoute", "InvalidValue").
 */
class OsrmApiError extends Error {
  readonly code: string;
  readonly status = 0;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'OsrmApiError';
    this.code = code;
  }
}

/* ------------------------------------------------------------------ *
 * Opções de construção do provider
 * ------------------------------------------------------------------ */

export interface OsrmRoutingProviderOptions {
  /** Endpoint base (pode ser sobrescrito para OSRM self-hosted). */
  endpoint?: string;
  /** User-Agent enviado em cada request (obrigatório pela política OSM). */
  userAgent?: string;
  /** Throttle mínimo entre requisições em ms (padrão 1100ms — TASK 8.10). */
  throttleMs?: number;
  /** Máximo de tentativas de retry (padrão 3). */
  maxRetryAttempts?: number;
  /** Se deve incluir passos passo-a-passo (padrão true). */
  steps?: boolean;
  /** Nível de detalhe da geometria (full = maior fidelidade para exibição). */
  overview?: 'simplified' | 'full' | 'false';
}

/** Valor padrão de user-agent. Cumpre a política do OSRM/Nominatim. */
const DEFAULT_USER_AGENT = 'EntregaApp/0.0.1 (roteamento local de entregas)';

/* ------------------------------------------------------------------ *
 * Implementação do provider
 * ------------------------------------------------------------------ */

export class OsrmRoutingProvider implements RoutingProvider {
  readonly name = 'osrm';

  private readonly endpoint: string;
  private readonly userAgent: string;
  private readonly throttleMs: number;
  private readonly maxRetryAttempts: number;
  private readonly steps: boolean;
  private readonly overview: 'simplified' | 'full' | 'false';

  /** Timestamp da última requisição enviada (para throttle). */
  private lastRequestAt = 0;

  constructor(options: OsrmRoutingProviderOptions = {}) {
    this.endpoint = (
      options.endpoint ?? 'https://router.project-osrm.org'
    ).replace(/\/+$/, '');
    this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
    this.throttleMs = options.throttleMs ?? 1100;
    this.maxRetryAttempts = options.maxRetryAttempts ?? 3;
    this.steps = options.steps ?? true;
    this.overview = options.overview ?? 'full';
  }

  /**
   * TASKS 8.3–8.8: Consulta o OSRM e retorna RoutingResult consolidado.
   *
   * Recebe waypoints em ordem [origem, d1, d2, ...] e retorna a rota
   * completa passando por todos eles na sequência.
   */
  async route(
    waypoints: RoutingWaypoint[],
    profile: RoutingProfile,
  ): Promise<RoutingResult> {
    // TASK 8.3: valida entrada
    const validation = this.validateWaypoints(waypoints);
    if (validation) {
      return this.failureResult(
        waypoints,
        profile,
        validation.code,
        validation.message,
      );
    }

    // TASK 8.10: throttle mínimo entre requisições
    await this.throttle();

    const requestUrl = this.buildRouteUrl(waypoints, profile);

    try {
      const response = await retryWithBackoff<OsrmRouteResponse>(
        async () => this.makeRequest(requestUrl),
        {
          maxAttempts: this.maxRetryAttempts,
          baseDelayMs: 2000,
          maxDelayMs: 20000,
          onRetry: (error, attempt, delay) => {
            errorReporting.report(error, {
              context: 'OsrmRoutingProvider.retry',
              attempt,
              delayMs: delay,
              profile,
              waypointCount: waypoints.length,
            });
          },
        },
      );

      this.lastRequestAt = Date.now();

      return this.toRoutingResult(response, waypoints, profile);
    } catch (error) {
      errorReporting.report(error, {
        context: 'OsrmRoutingProvider.route',
        profile,
        waypointCount: waypoints.length,
      });
      return this.failureResultFromError(error, waypoints, profile);
    }
  }

  /* ------------------------------------------------------------------ *
   * Helpers: validação de entrada (TASK 8.3)
   * ------------------------------------------------------------------ */

  private validateWaypoints(
    waypoints: RoutingWaypoint[],
  ): { code: RoutingErrorCode; message: string } | null {
    if (!waypoints || waypoints.length < 2) {
      return {
        code: 'INVALID_COORDINATES',
        message:
          'Roteamento requer pelo menos 2 waypoints (origem + 1 destino).',
      };
    }
    for (let i = 0; i < waypoints.length; i++) {
      const wp = waypoints[i];
      if (
        !Number.isFinite(wp.latitude) ||
        !Number.isFinite(wp.longitude) ||
        wp.latitude < -90 ||
        wp.latitude > 90 ||
        wp.longitude < -180 ||
        wp.longitude > 180
      ) {
        return {
          code: 'INVALID_COORDINATES',
          message: `Coordenadas inválidas no waypoint #${i + 1}.`,
        };
      }
    }
    return null;
  }

  /* ------------------------------------------------------------------ *
   * Helpers: throttle (TASK 8.10)
   * ------------------------------------------------------------------ */

  private async throttle(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastRequestAt;
    if (elapsed < this.throttleMs) {
      const waitMs = this.throttleMs - elapsed;
      await new Promise<void>((resolve) =>
        setTimeout(() => resolve(), waitMs),
      );
    }
  }

  /* ------------------------------------------------------------------ *
   * Helpers: construção da URL e request HTTP (TASKS 8.3, 8.7)
   * ------------------------------------------------------------------ */

  private buildRouteUrl(
    waypoints: RoutingWaypoint[],
    profile: RoutingProfile,
  ): string {
    // OSRM espera "lon,lat;lon,lat;..." (GeoJSON ordem: longitude primeiro)
    const coords = waypoints
      .map((wp) => `${wp.longitude.toFixed(6)},${wp.latitude.toFixed(6)}`)
      .join(';');

    const params = new URLSearchParams();
    params.set('overview', this.overview);
    params.set('geometries', 'geojson'); // TASK 8.7: GeoJSON nativo
    params.set('steps', this.steps ? 'true' : 'false');
    params.set('alternatives', 'false');
    params.set('annotations', 'false');

    // O perfil "driving-traffic" não está na instância pública; fazemos
    // downgrade silencioso para "driving" evitando erro 400.
    const safeProfile: RoutingProfile =
      profile === 'driving-traffic' ? 'driving' : profile;

    return `${this.endpoint}/route/v1/${safeProfile}/${coords}?${params.toString()}`;
  }

  /**
   * Executa request HTTP. Lança OsrmHttpError para status ruins ou
   * OsrmApiError quando code != "Ok".
   */
  private async makeRequest(url: string): Promise<OsrmRouteResponse> {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': this.userAgent,
      },
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new OsrmHttpError(
        response.status,
        `OSRM HTTP ${response.status}: ${text || response.statusText}`,
      );
    }

    const data = (await response.json()) as unknown;
    if (!data || typeof data !== 'object') {
      throw new OsrmApiError('InvalidResponse', 'Resposta inválida do OSRM.');
    }
    const cast = data as OsrmRouteResponse;

    // TASK 8.9: Mapeia códigos lógicos da resposta em erros
    if (!cast.code) {
      throw new OsrmApiError('InvalidResponse', 'Campo "code" ausente.');
    }
    if (cast.code !== 'Ok') {
      throw new OsrmApiError(
        cast.code,
        cast.message || `OSRM retornou código ${cast.code}.`,
      );
    }
    if (!cast.routes || cast.routes.length === 0) {
      throw new OsrmApiError(
        'NoRoute',
        'Nenhuma rota retornada pelo OSRM.',
      );
    }

    return cast;
  }

  /* ------------------------------------------------------------------ *
   * Helpers: conversão → formato interno (TASK 8.8)
   * ------------------------------------------------------------------ */

  private toRoutingResult(
    response: OsrmRouteResponse,
    waypoints: RoutingWaypoint[],
    profile: RoutingProfile,
  ): RoutingResult {
    const route = response.routes![0]; // garantido não vazio por makeRequest
    const geometry = this.toGeoJsonFeature(route.geometry);
    const legs = (route.legs ?? []).map((leg) => this.toRouteLeg(leg));

    return {
      status: 'ROUTED',
      distanceMeters: Number(route.distance ?? 0),
      durationSeconds: Number(route.duration ?? 0),
      geometry,
      legs,
      waypoints,
      profile,
      processedAt: new Date().toISOString(),
      provider: this.name,
    };
  }

  private toGeoJsonFeature(
    geometry: LineString | string | undefined,
  ): Feature<LineString> | null {
    if (!geometry) return null;
    if (typeof geometry === 'string') {
      // Se algum dia usarmos geometries=polyline, aqui ficaria o decoder.
      // Como pedimos geometries=geojson, este ramo é fallback apenas.
      errorReporting.report(
        new Error('OSRM geometry inesperadamente em Polyline string.'),
        { context: 'OsrmRoutingProvider.toGeoJsonFeature' },
      );
      return null;
    }
    if (geometry.type !== 'LineString' || !Array.isArray(geometry.coordinates)) {
      errorReporting.report(
        new Error('OSRM geometry não é LineString válido.'),
        { context: 'OsrmRoutingProvider.toGeoJsonFeature', type: geometry.type },
      );
      return null;
    }
    return {
      type: 'Feature',
      properties: {},
      geometry,
    };
  }

  private toRouteLeg(leg: OsrmRouteLeg): RouteLeg {
    return {
      distanceMeters: Number(leg.distance ?? 0),
      durationSeconds: Number(leg.duration ?? 0),
      steps: (leg.steps ?? []).map((step) => this.toRouteStep(step)),
      summary: leg.summary,
    };
  }

  private toRouteStep(step: OsrmRouteStep): RouteStep {
    const maneuver = step.maneuver ?? {};
    const location = maneuver.location
      ? { longitude: maneuver.location[0], latitude: maneuver.location[1] }
      : undefined;

    const instruction =
      maneuver.instruction ??
      this.buildInstructionFromManeuver(
        maneuver.type,
        maneuver.modifier,
        step.name,
      );

    return {
      distanceMeters: Number(step.distance ?? 0),
      durationSeconds: Number(step.duration ?? 0),
      instruction,
      maneuverType: maneuver.type,
      maneuverModifier: maneuver.modifier,
      roadName: step.name,
      location,
    };
  }

  /**
   * Gera uma instrução amigável quando o OSRM não fornece o campo
   * `instruction` (ex.: self-hosted antigo).
   */
  private buildInstructionFromManeuver(
    type?: string,
    modifier?: string,
    roadName?: string,
  ): string {
    const action: Record<string, string> = {
      turn: 'Vire',
      merge: 'Entre na via',
      onramp: 'Entre na rampa',
      offramp: 'Saia na rampa',
      fork: 'Na bifurcação, siga',
      endofroad: 'No fim da via, vire',
      roundabout: 'Na rotatória, saia em direção',
      rotary: 'Na rotatória, saia em direção',
      depart: 'Saia de',
      arrive: 'Chegue em',
      straight: 'Siga em frente por',
      continue: 'Continue por',
    };
    const side: Record<string, string> = {
      left: 'à esquerda',
      right: 'à direita',
      'slight left': 'um pouco à esquerda',
      'slight right': 'um pouco à direita',
      'sharp left': 'forte à esquerda',
      'sharp right': 'forte à direita',
      uturn: 'e faça retorno',
      straight: 'em frente',
    };
    const verb = action[type ?? ''] ?? 'Siga';
    const dir = side[modifier ?? ''] ?? '';
    const road = roadName ? ` na ${roadName}` : '';
    return `${verb} ${dir}${road}`.replace(/\s+/g, ' ').trim();
  }

  /* ------------------------------------------------------------------ *
   * Helpers: montagem de falhas (TASK 8.9 - tratamento de erros)
   * ------------------------------------------------------------------ */

  private failureResult(
    waypoints: RoutingWaypoint[],
    profile: RoutingProfile,
    errorCode: RoutingErrorCode,
    errorMessage: string,
  ): RoutingResult {
    return {
      status: 'FAILED',
      distanceMeters: 0,
      durationSeconds: 0,
      geometry: null,
      legs: [],
      waypoints,
      profile,
      errorCode,
      errorMessage,
      processedAt: new Date().toISOString(),
      provider: this.name,
    };
  }

  private failureResultFromError(
    error: unknown,
    waypoints: RoutingWaypoint[],
    profile: RoutingProfile,
  ): RoutingResult {
    let code: RoutingErrorCode = 'UNKNOWN';
    let message = 'Erro desconhecido ao calcular a rota.';

    if (error instanceof OsrmApiError) {
      code = this.mapOsrmCodeToErrorCode(error.code);
      message = error.message;
    } else if (error instanceof OsrmHttpError) {
      if (error.status === 429) code = 'RATE_LIMITED';
      else if (error.status >= 500) code = 'PROVIDER_ERROR';
      else if (error.status >= 400) code = 'CLIENT_ERROR';
      message = error.message;
    } else if (error instanceof TypeError) {
      code = 'NETWORK_ERROR';
      message = error.message;
    } else if (error instanceof Error) {
      const msg = error.message;
      if (/network|timeout|econnreset|socket hang up|fetch failed/i.test(msg)) {
        code = 'NETWORK_ERROR';
      }
      message = msg;
    } else {
      message = String(error ?? message);
    }

    return this.failureResult(waypoints, profile, code, message);
  }

  private mapOsrmCodeToErrorCode(osrmCode: string): RoutingErrorCode {
    switch (osrmCode) {
      case 'NoRoute':
      case 'NoSegment':
        return 'NO_ROUTE';
      case 'InvalidValue':
      case 'InvalidOptions':
        return 'INVALID_COORDINATES';
      case 'TooManyRequests':
        return 'RATE_LIMITED';
      case 'GazetteerTimeout':
      case 'TableTimeout':
        return 'PROVIDER_ERROR';
      default:
        return 'UNKNOWN';
    }
  }
}

/** Instância singleton pronta para uso em todo o app. */
export const osrmRoutingProvider = new OsrmRoutingProvider();
