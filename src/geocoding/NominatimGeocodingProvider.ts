/**
 * NominatimGeocodingProvider (TASKS 6.2, 6.6, 6.13, 6.14).
 *
 * Provedor de geocodificação baseado na API pública do Nominatim
 * (OpenStreetMap). Implementa a interface `GeocodingProvider` e
 * cumpre as regras de uso do serviço:
 *
 *   - User-Agent identificando o app (obrigatório pela política).
 *   - Limit de no máximo 1 requisição por segundo (TASK 6.14).
 *     Controlado por um throttle interno nesta classe.
 *   - Retry automático com backoff exponencial (TASK 6.13).
 *   - Respeita 429 Too Many Requests com backoff dobrado.
 *   - countrycodes=br (foco em Maricá/RJ, TASK 6.19) para reduzir
 *     falsos positivos internacionais.
 *
 * Documentação da API: https://nominatim.org/release-docs/latest/api/Search/
 * Política de uso: https://operations.osmfoundation.org/policies/nominatim/
 */

import { errorReporting } from '../services/errorReporting';
import type {
  GeocodingCandidate,
  GeocodingProvider,
  NormalizedAddress,
} from './types';
import { retryWithBackoff } from './retry';

/** Resposta JSON de um candidato retornado pelo Nominatim /search. */
interface NominatimSearchFeature {
  place_id?: number | string;
  lat: string;
  lon: string;
  display_name?: string;
  importance?: number;
  class?: string;
  type?: string;
  address?: Record<string, string>;
  licence?: string;
  boundingbox?: [string, string, string, string];
}

/** Erro do Nominatim quando a requisição falha com status HTTP. */
class NominatimHttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'NominatimHttpError';
    this.status = status;
  }
}

/** Opções de construção do provider. */
export interface NominatimProviderOptions {
  /** Endpoint base (pode ser sobrescrito para Nominatim self-hosted). */
  endpoint?: string;
  /** User-Agent enviado em cada request (obrigatório pela política OSM). */
  userAgent?: string;
  /** Limite de candidatos por consulta (default 5). */
  limit?: number;
  /** Códigos de país aceitos (default = "br" — TASK 6.19 Maricá/RJ). */
  countryCodes?: string;
  /** Throttle mínimo entre requisições em ms (padrão 1100ms — TASK 6.14). */
  throttleMs?: number;
  /** Máximo de tentativas de retry (padrão 3). */
  maxRetryAttempts?: number;
}

/** Valor padrão de user-agent. Cumpre a política do Nominatim. */
const DEFAULT_USER_AGENT = 'EntregaApp/0.0.1 (geocodificação local de entregas)';

/**
 * Implementação do GeocodingProvider usando o Nominatim público.
 *
 * IMPORTANTE (TASK 6.3): Este provider é usado PELA CAMADA DE SERVIÇO
 * do app, que acrescenta cache offline + normalização. Ele NÃO é chamado
 * diretamente pela UI a cada clique — todo o pipeline passa por
 * GeocodingService, que garante deduplicação e limite de chamadas.
 */
export class NominatimGeocodingProvider implements GeocodingProvider {
  readonly name = 'nominatim';

  private readonly endpoint: string;
  private readonly userAgent: string;
  private readonly limit: number;
  private readonly countryCodes: string;
  private readonly throttleMs: number;
  private readonly maxRetryAttempts: number;

  /** Timestamp da última requisição enviada (para throttle). */
  private lastRequestAt = 0;

  constructor(options: NominatimProviderOptions = {}) {
    this.endpoint =
      (options.endpoint ?? 'https://nominatim.openstreetmap.org').replace(
        /\/+$/,
        '',
      );
    this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
    this.limit = options.limit ?? 5;
    this.countryCodes = options.countryCodes ?? 'br';
    this.throttleMs = options.throttleMs ?? 1100;
    this.maxRetryAttempts = options.maxRetryAttempts ?? 3;
  }

  /**
   * Geocodifica um endereço normalizado (TASK 6.6).
   *
   * Chama `Nominatim /search` e retorna uma lista ordenada de
   * `GeocodingCandidate[]`. A seleção do candidato final e a
   * detecção de ambiguidade ficam a cargo do `GeocodingService`.
   */
  async geocode(address: NormalizedAddress): Promise<GeocodingCandidate[]> {
    // Throttle: garante espaçamento mínimo entre requisições (TASK 6.14).
    await this.throttle();

    const searchUrl = this.buildSearchUrl(address);

    try {
      const features = await retryWithBackoff<NominatimSearchFeature[]>(
        async () => this.makeRequest(searchUrl),
        {
          maxAttempts: this.maxRetryAttempts,
          baseDelayMs: 2000,
          maxDelayMs: 20000,
          onRetry: (error, attempt, delay) => {
            errorReporting.report(error, {
              context: 'NominatimGeocodingProvider.retry',
              attempt,
              delayMs: delay,
              query: address.query,
            });
          },
        },
      );

      this.lastRequestAt = Date.now();

      return (features ?? []).map((f) => this.toCandidate(f, address));
    } catch (error) {
      errorReporting.report(error, {
        context: 'NominatimGeocodingProvider.geocode',
        query: address.query,
      });
      throw error;
    }
  }

