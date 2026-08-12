/**
 * FASE 6 — GEOCODING ONLINE
 *
 * TASK 6.19 (e vizinhas): testes unitários offline focados no bias
 * regional para Maricá/RJ, combinado com validação das TASKS
 * 6.5 (normalização) e 6.16 (ambiguidade/limiar de confiança).
 *
 * TODAS as requisições Nominatim são mockadas via `globalThis.fetch`,
 * então a suíte roda 100% offline e de forma determinística.
 */

/* ------------------------------------------------------------------ *
 * MOCKS DE MÓDULOS NATIVOS RN — necessários para o Jest rodar os  *
 * OfflineCache → database/database → op-sqlite fora do RN runtime. *
 * ------------------------------------------------------------------ */

jest.mock('@op-engineering/op-sqlite', () => ({
  open: jest.fn(),
}));

jest.mock('../src/database/database', () => ({
  getAppDb: undefined,
}));

jest.mock('../src/cache/OfflineCache', () => {
  const store = new Map<string, unknown>();
  return {
    offlineCache: {
      get: jest.fn(async (key: string) => {
        const value = store.get(key);
        return value === undefined ? null : value;
      }),
      set: jest.fn(async (key: string, value: unknown): Promise<void> => {
        store.set(key, value);
      }),
      remove: jest.fn(async (key: string): Promise<void> => {
        store.delete(key);
      }),
    },
  };
});

jest.setTimeout(30000);

jest.mock('../src/database/DeliveryRepository', () => ({}));

import { normalizeAddress } from '../src/geocoding/AddressNormalizer';
import { nominatimGeocodingProvider } from '../src/geocoding/NominatimGeocodingProvider';
import { geocodingService } from '../src/geocoding/GeocodingService';
import type { GeocodingCandidate } from '../src/geocoding/types';

// ---------------------------------------------------------------
// Helpers de mock fetch. Garante que a suíte é 100% offline.
// ---------------------------------------------------------------

type FetchMock = jest.Mock<Promise<Response>, any[]>;
function getFetchMock(): FetchMock | undefined {
  const g = globalThis as unknown as { fetch?: FetchMock };
  return g.fetch;
}

function mockFetchOnceJson<T>(payload: T): void {
  const fn = jest.fn().mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => payload,
  } as unknown as Response);
  (globalThis as unknown as { fetch: FetchMock }).fetch = fn;
}

function lastFetchArgs(): { url: string } | null {
  const fn = getFetchMock();
  if (!fn) return null;
  const call = fn.mock.calls[fn.mock.calls.length - 1];
  if (!call || !call[0]) return null;
  return typeof call[0] === 'string' ? { url: call[0] } : { url: String(call[0]) };
}

afterEach(() => {
  const fn = getFetchMock();
  if (fn && typeof fn.mockClear === 'function') {
    fn.mockClear();
  }
});

// ===============================================================
// SUÍTE 1 — TASK 6.5 (normalização) + TASK 6.19 (bias Maricá/RJ)
// ===============================================================

describe('AddressNormalizer — TASK 6.5 + TASK 6.19 (Maricá/RJ)', () => {
  it('infere UF=RJ quando cidade="Maricá" (sem acento)', () => {
    const out = normalizeAddress({
      endereco: 'Rua 14 Bis, 100',
      bairro: 'Centro',
      cidade: 'Marica',
    });
    expect(out.components.state).toBe('RJ');
    expect(out.query).toContain('Marica - RJ');
  });

  it('infere UF=RJ quando cidade="Maricá" (com acento)', () => {
    const out = normalizeAddress({
      endereco: 'Rua 14 Bis, 100',
      bairro: 'Centro',
      cidade: 'Maricá',
    });
    expect(out.components.state).toBe('RJ');
    expect(out.query).toContain('Marica - RJ');
  });

  it('infere UF=RJ apenas por CEP prefixo 249 (cidade vazia)', () => {
    const out = normalizeAddress({
      endereco: 'Estrada de Itaipuaçu, 5000',
      bairro: 'Itaipuaçu',
      cep: '24930-000',
    });
    expect(out.components.state).toBe('RJ');
    expect(out.components.postalCode).toBe('24930-000');
  });

  it('formata CEP bruto sem hífen e infere UF=RJ', () => {
    const out = normalizeAddress({
      endereco: 'Av. Atlântica, 1000',
      bairro: 'Barra de Maricá',
      cep: '24904350',
    });
    expect(out.components.postalCode).toBe('24904-350');
    expect(out.components.state).toBe('RJ');
  });

  it('não infere RJ para cidades que não são Maricá — ex: São Paulo', () => {
    const out = normalizeAddress({
      endereco: 'Av. Paulista, 1578',
      bairro: 'Bela Vista',
      cidade: 'São Paulo',
      cep: '01310-200',
    });
    expect(out.components.state).toBe('SP');
    expect(out.query).toContain('Sao Paulo - SP');
  });

  it('expande abreviaturas: Av., R., Dr.', () => {
    const out = normalizeAddress({
      endereco: 'Av. Almirante Newton Braga',
      numero: '500',
      complemento: 'Apto 201',
      cidade: 'Maricá',
    });
    expect(out.components.street).toBe('Avenida Almirante Newton Braga');
    expect(out.components.number).toBe('500');
    expect(out.query).toContain('Avenida Almirante Newton Braga, 500');
    expect(out.query).toContain('Apartamento 201');
  });

  it('produz hashes idênticos para a mesma entrada (estabilidade cache)', () => {
    const addr = {
      endereco: 'Rua Dr. Plinio Guimaraes, 200',
      bairro: 'Jardim Atlantico',
      cidade: 'Marica',
      cep: '24904-350',
    };
    const a = normalizeAddress(addr);
    const b = normalizeAddress(addr);
    expect(a.hash).toBe(b.hash);
    expect(a.hash.length).toBe(8);
  });

  it('endereço típico de Maricá Centro (CEP 24900-001)', () => {
    const out = normalizeAddress({
      endereco: 'Rua 14 Bis, 100',
      bairro: 'Centro',
      cidade: 'Maricá',
      cep: '24900001',
    });
    expect(out.components.state).toBe('RJ');
    expect(out.components.postalCode).toBe('24900-001');
    expect(out.query).toMatch(/^Rua 14 Bis, 100, Centro, Marica - RJ, 24900-001, Brasil$/);
  });
});

