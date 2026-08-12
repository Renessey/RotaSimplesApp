import { pick, types } from '@react-native-documents/picker';
import RNFS from 'react-native-fs';
import { createAppError } from '../../utils/errorHandler';
import { errorReporting } from '../errorReporting';

/**
 * FileReader (Tasks 4.5, 4.6).
 *
 * Seleciona um arquivo XLSX/CSV via picker nativo e lê seu conteúdo:
 *  - 4.5: seleciona o arquivo (restrito a .xlsx/.xls/.csv).
 *  - 4.6: lê o arquivo (base64) e retorna junto com o nome.
 */

/** Resultado da leitura de um arquivo. */
export interface PickedFile {
  /** Nome do arquivo selecionado (ex.: "entregas.xlsx"). */
  fileName: string;
  /** Conteúdo do arquivo em base64. */
  base64: string;
  /** URI local temporária (para depuração). */
  localUri: string;
}

/**
 * Abre o seletor de documentos e lê o arquivo escolhido.
 *
 * @returns O arquivo lido em base64, ou `null` se o usuário cancelar.
 */
export async function pickSpreadsheetFile(): Promise<PickedFile | null> {
  try {
    const picked = await pick({
      mode: 'import',
      type: [types.csv, types.xls, types.xlsx],
      allowMultiSelection: false,
    });

    const file = picked[0];
    if (!file) {
      return null;
    }

    const fileName = file.name ?? 'planilha';

    // Copia o arquivo para o cache do app (converte content:// em file://).
    const copies = await keepLocalCopyOf(file.uri, fileName);
    if (!copies) {
      throw createAppError('Não foi possível copiar o arquivo selecionado para leitura.', {
        category: 'import',
        severity: 'error',
        code: 'IMPORT_PARSE_ERROR',
        userMessage: 'Não foi possível acessar o arquivo selecionado.',
      });
    }

    const { localUri } = copies;

    // Lê o arquivo copiado como base64.
    const base64 = await RNFS.readFile(localUri, 'base64');

    return { fileName, base64, localUri };
  } catch (error) {
    // Cancela pelo usuário não é erro.
    if (isPickCancel(error)) {
      return null;
    }
    errorReporting.report(error, {
      context: 'FileReader.pickSpreadsheetFile',
    });
    throw error;
  }
}

/** Importa `keepLocalCopy` de forma tipada. */
async function keepLocalCopyOf(
  uri: string,
  fileName: string,
): Promise<{ localUri: string } | null> {
  const { keepLocalCopy } = await import('@react-native-documents/picker');
  const response = await keepLocalCopy({
    files: [{ uri, fileName }],
    destination: 'cachesDirectory',
  });

  const copy = response[0];
  if (!copy || copy.status !== 'success') {
    return null;
  }
  return { localUri: copy.localUri };
}

/** Detecta se o erro significa que o usuário cancelou a seleção. */
function isPickCancel(error: unknown): boolean {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: string }).code;
    return code === 'OPERATION_CANCELED' || code === 'DOCUMENT_PICKER_CANCELED';
  }
  return false;
}

/** Detecta se o erro significa que a seleção ainda está em andamento. */
export function isPickInProgress(error: unknown): boolean {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: string }).code;
    return code === 'OPERATION_IN_PROGRESS' || code === 'DOCUMENT_PICKER_IN_PROGRESS';
  }
  return false;
}
