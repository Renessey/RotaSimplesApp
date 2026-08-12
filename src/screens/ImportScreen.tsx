import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { DeliveryManagerPanel } from '../components/DeliveryManagerPanel';

/**
 * ImportScreen (Task 4.3).
 *
 * Tela dedicada à importação de entregas a partir de XLSX/CSV.
 * Reutiliza o `DeliveryManagerPanel`, que centraliza toda a lógica de
 * importação, prévia, erros de linha e persistência no SQLite.
 *
 * Foi criada como tela separada para permitir navegação futura, mas a
 * integração principal fica no painel abaixo do mapa (Task 4.4).
 */
export function ImportScreen() {
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Importação de Entregas</Text>
        <Text style={styles.subtitle}>
          Importe planilhas XLSX/CSV com as colunas: Nome, Endereço, CEP,
          Código de rastreio, Telefone, Número, Complemento, Bairro e Cidade.
        </Text>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <DeliveryManagerPanel />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 20,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#0f172a',
  },
  subtitle: {
    fontSize: 13,
    color: '#64748b',
    marginTop: 6,
    lineHeight: 18,
  },
  content: {
    padding: 12,
  },
});

export default ImportScreen;
