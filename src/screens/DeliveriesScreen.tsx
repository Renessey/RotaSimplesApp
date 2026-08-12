import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  ArrowLeft,
  Search,
  MapPin,
  Navigation,
  PackageCheck,
  CircleDashed,
  Truck,
  CheckCircle2,
  XCircle,
  Ban,
  Filter,
  ListOrdered,
  ChevronRight,
  Map as MapIcon,
} from 'lucide-react-native';
import {
  clearDeliveries,
  countEntregas,
  countEntregasByGeocodingStatus,
  getEntregas,
} from '../database/DeliveryRepository';
import { errorReporting } from '../services/errorReporting';
import type { Entrega, DeliveryStatus } from '../types/entrega';
import {
  STATUS_COLORS,
  STATUS_LABELS,
  normalizeStatus,
} from '../status/DeliveryStatus';
import { useDeliveryMarkers } from '../hooks/DeliveryMarkersContext';

/* ------------------------------------------------------------------ *
 * Filtros
 * ------------------------------------------------------------------ */

type StatusFilter = 'ALL' | DeliveryStatus;

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'ALL', label: 'Todas' },
  { value: 'PENDENTE', label: STATUS_LABELS.PENDENTE },
  { value: 'EM_TRANSITO', label: STATUS_LABELS.EM_TRANSITO },
  { value: 'ENTREGUE', label: STATUS_LABELS.ENTREGUE },
  { value: 'FALHOU', label: STATUS_LABELS.FALHOU },
  { value: 'INFRUTIFERO', label: STATUS_LABELS.INFRUTIFERO },
  { value: 'CANCELADA', label: STATUS_LABELS.CANCELADA },
];

function statusIcon(status: DeliveryStatus, size = 14) {
  switch (status) {
    case 'PENDENTE':
      return <CircleDashed size={size} color="#d97706" />;
    case 'EM_TRANSITO':
      return <Truck size={size} color="#2563eb" />;
    case 'ENTREGUE':
      return <CheckCircle2 size={size} color="#16a34a" />;
    case 'FALHOU':
      return <XCircle size={size} color="#dc2626" />;
    case 'INFRUTIFERO':
      return <Ban size={size} color="#7c3aed" />;
    case 'CANCELADA':
      return <Ban size={size} color="#64748b" />;
  }
}

export interface DeliveriesScreenProps {
  onBack?: () => void;
  onFocusEntrega?: (entregaId: number) => void;
}

