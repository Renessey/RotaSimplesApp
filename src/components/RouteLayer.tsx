import React, { useMemo } from 'react';
import { GeoJSONSource, Layer } from '@maplibre/maplibre-react-native';
import type { Feature, FeatureCollection, LineString } from 'geojson';

/**
 * RouteLayer (FASE 10 — TASKS 10.1..10.7).
 *
 * Desenha a rota completa (linha poligonal) sobre um `<Map>` MapLibre.
 *
 * API MapLibre RN 13.x (oficial):
 *   - GeoJSONSource com prop `data` (string | GeoJSON) — a source propriamente dita.
 *   - Layer com `type="line"`, `paint={...}` (ex.: line-color / line-width) e
 *     `layout={...}` (ex.: line-cap / line-join) — NÃO usa a prop antiga
 *     `style` (deprecated) nem componentes inexistentes `LineLayer`/`ShapeSource`.
 *   - minzoom (minúsculas, propriedade codegen nativa).
 *   - source: string (aponta para o `id` da GeoJSONSource).
 */

export interface RouteLayerProps {
  /** Geometria da rota (resultado do RoutingService). null sem rota. */
  routeGeometry: Feature<LineString> | null;
  /** Cor do traço principal (padrão MapLibre primary). */
  lineColor?: string;
  /** Espessura do traço em pixels (padrão 5). */
  lineWidth?: number;
  /** ID único da source; padrão = "route-source". */
  sourceID?: string;
  /** Nível de zoom mínimo para mostrar a linha. */
  minZoomLevel?: number;
}

const DEFAULT_LINE_COLOR = '#2563eb';
const DEFAULT_LINE_WIDTH = 5;

function emptyCollection(): FeatureCollection<LineString> {
  return { type: 'FeatureCollection', features: [] };
}

function toCollection(
  geom: Feature<LineString> | null,
): FeatureCollection<LineString> {
  if (!geom) return emptyCollection();
  return { type: 'FeatureCollection', features: [geom] };
}

export function RouteLayer(props: RouteLayerProps) {
  const {
    routeGeometry,
    lineColor = DEFAULT_LINE_COLOR,
    lineWidth = DEFAULT_LINE_WIDTH,
    sourceID = 'route-source',
    minZoomLevel,
  } = props;

  const collection = useMemo(
    () => toCollection(routeGeometry),
    [routeGeometry],
  );

  const featureCount = collection.features.length;
  const coordsCount =
    collection.features[0]?.geometry.coordinates.length ?? 0;
  const sourceKey = useMemo(
    () => `${sourceID}-${featureCount}-${coordsCount}`,
    [sourceID, featureCount, coordsCount],
  );

  const shadowWidth = Math.max(1, lineWidth + 2);
  const shadowId = `${sourceID}-shadow`;
  const mainId = `${sourceID}-main`;

  const layout = {
    'line-cap': 'round' as const,
    'line-join': 'round' as const,
    visibility: 'visible' as const,
  };

  return (
    <GeoJSONSource id={sourceID} key={sourceKey} data={collection}>
      <Layer
        id={shadowId}
        type="line"
        source={sourceID}
        minzoom={minZoomLevel}
        paint={{
          'line-color': 'rgba(15, 23, 42, 0.22)',
          'line-width': shadowWidth,
        }}
        layout={layout}
      />
      <Layer
        id={mainId}
        type="line"
        source={sourceID}
        minzoom={minZoomLevel}
        paint={{
          'line-color': lineColor,
          'line-width': lineWidth,
        }}
        layout={layout}
      />
    </GeoJSONSource>
  );
}

export default RouteLayer;