// ===============================================================
// SUÍTE 2 — TASK 6.19 (Nominatim provider: viewbox Maricá)
// ===============================================================

describe('NominatimGeocodingProvider — TASK 6.19 (viewbox Maricá)', () => {
  it('inclui countrycodes=br e accept-language=pt-BR em qualquer busca', async () => {
    mockFetchOnceJson([]);
    const address = normalizeAddress({
      endereco: 'Av. Paulista, 1578',
      cidade: 'São Paulo',
    });
    await nominatimGeocodingProvider.geocode(address);
    const req = lastFetchArgs();
    expect(req).not.toBeNull();
    expect(req!.url).toContain('countrycodes=br');
    expect(req!.url).toContain('accept-language=pt-BR');
    expect(req!.url).toContain('format=jsonv2');
  });

  it('endereço com cidade Maricá → URL contém viewbox regional + bounded=1', async () => {
    mockFetchOnceJson([]);
    const address = normalizeAddress({
      endereco: 'Rua 14 Bis, 100',
      bairro: 'Centro',
      cidade: 'Maricá',
    });
    await nominatimGeocodingProvider.geocode(address);
    const req = lastFetchArgs();
    expect(req).not.toBeNull();
    const url = req!.url;
    expect(url).toContain('viewbox=');
    expect(url).toMatch(/bounded=[01]/);
    // Região de Maricá: LON entre -43.0 e -42.6, LAT entre -23.1 e -22.7.
    // O nominatim usa formato viewbox=left,top,right,bottom (ou similar
    // via QSL west,south,east,north). Verificamos que os números batem.
    const nums = url.match(/(-?\d+\.\d+)/g) ?? [];
    const floats = nums.map(Number);
    const lons = floats.filter((n) => n < -30);
    const lats = floats.filter((n) => n > -30 && n < 0);
    for (const lon of lons) expect(lon).toBeGreaterThanOrEqual(-43.2);
    for (const lon of lons) expect(lon).toBeLessThanOrEqual(-42.5);
    for (const lat of lats) expect(lat).toBeGreaterThanOrEqual(-23.2);
    for (const lat of lats) expect(lat).toBeLessThanOrEqual(-22.6);
  });

  it('endereço de São Paulo (não Maricá) → URL SEM bounded=1 (bias neutral)', async () => {
    mockFetchOnceJson([]);
    const address = normalizeAddress({
      endereco: 'Av. Paulista, 1578',
      cidade: 'São Paulo',
      cep: '01310-200',
    });
    await nominatimGeocodingProvider.geocode(address);
    const req = lastFetchArgs();
    expect(req).not.toBeNull();
    const url = req!.url;
    // Para não-Maricá: bounded=1 não deve ser setado (apenas país e idioma).
    expect(url).not.toContain('bounded=1');
  });
});

// ===============================================================
// SUÍTE 3 — TASK 6.16 (confiança 0.7 + ambiguidade top-2)
// ===============================================================

interface FakeFeature {
  place_id?: number;
  lat: string;
  lon: string;
  importance?: number;
  display_name?: string;
  type?: string;
  class?: string;
}

