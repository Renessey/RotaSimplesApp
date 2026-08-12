import type { DB } from '@op-engineering/op-sqlite';
import { errorReporting } from '../services/errorReporting';
import { createAppError } from '../utils/errorHandler';
import {
  ALTER_ENTREGAS_ADD_GEOCODED_AT_SQL,
  ALTER_ENTREGAS_ADD_GEOCODING_CONFIDENCE_SQL,
  ALTER_ENTREGAS_ADD_GEOCODING_NOTE_SQL,
  ALTER_ENTREGAS_ADD_GEOCODING_STATUS_SQL,
  buildColumnExistsSQL,
  CREATE_CACHE_TABLE_SQL,
  CREATE_ENTREGAS_GEOCODING_INDEX_SQL,
  CREATE_ENTREGAS_ORDEM_INDEX_SQL,
  CREATE_ENTREGAS_SEARCH_INDEX_SQL,
  CREATE_ENTREGAS_TABLE_SQL,
  CREATE_ENTREGAS_TRACKING_INDEX_SQL,
  CREATE_LEGACY_DELIVERIES_TABLE_SQL,
} from './schema';

/**
 * Sistema de migrations (Task 5.2 + FASE 6).
 *
 * Usa `PRAGMA user_version` para versionar o schema. Cada migração é aplicada
 * em ordem atômica e o versionamento é incrementado após sucesso.
 *
 * Migração 1: cria a tabela `entregas` (schema da Task 5.3) + índices + cache.
 * Migração 2: migra dados da tabela legada `deliveries` (FASE 4) para `entregas`.
 * Migração 3: adiciona colunas de geocodificação da FASE 6.
 */

interface Migration {
  version: number;
  name: string;
  up: (db: DB) => void;
}

/** Lê a versão atual do schema. */
function getVersion(db: DB): number {
  const result = db.executeSync('PRAGMA user_version;');
  const row = result.rows[0];
  return row ? Number(row.user_version) : 0;
}

/** Define a versão do schema. */
function setVersion(db: DB, version: number): void {
  db.executeSync(`PRAGMA user_version = ${version};`);
}

/** Verifica se uma tabela existe. */
function tableExists(db: DB, name: string): boolean {
  const result = db.executeSync(
    "SELECT name FROM sqlite_master WHERE type='table' AND name = ?;",
    [name],
  );
  return result.rows.length > 0;
}

/** Verifica se uma coluna existe em `entregas`. */
function columnExistsInEntregas(db: DB, column: string): boolean {
  const result = db.executeSync(buildColumnExistsSQL(column));
  return result.rows.length > 0;
}

/** Aplica um ALTER TABLE apenas se a coluna não existir. */
function addColumnIfMissing(db: DB, column: string, sql: string): void {
  if (!columnExistsInEntregas(db, column)) {
    db.executeSync(sql);
  }
}

/** Migrations registradas (em ordem crescente de versão). */
const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'cria_tabela_entregas',
    up: (db) => {
      db.executeSync(CREATE_ENTREGAS_TABLE_SQL);
      db.executeSync(CREATE_ENTREGAS_TRACKING_INDEX_SQL);
      db.executeSync(CREATE_ENTREGAS_SEARCH_INDEX_SQL);
      db.executeSync(CREATE_ENTREGAS_ORDEM_INDEX_SQL);
      db.executeSync(CREATE_CACHE_TABLE_SQL);
    },
  },
  {
    version: 2,
    name: 'migra_dados_deliveries_para_entregas',
    up: (db) => {
      db.executeSync(CREATE_LEGACY_DELIVERIES_TABLE_SQL);

      if (!tableExists(db, 'deliveries')) {
        return;
      }

      db.executeSync(`
        INSERT OR IGNORE INTO entregas (
          codigo_rastreio,
          nome_destinatario,
          telefone,
          endereco,
          numero,
          complemento,
          bairro,
          cidade,
          cep,
          status,
          criado_em
        )
        SELECT
          d.tracking_code,
          d.name,
          d.phone,
          d.address,
          d.number,
          d.complement,
          d.neighborhood,
          d.city,
          d.cep,
          CASE
            WHEN d.sync_status = 'synced' THEN 'ENTREGUE'
            ELSE 'PENDENTE'
          END,
          datetime(d.created_at / 1000, 'unixepoch')
        FROM deliveries d
        WHERE d.cep IS NOT NULL AND d.cep <> '';
      `);
    },
  },
  {
    version: 3,
    name: 'adiciona_colunas_geocodificacao_fase6',
    up: (db) => {
      addColumnIfMissing(db, 'geocoding_status', ALTER_ENTREGAS_ADD_GEOCODING_STATUS_SQL);
      addColumnIfMissing(db, 'geocoding_confidence', ALTER_ENTREGAS_ADD_GEOCODING_CONFIDENCE_SQL);
      addColumnIfMissing(db, 'geocoding_note', ALTER_ENTREGAS_ADD_GEOCODING_NOTE_SQL);
      addColumnIfMissing(db, 'geocoded_at', ALTER_ENTREGAS_ADD_GEOCODED_AT_SQL);
      db.executeSync(CREATE_ENTREGAS_GEOCODING_INDEX_SQL);

      // Para entregas que já possuem latitude/longitude definidas
      // (caso o usuário já tenha importado algo em fases anteriores),
      // marcamos como GEOCODED para evitar re-processamento desnecessário.
      db.executeSync(`
        UPDATE entregas
        SET geocoding_status = 'GEOCODED',
            geocoded_at = COALESCE(geocoded_at, criado_em, CURRENT_TIMESTAMP)
        WHERE geocoding_status IS NULL
           OR geocoding_status = 'PENDING'
           AND latitude IS NOT NULL
           AND longitude IS NOT NULL;
      `);
    },
  },
];

/**
 * Aplica todas as migrations pendentes.
 * Deve ser chamado uma vez, após abrir a conexão com o banco.
 */
export function runMigrations(db: DB): void {
  const current = getVersion(db);

  for (const migration of MIGRATIONS) {
    if (migration.version <= current) {
      continue;
    }

    try {
      migration.up(db);
      setVersion(db, migration.version);
    } catch (error) {
      errorReporting.report(error, {
        context: 'migrations.run',
        migration: migration.name,
        version: migration.version,
      });
      throw createAppError(
        `Falha ao aplicar a migração "${migration.name}" (v${migration.version}).`,
        {
          category: 'database',
          severity: 'critical',
          code: 'DATABASE_MIGRATION_ERROR',
          userMessage: 'Não foi possível atualizar o banco de dados local.',
        },
      );
    }
  }
}
