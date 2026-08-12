import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  X,
  StickyNote,
  CheckCircle2,
  CircleDashed,
  Ban,
  Save,
  MapPin,
  CalendarDays,
  Phone,
  Hash,
  Tag,
} from 'lucide-react-native';
import type { Entrega, DeliveryStatus } from '../types/entrega';
import {
  STATUS_COLORS,
  STATUS_LABELS,
  normalizeStatus,
} from '../status/DeliveryStatus';
import { updateEntrega } from '../database/DeliveryRepository';
import { errorReporting } from '../services/errorReporting';
import { useDeliveryMarkers } from '../hooks/DeliveryMarkersContext';

/**
 * DeliveryDetailsModal (FASE 7 + FASE 12 — Tasks 12.1-12.8).
 *
 * Exibe detalhes da entrega e permite:
 *  - Visualizar detalhes completos
 *  - Alterar status: PENDENTE / ENTREGUE / NÃO ENTREGUE (INFRUTIFERO)
 *  - Adicionar observação
 *  - Persistir no SQLite e atualizar mapa/lista imediatamente
 */

export type QuickStatus = 'PENDENTE' | 'ENTREGUE' | 'INFRUTIFERO';

const QUICK_OPTIONS: {
  value: QuickStatus;
  label: string;
  hint: string;
}[] = [
  { value: 'PENDENTE', label: 'Pendente', hint: 'Voltar para fila' },
  { value: 'ENTREGUE', label: 'Entregue', hint: 'Concluída com sucesso' },
  {
    value: 'INFRUTIFERO',
    label: 'Não entregue',
    hint: 'Ausente / endereço inexistente etc.',
  },
];

function quickIcon(value: QuickStatus, size = 18) {
  switch (value) {
    case 'PENDENTE':
      return <CircleDashed size={size} color="#d97706" />;
    case 'ENTREGUE':
      return <CheckCircle2 size={size} color="#16a34a" />;
    case 'INFRUTIFERO':
      return <Ban size={size} color="#7c3aed" />;
  }
}

function statusIcon(status: DeliveryStatus, size = 14) {
  switch (status) {
    case 'PENDENTE':
      return <CircleDashed size={size} color="#d97706" />;
    case 'EM_TRANSITO':
      return <CircleDashed size={size} color="#2563eb" />;
    case 'ENTREGUE':
      return <CheckCircle2 size={size} color="#16a34a" />;
    case 'FALHOU':
      return <Ban size={size} color="#dc2626" />;
    case 'INFRUTIFERO':
      return <Ban size={size} color="#7c3aed" />;
    case 'CANCELADA':
      return <Ban size={size} color="#64748b" />;
  }
}

interface DeliveryDetailsModalProps {
  entrega: Entrega | null;
  visible: boolean;
  onClose: () => void;
  /** Chamado após salvar status/observação com sucesso. */
  onStatusChanged?: (entrega: Entrega) => void;
}

