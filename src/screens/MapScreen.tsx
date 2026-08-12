import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  Camera,
  Map,
  Marker,
  NativeUserLocation,
  useCurrentPosition,
} from '@maplibre/maplibre-react-native';
import {
  ZoomIn,
  ZoomOut,
  Crosshair,
  MoveHorizontal,
  List,
} from 'lucide-react-native';
import {
  DEFAULT_ZOOM,
  FALLBACK_CENTER,
  MAP_STYLE_CANDIDATES,
  USER_LOCATION_ZOOM,
  getMapStyleForAttempt,
} from '../config/maps';
import { errorReporting } from '../services/errorReporting';
import {
  currentLocationService,
} from '../services/location/CurrentLocationService';
import { DeliveryManagerPanel, PanelSizeMode } from '../components/DeliveryManagerPanel';
import { DeliveryMarker } from '../components/DeliveryMarker';
import { DeliveryDetailsModal } from '../components/DeliveryDetailsModal';
import { RouteLayer } from '../components/RouteLayer';
import { useDeliveryMarkers } from '../hooks/DeliveryMarkersContext';
import { useOptimizedRoute } from '../hooks/OptimizedRouteContext';
import type { Entrega } from '../types/entrega';
import type { LocationStatus, UserLocation } from '../types/location';

const LOCATION_MIN_DISPLACEMENT = 5;

function getPanelMaxHeight(mode: PanelSizeMode): string {
  switch (mode) {
    case 'min':
      return '15%';
    case 'normal':
      return '50%';
    case 'max':
      return '88%';
  }
}

