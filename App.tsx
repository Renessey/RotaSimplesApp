/**
 * Sample React Native App
 * https://github.com/facebook/react-native
 *
 * @format
 */

import React, { useCallback, useState } from 'react';
import { StatusBar, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import ErrorBoundary from './src/components/ErrorBoundary';
import { validateEnv } from './src/config/env';
import MapScreen from './src/screens/MapScreen';
import DeliveriesScreen from './src/screens/DeliveriesScreen';
import { DeliveryMarkersProvider } from './src/hooks/DeliveryMarkersContext';
import { OptimizedRouteProvider } from './src/hooks/OptimizedRouteContext';

validateEnv();

export type AppScreen = 'map' | 'deliveries';

export interface AppNavigationHandle {
  currentScreen: AppScreen;
  goToMap: (focusEntregaId?: number) => void;
  goToDeliveries: () => void;
}

function App() {
  return (
    <ErrorBoundary>
      <SafeAreaProvider>
        <StatusBar hidden translucent backgroundColor="transparent" />
        <AppContent />
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}

function AppContent() {
  const [screen, setScreen] = useState<AppScreen>('map');

  const goToMap = useCallback(() => {
    setScreen('map');
  }, []);

  const goToDeliveries = useCallback(() => {
    setScreen('deliveries');
  }, []);

  return (
    <OptimizedRouteProvider>
      <DeliveryMarkersProvider>
        <View style={styles.container}>
          {screen === 'map' ? (
            <MapScreen onOpenList={goToDeliveries} />
          ) : (
            <DeliveriesScreen onBack={goToMap} />
          )}
        </View>
      </DeliveryMarkersProvider>
    </OptimizedRouteProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});

export default App;
