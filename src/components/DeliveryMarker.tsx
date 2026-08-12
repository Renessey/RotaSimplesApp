import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Marker } from '@maplibre/maplibre-react-native';
import type { Entrega, DeliveryStatus } from '../types/entrega';
import { normalizeStatus, STATUS_COLORS } from '../status/DeliveryStatus';

/**
 * DeliveryMarker (FASE 7 — Tasks 7.1, 7.3, 7.4, 7.5, 7.6, 7.7).
 *
 * Marcador circular de uma entrega no mapa:
 *  - 7.1: componente de marcador de entrega.
 *  - 7.3: formato circular (círculo colorido + anel branco).
 *  - 7.4: mostra o número dentro do marcador.
 *  - 7.5: número usa `ordem_entrega` (fallback: índice sequencial).
 *  - 7.6: cor do marcador muda conforme o `status`.
 *  - 7.7: `onPress` ao clicar no marcador.
 */

interface DeliveryMarkerProps {
  entrega: Entrega;
  /** Número a exibir (Task 7.5: usa ordem_entrega; fallback: índice). */
  number: number;
  /**
   * Ordem de entrega (FASE 9, TASK 9.5). Quando fornecido, desenha um
   * badge adicional no canto superior mostrando a parada calculada pelo
   * OptimizationService — independente do índice da lista.
   */
  ordemEntrega?: number;
  /** Callback ao clicar no marcador (Task 7.7). */
  onPress?: (entrega: Entrega) => void;
}

export function DeliveryMarker({
  entrega,
  number,
  ordemEntrega,
  onPress,
}: DeliveryMarkerProps) {
  if (entrega.latitude == null || entrega.longitude == null) {
    return null;
  }

  const status: DeliveryStatus = normalizeStatus(entrega.status);
  const color = STATUS_COLORS[status];

  return (
    <Marker
      id={`entrega-${entrega.id ?? number}`}
      lngLat={[entrega.longitude, entrega.latitude]}
      anchor="center"
      onPress={() => onPress?.(entrega)}
    >
      <View style={styles.wrapper}>
        <View style={styles.markerOuter}>
          <View style={[styles.markerInner, { backgroundColor: color }]}>
            <Text style={styles.markerNumber}>{number}</Text>
          </View>
        </View>
        {ordemEntrega != null && ordemEntrega > 0 ? (
          <View style={styles.orderBadge}>
            <Text style={styles.orderBadgeText}>{ordemEntrega}</Text>
          </View>
        ) : null}
      </View>
    </Marker>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'relative',
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markerOuter: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#ffffff',
    borderWidth: 3,
    borderColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOpacity: 0.3,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
    elevation: 6,
  },
  markerInner: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markerNumber: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '800',
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  orderBadge: {
    position: 'absolute',
    top: 0,
    right: 0,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#2563eb',
    borderWidth: 2,
    borderColor: '#ffffff',
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOpacity: 0.25,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 4,
  },
  orderBadgeText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '900',
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
});

export default DeliveryMarker;