  /* ------------------------------------------------------------------ *
   * Helpers internos.
   * ------------------------------------------------------------------ */

  /** Garante o espaçamento mínimo entre requisições. */
  private async throttle(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastRequestAt;
    if (elapsed < this.throttleMs) {
      const waitMs = this.throttleMs - elapsed;
      await new Promise<void>((resolve) => setTimeout(() => resolve(), waitMs));
    }
  }

  /** Monta a URL completa com query params. */
  private buildSearchUrl(address: NormalizedAddress): string {
    const params = new URLSearchParams();
    params.set('q', address.query);
    params.set('format', 'jsonv2');
    params.set('limit', String(this.limit));
    params.set('addressdetails', '1');
    params.set('countrycodes', this.countryCodes);
    params.set('accept-language', 'pt-BR');
    params.set('bounded', '0');

    // Extra bias para região de Maricá/RJ (TASK 6.19).
    // Viewbox em torno de Maricá para priorizar resultados locais.
    if (/marica/i.test(address.components.city ?? '') ||
        (address.components.postalCode ?? '').startsWith('249')) {
      // viewbox = <left>,<top>,<right>,<bottom>
      // Maricá: aproximadamente -42.99,-22.83,-42.73,-23.04
      params.set('viewbox', '-43.05,-22.78,-42.70,-23.08');
    }

    return `${this.endpoint}/search?${params.toString()}`;
  }

  /**
   * Executa a requisição HTTP e retorna os features parseados.
   * Lança `NominatimHttpError` em status ruins (para o retry identificar).
   */
  private async makeRequest(url: string): Promise<NominatimSearchFeature[]> {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': this.userAgent,
      },
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new NominatimHttpError(
        response.status,
        `Nominatim HTTP ${response.status}: ${text || response.statusText}`,
      );
    }

    const data = (await response.json()) as unknown;
    if (!Array.isArray(data)) {
      return [];
    }
    return data as NominatimSearchFeature[];
  }

  /** Converte um feature Nominatim em GeocodingCandidate com confiança. */
  private toCandidate(
    feature: NominatimSearchFeature,
    address: NormalizedAddress,
  ): GeocodingCandidate {
    const latitude = Number(feature.lat);
    const longitude = Number(feature.lon);
    const importance = Number(feature.importance ?? 0.1);

    const confidence = this.computeConfidence(feature, importance, address);

    return {
      latitude,
      longitude,
      displayName: feature.display_name,
      confidence,
      placeClass: feature.class,
      placeType: feature.type,
    };
  }

  /**
   * Heurística de confiança do candidato.
   *
   * Usa o `importance` do Nominatim como base e multiplica por fatores:
   *   - match exato do bairro: +15%
   *   - match parcial do logradouro: +10%
   *   - tipo de lugar "building" ou "house" é mais confiável: +10%
   *   - se importance < 0.3, candidatos são penalizados
   */
  private computeConfidence(
    feature: NominatimSearchFeature,
    importance: number,
    address: NormalizedAddress,
  ): number {
    let score = Math.max(0.1, Math.min(1.0, importance));

    // Match bairro
    const featureAddr = feature.address ?? {};
    const neighborhood =
      featureAddr.suburb ?? featureAddr.neighbourhood ?? featureAddr.city_district ?? '';
    const expectedNeighborhood = address.components.neighborhood ?? '';
    if (expectedNeighborhood && neighborhood) {
      if (this.normalizeCompare(neighborhood, expectedNeighborhood)) {
        score = Math.min(1.0, score * 1.15);
      }
    }

    // Match de logradouro no display_name
    if (address.components.street && feature.display_name) {
      if (this.normalizeCompare(feature.display_name, address.components.street)) {
        score = Math.min(1.0, score * 1.1);
      }
    }

    // Tipo de lugar: building/house → alta precisão; residential/amenity → baixa
    const placeType = feature.type ?? '';
    if (/(house|building|entrance|door|shop|office)/i.test(placeType)) {
      score = Math.min(1.0, score + 0.1);
    } else if (/(residential|neighbourhood|suburb|city|county|state)/i.test(placeType)) {
      score = Math.max(0.1, score - 0.15);
    }

    return Number(score.toFixed(3));
  }

  /** Compara duas strings após normalização (sem acentos, lowercase). */
  private normalizeCompare(a: string, b: string): boolean {
    const norm = (s: string) =>
      s
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
    const na = norm(a);
    const nb = norm(b);
    return na.includes(nb) || nb.includes(na);
  }
}

/** Instância singleton pronta para uso. */
export const nominatimGeocodingProvider = new NominatimGeocodingProvider();
