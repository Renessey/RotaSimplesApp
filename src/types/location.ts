/**
 * Tipos centrais do sistema de localização (GPS) da aplicação.
 *
 * A posição/status é consumido pelo `CurrentLocationService` e exibido
 * pelo `MapScreen` (posição do entregador no mapa).
 */

/** Status de disponibilidade do GPS/permissão. */
export type LocationStatus =
  /** Permissão concedida e GPS ativo — posição disponível. */
  | 'granted'
  /** Permissão negada pelo usuário — não é possível obter posição. */
  | 'denied'
  /** Permissão concedida, mas GPS desligado/indisponível. */
  | 'unavailable'
  /** Estado inicial — ainda determinando permissão/posição. */
  | 'unknown';

/** Coordenadas geográficas normalizadas (usadas pelo MapScreen). */
export interface Coordinates {
  /** Longitude em graus. */
  longitude: number;
  /** Latitude em graus. */
  latitude: number;
  /** Precisão (metros) da longitude/latitude. */
  accuracy: number;
  /** Altitude em metros (pode ser nula). */
  altitude: number | null;
  /** Precisão da altitude em metros (pode ser nula). */
  altitudeAccuracy: number | null;
  /** Direção de deslocamento em graus a partir do norte (pode ser nula). */
  heading: number | null;
  /** Velocidade instantânea em metros/segundo (pode ser nula). */
  speed: number | null;
}

/** Posição geográfica do usuário/entregador. */
export interface UserLocation {
  /** Coordenadas da posição. */
  coords: Coordinates;
  /** Timestamp (ms) da medição. */
  timestamp: number;
}

/** Resultado da solicitação de permissão de localização. */
export type PermissionResult = 'granted' | 'denied';
