/**
 * Tipos centrais do sistema de geocodificação (FASE 6).
 *
 * Define o contrato entre provedores (Nominatim, backend futuro, etc.),
 * a camada de serviço, o cache e a persistência na tabela `entregas`.
 */

/**
 * Status do processo de geocodificação de uma entrega.
 * Persistido na coluna `geocoding_status` da tabela `entregas`.
 */
export type GeocodingStatus =
  | 'PENDING'
  | 'GEOCODED'
  | 'FAILED'
  | 'AMBIGUOUS'
  | 'MANUAL';

/** Lista de valores válidos (usada em validação e normalização). */
export const GEOCODING_STATUS_VALUES: readonly GeocodingStatus[] = [
  'PENDING',
  'GEOCODED',
  'FAILED',
  'AMBIGUOUS',
  'MANUAL',
];

/**
 * Confiança mínima para considerar um resultado "não ambíguo".
 * Resultados abaixo desse limite recebem status `AMBIGUOUS` (TASK 6.16).
 */
export const GEOCODING_MIN_CONFIDENCE = 0.7;

/**
 * Endereço normalizado, pronto para consulta no provedor (TASK 6.5).
 * Gerado a partir de uma entrega por `AddressNormalizer`.
 */
export interface NormalizedAddress {
  /** Hash SHA-1 textual do endereço normalizado (chave de cache). */
  hash: string;
  /** String única de busca (ex.: "Rua das Flores, 123, Centro, Maricá, RJ, 24900-000"). */
  query: string;
  /** Componentes desestruturados para fine-tuning se o provedor suportar. */
  components: {
    street?: string;
    number?: string;
    neighborhood?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    country?: string;
  };
}

/**
 * Um candidato retornado pelo provedor de geocodificação.
 * Usado para detectar ambiguidade (TASK 6.16).
 */
export interface GeocodingCandidate {
  latitude: number;
  longitude: number;
  /** Nome/label completo retornado pelo provedor. */
  displayName?: string;
  /** Confiança 0.0..1.0 (se o provedor fornecer; senão inferido por heurística). */
  confidence: number;
  /** Tipo do lugar (amenity, highway, building, residential...). */
  placeClass?: string;
  placeType?: string;
}

/**
 * Resultado final da consulta de geocodificação, após validação,
 * desambiguação e tratamento de erro.
 */
export interface GeocodeResult {
  /** Status final da operação. */
  status: 'GEOCODED' | 'FAILED' | 'AMBIGUOUS';
  /** Coordenadas escolhidas (pode ser undefined se FAILED). */
  latitude?: number;
  longitude?: number;
  /** Confiança do resultado selecionado. */
  confidence?: number;
  /** Candidatos retornados pelo provedor (para debug / UI de desambiguação). */
  candidates?: GeocodingCandidate[];
  /** Endereço formatado retornado pelo provedor (para comparação). */
  matchedAddress?: string;
  /** Motivo da falha ou ambiguidade (TASK 6.15, 6.16). */
  note?: string;
  /** Timestamp ISO da consulta. */
  processedAt: string;
  /** Nome do provedor usado. */
  provider: string;
}

/**
 * Estratégia/Interface de um provedor de geocodificação.
 *
 * Implementado atualmente por `NominatimGeocodingProvider`.
 * No futuro pode ser implementado por `BackendGeocodingProvider`
 * ou qualquer outro provedor (Geoapify, Google, etc.).
 *
 * A implementação DEVE respeitar rate-limits do provedor alvo.
 */
export interface GeocodingProvider {
  /** Identificador legível do provedor (aparece em logs e resultados). */
  readonly name: string;

  /**
   * Consulta coordenadas a partir de um endereço normalizado.
   * Não trata cache nem retry — a camada GeocodingService cuida disso.
   *
   * @throws {Error} Quando houver erro de rede ou do provedor (será tratado
   *                 com retry pela camada superior).
   */
  geocode(address: NormalizedAddress): Promise<GeocodingCandidate[]>;
}

/**
 * Progresso da fila de geocodificação em lote.
 * Emitido pelo `GeocodingQueue` para UI (TASK 6.12).
 */
export interface GeocodingProgress {
  /** Total de entregas para processar no lote. */
  total: number;
  /** Quantidade já processada. */
  completed: number;
  /** Quantidade com sucesso (status = GEOCODED ou MANUAL). */
  successCount: number;
  /** Quantidade de falhas. */
  failedCount: number;
  /** Quantidade de ambíguos. */
  ambiguousCount: number;
  /** Entrega atualmente sendo processada (para exibição na UI). */
  currentName?: string;
  /** 0.0..1.0 (facilita barras de progresso). */
  fraction: number;
}
