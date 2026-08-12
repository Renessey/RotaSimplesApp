import { getDatabase } from './database';
import { createAppError } from '../utils/errorHandler';
import { errorReporting } from '../services/errorReporting';
import type { Delivery } from '../types/import';
import type { Entrega, EntregaFilter, DeliveryStatus } from '../types/entrega';
import type { GeocodingStatus } from '../geocoding/types';
import type { OrderAssignment } from '../services/optimization/types';
import { normalizeStatus } from '../status/DeliveryStatus';

/**
 * DeliveryRepository (Tasks 4.15–4.23, FASE 5 — Task 5.4 e FASE 6).
 *
 * Camada de persistência local das entregas no SQLite.
 *
 * FASE 5 (Task 5.4): passa a operar na tabela `entregas` com os métodos:
 *   - createEntrega()
 *   - getEntregas()
 *   - getEntregaById()
 *   - updateEntrega()
 *   - deleteEntrega()
 *
 * FASE 6: adiciona métodos e campos de geocodificação:
 *   - geocoding_status / geocoding_confidence / geocoding_note / geocoded_at
 *   - getEntregasPendingGeocoding()
 *   - getEntregasFailedGeocoding()
 *   - updateEntregaGeocoding()
 *
 * Mantém aliases retrocompatíveis (insertDelivery, listDeliveries, etc.)
 * para não quebrar a UI construída na FASE 4.
 */

/** Opções de filtro para listagem de entregas (retrocompatibilidade). */
export interface DeliveryFilter {
  /** Texto de pesquisa (nome, endereço, cidade, CEP). */
  search?: string;
  /** Filtro por status (novo campo da FASE 5). */
  syncStatus?: Delivery['syncStatus'] | DeliveryStatus;
  /** Limite de resultados (paginação simples). */
  limit?: number;
  /** Deslocamento (paginação). */
  offset?: number;
}

/** Normaliza um GeocodingStatus garantindo valor válido. */
function normalizeGeocodingStatus(
  value: unknown,
): GeocodingStatus | undefined {
  if (typeof value !== 'string') return undefined;
  const valid: readonly string[] = [
    'PENDING',
    'GEOCODED',
    'FAILED',
    'AMBIGUOUS',
    'MANUAL',
  ];
  if (valid.includes(value)) return value as GeocodingStatus;
  return undefined;
}

/** Mapeia uma linha da tabela `entregas` para um objeto `Entrega`. */
function mapRow(row: Record<string, unknown>): Entrega {
  return {
    id: Number(row.id),
    codigoRastreio:
      row.codigo_rastreio != null ? String(row.codigo_rastreio) : undefined,
    nomeDestinatario: String(row.nome_destinatario ?? ''),
    telefone: row.telefone != null ? String(row.telefone) : undefined,
    endereco: String(row.endereco ?? ''),
    numero:
      row.numero != null && row.numero !== ''
        ? String(row.numero)
        : undefined,
    complemento:
      row.complemento != null ? String(row.complemento) : undefined,
    bairro: row.bairro != null ? String(row.bairro) : undefined,
    cidade: row.cidade != null ? String(row.cidade) : undefined,
    cep: String(row.cep ?? ''),
    latitude: row.latitude != null ? Number(row.latitude) : undefined,
    longitude: row.longitude != null ? Number(row.longitude) : undefined,
    ordemEntrega:
      row.ordem_entrega != null ? Number(row.ordem_entrega) : undefined,
    status: normalizeStatus(row.status),
    observacao: row.observacao != null ? String(row.observacao) : undefined,
    criadoEm:
      row.criado_em != null ? String(row.criado_em) : undefined,

    /* ===== FASE 6 ===== */
    geocodingStatus: normalizeGeocodingStatus(row.geocoding_status),
    geocodingConfidence:
      row.geocoding_confidence != null
        ? Number(row.geocoding_confidence)
        : undefined,
    geocodingNote:
      row.geocoding_note != null ? String(row.geocoding_note) : undefined,
    geocodedAt:
      row.geocoded_at != null ? String(row.geocoded_at) : undefined,
  };
}