export function DeliveriesScreen(props: DeliveriesScreenProps) {
  const { onBack } = props;
  const [entregas, setEntregas] = useState<Entrega[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');

  const [geocodingStats, setGeocodingStats] = useState<Record<string, number>>({
    PENDING: 0,
    GEOCODED: 0,
    FAILED: 0,
    AMBIGUOUS: 0,
    MANUAL: 0,
  });

  const { reload: reloadMarkers } = useDeliveryMarkers();

  const [debouncedSearch, setDebouncedSearch] = useState('');

  /* --- Debounce search (TASK 15.8) --- */
  useEffect(() => {
    const id = setTimeout(() => {
      Keyboard.dismiss();
      setDebouncedSearch(search.trim());
    }, 280);
    return () => clearTimeout(id);
  }, [search]);

  const reloadGeoStats = useCallback(async () => {
    try {
      const stats = await countEntregasByGeocodingStatus();
      setGeocodingStats(stats);
    } catch (error) {
      errorReporting.report(error, { context: 'DeliveriesScreen.reloadGeoStats' });
    }
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [items, total] = await Promise.all([
        getEntregas({
          search: debouncedSearch || undefined,
          status: statusFilter === 'ALL' ? undefined : statusFilter,
          limit: 1500,
        }),
        countEntregas(),
      ]);
      setEntregas(items);
      setTotalCount(total);
    } catch (error) {
      errorReporting.report(error, { context: 'DeliveriesScreen.reload' });
    } finally {
      setLoading(false);
      void reloadGeoStats();
    }
  }, [debouncedSearch, statusFilter, reloadGeoStats]);

  useEffect(() => {
    void reload();
  }, [reload]);

  /* --- Progresso (TASK 11.6) --- */
  const progress = useMemo(() => {
    let entregues = 0;
    let pendentes = 0;
    let emTransito = 0;
    for (const e of entregas) {
      const s = normalizeStatus(e.status);
      if (s === 'ENTREGUE') entregues += 1;
      else if (s === 'PENDENTE') pendentes += 1;
      else if (s === 'EM_TRANSITO') emTransito += 1;
    }
    const total = entregas.length;
    const porcento = total > 0 ? Math.round((entregues / total) * 100) : 0;
    return { entregues, pendentes, emTransito, total, porcento };
  }, [entregas]);

  /* --- Próxima entrega (TASK 11.7) --- */
  const proximaEntrega = useMemo<Entrega | null>(() => {
    const candidatas = entregas.filter((e) => {
      const s = normalizeStatus(e.status);
      return s !== 'ENTREGUE' && s !== 'CANCELADA';
    });
    if (candidatas.length === 0) return null;
    candidatas.sort((a, b) => {
      const oa = a.ordemEntrega ?? Number.MAX_SAFE_INTEGER;
      const ob = b.ordemEntrega ?? Number.MAX_SAFE_INTEGER;
      if (oa !== ob) return oa - ob;
      return (a.id ?? 0) - (b.id ?? 0);
    });
    return candidatas[0] ?? null;
  }, [entregas]);

  const confirmClearAll = useCallback(() => {
    Alert.alert(
      'Limpar entregas',
      'Deseja excluir TODAS as entregas? Esta ação não pode ser desfeita.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Limpar tudo',
          style: 'destructive',
          onPress: async () => {
            await clearDeliveries();
            setEntregas([]);
            setTotalCount(0);
            void reloadGeoStats();
            void reloadMarkers();
          },
        },
      ],
    );
  }, [reloadGeoStats, reloadMarkers]);

  const goBackOrClose = useCallback(() => {
    Keyboard.dismiss();
    onBack?.();
  }, [onBack]);

  const handleOpenOnMap = useCallback(
    (_entrega: Entrega) => {
      // Volta para o mapa; contexto mantém marcadores atualizados
      onBack?.();
    },
    [onBack],
  );

  const pendingGeoCount = geocodingStats.PENDING ?? 0;
  const failedGeoCount =
    (geocodingStats.FAILED ?? 0) + (geocodingStats.AMBIGUOUS ?? 0);
  const okGeoCount =
    (geocodingStats.GEOCODED ?? 0) + (geocodingStats.MANUAL ?? 0);

  /* ------------------------------------------------------------------ *
   * Render
   * ------------------------------------------------------------------ */

  const renderHeader = () => (
    <View style={styles.listHeader}>
      {/* Progresso */}
      <View style={styles.progressCard}>
        <View style={styles.progressHeader}>
          <View style={styles.progressTitleRow}>
            <PackageCheck size={18} color="#4338ca" />
            <Text style={styles.progressTitle}>Progresso</Text>
          </View>
          <Text style={styles.progressPct}>{progress.porcento}%</Text>
        </View>
        <View style={styles.progressBarTrack}>
          <View
            style={[
              styles.progressBarFill,
              { width: `${Math.min(100, progress.porcento)}%` },
            ]}
          />
        </View>
        <View style={styles.progressMetaRow}>
          <Text style={styles.progressMeta}>
            <Text style={{ fontWeight: '700', color: '#16a34a' }}>
              {progress.entregues}
            </Text>
            <Text style={{ color: '#64748b' }}> / {progress.total} entregas</Text>
          </Text>
          {progress.pendentes > 0 && (
            <Text style={styles.progressMetaBadgePending}>
              {progress.pendentes} pendentes
            </Text>
          )}
          {progress.emTransito > 0 && (
            <Text style={styles.progressMetaBadgeTransit}>
              {progress.emTransito} em rota
            </Text>
          )}
        </View>
      </View>

      {/* Próxima entrega */}
      {proximaEntrega && (
        <Pressable
          style={({ pressed }) => [
            styles.nextCard,
            pressed && { opacity: 0.85 },
          ]}
          onPress={() => handleOpenOnMap(proximaEntrega)}
        >
          <View style={styles.nextCardHeader}>
            <View style={styles.nextTitleRow}>
              <Navigation size={16} color="#b45309" />
              <Text style={styles.nextTitle}>Próxima entrega</Text>
            </View>
            {proximaEntrega.ordemEntrega != null && (
              <View style={styles.nextOrdemBadge}>
                <ListOrdered size={12} color="#92400e" />
                <Text style={styles.nextOrdemBadgeText}>
                  {'  '}Ordem {proximaEntrega.ordemEntrega}
                </Text>
              </View>
            )}
          </View>
          <Text style={styles.nextName} numberOfLines={1}>
            {proximaEntrega.nomeDestinatario}
          </Text>
          <Text style={styles.nextAddr} numberOfLines={2}>
            {proximaEntrega.endereco}
            {proximaEntrega.numero ? `, ${proximaEntrega.numero}` : ''}
            {proximaEntrega.bairro ? ` — ${proximaEntrega.bairro}` : ''}
          </Text>
          <View style={styles.nextCardFooter}>
            <View
              style={[
                styles.statusBadge,
                {
                  backgroundColor:
                    STATUS_COLORS[normalizeStatus(proximaEntrega.status)],
                },
              ]}
            >
              {statusIcon(normalizeStatus(proximaEntrega.status), 12)}
              <Text style={styles.statusBadgeText}>
                {'  '}
                {STATUS_LABELS[normalizeStatus(proximaEntrega.status)]}
              </Text>
            </View>
            <View style={styles.openMapRow}>
              <MapIcon size={14} color="#4338ca" />
              <Text style={styles.openMapText}>Abrir no mapa</Text>
              <ChevronRight size={14} color="#4338ca" />
            </View>
          </View>
        </Pressable>
      )}

      {totalCount > 0 && (
        <View style={styles.geoStatsRow}>
          <View style={[styles.geoBadge, styles.geoBadgeOk]}>
            <CheckCircle2 size={12} color="#15803d" />
            <Text style={[styles.geoBadgeText, { color: '#15803d' }]}>
              {'  '}
              {okGeoCount}
            </Text>
          </View>
          {pendingGeoCount > 0 && (
            <View style={[styles.geoBadge, styles.geoBadgePending]}>
              <CircleDashed size={12} color="#0369a1" />
              <Text style={[styles.geoBadgeText, { color: '#0369a1' }]}>
                {'  '}
                {pendingGeoCount}
              </Text>
            </View>
          )}
          {failedGeoCount > 0 && (
            <View style={[styles.geoBadge, styles.geoBadgeFailed]}>
              <XCircle size={12} color="#92400e" />
              <Text style={[styles.geoBadgeText, { color: '#92400e' }]}>
                {'  '}
                {failedGeoCount}
              </Text>
            </View>
          )}
        </View>
      )}

      {/* Filtros de status (TASK 11.5) */}
      <View style={styles.filterRowWrapper}>
        <View style={styles.filterRowLabel}>
          <Filter size={14} color="#475569" />
          <Text style={styles.filterRowLabelText}>Status</Text>
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterRow}
          keyboardShouldPersistTaps="handled"
        >
          {STATUS_FILTERS.map((opt) => {
            const active = statusFilter === opt.value;
            return (
              <Pressable
                key={opt.value}
                onPress={() => setStatusFilter(opt.value)}
                style={({ pressed }) => [
                  styles.filterChip,
                  active && styles.filterChipActive,
                  pressed && { opacity: 0.85 },
                ]}
              >
                <Text
                  style={[
                    styles.filterChipText,
                    active && styles.filterChipTextActive,
                  ]}
                >
                  {opt.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    </View>
  );

  const renderItem = ({ item }: { item: Entrega }) => {
    if (item.id == null) return null;
    const status = normalizeStatus(item.status);
    return (
      <View style={styles.row}>
        {item.ordemEntrega != null && (
          <View style={styles.ordemChip}>
            <Text style={styles.ordemChipText}>{item.ordemEntrega}</Text>
          </View>
        )}
        <View style={styles.rowMain}>
          <View style={styles.rowHeader}>
            <Text style={styles.name} numberOfLines={1}>
              {item.nomeDestinatario}
            </Text>
            <View
              style={[
                styles.statusBadge,
                { backgroundColor: STATUS_COLORS[status] },
              ]}
            >
              {statusIcon(status, 12)}
              <Text style={styles.statusBadgeText}>
                {'  '}
                {STATUS_LABELS[status]}
              </Text>
            </View>
          </View>
          <Text style={styles.meta} numberOfLines={2}>
            {item.endereco}
            {item.numero != null ? `, ${item.numero}` : ''}
            {item.complemento ? ` - ${item.complemento}` : ''}
            {item.bairro ? ` - ${item.bairro}` : ''}
          </Text>
          <View style={styles.rowMetaRow}>
            <MapPin size={12} color="#2563eb" />
            <Text style={styles.cepText}>{item.cep}</Text>
            {item.codigoRastreio ? (
              <>
                <View style={styles.dot} />
                <Text style={styles.trackingText}>#{item.codigoRastreio}</Text>
              </>
            ) : null}
          </View>
          {item.observacao ? (
            <Text style={styles.obsText} numberOfLines={1}>
              Obs.: {item.observacao}
            </Text>
          ) : null}
        </View>
        <Pressable
          style={({ pressed }) => [
            styles.mapButton,
            pressed && { opacity: 0.7 },
          ]}
          onPress={() => handleOpenOnMap(item)}
          hitSlop={8}
        >
          <MapIcon size={16} color="#4338ca" />
        </Pressable>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'android' ? 20 : 0}
      enabled
    >
      {/* Top bar */}
      <View style={styles.topBar}>
        <Pressable
          onPress={goBackOrClose}
          style={({ pressed }) => [
            styles.backButton,
            pressed && { opacity: 0.7 },
          ]}
          hitSlop={8}
        >
          <ArrowLeft size={20} color="#0f172a" strokeWidth={2.4} />
        </Pressable>
        <View style={styles.titleWrap}>
          <Text style={styles.title}>Entregas</Text>
          <Text style={styles.badge}>{totalCount} registro(s)</Text>
        </View>
        {totalCount > 0 ? (
          <Pressable
            onPress={confirmClearAll}
            style={({ pressed }) => [
              styles.clearButton,
              pressed && { opacity: 0.7 },
            ]}
            hitSlop={8}
          >
            <Ban size={16} color="#dc2626" />
          </Pressable>
        ) : (
          <View style={{ width: 40 }} />
        )}
      </View>

      {/* Search (TASK 11.4) */}
      <View style={styles.searchWrap}>
        <View style={styles.searchRow}>
          <Search size={18} color="#64748b" />
          <TextInput
            style={styles.searchInput}
            placeholder="Código, nome, endereço, bairro ou CEP..."
            placeholderTextColor="#94a3b8"
            value={search}
            onChangeText={setSearch}
            returnKeyType="search"
            autoCorrect={false}
            onSubmitEditing={() => Keyboard.dismiss()}
          />
        </View>
      </View>

      {loading ? (
        <ActivityIndicator
          style={styles.loading}
          color="#2563eb"
          size="large"
        />
      ) : (
        <FlatList
          data={entregas}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderItem}
          ListHeaderComponent={renderHeader}
          contentContainerStyle={styles.listContent}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <Text style={styles.empty}>
              {debouncedSearch || statusFilter !== 'ALL'
                ? 'Nenhuma entrega para os filtros selecionados.'
                : 'Nenhuma entrega importada ainda.'}
            </Text>
          }
        />
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingTop: 12,
    paddingBottom: 8,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    gap: 4,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f1f5f9',
  },
  titleWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 6,
  },
  title: {
    fontSize: 19,
    fontWeight: '700',
    color: '#0f172a',
  },
  badge: {
    fontSize: 12,
    color: '#2563eb',
    fontWeight: '600',
    backgroundColor: '#eff6ff',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    overflow: 'hidden',
  },
  clearButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  searchWrap: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: '#ffffff',
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#f8fafc',
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: '#0f172a',
    paddingVertical: 2,
  },
  loading: {
    marginTop: 40,
  },
  listContent: {
    padding: 12,
    paddingBottom: 160,
  },
  listHeader: {
    gap: 10,
    marginBottom: 10,
  },
  progressCard: {
    backgroundColor: '#ffffff',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    gap: 10,
  },
  progressHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  progressTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  progressTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
  },
  progressPct: {
    fontSize: 16,
    fontWeight: '700',
    color: '#4338ca',
  },
  progressBarTrack: {
    height: 10,
    borderRadius: 999,
    backgroundColor: '#e2e8f0',
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#4338ca',
    borderRadius: 999,
  },
  progressMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  progressMeta: {
    fontSize: 13,
    color: '#475569',
  },
  progressMetaBadgePending: {
    fontSize: 12,
    color: '#b45309',
    backgroundColor: '#fef3c7',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    overflow: 'hidden',
    fontWeight: '600',
  },
  progressMetaBadgeTransit: {
    fontSize: 12,
    color: '#1d4ed8',
    backgroundColor: '#dbeafe',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    overflow: 'hidden',
    fontWeight: '600',
  },
  nextCard: {
    backgroundColor: '#fffbeb',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#fcd34d',
    gap: 8,
  },
  nextCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  nextTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  nextTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#92400e',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  nextOrdemBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fde68a',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  nextOrdemBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#92400e',
  },
  nextName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0f172a',
  },
  nextAddr: {
    fontSize: 13,
    color: '#78350f',
  },
  nextCardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 2,
    flexWrap: 'wrap',
    gap: 8,
  },
  openMapRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  openMapText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#4338ca',
  },
  geoStatsRow: {
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 4,
  },
  geoBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    overflow: 'hidden',
  },
  geoBadgeOk: { backgroundColor: '#dcfce7' },
  geoBadgePending: { backgroundColor: '#e0f2fe' },
  geoBadgeFailed: { backgroundColor: '#fef3c7' },
  geoBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  filterRowWrapper: {
    gap: 6,
    marginTop: 4,
  },
  filterRowLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 4,
  },
  filterRowLabelText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
  },
  filterRow: {
    paddingHorizontal: 4,
    gap: 6,
    paddingVertical: 2,
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  filterChipActive: {
    backgroundColor: '#4338ca',
    borderColor: '#4338ca',
  },
  filterChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
  },
  filterChipTextActive: {
    color: '#ffffff',
  },
  empty: {
    textAlign: 'center',
    color: '#94a3b8',
    fontSize: 14,
    marginTop: 40,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    gap: 10,
  },
  ordemChip: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#eef2ff',
    borderWidth: 1,
    borderColor: '#c7d2fe',
  },
  ordemChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#4338ca',
  },
  rowMain: {
    flex: 1,
    gap: 3,
  },
  rowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  },
  name: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0f172a',
    flexShrink: 1,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  statusBadgeText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '700',
  },
  meta: {
    fontSize: 12,
    color: '#475569',
    marginTop: 2,
  },
  rowMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  cepText: {
    fontSize: 12,
    color: '#2563eb',
    fontWeight: '600',
  },
  trackingText: {
    fontSize: 12,
    color: '#8b5cf6',
    fontWeight: '600',
  },
  dot: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: '#cbd5e1',
    marginHorizontal: 2,
  },
  obsText: {
    fontSize: 12,
    color: '#b45309',
    marginTop: 2,
    fontStyle: 'italic',
  },
  mapButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#eef2ff',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#c7d2fe',
  },
});

export default DeliveriesScreen;
