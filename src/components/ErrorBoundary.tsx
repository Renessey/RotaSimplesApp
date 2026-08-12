import React, { Component, type ErrorInfo as ReactErrorInfo, type ReactNode } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { errorReporting } from '../services/errorReporting';
import { getUserMessage } from '../utils/errorHandler';

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Fallback customizado para renderização quando ocorrer um erro. */
  fallback?: (error: Error, reset: () => void) => ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

/**
 * Error Boundary global da aplicação.
 * Captura erros de renderização (lifecycle) e exibe uma UI amigável,
 * além de enviar o erro ao serviço de reporting.
 */
export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ReactErrorInfo): void {
    errorReporting.report(error, {
      context: 'ErrorBoundary',
      componentStack: info.componentStack,
    });
  }

  private reset = (): void => {
    this.setState({ hasError: false, error: undefined });
  };

  render(): ReactNode {
    const { children, fallback } = this.props;
    const { hasError, error } = this.state;

    if (!hasError) {
      return children;
    }

    if (fallback) {
      return fallback(error as Error, this.reset);
    }

    return (
      <View style={styles.container}>
        <Text style={styles.title}>Ops! Algo deu errado.</Text>
        <Text style={styles.message}>{getUserMessage(error)}</Text>
        <TouchableOpacity style={styles.button} onPress={this.reset}>
          <Text style={styles.buttonText}>Tentar novamente</Text>
        </TouchableOpacity>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#fff',
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1a1a1a',
    marginBottom: 12,
    textAlign: 'center',
  },
  message: {
    fontSize: 15,
    color: '#666',
    textAlign: 'center',
    marginBottom: 24,
  },
  button: {
    backgroundColor: '#2563eb',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
