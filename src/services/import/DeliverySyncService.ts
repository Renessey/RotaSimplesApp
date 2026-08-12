import { config } from '../../config/env';
import { createAppError } from '../../utils/errorHandler';
import { errorReporting } from '../errorReporting';
import type { Delivery } from '../../types/import';
import type { Entrega, DeliveryStatus } from '../../types/entrega';
import { normalizeStatus } from '../../status/DeliveryStatus';

/**
 * DeliverySyncService (Task 4.24 e FASE 5 — Task 5.5).
 *
 * Camada de preparação para futura sincronização com a API.
 *
 * Atualmente as entregas são persistidas apenas no SQLite local. Este serviço
 * expõe o contrato que será usado quando houver backend:
 *  - `syncDelivery(delivery)`: envia uma entrega para o endpoint configurado.
 *  - `buildSyncPayload(delivery)`: monta o payload JSON tipado a ser enviado.
 *
 * FASE 5 (Task 5.5): o payload incorpora o novo schema (status, latitude,
 * longitude e ordem de entrega), compatível com o modelo `Entrega`.
 *
 * O endpoint base vem de `config.apiUrl` (variável `API_URL` no `.env`).
 */

/** Resposta esperada do backend ao receber uma entrega. */
export interface SyncResult {
  /** Se a sincronização foi bem-sucedida. */
  success: boolean;
  /** Id retornado pelo backend (quando aplicável). */
  remoteId?: string;
  /** Mensagem de erro (quando falhou). */
  errorMessage?: string;
}

/** Retorna o endpoint de entregas a partir da URL base. */
function getDeliveriesEndpoint(): string {
  const base = config.apiUrl.replace(/\/+$/, '');
  return `${base}/deliveries`;
}

/**
 * Monta o payload JSON tipado de uma entrega `Delivery` (FASE 4) para envio.
 * PONTO DE EXTENSÃO: ajuste os nomes dos campos conforme o contrato da API.
 */
export function buildSyncPayload(delivery: Delivery): Record<string, unknown> {
  return {
    trackingCode: delivery.trackingCode ?? null,
    name: delivery.name,
    phone: delivery.phone ?? null,
    address: delivery.address,
    number: delivery.number != null ? String(delivery.number) : null,
    complement: delivery.complement ?? null,
    neighborhood: delivery.neighborhood ?? null,
    city: delivery.city ?? null,
    cep: delivery.cep,
    status: 'pending',
  };
}

/**
 * Monta o payload JSON tipado de uma `Entrega` (FASE 5) para envio futuro.
 *
 * Inclui o novo schema (status, latitude, longitude e ordem de entrega),
 * conforme a Task 5.5.
 */
export function buildEntregaSyncPayload(
  entrega: Entrega,
): Record<string, unknown> {
  const status: DeliveryStatus = normalizeStatus(entrega.status);
  return {
    codigoRastreio: entrega.codigoRastreio ?? null,
    nomeDestinatario: entrega.nomeDestinatario,
    telefone: entrega.telefone ?? null,
    endereco: entrega.endereco,
    numero: entrega.numero ?? null,
    complemento: entrega.complemento ?? null,
    bairro: entrega.bairro ?? null,
    cidade: entrega.cidade ?? null,
    cep: entrega.cep,
    latitude: entrega.latitude ?? null,
    longitude: entrega.longitude ?? null,
    ordemEntrega: entrega.ordemEntrega ?? null,
    status,
    observacao: entrega.observacao ?? null,
  };
}

/**
 * Envia uma `Entrega` (FASE 5) para o backend.
 * Preparado para uso futuro na sincronização com a API.
 */
export async function syncEntrega(entrega: Entrega): Promise<SyncResult> {
  try {
    const endpoint = getDeliveriesEndpoint();
    const payload = buildEntregaSyncPayload(entrega);

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      return {
        success: false,
        errorMessage: `Falha na sincronização (HTTP ${response.status}).`,
      };
    }

    const data = (await response.json()) as { id?: string | number };
    return {
      success: true,
      remoteId: data.id != null ? String(data.id) : undefined,
    };
  } catch (error) {
    errorReporting.report(error, {
      context: 'DeliverySyncService.syncEntrega',
      deliveryName: entrega.nomeDestinatario,
    });
    return {
      success: false,
      errorMessage:
        error instanceof Error ? error.message : 'Erro de rede ao sincronizar.',
    };
  }
}

/**
 * Sincroniza em lote de `Entrega`s (preparado para uso futuro).
 * Retorna a contagem de sucessos e falhas.
 */
export async function syncEntregas(
  entregas: Entrega[],
): Promise<{ synced: number; failed: number }> {
  let synced = 0;
  let failed = 0;
  for (const entrega of entregas) {
    const result = await syncEntrega(entrega);
    if (result.success) {
      synced += 1;
    } else {
      failed += 1;
    }
  }
  return { synced, failed };
}

/**
 * Envia uma entrega para o backend (e merge de estado local).
 *
 * IMPORTANTE: este método NÃO é chamado hoje (o fluxo atual é 100% local).
 * Ele fica pronto para quando a sincronização com a API for implementada.
 */
export async function syncDelivery(delivery: Delivery): Promise<SyncResult> {
  try {
    const endpoint = getDeliveriesEndpoint();
    const payload = buildSyncPayload(delivery);

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      return {
        success: false,
        errorMessage: `Falha na sincronização (HTTP ${response.status}).`,
      };
    }

    const data = (await response.json()) as { id?: string | number };
    return {
      success: true,
      remoteId: data.id != null ? String(data.id) : undefined,
    };
  } catch (error) {
    errorReporting.report(error, {
      context: 'DeliverySyncService.syncDelivery',
      deliveryName: delivery.name,
    });
    return {
      success: false,
      errorMessage:
        error instanceof Error ? error.message : 'Erro de rede ao sincronizar.',
    };
  }
}

/**
 * Sincroniza em lote (preparado para uso futuro).
 * Retorna a contagem de sucessos e falhas.
 */
export async function syncDeliveries(
  deliveries: Delivery[],
): Promise<{ synced: number; failed: number }> {
  let synced = 0;
  let failed = 0;
  for (const delivery of deliveries) {
    const result = await syncDelivery(delivery);
    if (result.success) {
      synced += 1;
    } else {
      failed += 1;
    }
  }
  return { synced, failed };
}

/** Lança um erro tipado se a URL da API não estiver configurada. */
export function requireApiUrl(): string {
  if (!config.apiUrl) {
    throw createAppError('API_URL não configurada.', {
      category: 'api',
      severity: 'error',
      code: 'API_UNKNOWN',
      userMessage: 'A URL da API não está configurada.',
    });
  }
  return config.apiUrl;
}
