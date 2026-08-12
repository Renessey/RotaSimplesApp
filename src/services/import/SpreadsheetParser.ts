import * as XLSX from 'xlsx';
import { createAppError } from '../../utils/errorHandler';
import { errorReporting } from '../errorReporting';
import {
  COLUMN_HEADERS,
  REQUIREED_COLUMNS,
} from '../../types/import';
import type {
  Delivery,
  DetectedColumn,
  ImportColumnId,
  RowValidationError,
  SpreadsheetParseResult,
} from '../../types/import';

/**
 * SpreadsheetParser (Tasks 4.7–4.11).
 *
 * Conversor de planilhas (XLSX/CSV) em objetos TypeScript `Delivery`:
 *  - 4.8: converte a planilha em objetos TypeScript.
 *  - 4.9: detecta colunas automaticamente (cabeçalhos PT-BR).
 *  - 4.10: normaliza dados (trim, CEP só dígitos, etc.).
 *  - 4.11: valida registros (obrigatórios Nome, Endereço, CEP + CEP válido).
 */

/** Normaliza um texto: remove acentos, caixa baixa e espaços extras. */
function normalizeHeader(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/** Remove acentos de um texto mantendo a forma original (para normalização de valores). */
function onlyDigits(value: string): string {
  return value.replace(/\D/g, '');
}

/** Limpa um valor vindo da célula para um texto simples. */
function cellToString(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

/** Normaliza um campo genérico (trim). */
function normalizeText(value: unknown): string {
  return cellToString(value);
}

/**
 * Detecta automaticamente as colunas da planilha a partir da primeira linha
 * (cabeçalho), comparando com a lista de cabeçalhos aceitos em PT-BR.
 */
function detectColumns(headerRow: unknown[]): DetectedColumn[] {
  const detected: DetectedColumn[] = [];

  headerRow.forEach((cell, index) => {
    const headerText = normalizeHeader(cellToString(cell));
    if (!headerText) return;

    // Procura em qual coluna conhecida este cabeçalho corresponde.
    for (const [columnId, aliases] of Object.entries(COLUMN_HEADERS)) {
      const hit = aliases.some((alias) => normalizeHeader(alias) === headerText);
      if (hit) {
        // Evita detectar a mesma coluna duas vezes.
        if (!detected.some((c) => c.id === (columnId as ImportColumnId))) {
          detected.push({
            id: columnId as ImportColumnId,
            header: cellToString(cell),
            index,
          });
        }
        break;
      }
    }
  });

  return detected;
}

/**
 * Normaliza um CEP garantindo apenas 8 dígitos.
 * Aceita formatos como "12345678", "12.345-678", "12345-678".
 */
function normalizeCep(value: unknown): string {
  const digits = onlyDigits(cellToString(value));
  return digits.slice(0, 8);
}

/** Normaliza um telefone: mantém apenas dígitos (até 13). */
function normalizePhone(value: unknown): string {
  const digits = onlyDigits(cellToString(value));
  return digits;
}

/** Extrai o número do endereço: se for numérico, mantém como string normalizada. */
function normalizeNumber(value: unknown): string | number | undefined {
  const text = cellToString(value);
  if (!text) return undefined;
  if (/^\d+$/.test(text)) {
    return Number(text);
  }
  return text;
}

/** Valida uma linha convertida, retornando as mensagens de erro. */
function validateDelivery(delivery: Delivery): string[] {
  const errors: string[] = [];

  if (!delivery.name) {
    errors.push('Campo obrigatório "Nome" ausente.');
  }
  if (!delivery.address) {
    errors.push('Campo obrigatório "Endereço" ausente.');
  }
  if (!delivery.cep) {
    errors.push('Campo obrigatório "CEP" ausente.');
  } else if (delivery.cep.length !== 8) {
    errors.push(`CEP inválido ("${delivery.cep}" precisa ter 8 dígitos).`);
  }

  return errors;
}

/**
 * Converte uma linha da planilha em um objeto `Delivery` usando as colunas
 * detectadas. Retorna `null` se a linha estiver completamente vazia.
 */
function rowToDelivery(
  row: unknown[],
  columns: DetectedColumn[],
  rowNumber: number,
): Delivery | null {
  const get = (id: ImportColumnId): unknown => {
    const col = columns.find((c) => c.id === id);
    if (!col || col.index >= row.length) return undefined;
    return row[col.index];
  };

  // Linha totalmente vazia → ignora.
  const hasAnyValue = row.some((cell) => cellToString(cell) !== '');
  if (!hasAnyValue) {
    return null;
  }

  const numberValue = normalizeNumber(get('number'));

  const delivery: Delivery = {
    trackingCode: normalizeText(get('trackingCode')) || undefined,
    name: normalizeText(get('name')),
    phone: normalizePhone(get('phone')) || undefined,
    address: normalizeText(get('address')),
    number: numberValue,
    complement: normalizeText(get('complement')) || undefined,
    neighborhood: normalizeText(get('neighborhood')) || undefined,
    city: normalizeText(get('city')) || undefined,
    cep: normalizeCep(get('cep')),
    rowNumber,
  };

  return delivery;
}

/**
 * Converte uma planilha (workbook lido via SheetJS) em um
 * `SpreadsheetParseResult` com entregas válidas e erros de linha.
 */
export function parseSheet(raw: string | ArrayBuffer): SpreadsheetParseResult {
  try {
    // O FileReader retorna o conteúdo em base64 (string); também aceitamos
    // ArrayBuffer (quando o chamador já tiver o binário em memória).
    const type: 'array' | 'base64' = typeof raw === 'string' ? 'base64' : 'array';
    const workbook = XLSX.read(raw, { type });
    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) {
      throw createAppError('A planilha não contém nenhuma aba.', {
        category: 'import',
        severity: 'warning',
        code: 'IMPORT_PARSE_ERROR',
        userMessage: 'O arquivo selecionado não contém uma planilha válida.',
      });
    }

    const sheet = workbook.Sheets[firstSheetName];
    // Converte em matriz de linhas (linha 0 = cabeçalho).
    const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: '',
      raw: true,
    });

    if (rows.length === 0) {
      throw createAppError('A planilha está vazia.', {
        category: 'import',
        severity: 'warning',
        code: 'IMPORT_PARSE_ERROR',
        userMessage: 'O arquivo selecionado está vazio.',
      });
    }

    const headerRow = rows[0];
    const columns = detectColumns(headerRow);

    // Colunas obrigatórias que não foram encontradas.
    const missingColumns = REQUIREED_COLUMNS.filter(
      (required) => !columns.some((c) => c.id === required),
    );

    const deliveries: Delivery[] = [];
    const invalidRows: RowValidationError[] = [];

    // Task 4.8: converte cada linha em objeto TypeScript.
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const rowNumber = i + 1; // 1-based (linha 0 = cabeçalho)
      const delivery = rowToDelivery(row, columns, rowNumber);

      if (!delivery) {
        continue; // linha vazia
      }

      // Task 4.11: valida.
      const errors = validateDelivery(delivery);
      if (errors.length > 0) {
        invalidRows.push({ rowNumber, messages: errors });
      } else {
        deliveries.push(delivery);
      }
    }

    return {
      deliveries,
      invalidRows,
      columns,
      missingColumns,
      totalRows: rows.length - 1,
    };
  } catch (error) {
    errorReporting.report(error, {
      context: 'SpreadsheetParser.parseSheet',
    });
    throw error;
  }
}
