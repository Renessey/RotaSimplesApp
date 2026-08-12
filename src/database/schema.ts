/**
 * Definição central do schema do banco SQLite (FASE 5 + FASE 6).
 *
 * A tabela `entregas` agora incorpora colunas para acompanhar o processo
 * de geocodificação (status, confiança, timestamp, nota) da FASE 6.
 *
 * A tabela `deliveries` é o schema legado da FASE 4 (mantida apenas
 * para migração de dados; não é mais criada em instalações novas).
 */

/** Nome da tabela de entregas (novo schema). */
export const ENTREGAS_TABLE = 'entregas';

/** Nome da tabela legada (FASE 4). */
export const LEGACY_DELIVERIES_TABLE = 'deliveries';

/** Nome da tabela de cache offline (chave→valor). */
export const CACHE_TABLE = 'offline_cache';

/**
 * Criação da tabela `entregas` (Task 5.3 + FASE 6) — schema atualizado.
 *
 * Inclui as colunas da FASE 5 (lat/long, status, ordem) e também as
 * colunas de geocodificação da FASE 6:
 *   - geocoding_status   (PENDING | GEOCODED | FAILED | AMBIGUOUS | MANUAL)
 *   - geocoding_confidence (0.0..1.0, null quando não geocodificado)
 *   - geocoding_note     (motivo de falha/ambiguidade)
 *   - geocoded_at        (timestamp de conclusão)
 */
export const CREATE_ENTREGAS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS entregas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    codigo_rastreio TEXT UNIQUE,
    nome_destinatario TEXT,
    telefone TEXT,
    endereco TEXT,
    numero TEXT,
    complemento TEXT,
    bairro TEXT,
    cidade TEXT,
    cep TEXT,
    latitude REAL,
    longitude REAL,
    ordem_entrega INTEGER,
    status TEXT DEFAULT 'PENDENTE',
    observacao TEXT,
    criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
    geocoding_status TEXT DEFAULT 'PENDING',
    geocoding_confidence REAL,
    geocoding_note TEXT,
    geocoded_at DATETIME
  );
`;

/** Índice único de rastreio (reforça a constraint no schema). */
export const CREATE_ENTREGAS_TRACKING_INDEX_SQL = `
  CREATE UNIQUE INDEX IF NOT EXISTS idx_entregas_codigo_rastreio
  ON entregas (codigo_rastreio);
`;

/** Índice de busca por nome/endereço/cidade/CEP. */
export const CREATE_ENTREGAS_SEARCH_INDEX_SQL = `
  CREATE INDEX IF NOT EXISTS idx_entregas_busca
  ON entregas (nome_destinatario, endereco, cidade, cep);
`;

/** Índice para ordenação por rota. */
export const CREATE_ENTREGAS_ORDEM_INDEX_SQL = `
  CREATE INDEX IF NOT EXISTS idx_entregas_ordem
  ON entregas (ordem_entrega);
`;

/**
 * Índice para listar rapidamente entregas pendentes de geocodificação
 * e para reprocessar as que falharam (TASK 6.18).
 */
export const CREATE_ENTREGAS_GEOCODING_INDEX_SQL = `
  CREATE INDEX IF NOT EXISTS idx_entregas_geocoding_status
  ON entregas (geocoding_status);
`;

/** Criação da tabela legada `deliveries` (usada na migração). */
export const CREATE_LEGACY_DELIVERIES_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS deliveries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tracking_code TEXT,
    name TEXT NOT NULL,
    phone TEXT,
    address TEXT NOT NULL,
    number TEXT,
    complement TEXT,
    neighborhood TEXT,
    city TEXT,
    cep TEXT NOT NULL,
    row_number INTEGER,
    sync_status TEXT NOT NULL DEFAULT 'pending',
    created_at INTEGER NOT NULL
  );
`;

/** Criação da tabela de cache offline (chave→valor). */
export const CREATE_CACHE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS offline_cache (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
`;

/* ------------------------------------------------------------------ *
 * ALTER TABLE usados pela MIGRATION v3 (quando schema já existia)
 * ------------------------------------------------------------------ */

/** Migração v3: adicionar coluna geocoding_status. */
export const ALTER_ENTREGAS_ADD_GEOCODING_STATUS_SQL = `
  ALTER TABLE entregas ADD COLUMN geocoding_status TEXT DEFAULT 'PENDING';
`;

/** Migração v3: adicionar coluna geocoding_confidence. */
export const ALTER_ENTREGAS_ADD_GEOCODING_CONFIDENCE_SQL = `
  ALTER TABLE entregas ADD COLUMN geocoding_confidence REAL;
`;

/** Migração v3: adicionar coluna geocoding_note. */
export const ALTER_ENTREGAS_ADD_GEOCODING_NOTE_SQL = `
  ALTER TABLE entregas ADD COLUMN geocoding_note TEXT;
`;

/** Migração v3: adicionar coluna geocoded_at. */
export const ALTER_ENTREGAS_ADD_GEOCODED_AT_SQL = `
  ALTER TABLE entregas ADD COLUMN geocoded_at DATETIME;
`;

/**
 * Verifica se uma coluna existe na tabela entregas (usado para aplicar
 * apenas os ALTER TABLE pendentes).
 */
export function buildColumnExistsSQL(column: string): string {
  return `SELECT 1 AS found FROM pragma_table_info('entregas') WHERE name = '${column}';`;
}
