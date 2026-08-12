/**
 * AddressNormalizer (TASK 6.5).
 *
 * Recebe os componentes de endereço vindos da planilha de importação
 * e produz um endereço normalizado, pronta para consulta no provedor
 * de geocodificação e para chave de cache.
 *
 * Processos aplicados:
 *   1. Remoção de acentos e caracteres especiais.
 *   2. Normalização de whitespace (trim + collapsar múltiplos espaços).
 *   3. Abreviaturas expandidas (Av. → Avenida, R. → Rua, etc.).
 *   4. Inferência de estado padrão = RJ quando cidade=Maricá (TASK 6.19).
 *   5. Montagem da query de busca composta.
 *   6. Geração de hash estável para chave do cache offline (TASK 6.10).
 */

import type { NormalizedAddress } from './types';

/* ------------------------------------------------------------------ *
 * Tabelas de abreviaturas — usadas na expansão.
 * ------------------------------------------------------------------ */

const STREET_ABBREVIATIONS: ReadonlyArray<[RegExp, string]> = [
  [/\bR\b\.?/gi, 'Rua'],
  [/\bAv\b\.?/gi, 'Avenida'],
  [/\bAvda\b\.?/gi, 'Avenida'],
  [/\bEstr\b\.?/gi, 'Estrada'],
  [/\bRod\b\.?/gi, 'Rodovia'],
  [/\bAl\b\.?/gi, 'Alameda'],
  [/\bTrav\b\.?/gi, 'Travessa'],
  [/\bTv\b\.?/gi, 'Travessa'],
  [/\bDr\b\.?/gi, 'Doutor'],
  [/\bDra\b\.?/gi, 'Doutora'],
  [/\bSt\b\.?/gi, 'Santo'],
  [/\bSto\b\.?/gi, 'Santo'],
  [/\bSta\b\.?/gi, 'Santa'],
  [/\bS\b\.?/gi, 'São'],
  [/\bSra\b\.?/gi, 'Senhora'],
  [/\bSr\b\.?/gi, 'Senhor'],
];

const COMPLEMENT_ABBREVIATIONS: ReadonlyArray<[RegExp, string]> = [
  [/\bApto\b\.?/gi, 'Apartamento'],
  [/\bAp\b\.?/gi, 'Apartamento'],
  [/\bCasa\s+(\d+)\b/gi, 'Casa $1'],
  [/\bSala\b\.?/gi, 'Sala'],
  [/\bBl\b\.?/gi, 'Bloco'],
];

/* ------------------------------------------------------------------ *
 * Helpers de string.
 * ------------------------------------------------------------------ */