function DetailRow({
  label,
  value,
  icon,
}: {
  label: string;
  value?: string;
  icon?: React.ReactNode;
}) {
  if (!value) return null;
  return (
    <View style={styles.detailRow}>
      <View style={styles.detailLabelWrap}>
        {icon ?? <View style={{ width: 14 }} />}
        <Text style={styles.detailLabel}>{label}</Text>
      </View>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

export function DeliveryDetailsModal({
  entrega,
  visible,
  onClose,
  onStatusChanged,
}: DeliveryDetailsModalProps) {
  const { reload: reloadMarkers } = useDeliveryMarkers();

  const [quickStatus, setQuickStatus] = useState<QuickStatus | null>(null);
  const [observacao, setObservacao] = useState('');
  const [saving, setSaving] = useState(false);

  /* Sincroniza campos locais com entrega sempre que ela mudar */
  useEffect(() => {
    if (visible && entrega) {
      const s = normalizeStatus(entrega.status);
      if (s === 'PENDENTE' || s === 'ENTREGUE' || s === 'INFRUTIFERO') {
        setQuickStatus(s as QuickStatus);
      } else {
        setQuickStatus(null);
      }
      setObservacao(entrega.observacao ?? '');
    }
  }, [visible, entrega]);

  const statusAtual = useMemo(
    () => normalizeStatus(entrega?.status),
    [entrega],
  );

  const dirty = useMemo(() => {
    if (!entrega) return false;
    const obsChanged = observacao !== (entrega.observacao ?? '');
    const statusChanged =
      quickStatus != null && quickStatus !== normalizeStatus(entrega.status);
    return obsChanged || statusChanged;
  }, [entrega, quickStatus, observacao]);

  const handleSave = useCallback(async () => {
    if (!entrega || entrega.id == null || saving) return;
    if (!dirty) {
      onClose();
      return;
    }
    setSaving(true);
    try {
      const nextStatus: DeliveryStatus = quickStatus ?? normalizeStatus(entrega.status);
      const updated = await updateEntrega(entrega.id, {
        status: nextStatus,
        observacao: observacao.trim().length > 0 ? observacao.trim() : undefined,
      });
      if (updated) {
        /* TASK 12.7: Atualizar mapa imediatamente */
        void reloadMarkers();
        /* TASK 12.8: atualizar lista imediatamente via callback */
        onStatusChanged?.(updated);
      }
      onClose();
    } catch (error) {
      errorReporting.report(error, {
        context: 'DeliveryDetailsModal.saveStatus',
        entregaId: entrega.id,
      });
    } finally {
      setSaving(false);
    }
  }, [
    entrega,
    saving,
    dirty,
    quickStatus,
    observacao,
    onClose,
    reloadMarkers,
    onStatusChanged,
  ]);

  if (!entrega) return null;

  const statusColor = STATUS_COLORS[statusAtual];
  const statusLabel = STATUS_LABELS[statusAtual];

  const endereco = entrega.endereco
    ? `${entrega.endereco}${entrega.numero ? `, ${entrega.numero}` : ''}${
        entrega.complemento ? ` - ${entrega.complemento}` : ''
      }`
    : undefined;

  const localizacao =
    entrega.latitude != null && entrega.longitude != null
      ? `${entrega.latitude.toFixed(6)}, ${entrega.longitude.toFixed(6)}`
      : undefined;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'android' ? 20 : 0}
        enabled
      >
        <View style={styles.card}>
          <View style={styles.header}>
            <Text style={styles.title}>Detalhes da entrega</Text>
            <Pressable
              style={({ pressed }) => [
                styles.closeButton,
                pressed && { opacity: 0.7 },
              ]}
              onPress={onClose}
              hitSlop={8}
            >
              <X size={18} color="#475569" />
            </Pressable>
          </View>

          <ScrollView
            style={styles.body}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator
          >
            {/* Status atual */}
            <View style={styles.currentStatusRow}>
              <View style={styles.detailLabelWrap}>
                <Tag size={14} color="#475569" />
                <Text style={styles.detailLabel}>Status atual</Text>
              </View>
              <View
                style={[
                  styles.statusBadge,
                  { backgroundColor: statusColor },
                ]}
              >
                {statusIcon(statusAtual, 12)}
                <Text style={styles.statusBadgeText}>{'  '}{statusLabel}</Text>
              </View>
            </View>

            <DetailRow
              label="Nome"
              value={entrega.nomeDestinatario}
              icon={<MapPin size={14} color="#475569" />}
            />
            <DetailRow label="Endereço" value={endereco} />
            <DetailRow
              label="Bairro / Cidade"
              value={
                [entrega.bairro, entrega.cidade].filter(Boolean).join(' • ') ||
                undefined
              }
            />
            <DetailRow label="CEP" value={entrega.cep} icon={<MapPin size={14} color="#2563eb" />} />
            <DetailRow
              label="Telefone"
              value={entrega.telefone}
              icon={<Phone size={14} color="#475569" />}
            />
            <DetailRow
              label="Código de rastreio"
              value={entrega.codigoRastreio}
              icon={<Hash size={14} color="#8b5cf6" />}
            />
            <DetailRow
              label="Ordem"
              value={
                entrega.ordemEntrega != null
                  ? `${entrega.ordemEntrega}ª na rota`
                  : undefined
              }
              icon={<CalendarDays size={14} color="#475569" />}
            />
            <DetailRow label="Coordenadas" value={localizacao} />

            {/* =========================================================
             * FASE 12 — Alterar status / observação
             * ========================================================= */}

            <View style={styles.sectionDivider} />

            <Text style={styles.sectionTitle}>Alterar status</Text>

            <View style={styles.statusOptions}>
              {QUICK_OPTIONS.map((opt) => {
                const active = quickStatus === opt.value;
                const borderColor = STATUS_COLORS[opt.value as DeliveryStatus];
                return (
                  <Pressable
                    key={opt.value}
                    onPress={() => setQuickStatus(opt.value)}
                    style={({ pressed }) => [
                      styles.statusOption,
                      active && {
                        borderColor,
                        backgroundColor: `${borderColor}15`,
                      },
                      pressed && { opacity: 0.85 },
                    ]}
                  >
                    <View style={styles.statusOptionRow}>
                      {quickIcon(opt.value, 18)}
                      <Text
                        style={[
                          styles.statusOptionLabel,
                          active && { color: borderColor },
                        ]}
                      >
                        {opt.label}
                      </Text>
                    </View>
                    <Text style={styles.statusOptionHint}>{opt.hint}</Text>
                  </Pressable>
                );
              })}
            </View>

            <View style={styles.obsWrapper}>
              <View style={styles.obsHeader}>
                <StickyNote size={14} color="#92400e" />
                <Text style={styles.obsLabel}>Observação</Text>
              </View>
              <TextInput
                style={styles.obsInput}
                value={observacao}
                onChangeText={setObservacao}
                placeholder="Ex.: entregue ao porteiro / ausente / mudou-se..."
                placeholderTextColor="#94a3b8"
                multiline
                numberOfLines={3}
                maxLength={240}
                textAlignVertical="top"
                returnKeyType="default"
                blurOnSubmit={false}
              />
              <Text style={styles.obsCounter}>
                {observacao.length}/240
              </Text>
            </View>
          </ScrollView>

          <View style={styles.footer}>
            <Pressable
              onPress={onClose}
              style={({ pressed }) => [
                styles.footerBtn,
                styles.cancelBtn,
                pressed && { opacity: 0.7 },
                saving && styles.disabled,
              ]}
              disabled={saving}
              hitSlop={6}
            >
              <Text style={styles.cancelBtnText}>Fechar</Text>
            </Pressable>
            <Pressable
              onPress={handleSave}
              style={({ pressed }) => [
                styles.footerBtn,
                styles.confirmBtn,
                !dirty && styles.disabled,
                pressed && { opacity: 0.85 },
                saving && styles.disabled,
              ]}
              disabled={saving || !dirty}
              hitSlop={6}
            >
              {saving ? (
                <ActivityIndicator color="#ffffff" size="small" />
              ) : (
                <>
                  <Save size={16} color="#ffffff" />
                  <Text style={styles.confirmBtnText}>Salvar</Text>
                </>
              )}
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
    backgroundColor: 'rgba(15, 23, 42, 0.62)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '92%',
    backgroundColor: '#ffffff',
    borderRadius: 18,
    padding: 16,
    shadowColor: '#000000',
    shadowOpacity: 0.3,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 12,
    gap: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    color: '#0f172a',
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flex: 0,
    maxHeight: 520,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
    gap: 12,
  },
  detailLabelWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
  },
  detailLabel: {
    fontSize: 13,
    color: '#64748b',
    fontWeight: '600',
  },
  detailValue: {
    fontSize: 14,
    color: '#0f172a',
    fontWeight: '500',
    flexShrink: 1,
    textAlign: 'right',
    maxWidth: '65%',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  statusBadgeText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  currentStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    marginBottom: 4,
    gap: 12,
  },
  sectionDivider: {
    height: 1,
    backgroundColor: '#e2e8f0',
    marginVertical: 12,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 8,
    letterSpacing: 0.2,
  },
  statusOptions: {
    gap: 8,
  },
  statusOption: {
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#f8fafc',
  },
  statusOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusOptionLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
  },
  statusOptionHint: {
    marginTop: 2,
    marginLeft: 26,
    fontSize: 11,
    color: '#64748b',
  },
  obsWrapper: {
    marginTop: 14,
    gap: 6,
  },
  obsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  obsLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#92400e',
    letterSpacing: 0.2,
  },
  obsInput: {
    borderWidth: 1,
    borderColor: '#fed7aa',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#fffbeb',
    minHeight: 72,
    fontSize: 14,
    color: '#78350f',
    textAlignVertical: 'top',
  },
  obsCounter: {
    alignSelf: 'flex-end',
    fontSize: 11,
    color: '#a16207',
    fontWeight: '600',
  },
  footer: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 6,
  },
  footerBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 12,
  },
  cancelBtn: {
    backgroundColor: '#f1f5f9',
  },
  cancelBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#475569',
  },
  confirmBtn: {
    backgroundColor: '#4338ca',
  },
  confirmBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#ffffff',
  },
  disabled: {
    opacity: 0.5,
  },
});

export default DeliveryDetailsModal;