/** Converte o id de um insert (string | number) para number. */
function toNumber(value: unknown): number {
  return Number(value);
}

/** Detecta erros de constraint UNIQUE / duplicidade. */
function isConstraintError(error: unknown): boolean {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = String((error as { message: string }).message);
    return /UNIQUE|constraint|duplicate/i.test(message);
  }
  return false;
}

/* ------------------------------------------------------------------ *
 * FASE 5 — métodos principais (tabela `entregas`)
 * ------------------------------------------------------------------ */

/**
 * Cria uma entrega na tabela `entregas` (Task 5.4).
 * Impede duplicação por código de rastreio (índice único).
 * @returns a entrega persistida (com `id`), ou `null` se duplicada.
 */
export async function createEntrega(entrega: Entrega): Promise<Entrega | null> {
  const db = getDatabase();

  try {
    if (entrega.codigoRastreio) {
      const existing = await findByCodigoRastreio(entrega.codigoRastreio);
      if (existing) {
        return null;
      }
    }

    const status = normalizeStatus(entrega.status);
    const geocodingStatus = entrega.geocodingStatus ?? 'PENDING';
    const params = [
      entrega.codigoRastreio ?? null,
      entrega.nomeDestinatario,
      entrega.telefone ?? null,
      entrega.endereco,
      entrega.numero ?? null,
      entrega.complemento ?? null,
      entrega.bairro ?? null,
      entrega.cidade ?? null,
      entrega.cep,
      entrega.latitude != null ? entrega.latitude : null,
      entrega.longitude != null ? entrega.longitude : null,
      entrega.ordemEntrega ?? null,
      status,
      entrega.observacao ?? null,
      geocodingStatus,
      entrega.geocodingConfidence != null ? entrega.geocodingConfidence : null,
      entrega.geocodingNote ?? null,
      entrega.geocodedAt ?? null,
    ];

    const result = await db.execute(
      `INSERT INTO entregas
        (codigo_rastreio, nome_destinatario, telefone, endereco, numero,
         complemento, bairro, cidade, cep, latitude, longitude,
         ordem_entrega, status, observacao,
         geocoding_status, geocoding_confidence, geocoding_note, geocoded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      params,
    );

    const insertId = result.insertId;
    if (insertId === undefined || insertId === null) {
      throw createAppError('Falha ao obter o id da entrega inserida.', {
        category: 'database',
        severity: 'error',
        code: 'DATABASE_ERROR',
      });
    }

    return { ...entrega, id: toNumber(insertId), status, geocodingStatus };
  } catch (error) {
    if (isConstraintError(error)) {
      return null;
    }
    errorReporting.report(error, {
      context: 'DeliveryRepository.createEntrega',
      deliveryName: entrega.nomeDestinatario,
    });
    throw error;
  }
}

/** Busca uma entrega pelo id (Task 5.4). */
export async function getEntregaById(id: number): Promise<Entrega | null> {
  const db = getDatabase();
  const result = await db.execute(
    'SELECT * FROM entregas WHERE id = ? LIMIT 1;',
    [id],
  );
  const row = result.rows[0];
  return row ? mapRow(row) : null;
}

/** Lista entregas com filtro e paginação (Task 5.4 + FASE 6). */
export async function getEntregas(
  filter: EntregaFilter = {},
): Promise<Entrega[]> {
  const db = getDatabase();

  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (filter.search) {
    const term = `%${filter.search}%`;
    conditions.push(
      `(nome_destinatario LIKE ? OR endereco LIKE ? OR bairro LIKE ? OR cidade LIKE ? OR cep LIKE ? OR codigo_rastreio LIKE ?)`,
    );
    params.push(term, term, term, term, term, term);
  }

  if (filter.status) {
    conditions.push('status = ?');
    params.push(normalizeStatus(filter.status));
  }

  if (filter.geocodingStatus) {
    conditions.push('geocoding_status = ?');
    params.push(filter.geocodingStatus);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = filter.limit ?? 500;
  const offset = filter.offset ?? 0;

  const sql = `SELECT * FROM entregas ${where} ORDER BY ordem_entrega ASC, id DESC LIMIT ? OFFSET ?;`;
  params.push(limit, offset);

  const result = await db.execute(sql, params);
  const rows = result.rows;
  const entregas: Entrega[] = [];
  if (rows) {
    for (const row of rows) {
      entregas.push(mapRow(row));
    }
  }
  return entregas;
}

/** Atualiza campos de uma entrega existente (Task 5.4 + FASE 6). */
export async function updateEntrega(
  id: number,
  updates: Partial<Entrega>,
): Promise<Entrega | null> {
  const db = getDatabase();

  const existing = await getEntregaById(id);
  if (!existing) {
    return null;
  }

  const merged: Entrega = {
    ...existing,
    ...updates,
    id,
  };

  const status = normalizeStatus(merged.status);
  const geocodingStatus = merged.geocodingStatus ?? 'PENDING';

  try {
    await db.execute(
      `UPDATE entregas SET
         codigo_rastreio = ?, nome_destinatario = ?, telefone = ?,
         endereco = ?, numero = ?, complemento = ?, bairro = ?,
         cidade = ?, cep = ?, latitude = ?, longitude = ?,
         ordem_entrega = ?, status = ?, observacao = ?,
         geocoding_status = ?, geocoding_confidence = ?, geocoding_note = ?, geocoded_at = ?
       WHERE id = ?;`,
      [
        merged.codigoRastreio ?? null,
        merged.nomeDestinatario,
        merged.telefone ?? null,
        merged.endereco,
        merged.numero ?? null,
        merged.complemento ?? null,
        merged.bairro ?? null,
        merged.cidade ?? null,
        merged.cep,
        merged.latitude != null ? merged.latitude : null,
        merged.longitude != null ? merged.longitude : null,
        merged.ordemEntrega ?? null,
        status,
        merged.observacao ?? null,
        geocodingStatus,
        merged.geocodingConfidence != null ? merged.geocodingConfidence : null,
        merged.geocodingNote ?? null,
        merged.geocodedAt ?? null,
        id,
      ],
    );
  } catch (error) {
    if (isConstraintError(error)) {
      return null;
    }
    errorReporting.report(error, {
      context: 'DeliveryRepository.updateEntrega',
      deliveryName: merged.nomeDestinatario,
    });
    throw error;
  }

  return getEntregaById(id);
}

/** Exclui uma entrega pelo id (Task 5.4). Retorna true se excluiu. */
export async function deleteEntrega(id: number): Promise<boolean> {
  const db = getDatabase();
  const result = await db.execute('DELETE FROM entregas WHERE id = ?;', [id]);
  return (result.rowsAffected ?? 0) > 0;
}

/** Conta o total de entregas na tabela `entregas`. */
export async function countEntregas(): Promise<number> {
  const db = getDatabase();
  const result = await db.execute('SELECT COUNT(*) AS total FROM entregas;');
  const row = result.rows[0];
  return row ? Number(row.total) : 0;
}

/** Conta entregas por status de geocodificação. */
export async function countEntregasByGeocodingStatus(): Promise<
  Record<string, number>
> {
  const db = getDatabase();
  const result = await db.execute(
    `SELECT geocoding_status, COUNT(*) AS total
       FROM entregas
      GROUP BY geocoding_status;`,
  );
  const counts: Record<string, number> = {
    PENDING: 0,
    GEOCODED: 0,
    FAILED: 0,
    AMBIGUOUS: 0,
    MANUAL: 0,
  };
  for (const row of result.rows) {
    const key = String(row.geocoding_status ?? 'PENDING');
    counts[key] = Number(row.total ?? 0);
  }
  return counts;
}

/** Exclui todas as entregas (limpar importação). */
export async function clearEntregas(): Promise<number> {
  const db = getDatabase();
  const result = await db.execute('DELETE FROM entregas;');
  return result.rowsAffected ?? 0;
}

/** Busca uma entrega pelo código de rastreio. */
async function findByCodigoRastreio(
  codigoRastreio: string,
): Promise<Entrega | undefined> {
  const db = getDatabase();
  const result = await db.execute(
    'SELECT * FROM entregas WHERE codigo_rastreio = ? LIMIT 1;',
    [codigoRastreio],
  );
  const row = result.rows[0];
  return row ? mapRow(row) : undefined;
}

/* ------------------------------------------------------------------ *
 * FASE 6 — métodos específicos de geocodificação
 * ------------------------------------------------------------------ */

/**
 * TASK 6.9 / 6.18: Lista entregas ainda sem coordenadas válidas
 * (status = PENDING ou FAILED, para serem reprocessadas).
 */
export async function getEntregasPendingGeocoding(): Promise<Entrega[]> {
  return getEntregas({ geocodingStatus: 'PENDING' });
}

/* ------------------------------------------------------------------ *
 * FASE 9 — método de bulk update de ordem_entrega (TASK 9.6 / 9.7).
 * ------------------------------------------------------------------ */

/**
 * Atualiza `ordem_entrega` para vários IDs em uma ÚNICA transação.
 *
 * Ex.: [{entregaId: 17, ordem: 1}, {entregaId: 22, ordem: 2}, ...]
 *
 * IDs que não existem na tabela são simplesmente ignorados.
 * Valores de ordem repetidos são permitidos (não conferimos unicidade).
 */
export async function bulkUpdateOrdemEntrega(
  assignments: ReadonlyArray<OrderAssignment>,
): Promise<number> {
  if (assignments.length === 0) return 0;
  const db = getDatabase();
  try {
    await db.execute('BEGIN TRANSACTION;');
    let rowsAffected = 0;
    for (const a of assignments) {
      const r = await db.execute(
        'UPDATE entregas SET ordem_entrega = ? WHERE id = ?;',
        [a.ordem, a.entregaId],
      );
      rowsAffected += r.rowsAffected ?? 0;
    }
    await db.execute('COMMIT;');
    return rowsAffected;
  } catch (error) {
    try {
      await db.execute('ROLLBACK;');
    } catch {
      /* no-op: rollback também falhou */
    }
    errorReporting.report(error, {
      context: 'DeliveryRepository.bulkUpdateOrdemEntrega',
      total: assignments.length,
    });
    throw error;
  }
}

/**
 * TASK 6.18: Lista entregas que falharam na geocodificação
 * (para reprocessamento seletivo).
 */
export async function getEntregasFailedGeocoding(): Promise<Entrega[]> {
  const db = getDatabase();
  const result = await db.execute(
    `SELECT * FROM entregas
      WHERE geocoding_status = 'FAILED'
         OR geocoding_status = 'AMBIGUOUS'
      ORDER BY id ASC;`,
  );
  const entregas: Entrega[] = [];
  for (const row of result.rows) {
    entregas.push(mapRow(row));
  }
  return entregas;
}

/**
 * TASK 6.8, 6.15, 6.16, 6.17: Atualiza apenas os campos de geocodificação
 * de uma entrega (mais leve e semântico do que `updateEntrega` genérico).
 */
export async function updateEntregaGeocoding(
  id: number,
  patch: {
    latitude?: number | null;
    longitude?: number | null;
    geocodingStatus?: GeocodingStatus;
    geocodingConfidence?: number | null;
    geocodingNote?: string | null;
    geocodedAt?: string | null;
  },
): Promise<Entrega | null> {
  const existing = await getEntregaById(id);
  if (!existing) return null;

  const nextGeocodedAt =
    patch.geocodedAt === null
      ? undefined
      : patch.geocodedAt ?? new Date().toISOString();

  return updateEntrega(id, {
    latitude:
      patch.latitude === null
        ? undefined
        : patch.latitude ?? existing.latitude,
    longitude:
      patch.longitude === null
        ? undefined
        : patch.longitude ?? existing.longitude,
    geocodingStatus: patch.geocodingStatus ?? existing.geocodingStatus,
    geocodingConfidence:
      patch.geocodingConfidence === null
        ? undefined
        : patch.geocodingConfidence ?? existing.geocodingConfidence,
    geocodingNote:
      patch.geocodingNote === null
        ? undefined
        : patch.geocodingNote ?? existing.geocodingNote,
    geocodedAt: nextGeocodedAt,
  });
}

/* ------------------------------------------------------------------ *
 * Aliases retrocompatíveis (FASE 4) — mantêm a UI funcionando.
 * ------------------------------------------------------------------ */

/** Converte uma `Delivery` (FASE 4) em uma `Entrega` (FASE 5). */
function deliveryToEntrega(delivery: Delivery): Entrega {
  let status: DeliveryStatus = 'PENDENTE';
  if (delivery.syncStatus === 'synced') {
    status = 'ENTREGUE';
  }
  return {
    codigoRastreio: delivery.trackingCode,
    nomeDestinatario: delivery.name,
    telefone: delivery.phone,
    endereco: delivery.address,
    numero: delivery.number != null ? String(delivery.number) : undefined,
    complemento: delivery.complement,
    bairro: delivery.neighborhood,
    cidade: delivery.city,
    cep: delivery.cep,
    status,
    criadoEm: delivery.createdAt
      ? new Date(delivery.createdAt).toISOString()
      : undefined,
  };
}

/** Converte uma `Entrega` (FASE 5) em uma `Delivery` (FASE 4). */
function entregaToDelivery(entrega: Entrega): Delivery {
  const syncStatus =
    entrega.status === 'ENTREGUE' ? 'synced' : 'pending';
  return {
    id: entrega.id,
    trackingCode: entrega.codigoRastreio,
    name: entrega.nomeDestinatario,
    phone: entrega.telefone,
    address: entrega.endereco,
    number: entrega.numero ?? undefined,
    complement: entrega.complemento,
    neighborhood: entrega.bairro,
    city: entrega.cidade,
    cep: entrega.cep,
    syncStatus,
  };
}

/** Insere uma entrega (alias de `createEntrega`). */
export async function insertDelivery(delivery: Delivery): Promise<Delivery | null> {
  const created = await createEntrega(deliveryToEntrega(delivery));
  return created ? entregaToDelivery(created) : null;
}

/** Insere em lote (alias). Retorna quantas foram realmente inseridas. */
export async function insertDeliveries(deliveries: Delivery[]): Promise<number> {
  let inserted = 0;
  for (const delivery of deliveries) {
    const result = await insertDelivery(delivery);
    if (result) {
      inserted += 1;
    }
  }
  return inserted;
}

/** Lista entregas (alias de `getEntregas`). */
export async function listDeliveries(
  filter: DeliveryFilter = {},
): Promise<Delivery[]> {
  const entregas = await getEntregas({
    search: filter.search,
    status: filter.syncStatus as DeliveryStatus | undefined,
    limit: filter.limit,
    offset: filter.offset,
  });
  return entregas.map(entregaToDelivery);
}

/** Conta o total (alias de `countEntregas`). */
export async function countDeliveries(): Promise<number> {
  return countEntregas();
}

/** Exclui uma entrega (alias de `deleteEntrega`). */
export async function deleteDelivery(id: number): Promise<boolean> {
  return deleteEntrega(id);
}

/** Exclui todas as entregas (alias de `clearEntregas`). */
export async function clearDeliveries(): Promise<number> {
  return clearEntregas();
}
