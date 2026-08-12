import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { getEntregas } from '../database/DeliveryRepository';
import { errorReporting } from '../services/errorReporting';
import type { Entrega } from '../types/entrega';

/**
 * DeliveryMarkersContext (FASE 7 — integração dos marcadores no mapa).
 *
 * Compartilha o estado das entregas geocodificadas entre o `MapScreen`
 * (que renderiza os marcadores) e o `DeliveryManagerPanel` (que importa,
 * geocodifica e atualiza as entregas). Isso mantém os marcadores em
 * sincronia após importação, geocodificação e correção manual.
 *
 *  - 7.2: expõe apenas entregas geocodificadas (latitude/longitude válidas).
 */

interface DeliveryMarkersContextValue {
  /** Entregas com coordenadas válidas (prontas para exibir no mapa). */
  entregasGeocodificadas: Entrega[];
  /** Recarrega as entregas do banco local. */
  reload: () => Promise<void>;
  /** Carregando a lista. */
  loading: boolean;
}

const DeliveryMarkersContext = createContext<
  DeliveryMarkersContextValue | undefined
>(undefined);

/** Verifica se a entrega possui coordenadas válidas para exibir no mapa. */
function hasValidCoordinates(entrega: Entrega): boolean {
  return (
    entrega.latitude != null &&
    entrega.longitude != null &&
    Number.isFinite(entrega.latitude) &&
    Number.isFinite(entrega.longitude)
  );
}

export function DeliveryMarkersProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [entregasGeocodificadas, setEntregasGeocodificadas] = useState<
    Entrega[]
  >([]);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const entregas = await getEntregas({});
      setEntregasGeocodificadas(entregas.filter(hasValidCoordinates));
    } catch (error) {
      errorReporting.report(error, {
        context: 'DeliveryMarkersContext.reload',
      });
    } finally {
      setLoading(false);
    }
  }, []);

  // Carrega ao montar.
  useEffect(() => {
    void reload();
  }, [reload]);

  const value = useMemo(
    () => ({
      entregasGeocodificadas,
      reload,
      loading,
    }),
    [entregasGeocodificadas, reload, loading],
  );

  return (
    <DeliveryMarkersContext.Provider value={value}>
      {children}
    </DeliveryMarkersContext.Provider>
  );
}

/** Hook de acesso ao contexto de marcadores. */
export function useDeliveryMarkers(): DeliveryMarkersContextValue {
  const context = useContext(DeliveryMarkersContext);
  if (!context) {
    throw new Error(
      'useDeliveryMarkers deve ser usado dentro de DeliveryMarkersProvider.',
    );
  }
  return context;
}

export default DeliveryMarkersProvider;