function MapScreen({ onOpenList }: { onOpenList?: () => void }) {
  const [locationStatus, setLocationStatus] =
    useState<LocationStatus>('unknown');
  const [userLocation, setUserLocation] = useState<UserLocation | undefined>(
    undefined,
  );
  const [panelSizeMode, setPanelSizeMode] = useState<PanelSizeMode>('normal');

  const currentPosition = useCurrentPosition({
    minDisplacement: LOCATION_MIN_DISPLACEMENT,
  });

  const attemptIndexRef = useRef(0);
  const mapRef = useRef<any>(null);
  const cameraRef = useRef<any>(null);
  const [attemptIndex, setAttemptIndex] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isStyleLoaded, setIsStyleLoaded] = useState(false);
  const [isFullyRendered, setIsFullyRendered] = useState(false);
  const [selectedEntrega, setSelectedEntrega] = useState<Entrega | null>(null);
  const { entregasGeocodificadas, reload: reloadMarkers } = useDeliveryMarkers();
  const {
    geometry: routeGeometry,
    computeRouteBounds,
    updatedAt: routeUpdatedAt,
  } = useOptimizedRoute();

  const effectiveLocation: UserLocation | undefined = useMemo(
    () =>
      currentPosition
        ? {
            coords: {
              longitude: currentPosition.coords.longitude,
              latitude: currentPosition.coords.latitude,
              accuracy: currentPosition.coords.accuracy,
              altitude: currentPosition.coords.altitude,
              altitudeAccuracy: currentPosition.coords.altitudeAccuracy,
              heading: currentPosition.coords.heading,
              speed: currentPosition.coords.speed,
            },
            timestamp: currentPosition.timestamp,
          }
        : userLocation,
    [currentPosition, userLocation],
  );

  const userLocationCoords: [number, number] | undefined = useMemo(
    () =>
      effectiveLocation
        ? [effectiveLocation.coords.longitude, effectiveLocation.coords.latitude]
        : undefined,
    [effectiveLocation],
  );

  const lastZoomRef = useRef<number>(
    effectiveLocation ? USER_LOCATION_ZOOM : DEFAULT_ZOOM,
  );
  const lastCenterRef = useRef<[number, number]>(
    userLocationCoords ?? FALLBACK_CENTER,
  );
  const lastBearingRef = useRef<number>(0);
  const lastPitchRef = useRef<number>(0);

  useEffect(() => {
    let active = true;

    const initLocation = async (): Promise<void> => {
      const permission = await currentLocationService.requestPermission();

      if (!active) {
        return;
      }

      if (permission === 'granted') {
        setLocationStatus('granted');
        const position = await currentLocationService.getCurrentPosition();

        if (!active) {
          return;
        }

        if (position) {
          setUserLocation(position);
          setLocationStatus('granted');
        }
      } else {
        setLocationStatus('denied');
      }
    };

    void initLocation();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (currentPosition) {
      setLocationStatus('granted');
    }
  }, [currentPosition]);

  useEffect(() => {
    const id = setInterval(() => {
      // eslint-disable-next-line no-console
      console.warn('[MapScreen] JS thread heartbeat OK');
    }, 5000);
    return () => clearInterval(id);
  }, []);

  const hasDumpedRefMethods = useRef(false);

  const dumpRefMethods = useCallback((): void => {
    if (hasDumpedRefMethods.current) return;
    hasDumpedRefMethods.current = true;
    try {
      const proto = Object.getPrototypeOf(cameraRef.current);
      const names = Object.getOwnPropertyNames(proto)
        .filter((n) => typeof (cameraRef.current as any)[n] === 'function')
        .sort();
      // eslint-disable-next-line no-console
      console.warn(`[MapScreen] cameraRef methods (${names.length}): ${names.join(', ')}`);
    } catch (err) {
      void err;
    }
    try {
      const proto = Object.getPrototypeOf(mapRef.current);
      const names = Object.getOwnPropertyNames(proto)
        .filter((n) => typeof (mapRef.current as any)[n] === 'function')
        .sort();
      const own = Object.keys(mapRef.current ?? {}).sort();
      // eslint-disable-next-line no-console
      console.warn(`[MapScreen] mapRef proto methods (${names.length}): ${names.join(', ')}; own: ${own.slice(0, 30).join(', ')}`);
    } catch (err) {
      void err;
    }
  }, []);

  const handleZoomIn = useCallback(() => {
    if (!cameraRef.current) return;
    dumpRefMethods();
    const next = Math.min(20, lastZoomRef.current + 1);
    // eslint-disable-next-line no-console
    console.warn(`[MapScreen] BTN zoomIn -> cameraRef.zoomTo(${next})`);
    try {
      cameraRef.current.zoomTo(next, { duration: 500, easing: 'ease' });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[MapScreen] ERRO zoomIn:', err instanceof Error ? err.message : String(err));
    }
  }, [dumpRefMethods]);

  const handleZoomOut = useCallback(() => {
    if (!cameraRef.current) return;
    dumpRefMethods();
    const next = Math.max(2, lastZoomRef.current - 1);
    // eslint-disable-next-line no-console
    console.warn(`[MapScreen] BTN zoomOut -> cameraRef.zoomTo(${next})`);
    try {
      cameraRef.current.zoomTo(next, { duration: 500, easing: 'ease' });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[MapScreen] ERRO zoomOut:', err instanceof Error ? err.message : String(err));
    }
  }, [dumpRefMethods]);

  const handleRecenter = useCallback(() => {
    if (!cameraRef.current) return;
    if (!userLocationCoords) {
      // eslint-disable-next-line no-console
      console.warn('[MapScreen] BTN recenter -> sem localização disponível');
      return;
    }
    // eslint-disable-next-line no-console
    console.warn(`[MapScreen] BTN recenter -> flyTo center=[${userLocationCoords[0]},${userLocationCoords[1]}]`);
    try {
      cameraRef.current.flyTo({
        center: userLocationCoords,
        zoom: USER_LOCATION_ZOOM,
        duration: 800,
        easing: 'ease',
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[MapScreen] ERRO recenter:', err instanceof Error ? err.message : String(err));
    }
  }, [userLocationCoords]);

  const handlePan = useCallback(() => {
    if (!cameraRef.current) return;
    dumpRefMethods();
    const ida: [number, number] = [-46.6533, -23.5605];
    // eslint-disable-next-line no-console
    console.warn(`[MapScreen] BTN pan -> flyTo center=[${ida[0]},${ida[1]}]`);
    try {
      cameraRef.current.flyTo({ center: ida, duration: 1000, easing: 'fly' });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[MapScreen] ERRO pan ida:', err instanceof Error ? err.message : String(err));
    }
    setTimeout(() => {
      if (!cameraRef.current) return;
      const volta = lastCenterRef.current;
      // eslint-disable-next-line no-console
      console.warn(`[MapScreen] BTN pan -> flyTo volta center=[${volta[0]},${volta[1]}]`);
      try {
        cameraRef.current.flyTo({ center: volta, duration: 1000, easing: 'fly' });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[MapScreen] ERRO pan volta:', err instanceof Error ? err.message : String(err));
      }
    }, 2200);
  }, [dumpRefMethods]);

  void hasDumpedRefMethods;

  useEffect(() => {
    if (!cameraRef.current || !isStyleLoaded) return;
    if (!routeUpdatedAt) return;
    try {
      const origin = effectiveLocation?.coords;
      const bounds = computeRouteBounds(origin);
      if (!bounds) return;
      // eslint-disable-next-line no-console
      console.warn(`[MapScreen] fitBounds route sw=${JSON.stringify(bounds.sw)} ne=${JSON.stringify(bounds.ne)}`);
      try {
        if (typeof cameraRef.current.fitBounds === 'function') {
          cameraRef.current.fitBounds(bounds.sw, bounds.ne, {
            padding: bounds.padding ?? 48,
            duration: 700,
            easing: 'ease',
          });
        }
      } catch {
        const cx = (bounds.sw[0] + bounds.ne[0]) / 2;
        const cy = (bounds.sw[1] + bounds.ne[1]) / 2;
        if (typeof cameraRef.current.easeTo === 'function') {
          cameraRef.current.easeTo({
            center: [cx, cy],
            zoom: 13,
            duration: 600,
            easing: 'ease',
          });
        }
      }
    } catch (err) {
      errorReporting.report(err, {
        context: 'MapScreen fitBounds route',
      });
    }
  }, [routeUpdatedAt, effectiveLocation, isStyleLoaded, computeRouteBounds]);

  const handleMapError = useCallback(
    (error: unknown): void => {
      const message =
        error instanceof Error
          ? error.message
          : String(error ?? 'Erro desconhecido');
      setLoadError(message);
      setIsStyleLoaded(false);
      setIsFullyRendered(false);
      errorReporting.report(error, {
        context: 'MapScreen',
        attemptIndex: attemptIndexRef.current,
      });
    },
    [],
  );

  const handleRetry = useCallback((): void => {
    if (attemptIndex + 1 >= MAP_STYLE_CANDIDATES.length) {
      setLoadError('Não foi possível carregar o mapa com nenhum estilo disponível.');
      return;
    }
    const next = attemptIndex + 1;
    attemptIndexRef.current = next;
    setAttemptIndex(next);
    setLoadError(null);
    setIsStyleLoaded(false);
    setIsFullyRendered(false);
  }, [attemptIndex]);

  const handleRetryPermission = useCallback(async (): Promise<void> => {
    const permission = await currentLocationService.requestPermission();
    if (permission === 'granted') {
      setLocationStatus('granted');
    } else {
      setLocationStatus('denied');
    }
  }, []);

  return (
    <View style={styles.container}>
      <View style={styles.mapArea}>
        <Map
          ref={mapRef}
          key={attemptIndex}
          style={styles.map}
          mapStyle={getMapStyleForAttempt(attemptIndex)}
          onDidFailLoadingMap={() =>
            handleMapError(new Error('Falha ao carregar o mapa.'))
          }
          onWillStartLoadingMap={() => {
            // eslint-disable-next-line no-console
            console.warn('[MapScreen] onWillStartLoadingMap');
          }}
          onDidFinishLoadingMap={() => {
            // eslint-disable-next-line no-console
            console.warn('[MapScreen] onDidFinishLoadingMap - estilo carregado');
            setIsStyleLoaded(true);
            setLoadError(null);
          }}
          onDidFinishRenderingMapFully={() => {
            // eslint-disable-next-line no-console
            console.warn('[MapScreen] onDidFinishRenderingMapFully - tiles renderizados');
            setIsFullyRendered(true);
          }}
          onRegionWillChange={(event) => {
            const vs = event.nativeEvent;
            const z = typeof vs.zoom === 'number' ? vs.zoom.toFixed(2) : '?';
            const tag = vs.userInteraction ? 'user' : 'auto';
            if (typeof vs.zoom === 'number') lastZoomRef.current = vs.zoom;
            if (typeof vs.bearing === 'number') lastBearingRef.current = vs.bearing;
            if (typeof vs.pitch === 'number') lastPitchRef.current = vs.pitch;
            if (Array.isArray(vs.center) && typeof vs.center[0] === 'number' && typeof vs.center[1] === 'number') {
              lastCenterRef.current = [vs.center[0], vs.center[1]];
            }
            // eslint-disable-next-line no-console
            console.warn(`[MapScreen] onRegionWillChange z=${z} ${tag}`);
          }}
          onRegionIsChanging={(event) => {
            const vs = event.nativeEvent;
            const z = typeof vs.zoom === 'number' ? vs.zoom.toFixed(2) : '?';
            const lng =
              Array.isArray(vs.center) && typeof vs.center[0] === 'number'
                ? vs.center[0].toFixed(4)
                : '?';
            const lat =
              Array.isArray(vs.center) && typeof vs.center[1] === 'number'
                ? vs.center[1].toFixed(4)
                : '?';
            const parts = [`z=${z}`, `lng=${lng}`, `lat=${lat}`];
            if (typeof vs.bearing === 'number' && Math.abs(vs.bearing) > 0.01) {
              parts.push(`rot=${vs.bearing.toFixed(0)}°`);
            }
            if (typeof vs.pitch === 'number' && Math.abs(vs.pitch) > 0.01) {
              parts.push(`pitch=${vs.pitch.toFixed(0)}°`);
            }
            if (vs.userInteraction) {
              parts.push('user');
            }
            if (typeof vs.zoom === 'number') lastZoomRef.current = vs.zoom;
            if (typeof vs.bearing === 'number') lastBearingRef.current = vs.bearing;
            if (typeof vs.pitch === 'number') lastPitchRef.current = vs.pitch;
            if (Array.isArray(vs.center) && typeof vs.center[0] === 'number' && typeof vs.center[1] === 'number') {
              lastCenterRef.current = [vs.center[0], vs.center[1]];
            }
            // eslint-disable-next-line no-console
            console.warn(`[MapScreen] onRegionIsChanging ${parts.join(' | ')}`);
          }}
          onRegionDidChange={(event) => {
            const vs = event.nativeEvent;
            const z = typeof vs.zoom === 'number' ? vs.zoom.toFixed(2) : '?';
            const lng =
              Array.isArray(vs.center) && typeof vs.center[0] === 'number'
                ? vs.center[0].toFixed(4)
                : '?';
            const lat =
              Array.isArray(vs.center) && typeof vs.center[1] === 'number'
                ? vs.center[1].toFixed(4)
                : '?';
            const parts = [`z=${z}`, `lng=${lng}`, `lat=${lat}`];
            if (typeof vs.bearing === 'number' && Math.abs(vs.bearing) > 0.01) {
              parts.push(`rot=${vs.bearing.toFixed(0)}°`);
            }
            if (typeof vs.pitch === 'number' && Math.abs(vs.pitch) > 0.01) {
              parts.push(`pitch=${vs.pitch.toFixed(0)}°`);
            }
            if (vs.userInteraction) {
              parts.push('user');
            }
            if (typeof vs.zoom === 'number') lastZoomRef.current = vs.zoom;
            if (typeof vs.bearing === 'number') lastBearingRef.current = vs.bearing;
            if (typeof vs.pitch === 'number') lastPitchRef.current = vs.pitch;
            if (Array.isArray(vs.center) && typeof vs.center[0] === 'number' && typeof vs.center[1] === 'number') {
              lastCenterRef.current = [vs.center[0], vs.center[1]];
            }
            // eslint-disable-next-line no-console
            console.warn(`[MapScreen] onRegionDidChange ${parts.join(' | ')}`);
          }}
        >
          <Camera
            ref={cameraRef}
            initialViewState={
              userLocationCoords
                ? { center: userLocationCoords, zoom: USER_LOCATION_ZOOM }
                : { center: FALLBACK_CENTER, zoom: DEFAULT_ZOOM }
            }
            trackUserLocation={locationStatus === 'granted' ? 'default' : undefined}
          />
          <NativeUserLocation />
          {userLocationCoords && (
            <Marker id="delivery-user" lngLat={userLocationCoords} anchor="bottom">
              <View style={styles.deliveryMarkerOuter}>
                <View style={styles.deliveryMarkerInner} />
              </View>
            </Marker>
          )}
          {entregasGeocodificadas.map((entrega, index) => (
            <DeliveryMarker
              key={entrega.id ?? `entrega-${index}`}
              entrega={entrega}
              number={entrega.ordemEntrega ?? index + 1}
              ordemEntrega={entrega.ordemEntrega}
              onPress={setSelectedEntrega}
            />
          ))}
          <RouteLayer
            key={
              routeUpdatedAt && routeGeometry
                ? `${routeUpdatedAt}-${routeGeometry.geometry.coordinates.length}`
                : 'route-layer-empty'
            }
            routeGeometry={routeGeometry}
          />
        </Map>

        {locationStatus === 'unknown' && !isFullyRendered && !loadError && (
          <View style={styles.locationOverlay} pointerEvents="none">
            <ActivityIndicator size="large" color="#2563eb" />
            <Text style={styles.locationOverlayText}>Obtendo sua localização...</Text>
          </View>
        )}

        {locationStatus === 'denied' && (
          <View style={styles.errorOverlay}>
            <Text style={styles.errorTitle}>Permissão de localização negada</Text>
            <Text style={styles.errorMessage}>
              Para mostrar sua posição no mapa, é necessário permitir o acesso à localização.
            </Text>
            <Pressable style={styles.retryButton} onPress={handleRetryPermission}>
              <Text style={styles.retryButtonText}>Tentar novamente</Text>
            </Pressable>
          </View>
        )}

        {locationStatus === 'unavailable' && (
          <View style={styles.errorOverlay}>
            <Text style={styles.errorTitle}>GPS desligado</Text>
            <Text style={styles.errorMessage}>
              Ative o GPS do dispositivo para ver sua posição no mapa.
            </Text>
            <Pressable style={styles.retryButton} onPress={handleRetryPermission}>
              <Text style={styles.retryButtonText}>Tentar novamente</Text>
            </Pressable>
          </View>
        )}

        {loadError && (
          <View style={styles.errorOverlay}>
            <Text style={styles.errorTitle}>Não foi possível carregar o mapa</Text>
            <Text style={styles.errorMessage}>{loadError}</Text>
            <Text style={styles.errorMeta}>
              Tentativa {attemptIndex + 1} de {MAP_STYLE_CANDIDATES.length}
            </Text>
            {attemptIndex + 1 < MAP_STYLE_CANDIDATES.length && (
              <Pressable style={styles.retryButton} onPress={handleRetry}>
                <Text style={styles.retryButtonText}>Tentar novamente</Text>
              </Pressable>
            )}
          </View>
        )}

        {!loadError && (locationStatus === 'granted' || locationStatus === 'unknown') && (
          <View style={styles.debugOverlay} pointerEvents="none">
            <View style={styles.debugChip}>
              <Text style={styles.debugChipText}>
                Tentativa {attemptIndex + 1}/{MAP_STYLE_CANDIDATES.length}
              </Text>
            </View>
            <View
              style={[
                styles.debugChip,
                {
                  backgroundColor: isFullyRendered
                    ? '#16a34a'
                    : isStyleLoaded
                      ? '#ca8a04'
                      : '#64748b',
                },
              ]}
            >
              <Text style={styles.debugChipText}>
                {isFullyRendered
                  ? 'Mapa renderizado'
                  : isStyleLoaded
                    ? 'Carregando tiles'
                    : 'Carregando estilo'}
              </Text>
            </View>
          </View>
        )}

        {onOpenList && isFullyRendered && !loadError && (
          <View style={styles.topRightButtons}>
            <Pressable
              style={styles.actionBtn}
              onPress={onOpenList}
              hitSlop={8}
            >
              <List size={22} color="#4338ca" strokeWidth={2.4} />
            </Pressable>
          </View>
        )}

        {isFullyRendered && !loadError && (locationStatus === 'granted' || locationStatus === 'unknown') && (
          <View style={[
            styles.actionButtons,
            { bottom: panelSizeMode === 'min' ? 120 : panelSizeMode === 'max' ? 32 : 104 },
          ]}>
            <Pressable
              style={styles.actionBtn}
              onPress={handleZoomIn}
              hitSlop={8}
            >
              <ZoomIn size={22} color="#0f172a" strokeWidth={2.4} />
            </Pressable>
            <Pressable
              style={styles.actionBtn}
              onPress={handleZoomOut}
              hitSlop={8}
            >
              <ZoomOut size={22} color="#0f172a" strokeWidth={2.4} />
            </Pressable>
            <Pressable
              style={styles.actionBtn}
              onPress={handleRecenter}
              hitSlop={8}
            >
              <Crosshair size={22} color="#2563eb" strokeWidth={2.4} />
            </Pressable>
            <Pressable
              style={styles.actionBtn}
              onPress={handlePan}
              hitSlop={8}
            >
              <MoveHorizontal size={22} color="#0f172a" strokeWidth={2.4} />
            </Pressable>
          </View>
        )}
      </View>

      <DeliveryDetailsModal
        entrega={selectedEntrega}
        visible={selectedEntrega != null}
        onClose={() => setSelectedEntrega(null)}
        onStatusChanged={(updated) => {
          void reloadMarkers();
          setSelectedEntrega(updated);
        }}
      />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'android' ? 20 : 0}
        enabled
        style={[
          styles.panelWrapper,
          { maxHeight: getPanelMaxHeight(panelSizeMode) },
        ]}
      >
        <DeliveryManagerPanel
          sizeMode={panelSizeMode}
          onSizeModeChange={setPanelSizeMode}
        />
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  mapArea: {
    flex: 1,
    minHeight: 120,
  },
  map: {
    flex: 1,
  },
  panelWrapper: {
    flexShrink: 1,
  },
  locationOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(255, 255, 255, 0.7)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  locationOverlayText: {
    marginTop: 12,
    fontSize: 15,
    color: '#1a1a1a',
    fontWeight: '600',
  },
  errorOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(255, 255, 255, 0.96)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1a1a1a',
    marginBottom: 8,
    textAlign: 'center',
  },
  errorMessage: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginBottom: 12,
  },
  errorMeta: {
    fontSize: 12,
    color: '#888',
    marginBottom: 24,
  },
  retryButton: {
    backgroundColor: '#2563eb',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  retryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  debugOverlay: {
    position: 'absolute',
    top: 12,
    left: 12,
    right: 12,
    alignItems: 'flex-start',
    gap: 6,
  },
  debugChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: '#0f172a',
  },
  debugChipText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
  },
  topRightButtons: {
    position: 'absolute',
    top: 16,
    right: 16,
    alignItems: 'center',
    gap: 10,
  },
  deliveryMarkerOuter: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#2563eb',
    borderWidth: 3,
    borderColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOpacity: 0.25,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 5,
  },
  deliveryMarkerInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#ffffff',
  },
  actionButtons: {
    position: 'absolute',
    right: 16,
    alignItems: 'center',
    gap: 10,
  },
  actionBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOpacity: 0.22,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 6,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
});

export default MapScreen;
