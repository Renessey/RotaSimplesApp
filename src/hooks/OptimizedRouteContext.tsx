import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { Feature, LineString } from 'geojson';
import type { Entrega } from '../types/entrega';
import type { OptimizationProgress } from '../services/optimization/types';

/**
 * OptimizedRouteContext (FASE 9 + FASE 10).
 *
 * Compartilha o estado da rota otimizada no momento entre:
 *   - DeliveryManagerPanel (botão "Otimizar rota" dispara o OptimizationService)
 *   - MapScreen (desenha RouteLayer com a geometria, ajusta câmera, atualiza
 *     marcadores com ordemEntrega).
 *
 * Evita "prop drilling" de ~7 níveis e permite que recálculo de rota
 * disparado de qualquer tela chegue imediatamente ao mapa.
 */

export interface OptimizedRouteState {
  /** Geometria GeoJSON pronta para o RouteLayer. */
  geometry: Feature<LineString> | null;
  /** Ordem otimizada atual (após OptimizationService). */
  orderedDeliveries: Entrega[];
  /** Distância total da rota calculada em METROS. */
  distanceMeters: number | null;
  /** Duração total estimada em SEGUNDOS. */
  durationSeconds: number | null;
  /** Momento em que a rota foi gerada (ISO). */
  updatedAt: string | null;
  /** Estado do progresso atual (null se estiver ocioso). */
  progress: OptimizationProgress | null;
  /** true enquanto o otimizador / recálculo está rodando. */
  isOptimizing: boolean;
  /** Último erro, se houve. */
  lastError: string | null;
}

/** Bounding box em [lngMin, latMin, lngMax, latMax] (MapLibre fitBounds). */
export interface RouteBounds {
  sw: [number, number];
  ne: [number, number];
  padding?: number;
}

interface OptimizedRouteContextValue extends OptimizedRouteState {
  /** Atualiza o estado da rota (usado pelo OptimizationService ou UI). */
  setRoute: (r: Partial<OptimizedRouteState> & { updatedAt?: string }) => void;
  /** Limpa toda a rota (tirar a linha do mapa). */
  clearRoute: () => void;
  /** Atualiza progresso visível na UI. */
  setProgress: (p: OptimizationProgress | null) => void;
  /** Seta isOptimizing (true/false). */
  setOptimizing: (b: boolean) => void;
  /**
   * Retorna o bounding box da geometria atual (incluindo origem e
   * todas as entregas), em formato [sw, ne] para usar em `camera.fitBounds`.
   * null se não houver dados.
   */
  computeRouteBounds: (origin?: {
    latitude: number;
    longitude: number;
  }) => RouteBounds | null;
}

const INITIAL_STATE: OptimizedRouteState = {
  geometry: null,
  orderedDeliveries: [],
  distanceMeters: null,
  durationSeconds: null,
  updatedAt: null,
  progress: null,
  isOptimizing: false,
  lastError: null,
};

const OptimizedRouteContext = createContext<OptimizedRouteContextValue | null>(null);

export function OptimizedRouteProvider(props: { children: React.ReactNode }) {
  const [state, setState] = useState<OptimizedRouteState>(INITIAL_STATE);
  const orderedRef = useRef<Entrega[]>([]);
  const geometryRef = useRef<Feature<LineString> | null>(null);

  orderedRef.current = state.orderedDeliveries;
  geometryRef.current = state.geometry;

  const setRoute: OptimizedRouteContextValue['setRoute'] = useCallback((r) => {
    setState((prev) => ({
      ...prev,
      ...r,
      updatedAt: r.updatedAt ?? new Date().toISOString(),
    }));
  }, []);

  const clearRoute = useCallback(() => {
    setState({
      ...INITIAL_STATE,
    });
  }, []);

  const setProgress = useCallback(
    (p: OptimizationProgress | null) =>
      setState((prev) => ({ ...prev, progress: p })),
    [],
  );

  const setOptimizing = useCallback(
    (b: boolean) => setState((prev) => ({ ...prev, isOptimizing: b })),
    [],
  );

  const computeRouteBounds: OptimizedRouteContextValue['computeRouteBounds'] =
    useCallback((origin) => {
      let lngMin = Number.POSITIVE_INFINITY;
      let latMin = Number.POSITIVE_INFINITY;
      let lngMax = Number.NEGATIVE_INFINITY;
      let latMax = Number.NEGATIVE_INFINITY;
      let touched = false;

      const consider = (lng: number, lat: number) => {
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;
        if (lng < lngMin) lngMin = lng;
        if (lat < latMin) latMin = lat;
        if (lng > lngMax) lngMax = lng;
        if (lat > latMax) latMax = lat;
        touched = true;
      };

      if (origin) consider(origin.longitude, origin.latitude);

      const ordered = orderedRef.current;
      for (const e of ordered) {
        if (typeof e.latitude === 'number' && typeof e.longitude === 'number') {
          consider(e.longitude, e.latitude);
        }
      }

      const geom = geometryRef.current;
      if (geom && Array.isArray(geom.geometry?.coordinates)) {
        for (const coord of geom.geometry.coordinates) {
          if (Array.isArray(coord) && coord.length >= 2) {
            consider(coord[0] as number, coord[1] as number);
          }
        }
      }

      if (!touched) return null;

      // Padding mínimo de 0.002 graus (~200m em latitudes brasileiras)
      // para o polyline não ficar grudado nas bordas.
      const pad = 0.002;
      return {
        sw: [lngMin - pad, latMin - pad],
        ne: [lngMax + pad, latMax + pad],
        padding: 48,
      };
    }, []);

  const value: OptimizedRouteContextValue = useMemo(
    () => ({
      ...state,
      setRoute,
      clearRoute,
      setProgress,
      setOptimizing,
      computeRouteBounds,
    }),
    [state, setRoute, clearRoute, setProgress, setOptimizing, computeRouteBounds],
  );

  return (
    <OptimizedRouteContext.Provider value={value}>
      {props.children}
    </OptimizedRouteContext.Provider>
  );
}

export function useOptimizedRoute(): OptimizedRouteContextValue {
  const ctx = useContext(OptimizedRouteContext);
  if (!ctx) {
    throw new Error(
      'useOptimizedRoute precisa estar dentro de <OptimizedRouteProvider>.',
    );
  }
  return ctx;
}

export default OptimizedRouteProvider;