/** Remove acentos de uma string (ex.: "Maricá" → "Marica"). */
function removeAccents(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** Colapsa múltiplos espaços e remove espaços nas pontas. */
function collapseSpaces(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** Expande abreviaturas conhecidas de logradouros e complementos. */
function expandAbbreviations(value: string): string {
  let out = value;
  for (const [regex, replacement] of STREET_ABBREVIATIONS) {
    out = out.replace(regex, replacement);
  }
  for (const [regex, replacement] of COMPLEMENT_ABBREVIATIONS) {
    out = out.replace(regex, replacement);
  }
  return out;
}

/** Formata CEP brasileiro: remove tudo que não for dígito e adiciona hífen se tiver 8 dígitos. */
function formatCep(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 8) {
    return `${digits.slice(0, 5)}-${digits.slice(5)}`;
  }
  return digits;
}

/**
 * Hash leve e determinístico (djb2 xor) compatível com qualquer
 * runtime JS. Não é criptográfico, mas serve perfeitamente como
 * chave de cache de endereços normalizados (TASK 6.10).
 * Produz uma string hex de 8 caracteres.
 */
function hashAddress(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i += 1) {
    // eslint-disable-next-line no-bitwise
    hash = ((hash << 5) + hash) ^ input.charCodeAt(i);
  }
  // Converte para unsigned hex de 8 chars
  // eslint-disable-next-line no-bitwise
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/* ------------------------------------------------------------------ *
 * Inferências contextuais (ajuda TASK 6.19 — Maricá/RJ).
 * ------------------------------------------------------------------ */

/** Tenta inferir o estado (UF) a partir da cidade, CEP ou contexto. */
function inferState(city?: string, postalCode?: string): string | undefined {
  const rawCity = (city ?? '').toLowerCase();
  const rawCep = postalCode ?? '';

  if (/marica/i.test(rawCity) || rawCep.startsWith('249')) {
    return 'RJ';
  }
  if (/rio de janeiro/i.test(rawCity)) {
    return 'RJ';
  }
  if (/sao paulo/i.test(removeAccents(rawCity)) || rawCep.startsWith('01') || rawCep.startsWith('02') || rawCep.startsWith('03')) {
    return 'SP';
  }
  if (/belo horizonte/i.test(rawCity) || rawCep.startsWith('30') || rawCep.startsWith('31')) {
    return 'MG';
  }
  if (/salvador/i.test(rawCity) || rawCep.startsWith('40') || rawCep.startsWith('41')) {
    return 'BA';
  }
  if (/brasilia/i.test(rawCity) || rawCep.startsWith('70') || rawCep.startsWith('71') || rawCep.startsWith('72') || rawCep.startsWith('73')) {
    return 'DF';
  }
  return undefined;
}

/** Normaliza um componente opcional de endereço (string vazia → undefined). */
function cleanComponent(value: string | undefined): string | undefined {
  if (value == null) return undefined;
  const cleaned = collapseSpaces(expandAbbreviations(removeAccents(value)));
  if (cleaned.length === 0) return undefined;
  return cleaned;
}

/* ------------------------------------------------------------------ *
 * API pública.
 * ------------------------------------------------------------------ */

/**
 * Entrada do normalizador: qualquer objeto com campos de endereço.
 * Compatível com `Entrega`, `Delivery` e estruturas parciais.
 */
export interface AddressInput {
  endereco?: string;
  address?: string;
  numero?: string | number;
  number?: string | number;
  complemento?: string;
  complement?: string;
  bairro?: string;
  neighborhood?: string;
  cidade?: string;
  city?: string;
  cep?: string;
  postalCode?: string;
}

/**
 * TASK 6.5: Normaliza um endereço para consulta no provedor.
 *
 * @returns `NormalizedAddress` contendo componentes limpos, query
 *          formatada para busca e hash estável para chave de cache.
 */
export function normalizeAddress(input: AddressInput): NormalizedAddress {
  const street = cleanComponent(input.endereco ?? input.address);
  const numberRaw = input.numero ?? input.number;
  const number = numberRaw != null && String(numberRaw).trim() !== ''
    ? collapseSpaces(removeAccents(String(numberRaw)))
    : undefined;
  const complement = cleanComponent(input.complemento ?? input.complement);
  const neighborhood = cleanComponent(input.bairro ?? input.neighborhood);
  const city = cleanComponent(input.cidade ?? input.city);
  const cepRaw = input.cep ?? input.postalCode ?? '';
  const postalCode = cepRaw.length > 0 ? formatCep(cepRaw) : undefined;
  const state = inferState(city, postalCode);
  const country = 'Brasil';

  const parts: string[] = [];
  if (street) {
    const streetPart = number ? `${street}, ${number}` : street;
    parts.push(streetPart);
  }
  if (complement && !street?.toLowerCase().includes(complement.toLowerCase())) {
    parts.push(complement);
  }
  if (neighborhood) {
    parts.push(neighborhood);
  }
  if (city) {
    parts.push(state ? `${city} - ${state}` : city);
  }
  if (postalCode) {
    parts.push(postalCode);
  }
  parts.push(country);

  const query = collapseSpaces(parts.join(', '));
  const hashSource = [
    street ?? '',
    number ?? '',
    complement ?? '',
    neighborhood ?? '',
    city ?? '',
    state ?? '',
    postalCode ?? '',
    country,
  ].join('|').toLowerCase();

  return {
    hash: hashAddress(hashSource),
    query,
    components: {
      street,
      number,
      neighborhood,
      city,
      state,
      postalCode,
      country,
    },
  };
}
