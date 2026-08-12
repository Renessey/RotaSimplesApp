import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { MapPin, Save, X } from 'lucide-react-native';
import type { Entrega } from '../types/entrega';
import { deliveryGeocodingOrchestrator } from '../services/geocoding/DeliveryGeocodingOrchestrator';

/**
 * ManualCoordinatePicker (TASK 6.17).
 *
 * Modal que permite ao usuário corrigir manualmente as coordenadas
 * de latitude/longitude de uma entrega. Ideal quando o Nominatim
 * retornou resultado ambíguo ou falhou completamente.
 *
 * Integra com `applyManualCoordinates()` do Orchestrator para
 * persistir as coords com status MANUAL, evitando reprocessamento
 * futuro automático.
 */

export interface ManualCoordinatePickerProps {
  /** Entrega sendo editada. */
  entrega: Entrega | null;
  /** Controle de exibição do modal. */
  visible: boolean;
  /** Chamado quando o modal é fechado (cancelar ou confirmar). */
  onClose: () => void;
  /** Chamado após salvar com sucesso. Recebe a entrega atualizada. */
  onSaved?: (entrega: Entrega) => void;
}

/** Valida e converte string de coordenada para número. */
function parseCoord(raw: string): number | null {
  const trimmed = raw.trim().replace(',', '.');
  if (trimmed.length === 0) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return null;
  return n;
}

export function ManualCoordinatePicker({
  entrega,
  visible,
  onClose,
  onSaved,
}: ManualCoordinatePickerProps) {
  const [latStr, setLatStr] = useState('');
  const [lngStr, setLngStr] = useState('');
  const [saving, setSaving] = useState(false);

  // Sempre que abrir e tiver entrega válida, preenche com os valores atuais
  useEffect(() => {
    if (visible && entrega) {
      setLatStr(entrega.latitude != null ? String(entrega.latitude) : '');
      setLngStr(entrega.longitude != null ? String(entrega.longitude) : '');
    }
  }, [visible, entrega]);

  const lat = parseCoord(latStr);
  const lng = parseCoord(lngStr);

  const latValid = lat != null && lat >= -90 && lat <= 90;
  const lngValid = lng != null && lng >= -180 && lng <= 180;
  const canSave = !saving && latValid && lngValid && entrega?.id != null;

  const handleSave = useCallback(async () => {
    if (!canSave || entrega?.id == null) return;
    setSaving(true);
    try {
      await deliveryGeocodingOrchestrator.applyManualCoordinates(
        entrega.id,
        lat!,
        lng!,
      );
      onSaved?.({
        ...entrega,
        latitude: lat!,
        longitude: lng!,
        geocodingStatus: 'MANUAL',
        geocodingConfidence: 1.0,
      });
      Alert.alert('Coordenadas salvas', 'Coordenadas atualizadas com sucesso.');
      onClose();
    } catch (error) {
      Alert.alert(
        'Falha ao salvar',
        error instanceof Error ? error.message : 'Erro desconhecido.',
      );
    } finally {
      setSaving(false);
    }
  }, [canSave, entrega, lat, lng, onClose, onSaved]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}
      transparent
    >
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'android' ? 20 : 0}
        enabled
      >
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View style={styles.titleRow}>
              <MapPin size={18} color="#2563eb" />
              <Text style={styles.title}>
                {entrega
                  ? `Coordenadas — ${entrega.nomeDestinatario}`
                  : 'Correção de coordenadas'}
              </Text>
            </View>
            <Pressable
              onPress={onClose}
              style={({ pressed }) => [
                styles.closeButton,
                pressed && { opacity: 0.7 },
              ]}
              hitSlop={6}
            >
              <X size={18} color="#64748b" />
            </Pressable>
          </View>

          {entrega ? (
            <View style={styles.addressBox}>
              <Text style={styles.addressLine}>
                {entrega.endereco}
                {entrega.numero ? `, ${entrega.numero}` : ''}
              </Text>
              {(entrega.bairro || entrega.cidade) && (
                <Text style={styles.addressMeta}>
                  {[entrega.bairro, entrega.cidade, entrega.cep]
                    .filter(Boolean)
                    .join(' • ')}
                </Text>
              )}
              {entrega.geocodingNote && (
                <Text style={styles.addressNote}>{entrega.geocodingNote}</Text>
              )}
            </View>
          ) : null}

          <View style={styles.fields}>
            <View style={styles.field}>
              <Text style={styles.label}>Latitude (-90 a 90)</Text>
              <TextInput
                value={latStr}
                onChangeText={setLatStr}
                placeholder="-22.9213"
                keyboardType="numeric"
                style={[
                  styles.input,
                  latStr.length > 0 && !latValid ? styles.inputInvalid : null,
                ]}
              />
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>Longitude (-180 a 180)</Text>
              <TextInput
                value={lngStr}
                onChangeText={setLngStr}
                placeholder="-42.8166"
                keyboardType="numeric"
                style={[
                  styles.input,
                  lngStr.length > 0 && !lngValid ? styles.inputInvalid : null,
                ]}
              />
            </View>
          </View>

          <View style={styles.helpBox}>
            <Text style={styles.helpText}>
              Dica: abra o Google Maps / OpenStreetMap, pressione e segure
              no local correto e copie as coordenadas.
            </Text>
          </View>

          <View style={styles.actionsRow}>
            <Pressable
              onPress={onClose}
              style={[styles.actionButton, styles.cancelButton, saving && styles.disabled]}
              disabled={saving}
            >
              <Text style={styles.cancelText}>Cancelar</Text>
            </Pressable>
            <Pressable
              onPress={handleSave}
              style={[
                styles.actionButton,
                styles.confirmButton,
                (!canSave) && styles.disabled,
              ]}
              disabled={!canSave}
            >
              <Save size={16} color="#ffffff" />
              <Text style={[styles.confirmText, { marginLeft: 6 }]}>
                {saving ? 'Salvando...' : 'Salvar manualmente'}
              </Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 16,
    paddingBottom: 28,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    gap: 10,
  },
  titleRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0f172a',
    flexShrink: 1,
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addressBox: {
    backgroundColor: '#f8fafc',
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  addressLine: {
    fontSize: 14,
    color: '#0f172a',
    fontWeight: '600',
  },
  addressMeta: {
    marginTop: 2,
    fontSize: 12,
    color: '#475569',
  },
  addressNote: {
    marginTop: 6,
    fontSize: 12,
    color: '#b45309',
  },
  fields: {
    flexDirection: 'row',
    gap: 12,
  },
  field: {
    flex: 1,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
    marginBottom: 4,
  },
  input: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 10,
    fontSize: 15,
    color: '#0f172a',
    backgroundColor: '#ffffff',
  },
  inputInvalid: {
    borderColor: '#dc2626',
    backgroundColor: '#fef2f2',
  },
  helpBox: {
    marginTop: 12,
    padding: 10,
    backgroundColor: '#eff6ff',
    borderRadius: 8,
  },
  helpText: {
    fontSize: 12,
    color: '#1d4ed8',
    lineHeight: 16,
  },
  actionsRow: {
    marginTop: 16,
    flexDirection: 'row',
    gap: 10,
  },
  actionButton: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelButton: {
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  cancelText: {
    color: '#475569',
    fontWeight: '600',
    fontSize: 14,
  },
  confirmButton: {
    backgroundColor: '#16a34a',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 14,
  },
  disabled: {
    opacity: 0.55,
  },
});

export default ManualCoordinatePicker;
