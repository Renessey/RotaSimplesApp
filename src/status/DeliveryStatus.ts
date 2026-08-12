import type { DeliveryStatus } from '../types/entrega';
import { DELIVERY_STATUS_VALUES } from '../types/entrega';

/**
 * Controle de status das entregas (Task 5.7).
 *
 * Centraliza a definição dos status válidos, as transições permitidas e
 * helpers para exibição (rótulos e cores).
 */

/** Transições válidas entre status (chave = status atual). */
const TRANSITIONS: Record<DeliveryStatus, readonly DeliveryStatus[]> = {
  PENDENTE: ['EM_TRANSITO', 'ENTREGUE', 'FALHOU', 'INFRUTIFERO', 'CANCELADA'],
  EM_TRANSITO: ['ENTREGUE', 'FALHOU', 'INFRUTIFERO', 'CANCELADA', 'PENDENTE'],
  ENTREGUE: [],
  FALHOU: ['EM_TRANSITO', 'ENTREGUE', 'PENDENTE'],
  INFRUTIFERO: ['EM_TRANSITO', 'ENTREGUE', 'PENDENTE'],
  CANCELADA: ['PENDENTE'],
};

/** Rótulos de exibição (PT-BR). */
export const STATUS_LABELS: Record<DeliveryStatus, string> = {
  PENDENTE: 'Pendente',
  EM_TRANSITO: 'Em trânsito',
  ENTREGUE: 'Entregue',
  FALHOU: 'Falhou',
  INFRUTIFERO: 'Infrutífero',
  CANCELADA: 'Cancelada',
};

/** Cores associadas a cada status (para badges na UI). */
export const STATUS_COLORS: Record<DeliveryStatus, string> = {
  PENDENTE: '#d97706', // âmbar
  EM_TRANSITO: '#2563eb', // azul
  ENTREGUE: '#16a34a', // verde
  FALHOU: '#dc2626', // vermelho
  INFRUTIFERO: '#7c3aed', // roxo
  CANCELADA: '#64748b', // cinza
};

/** Status inicial de uma entrega recém-criada. */
export const DEFAULT_STATUS: DeliveryStatus = 'PENDENTE';

/** Verifica se um valor é um status válido. */
export function isDeliveryStatus(value: unknown): value is DeliveryStatus {
  return (
    typeof value === 'string' &&
    (DELIVERY_STATUS_VALUES as readonly string[]).includes(value)
  );
}

/** Normaliza um status desconhecido para um status válido (fallback PENDENTE). */
export function normalizeStatus(value: unknown): DeliveryStatus {
  return isDeliveryStatus(value) ? value : DEFAULT_STATUS;
}

/** Verifica se uma transição de status é permitida. */
export function canTransition(
  from: DeliveryStatus,
  to: DeliveryStatus,
): boolean {
  if (from === to) {
    return true;
  }
  return TRANSITIONS[from].includes(to);
}

/** Valida uma transição e retorna true se for válida. */
export function assertTransition(
  from: DeliveryStatus,
  to: DeliveryStatus,
): boolean {
  return canTransition(from, to);
}

/** Retorna todos os status válidos. */
export function getAllStatuses(): readonly DeliveryStatus[] {
  return DELIVERY_STATUS_VALUES;
}

/** Estado final (não possui transições de saída). */
export function isTerminal(status: DeliveryStatus): boolean {
  return TRANSITIONS[status].length === 0;
}
