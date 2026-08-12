/**
 * Tipos centrais do sistema de importação de entregas (FASE 4).
 *
 * Modela desde a planilha (XLSX/CSV) até a entrega persistida no SQLite local.
 */

/** Colunas esperadas na planilha de importação. */
export type ImportColumnId =
  | 'trackingCode'
  | 'name'
  | 'phone'
  | 'address'
  | 'number'
  | 'complement'
  | 'neighborhood'
  | 'city'
  | 'cep';

/** Campos principais (obrigatórios) — Nome, Endereço e CEP. */
export const REQUIREED_COLUMNS: readonly ImportColumnId[] = [
  'name',
  'address',
  'cep',
];

/** Mapa de cabeçalhos aceitos (PT-BR) para cada coluna. */
export const COLUMN_HEADERS: Record<ImportColumnId, string[]> = {
  trackingCode: ['código de rastreio', 'codigo de rastreio', 'cod rastreio', 'rastreio', 'tracking', 'tracking code'],
  name: ['nome', 'nome do destinatario', 'destinatario', 'cliente', 'name'],
  phone: ['telefone', 'telefone1', 'celular', 'fone', 'phone', 'whatsapp'],
  address: ['endereço', 'endereco', 'logradouro', 'rua', 'address', 'end'],
  number: ['número', 'numero', 'nº', 'no', 'number', 'num'],
  complement: ['complemento', 'apto', 'apartamento', 'bloco', 'complement'],
  neighborhood: ['bairro', 'neighborhood', 'distrito'],
  city: ['cidade', 'city', 'municipio'],
  cep: ['cep', 'código postal', 'codigo postal', 'postal code', 'zip', 'zipcode'],
};

/** Formato normalizado de uma entrega importada da planilha. */
export interface Delivery {
  /** Identificador local (gerado pelo SQLite ao persistir). */
  id?: number;
  /** Código de rastreio (opcional). */
  trackingCode?: string;
  /** Nome do destinatário — campo principal obrigatório. */
  name: string;
  /** Telefone (opcional, normalizado). */
  phone?: string;
  /** Endereço (logradouro) — campo principal obrigatório. */
  address: string;
  /** Número do endereço (opcional). */
  number?: number | string;
  /** Complemento (opcional). */
  complement?: string;
  /** Bairro (opcional). */
  neighborhood?: string;
  /** Cidade (opcional). */
  city?: string;
  /** CEP — campo principal obrigatório (8 dígitos). */
  cep: string;
  /** Linha de origem na planilha (para reportar erros). */
  rowNumber?: number;
  /** Timestamp (ms) de criação/persistência. */
  createdAt?: number;
  /** Status local da entrega (preparado para sincronização futura). */
  syncStatus?: 'pending' | 'synced' | 'error';
}

/** Coluna detectada na planilha. */
export interface DetectedColumn {
  /** Identificador da coluna. */
  id: ImportColumnId;
  /** Cabeçalho original encontrado na planilha. */
  header: string;
  /** Índice da coluna (0-based). */
  index: number;
}

/** Erro de validação de uma linha da planilha. */
export interface RowValidationError {
  /** Número da linha (1-based, na planilha). */
  rowNumber: number;
  /** Lista de mensagens de erro. */
  messages: string[];
}

/** Resultado do parse/normalização/validação de uma planilha. */
export interface SpreadsheetParseResult {
  /** Entregas válidas (prontas para persistir). */
  deliveries: Delivery[];
  /** Entregas inválidas (com erros). */
  invalidRows: RowValidationError[];
  /** Colunas detectadas no cabeçalho. */
  columns: DetectedColumn[];
  /** Colunas esperadas porém não encontradas. */
  missingColumns: ImportColumnId[];
  /** Total de linhas de dados processadas. */
  totalRows: number;
}

/** Prévia exibida ao usuário antes de confirmar a importação. */
export interface ImportPreview {
  /** Nome do arquivo selecionado. */
  fileName: string;
  /** Total de linhas lidas. */
  totalRows: number;
  /** Quantidade de entregas válidas. */
  validCount: number;
  /** Quantidade de entregas inválidas. */
  invalidCount: number;
  /** Amostra das entregas válidas (primeiras N). */
  sample: Delivery[];
  /** Erros de linhas inválidas. */
  errors: RowValidationError[];
  /** Colunas detectadas. */
  columns: DetectedColumn[];
  /** Colunas obrigatórias ausentes. */
  missingColumns: ImportColumnId[];
}