function candidateFromFeature(
  f: FakeFeature,
  overrides?: Partial<GeocodingCandidate>,
): GeocodingCandidate {
  return {
    latitude: Number(f.lat),
    longitude: Number(f.lon),
    displayName: f.display_name ?? `Rua X, Maricá - RJ, Brasil`,
    confidence: f.importance ?? 0.8,
    placeType: f.type ?? 'residential',
    ...overrides,
  };
}

describe('GeocodingService.chooseCandidate — TASK 6.16', () => {
  it('retorna GEOCODED quando há um candidato forte (>= 0.7)', async () => {
    const address = normalizeAddress({
      endereco: 'Rua 14 Bis, 100',
      cidade: 'Maricá',
    });
    const features: FakeFeature[] = [
      { lat: '-22.9200', lon: '-42.8200', importance: 0.88, type: 'house' },
    ];
    mockFetchOnceJson(features);
    const res = await geocodingService.geocodeNormalized(address);
    expect(res.status).toBe('GEOCODED');
    expect(res.latitude).toBeCloseTo(-22.92, 3);
    expect(res.longitude).toBeCloseTo(-42.82, 3);
    expect(res.confidence! >= 0.7).toBe(true);
  });

  it('retorna AMBIGUOUS quando top2 confiança < 0.7 (mesmo que único)', async () => {
    const address = normalizeAddress({
      endereco: 'Rua Desconhecida',
      cidade: 'Maricá',
    });
    const features: FakeFeature[] = [
      { lat: '-22.9', lon: '-42.8', importance: 0.62, type: 'village' },
    ];
    mockFetchOnceJson(features);
    const res = await geocodingService.geocodeNormalized(address);
    expect(res.status).toBe('AMBIGUOUS');
    expect(res.note).toMatch(/baixa/i);
  });

  it('retorna AMBIGUOUS quando top2 confiança estão próximos (diff < 0.1)', async () => {
    const address = normalizeAddress({
      endereco: 'Rua Sete, 200',
      cidade: 'Maricá',
    });
    const features: FakeFeature[] = [
      { lat: '-22.9190', lon: '-42.8200', importance: 0.82, type: 'residential' },
      { lat: '-22.9205', lon: '-42.8190', importance: 0.76, type: 'residential' },
    ];
    mockFetchOnceJson(features);
    const res = await geocodingService.geocodeNormalized(address);
    expect(res.status).toBe('AMBIGUOUS');
    expect(res.note).toMatch(/[Aa]mb.*guo|[Mm]últiplos/);
  });

  it('retorna GEOCODED quando top2 diff >= 0.1 e top >= 0.7', async () => {
    const address = normalizeAddress({
      endereco: 'Rua 14 Bis, 100',
      cidade: 'Maricá',
    });
    const features: FakeFeature[] = [
      { lat: '-22.9200', lon: '-42.8200', importance: 0.9, type: 'house' },
      { lat: '-22.8000', lon: '-42.8000', importance: 0.65, type: 'road' },
    ];
    mockFetchOnceJson(features);
    const res = await geocodingService.geocodeNormalized(address);
    expect(res.status).toBe('GEOCODED');
    expect(res.latitude).toBeCloseTo(-22.92, 3);
  });

  it('retorna FAILED se Nominatim não retornar nenhuma feature', async () => {
    const address = normalizeAddress({
      endereco: 'Rua Inexistente XYZ 999999',
      cidade: 'Maricá',
    });
    mockFetchOnceJson([]);
    const res = await geocodingService.geocodeNormalized(address);
    expect(res.status).toBe('FAILED');
    expect(res.note).toMatch(/nenhum resultado|não foi possível|sem resultado/i);
  });

  it('idempotência do cache: 2 chamadas iguais → 1 fetch só (TASK 6.10)', async () => {
    const address = normalizeAddress({
      endereco: 'Av. Almirante Newton Braga, 500',
      cidade: 'Maricá',
    });
    const fn = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [
        { lat: '-22.9200', lon: '-42.8200', importance: 0.88, type: 'house' },
      ],
    } as unknown as Response);
    (globalThis as unknown as { fetch: FetchMock }).fetch = fn;

    const first = await geocodingService.geocodeNormalized(address);
    expect(first.status).toBe('GEOCODED');

    // Garante que o `void this.writeCache` (fire-and-forget) teve chance
    // de persistir antes de rodarmos a segunda consulta.
    await new Promise<void>((resolve) => setTimeout(() => resolve(), 20));

    const second = await geocodingService.geocodeNormalized(address);
    expect(second.status).toBe('GEOCODED');
    expect(second.latitude).toBe(first.latitude);
    expect(second.longitude).toBe(first.longitude);
    expect(fn.mock.calls.length).toBe(1);
  });
});
