import { open, type DB } from '@op-engineering/op-sqlite';
import { createAppError } from '../utils/errorHandler';
import { errorReporting } from '../services/errorReporting';
import { runMigrations } from './migrations';

/**
 * Camada de conexão com o banco SQLite local (Tasks 4.16, 5.1, 5.2).
 *
 *  - 4.16: cria o banco SQLite local (via op-sqlite).
 *  - 5.1: mantém o banco SQLite local (singleton `getDatabase()`).
 *  - 5.2: aplica migrations versionadas na inicialização.
 *
 * Usa `@op-engineering/op-sqlite` (mantido, compatível com New Architecture
 * e RN CLI), substituindo `react-native-sqlite-storage` (descontinuado e
 * incompatível com o Gradle moderno — usava `jcenter()` removido).
 */

const DB_NAME = 'entregaapp.db';

let dbInstance: DB | null = null;

/**
 * Obtém (e cria, se necessário) a conexão com o banco SQLite.
 * A conexão é um singleton compartilhado pela aplicação.
 */
export function getDatabase(): DB {
  if (!dbInstance) {
    try {
      dbInstance = open({ name: DB_NAME });
      initialize(dbInstance);
    } catch (error) {
      errorReporting.report(error, {
        context: 'database.getDatabase.open',
      });
      throw createAppError('Não foi possível abrir o banco de dados.', {
        category: 'database',
        severity: 'critical',
        code: 'DATABASE_ERROR',
        userMessage: 'Não foi possível abrir o banco de dados local.',
      });
    }
  }
  return dbInstance;
}

/** Aplica as migrations na primeira execução. */
function initialize(db: DB): void {
  try {
    runMigrations(db);
  } catch (error) {
    errorReporting.report(error, {
      context: 'database.initialize',
    });
    throw createAppError('Não foi possível inicializar o banco de dados.', {
      category: 'database',
      severity: 'critical',
      code: 'DATABASE_ERROR',
      userMessage: 'Não foi possível inicializar o banco de dados local.',
    });
  }
}

/** Retorna o nome do banco de dados aberto (para diagnóstico). */
export function getDatabaseName(): string {
  return DB_NAME;
}
