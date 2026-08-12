/**
 * Tipos do modelo de entrega (FASE 5 + FASE 6).
 *
 * Modelo em Português, espelhando o schema da tabela `entregas` do SQLite.
 * Representa o domínio de negócio da entrega (status, localização, ordem),
 * evoluindo a partir do `Delivery` da FASE 4.
 *
 * FASE 6: adiciona campos para acompanhar o processo de geocodificação
 * (status de geocodificação, confiança, timestamp, nota).
 */

import type { GeocodingStatus } from '../geocoding/types';

/** Status de uma entrega (Task 5.7 + FASE 7). */
export type DeliveryStatus =
  | 'PENDENTE'
  | 'EM_TRANSITO'
  | 'ENTREGUE'
  | 'FALHOU'
  | 'INFRUTIFERO'
  | 'CANCELADA';

/** Conjunto de status válidos. */
export const DELIVERY_STATUS_VALUES: readonly DeliveryStatus[] = [
  'PENDENTE',
  'EM_TRANSITO',
  'ENTREGUE',
  'FALHOU',
  'INFRUTIFERO',
  'CANCELADA',
];

/** Entrega persistida na tabela `entregas`. */
export interface Entrega {
  /** Identificador local (gerado pelo SQLite). */
  id?: number;
  /** Código de rastreio (opcional, único). */
  codigoRastreio?: string;
  /** Nome do destinatário. */
  nomeDestinatario: string;
  /** Telefone (opcional). */
  telefone?: string;
  /** Endereço (logradouro). */
  endereco: string;
  /** Número do endereço (opcional). */
  numero?: string;
  /** Complemento (opcional). */
  complemento?: string;
  /** Bairro (opcional). */
  bairro?: string;
  /** Cidade (opcional). */
  cidade?: string;
  /** CEP (8 dígitos). */
  cep: string;
  /** Latitude da entrega (após geocodificação). */
  latitude?: number;
  /** Longitude da entrega (após geocodificação). */
  longitude?: number;
  /** Ordem de entrega na rota (1-based). */
  ordemEntrega?: number;
  /** Status atual da entrega. */
  status?: DeliveryStatus;
  /** Observação (opcional). */
  observacao?: string;
  /** Timestamp (ISO) de criação. */
  criadoEm?: string;

  /* ===== CAMPOS DA FASE 6 - Geocodificação ===== */

  /** Status do processo de geocodificação (TASK 6.9 / 6.15 / 6.16). */
  geocodingStatus?: GeocodingStatus;
  /** Confiança do resultado (0.0..1.0). Abaixo de 0.7 = ambíguo (TASK 6.16). */
  geocodingConfidence?: number;
  /** Nota/motivo: descrição da falha ou ambiguidade detectada (TASK 6.15 / 6.16). */
  geocodingNote?: string;
  /** Timestamp (ISO) de conclusão da geocodificação (TASK 6.20). */
  geocodedAt?: string;
}

/** Filtros de listagem de entregas. */
export interface EntregaFilter {
  /** Texto de pesquisa (nome, endereço, cidade, CEP, rastreio). */
  search?: string;
  /** Filtro por status. */
  status?: DeliveryStatus;
  /** Filtro por status de geocodificação (FASE 6). */
  geocodingStatus?: GeocodingStatus;
  /** Limite de resultados. */
  limit?: number;
  /** Deslocamento. */
  offset?: number;
}

export type { GeocodingStatus };
