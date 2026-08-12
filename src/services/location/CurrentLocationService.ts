import { LocationManager } from '@maplibre/maplibre-react-native';
import { createAppError } from '../../utils/errorHandler';
import { errorReporting } from '../errorReporting';
import type {
  LocationStatus,
  PermissionResult,
  UserLocation,
} from '../../types/location';

/**
 * Serviço central de localização (GPS) da aplicação.
 *
 * Abstrai o `LocationManager` nativo do MapLibre e expõe uma API simples para:
 *  - Solicitar permissão de localização.
 *  - Obter a latitude/longitude atual.
 *  - Acompanhar (tracking) atualizações de posição do entregador.
 *  - Diferenciar "GPS desligado" (`unavailable`) de "permissão negada" (`denied`).
 */

/** Deslocamento mínimo (metros) para disparar atualização de posição. */
const DEFAULT_MIN_DISPLACEMENT = 5;

/** Código de erro estável para falha ao obter posição. */
const LOCATION_CODE = 'LOCATION_UNAVAILABLE';

class CurrentLocationService {
  private status: LocationStatus = 'unknown';
  private currentPosition: UserLocation | undefined;
  private listeners: ((location: UserLocation) => void)[] = [];

  /**
   * Retorna o status atual de localização.
   */
  getStatus(): LocationStatus {
    return this.status;
  }

  /**
   * Retorna a última posição conhecida do entregador.
   */
  getCurrentUserLocation(): UserLocation | undefined {
    return this.currentPosition;
  }

  /**
   * Solicita a permissão de localização ao usuário.
   *
   * - `granted`: permissão concedida (Android/iOS).
   * - `denied`: permissão negada — Task 3.9.
   *
   * Atualiza o status do serviço e reporta o resultado.
   */
  async requestPermission(): Promise<PermissionResult> {
    try {
      const granted = await LocationManager.requestPermissions();

      if (granted) {
        this.status = 'granted';
        return 'granted';
      }

      this.status = 'denied';
      return 'denied';
    } catch (error) {
      this.status = 'denied';
      errorReporting.report(error, {
        context: 'CurrentLocationService.requestPermission',
      });
      return 'denied';
    }
  }

  /**
   * Obtém a latitude/longitude atual do usuário.
   *
   * Se a permissão foi concedida mas não houver posição disponível
   * (ex.: GPS desligado), retorna `undefined` e marca status `unavailable`
   * — Task 3.8.
   */
  async getCurrentPosition(): Promise<UserLocation | undefined> {
    if (this.status !== 'granted') {
      const permission = await this.requestPermission();
      if (permission === 'denied') {
        return undefined;
      }
    }

    try {
      const position = await LocationManager.getCurrentPosition();

      if (!position) {
        this.status = 'unavailable';
        return undefined;
      }

      this.status = 'granted';
      this.currentPosition = this.normalize(position);
      return this.currentPosition;
    } catch (error) {
      this.status = 'unavailable';
      errorReporting.report(error, {
        context: 'CurrentLocationService.getCurrentPosition',
      });
      return undefined;
    }
  }

  /**
   * Inicia o rastreamento de atualizações de posição (Task 3.6).
   *
   * A cada deslocamento >= `minDisplacement` (padrão 5m), `listener` é chamado
   * com a nova posição do entregador.
   */
  startTracking(
    listener: (location: UserLocation) => void,
    minDisplacement: number = DEFAULT_MIN_DISPLACEMENT,
  ): void {
    if (!this.listeners.includes(listener)) {
      this.listeners.push(listener);
    }

    LocationManager.setMinDisplacement(minDisplacement);

    LocationManager.addListener((position) => {
      const normalized = this.normalize(position);
      this.currentPosition = normalized;
      this.status = 'granted';

      this.listeners.forEach((cb) => cb(normalized));
    });
  }

  /**
   * Interrompe o rastreamento de posição.
   */
  stopTracking(): void {
    this.listeners = [];
    LocationManager.removeAllListeners();
  }

  /**
   * Normaliza a posição nativa do MapLibre para o formato da aplicação.
   */
  private normalize(position: {
    coords: {
      longitude: number;
      latitude: number;
      accuracy: number;
      altitude: number | null;
      altitudeAccuracy: number | null;
      heading: number | null;
      speed: number | null;
    };
    timestamp: number;
  }): UserLocation {
    return {
      coords: {
        longitude: position.coords.longitude,
        latitude: position.coords.latitude,
        accuracy: position.coords.accuracy,
        altitude: position.coords.altitude,
        altitudeAccuracy: position.coords.altitudeAccuracy,
        heading: position.coords.heading,
        speed: position.coords.speed,
      },
      timestamp: position.timestamp,
    };
  }
}

/**
 * Exporta um erro tipado estável para GPS indisponível (uso externo opcional).
 */
export function createLocationUnavailableError(): ReturnType<typeof createAppError> {
  return createAppError('GPS indisponível ou desligado.', {
    category: 'maps',
    severity: 'warning',
    code: LOCATION_CODE,
    userMessage: 'Ative o GPS para ver sua posição no mapa.',
  });
}

export const currentLocationService = new CurrentLocationService();
