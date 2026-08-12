import { config } from './env';
import type { LngLat } from '@maplibre/maplibre-react-native';

/**
 * Configuração central do mapa online (MapLibre).
 *
 * Ordem de preferência dos estilos candidatos (o primeiro que carregar é usado):
 *   1. OpenFreeMap Liberty — gratuito sem chave, estilo STREETS ideal para
 *      visualização de rotas, avenidas, números de logradouros e POIs.
 *   2. OpenFreeMap Positron — gratuito sem chave, estilo claro para sobrepor
 *      polylines coloridas sem distração.
 *   3. MapTiler Streets — apenas se `MAPS_API_KEY` for uma chave válida
 *      (não placeholder) no `.env`.
 *
 * Se qualquer estilo falhar ao carregar, o `MapScreen` tenta automaticamente
 * o próximo candidato da lista via `attemptIndex`.
 */

/**
 * Verifica se uma chave de API recebida do `.env` é considerada válida para uso.
 *
 * Rejeita valores vazios e placeholders comuns utilizados em arquivos de exemplo
 * (ex.: `your_maps_api_key`, `changeme`, `xxx`, etc.), evitando que o MapTiler
 * seja incluído como candidato com uma chave inválida em desenvolvimento.
 */
const PLACEHOLDER_PATTERNS: readonly RegExp[] = [
  /^\s*$/,
  /^your[_\- ]/i,
  /^changeme$/i,
  /^example$/i,
  /^test$/i,
  /^x{3,}$/i,
  /^placeholder$/i,
  /^none$/i,
];

function isValidApiKey(key: string | undefined | null): boolean {
  if (!key) return false;
  const trimmed = key.trim();
  for (const pattern of PLACEHOLDER_PATTERNS) {
    if (pattern.test(trimmed)) return false;
  }
  return true;
}

/** Coordenada de fallback (São Paulo, Brasil) usada quando não há localização disponível. */
export const FALLBACK_CENTER: LngLat = [-46.6333, -23.5505];

/** Zoom inicial do mapa quando não há localização do usuário. */
export const DEFAULT_ZOOM = 12;

/** Zoom usado quando o mapa acompanha a localização do usuário. */
export const USER_LOCATION_ZOOM = 15;

/** URLs de estilos online suportados. */
export const MAP_STYLES = {
  /** OpenFreeMap Liberty — gratuito sem chave, streets ideal para rotas. */
  openFreeMapLiberty: 'https://tiles.openfreemap.org/styles/liberty',
  /** OpenFreeMap Positron — gratuito sem chave, estilo claro/clean. */
  openFreeMapPositron: 'https://tiles.openfreemap.org/styles/positron',
  /** MapTiler Streets — requer `MAPS_API_KEY` válida no `.env`. */
  mapTiler: (apiKey: string) =>
    `https://api.maptiler.com/maps/streets/style.json?key=${apiKey}`,
} as const;

/**
 * Ordem de estilos candidatos a serem tentados (fallback automático).
 *
 * Prioridade:
 *   1. MapTiler Streets — se MAPS_API_KEY for válida (não placeholder). Melhor
 *      qualidade para rotas (detalhamento de ruas/avenidas, POIs, números).
 *   2. OpenFreeMap Liberty — gratuito sem chave, streets para rotas fallback.
 *   3. OpenFreeMap Positron — estilo claro/clean, fallback final.
 */
export const MAP_STYLE_CANDIDATES: string[] = [
  ...(isValidApiKey(config.mapsApiKey)
    ? [MAP_STYLES.mapTiler(config.mapsApiKey!)]
    : []),
  MAP_STYLES.openFreeMapLiberty,
  MAP_STYLES.openFreeMapPositron,
];

/**
 * Retorna a Style URL primária do mapa online.
 * Com chave válida: MapTiler Streets (melhor para rotas).
 * Sem chave: OpenFreeMap Liberty.
 */
export function getMapStyleUrl(): string {
  return MAP_STYLE_CANDIDATES[0] ?? MAP_STYLES.openFreeMapLiberty;
}

/**
 * Retorna o estilo a ser usado na tentativa de índice `attemptIndex`.
 * Garante que o índice nunca ultrapasse a lista de candidatos.
 */
export function getMapStyleForAttempt(attemptIndex: number): string {
  const safeIndex = Math.min(attemptIndex, MAP_STYLE_CANDIDATES.length - 1);
  return MAP_STYLE_CANDIDATES[safeIndex] ?? MAP_STYLES.openFreeMapLiberty;
}
