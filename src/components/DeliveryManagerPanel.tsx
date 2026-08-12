import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  Play,
  RefreshCw,
  Route,
  ChevronUp,
  ChevronDown,
  ChevronsUp,
  CheckCircle2,
  Clock,
  AlertTriangle,
  FileSpreadsheet,
  Trash2,
  MapPin,
  RotateCcw,
  X,
  Eraser,
  List,
  GripVertical,
} from 'lucide-react-native';
import { pickSpreadsheetFile } from '../services/import/FileReader';
import { parseSheet } from '../services/import/SpreadsheetParser';
import {
  clearDeliveries,
  countDeliveries,
  countEntregasByGeocodingStatus,
  deleteDelivery,
  getEntregas,
  insertDeliveries,
  listDeliveries,
} from '../database/DeliveryRepository';
import { errorReporting } from '../services/errorReporting';
import { getUserMessage } from '../utils/errorHandler';
import type { Delivery, ImportPreview } from '../types/import';
import type { Entrega, GeocodingStatus as EntregaGeocodingStatus } from '../types/entrega';
import type { GeocodingProgress } from '../geocoding/types';
import { GeocodingProgressBar } from './GeocodingProgressBar';
import { ManualCoordinatePicker } from './ManualCoordinatePicker';
import { DeliveryGeocodingOrchestrator } from '../services/geocoding/DeliveryGeocodingOrchestrator';
import { useDeliveryMarkers } from '../hooks/DeliveryMarkersContext';
import { useOptimizedRoute } from '../hooks/OptimizedRouteContext';
import { optimizationService } from '../services/optimization/OptimizationService';
import { currentLocationService } from '../services/location/CurrentLocationService';
import { GeocodingSearchBar } from './GeocodingSearchBar';

type ImportPhase =
  | 'idle'
  | 'picking'
  | 'reading'
  | 'preview'
  | 'saving'
  | 'error';

export type PanelSizeMode = 'min' | 'normal' | 'max';

export interface DeliveryManagerPanelProps {
  sizeMode?: PanelSizeMode;
  onSizeModeChange?: (next: PanelSizeMode) => void;
}

function geocodingBadgeColor(
  status?: EntregaGeocodingStatus,
): { bg: string; text: string; label: string } {
  switch (status) {
    case 'GEOCODED':
      return { bg: '#dcfce7', text: '#15803d', label: 'OK' };
    case 'MANUAL':
      return { bg: '#dbeafe', text: '#1d4ed8', label: 'MANUAL' };
    case 'AMBIGUOUS':
      return { bg: '#fef3c7', text: '#92400e', label: 'AMBÍGUO' };
    case 'FAILED':
      return { bg: '#fee2e2', text: '#b91c1c', label: 'FALHOU' };
    case 'PENDING':
    default:
      return { bg: '#e2e8f0', text: '#475569', label: 'PENDENTE' };
  }
}

const BASE64_CHARS =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function formatDuration(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return '—';
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const clean = base64.replace(/[^A-Za-z0-9+/=]/g, '');
  const length = clean.length;
  let bufferLength = (length * 3) >> 2;
  if (clean.endsWith('==')) {
    bufferLength -= 2;
  } else if (clean.endsWith('=')) {
    bufferLength -= 1;
  }

  const bytes = new Uint8Array(bufferLength);
  let p = 0;

  for (let i = 0; i < length; i += 4) {
    const enc1 = BASE64_CHARS.indexOf(clean[i]);
    const enc2 = BASE64_CHARS.indexOf(clean[i + 1]);
    const enc3 = BASE64_CHARS.indexOf(clean[i + 2]);
    const enc4 = BASE64_CHARS.indexOf(clean[i + 3]);

    const chr1 = (enc1 << 2) | (enc2 >> 4);
    const chr2 = ((enc2 & 15) << 4) | (enc3 >> 2);
    const chr3 = ((enc3 & 3) << 6) | enc4;

    bytes[p++] = chr1;
    if (enc3 !== -1) bytes[p++] = chr2;
    if (enc4 !== -1) bytes[p++] = chr3;
  }

  return bytes.buffer;
}

function nextSizeMode(current: PanelSizeMode): PanelSizeMode {
  switch (current) {
    case 'min':
      return 'normal';
    case 'normal':
      return 'max';
    case 'max':
      return 'min';
  }
}

const ICON_SIZE = 16;
const ICON_COLOR = '#ffffff';
const ROW_ICON_SIZE = 14;

export function DeliveryManagerPanel(props: DeliveryManagerPanelProps) {
  const { sizeMode = 'normal', onSizeModeChange } = props;

  const [phase, setPhase] = useState<ImportPhase>('idle');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [pendingDeliveries, setPendingDeliveries] = useState<Delivery[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [entregasMap, setEntregasMap] = useState<Map<number, Entrega>>(new Map());
  const [totalCount, setTotalCount] = useState(0);
  const [search, setSearch] = useState('');
  const [loadingList, setLoadingList] = useState(false);
  const [showList, setShowList] = useState(true);

  const [geocodingProgress, setGeocodingProgress] = useState<GeocodingProgress | null>(null);
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [geocodingStats, setGeocodingStats] = useState<Record<string, number>>({
    PENDING: 0,
    GEOCODED: 0,
    FAILED: 0,
    AMBIGUOUS: 0,
    MANUAL: 0,
  });

  const orchestrator = useMemo(
    () =>
      new DeliveryGeocodingOrchestrator({
        onProgress: (p) => setGeocodingProgress(p),
      }),
    [],
  );

  const [pickerVisible, setPickerVisible] = useState(false);
  const [pickerEntrega, setPickerEntrega] = useState<Entrega | null>(null);

  const scrollRef = useRef<ScrollView>(null);

  const { reload: reloadMarkers } = useDeliveryMarkers();
  const {
    setRoute,
    clearRoute,
    setProgress: setRouteProgress,
    setOptimizing,
    isOptimizing,
    progress: routeProgress,
    distanceMeters,
    durationSeconds,
    updatedAt: routeUpdatedAt,
    lastError: routeError,
  } = useOptimizedRoute();
  const [optimizeError, setOptimizeError] = useState<string | null>(null);

  const isBusy =
    phase === 'picking' ||
    phase === 'reading' ||
    phase === 'saving' ||
    isGeocoding ||
    isOptimizing;
  const isSaving = phase === 'saving';

  const pendingGeoCount = geocodingStats.PENDING ?? 0;
  const failedGeoCount =
    (geocodingStats.FAILED ?? 0) + (geocodingStats.AMBIGUOUS ?? 0);
  const okGeoCount =
    (geocodingStats.GEOCODED ?? 0) + (geocodingStats.MANUAL ?? 0);

  const reloadGeoStats = useCallback(async () => {
    try {
      const stats = await countEntregasByGeocodingStatus();
      setGeocodingStats(stats);
    } catch (error) {
      errorReporting.report(error, { context: 'DeliveryManagerPanel.reloadGeoStats' });
    }
  }, []);

  const reloadDeliveries = useCallback(async () => {
    setLoadingList(true);
    try {
      const [items, total, entregasRaw] = await Promise.all([
        listDeliveries({ search: search || undefined }),
        countDeliveries(),
        getEntregas({ search: search || undefined }),
      ]);
      setDeliveries(items);
      setTotalCount(total);

      const map = new Map<number, Entrega>();
      for (const e of entregasRaw) {
        if (e.id != null) map.set(e.id, e);
      }
      setEntregasMap(map);
    } catch (error) {
      errorReporting.report(error, { context: 'DeliveryManagerPanel.reload' });
    } finally {
      setLoadingList(false);
      void reloadGeoStats();
      void reloadMarkers();
    }
  }, [search, reloadGeoStats, reloadMarkers]);

  useEffect(() => {
    reloadDeliveries();
  }, [reloadDeliveries]);

  const handlePickFile = useCallback(async () => {
    setPhase('picking');
    setErrorMessage(null);
    try {
      const file = await pickSpreadsheetFile();
      if (!file) {
        setPhase('idle');
        return;
      }

      setPhase('reading');
      const result = parseSheet(base64ToArrayBuffer(file.base64));

      setPendingDeliveries(result.deliveries);

      setPreview({
        fileName: file.fileName,
        totalRows: result.totalRows,
        validCount: result.deliveries.length,
        invalidCount: result.invalidRows.length,
        sample: result.deliveries.slice(0, 5),
        errors: result.invalidRows,
        columns: result.columns,
        missingColumns: result.missingColumns,
      });
      setPhase('preview');
    } catch (error) {
      setErrorMessage(getUserMessage(error, 'Não foi possível ler o arquivo.'));
      setPhase('error');
    }
  }, []);

  const startGeocoding = useCallback(async () => {
    setIsGeocoding(true);
    setGeocodingProgress(null);
    try {
      await orchestrator.runForPending();
    } catch (error) {
      errorReporting.report(error, { context: 'DeliveryManagerPanel.startGeocoding' });
    } finally {
      setIsGeocoding(false);
      setGeocodingProgress(null);
      void reloadDeliveries();
    }
  }, [orchestrator, reloadDeliveries]);

  const handleReprocessFailed = useCallback(async () => {
    setIsGeocoding(true);
    setGeocodingProgress(null);
    try {
      await orchestrator.runForFailed();
    } catch (error) {
      errorReporting.report(error, { context: 'DeliveryManagerPanel.reprocessFailed' });
    } finally {
      setIsGeocoding(false);
      setGeocodingProgress(null);
      void reloadDeliveries();
    }
  }, [orchestrator, reloadDeliveries]);

  const handleConfirm = useCallback(async () => {
    if (!preview || isSaving) return;
    setPhase('saving');
    try {
      await insertDeliveries(pendingDeliveries);
      setPreview(null);
      setPendingDeliveries([]);
      setPhase('idle');
      void reloadDeliveries();
    } catch (error) {
      setErrorMessage(getUserMessage(error, 'Não foi possível salvar as entregas.'));
      setPhase('error');
    }
  }, [preview, isSaving, pendingDeliveries, reloadDeliveries]);

  const handleOpenManual = useCallback((entrega: Entrega) => {
    setPickerEntrega(entrega);
    setPickerVisible(true);
  }, []);

  const handleOptimize = useCallback(async () => {
    if (isOptimizing) return;
    setOptimizeError(null);
    setOptimizing(true);
    setRouteProgress(null);
    try {
      const originLoc = await currentLocationService.getCurrentPosition();
      if (!originLoc) {
        throw new Error('Ainda sem localização atual para otimizar.');
      }
      const result = await optimizationService.optimize(originLoc, undefined, {
        recalculateRouteAfter: true,
        onProgress: (p) => setRouteProgress(p),
      });
      if (result.status !== 'OPTIMIZED') {
        throw new Error(
          result.errorMessage ?? 'Não foi possível otimizar a rota.',
        );
      }
      setRoute({
        geometry: result.geometry ?? null,
        orderedDeliveries: result.ordered,
        distanceMeters: result.distanceMeters ?? null,
        durationSeconds: result.durationSeconds ?? null,
        lastError: null,
      });
      setRouteProgress(null);
      void reloadDeliveries();
      void reloadMarkers();

      setShowList(false);
      requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({ y: 0, animated: true });
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Erro ao otimizar rota.';
      setOptimizeError(message);
      setRoute({
        lastError: message,
      });
      errorReporting.report(error, {
        context: 'DeliveryManagerPanel.handleOptimize',
      });
    } finally {
      setOptimizing(false);
    }
  }, [
    isOptimizing,
    setOptimizing,
    setRouteProgress,
    setRoute,
    reloadDeliveries,
    reloadMarkers,
  ]);

  const handleClearRoute = useCallback(() => {
    clearRoute();
    setOptimizeError(null);
  }, [clearRoute]);

  const handleDelete = useCallback(
    (id: number) => {
      Alert.alert('Excluir entrega', 'Deseja excluir esta entrega?', [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Excluir',
          style: 'destructive',
          onPress: async () => {
            await deleteDelivery(id);
            await reloadDeliveries();
          },
        },
      ]);
    },
    [reloadDeliveries],
  );

  const handleClearAll = useCallback(() => {
    Alert.alert(
      'Limpar importação',
      'Deseja excluir TODAS as entregas? Esta ação não pode ser desfeita.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Limpar tudo',
          style: 'destructive',
          onPress: async () => {
            await clearDeliveries();
            setDeliveries([]);
            setEntregasMap(new Map());
            setTotalCount(0);
            setGeocodingProgress(null);
            void reloadGeoStats();
            void reloadMarkers();
          },
        },
      ],
    );
  }, [reloadGeoStats, reloadMarkers]);

  const cycleSizeMode = useCallback(() => {
    const next = nextSizeMode(sizeMode);
    onSizeModeChange?.(next);
  }, [sizeMode, onSizeModeChange]);

  const scrollContentStyle = useMemo(() => {
    switch (sizeMode) {
      case 'min':
        return styles.containerContentMin;
      case 'max':
        return styles.containerContentMax;
      case 'normal':
      default:
        return styles.containerContent;
    }
  }, [sizeMode]);

  const showMiniHeaderOnly = sizeMode === 'min';

  return (
    <ScrollView
      ref={scrollRef}
      style={styles.container}
      contentContainerStyle={scrollContentStyle}
      nestedScrollEnabled
      showsVerticalScrollIndicator
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.headerRow}>
        <View style={styles.headerTitle}>
          <Pressable
            style={({ pressed }) => [
              styles.gripButton,
              pressed && { opacity: 0.7 },
            ]}
            onPress={cycleSizeMode}
            hitSlop={8}
          >
            <GripVertical size={18} color="#94a3b8" />
          </Pressable>
          <Text style={styles.title}>Gerenciamento de Entregas</Text>
        </View>
        <View style={styles.headerTrailing}>
          <Text style={styles.badge}>{totalCount} entrega(s)</Text>
          {totalCount > 0 && (
            <Pressable
              onPress={() => setShowList((prev) => !prev)}
              style={({ pressed }) => [
                styles.collapseButton,
                pressed && { opacity: 0.7 },
              ]}
              hitSlop={8}
            >
              {showList ? (
                <ChevronUp size={14} color="#4338ca" />
              ) : (
                <ChevronDown size={14} color="#4338ca" />
              )}
              <Text style={styles.collapseButtonText}>
                {showList ? 'Recolher' : 'Expandir'}
              </Text>
            </Pressable>
          )}
          <Pressable
            style={({ pressed }) => [
              styles.sizeButton,
              pressed && { opacity: 0.7 },
            ]}
            onPress={cycleSizeMode}
            hitSlop={8}
          >
            {sizeMode === 'max' ? (
              <ChevronsUp size={15} color="#0f172a" />
            ) : sizeMode === 'min' ? (
              <ChevronDown size={15} color="#0f172a" />
            ) : (
              <ChevronUp size={15} color="#0f172a" />
            )}
          </Pressable>
        </View>
      </View>

      {!showMiniHeaderOnly && (
        <>
          {totalCount > 0 && (
            <View style={styles.geoStatsRow}>
              <View style={[styles.geoBadge, styles.geoBadgeOk]}>
                <CheckCircle2 size={12} color="#15803d" />
                <Text style={[styles.geoBadgeText, { color: '#15803d' }]}>
                  {' '}
                  {okGeoCount}
                </Text>
              </View>
              {pendingGeoCount > 0 && (
                <View style={[styles.geoBadge, styles.geoBadgePending]}>
                  <Clock size={12} color="#0369a1" />
                  <Text style={[styles.geoBadgeText, { color: '#0369a1' }]}>
                    {' '}
                    {pendingGeoCount}
                  </Text>
                </View>
              )}
              {failedGeoCount > 0 && (
                <View style={[styles.geoBadge, styles.geoBadgeFailed]}>
                  <AlertTriangle size={12} color="#92400e" />
                  <Text style={[styles.geoBadgeText, { color: '#92400e' }]}>
                    {' '}
                    {failedGeoCount}
                  </Text>
                </View>
              )}
            </View>
          )}

          <GeocodingSearchBar
            searchValue={search}
            onChangeSearch={setSearch}
            placeholder="Pesquisar por nome, endereço, CEP..."
          />

          <GeocodingProgressBar
            progress={geocodingProgress}
            visible={isGeocoding && !!geocodingProgress}
          />

          <View style={styles.actionsRow}>
            <Pressable
              style={[styles.actionButton, styles.primaryButton, isBusy && styles.disabled]}
              onPress={handlePickFile}
              disabled={isBusy}
            >
              {phase === 'picking' || phase === 'reading' ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <View style={styles.buttonContent}>
                  <FileSpreadsheet size={ICON_SIZE} color={ICON_COLOR} />
                  <Text style={styles.primaryButtonText}>Importar XLSX/CSV</Text>
                </View>
              )}
            </Pressable>

            {totalCount > 0 && !isBusy && (
              <Pressable
                style={[styles.actionButton, styles.clearButton]}
                onPress={handleClearAll}
              >
                <View style={[styles.buttonContent, { gap: 4 }]}>
                  <Trash2 size={ICON_SIZE} color="#dc2626" />
                  <Text style={styles.clearButtonText}>Limpar</Text>
                </View>
              </Pressable>
            )}
          </View>

          {totalCount > 0 && (
            <View style={styles.actionsRow}>
              {pendingGeoCount > 0 && !isGeocoding && (
                <Pressable
                  style={[styles.actionButton, styles.secondaryButton]}
                  onPress={startGeocoding}
                >
                  <View style={styles.buttonContent}>
                    <MapPin size={ICON_SIZE} color="#ffffff" />
                    <Text style={styles.secondaryButtonText}>
                      Geocodificar pendentes ({pendingGeoCount})
                    </Text>
                  </View>
                </Pressable>
              )}
              {failedGeoCount > 0 && !isGeocoding && (
                <Pressable
                  style={[styles.actionButton, styles.warnButton]}
                  onPress={handleReprocessFailed}
                >
                  <View style={styles.buttonContent}>
                    <RotateCcw size={ICON_SIZE} color="#ffffff" />
                    <Text style={styles.warnButtonText}>
                      Reprocessar falhas ({failedGeoCount})
                    </Text>
                  </View>
                </Pressable>
              )}
            </View>
          )}

          <View style={styles.actionsRow}>
            <Pressable
              style={[
                styles.actionButton,
                styles.startRouteButton,
                isOptimizing && styles.disabled,
              ]}
              onPress={handleOptimize}
              disabled={isOptimizing}
            >
              {isOptimizing && routeProgress ? (
                <View style={styles.buttonContent}>
                  <ActivityIndicator
                    color="#ffffff"
                    size="small"
                    style={{ marginRight: 6 }}
                  />
                  <Text style={styles.startRouteButtonText} numberOfLines={1}>
                    {routeProgress.message ?? 'Preparando rota...'}
                  </Text>
                </View>
              ) : (
                <View style={styles.buttonContent}>
                  <Play size={ICON_SIZE} color={ICON_COLOR} fill={ICON_COLOR} />
                  <Text style={styles.startRouteButtonText}>Iniciar rota</Text>
                </View>
              )}
            </Pressable>
            <Pressable
              style={[
                styles.actionButton,
                styles.optimizeButton,
                isOptimizing && styles.disabled,
              ]}
              onPress={handleOptimize}
              disabled={isOptimizing}
            >
              <View style={styles.buttonContent}>
                <RefreshCw size={ICON_SIZE} color="#ffffff" />
                <Text style={styles.optimizeButtonText}>Reotimizar</Text>
              </View>
            </Pressable>
            <Pressable
              style={[styles.actionButton, styles.clearRouteButton]}
              onPress={handleClearRoute}
            >
              <View style={[styles.buttonContent, { gap: 4 }]}>
                <Eraser size={ICON_SIZE} color="#dc2626" />
                <Text style={styles.clearButtonText}>Limpar rota</Text>
              </View>
            </Pressable>
          </View>

          {distanceMeters != null || durationSeconds != null ? (
            <View style={styles.routeSummaryBox}>
              <View style={styles.routeSummaryCol}>
                <View style={styles.routeSummaryHeader}>
                  <Route size={12} color="#6d28d9" />
                  <Text style={styles.routeSummaryLabel}>Distância total</Text>
                </View>
                <Text style={styles.routeSummaryValue}>
                  {distanceMeters != null
                    ? `${(distanceMeters / 1000).toFixed(2)} km`
                    : '—'}
                </Text>
              </View>
              <View style={styles.routeSummaryCol}>
                <View style={styles.routeSummaryHeader}>
                  <Clock size={12} color="#6d28d9" />
                  <Text style={styles.routeSummaryLabel}>Duração est.</Text>
                </View>
                <Text style={styles.routeSummaryValue}>
                  {durationSeconds != null
                    ? formatDuration(durationSeconds)
                    : '—'}
                </Text>
              </View>
              {routeUpdatedAt && (
                <View style={styles.routeSummaryCol}>
                  <View style={styles.routeSummaryHeader}>
                    <CheckCircle2 size={12} color="#6d28d9" />
                    <Text style={styles.routeSummaryLabel}>Às</Text>
                  </View>
                  <Text style={styles.routeSummaryValue}>
                    {new Date(routeUpdatedAt).toLocaleTimeString('pt-BR')}
                  </Text>
                </View>
              )}
            </View>
          ) : null}

          {optimizeError || routeError ? (
            <View style={styles.errorBox}>
              <View style={{ flexDirection: 'row', gap: 6 }}>
                <AlertTriangle size={16} color="#dc2626" />
                <Text style={styles.errorText}>
                  {optimizeError ?? routeError ?? 'Erro ao otimizar rota.'}
                </Text>
              </View>
            </View>
          ) : null}

          {phase === 'error' && errorMessage && (
            <View style={styles.errorBox}>
              <View style={{ flexDirection: 'row', gap: 6 }}>
                <AlertTriangle size={16} color="#dc2626" />
                <Text style={styles.errorText}>{errorMessage}</Text>
              </View>
            </View>
          )}

          {preview && phase === 'preview' && (
            <View style={styles.previewBox}>
              <Text style={styles.previewTitle}>Prévia da importação</Text>
              <Text style={styles.previewMeta}>
                Arquivo: {preview.fileName} • {preview.totalRows} linha(s)
              </Text>
              <View style={{ flexDirection: 'row', gap: 6, marginTop: 4 }}>
                {preview.validCount > 0 && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <CheckCircle2 size={14} color="#16a34a" />
                    <Text style={styles.previewValid}>
                      {preview.validCount} entrega(s) válida(s)
                    </Text>
                  </View>
                )}
                {preview.invalidCount > 0 && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <AlertTriangle size={14} color="#d97706" />
                    <Text style={styles.previewInvalid}>
                      {preview.invalidCount} linha(s) inválida(s)
                    </Text>
                  </View>
                )}
              </View>
              {preview.missingColumns.length > 0 && (
                <Text style={styles.previewWarning}>
                  Colunas obrigatórias ausentes: {preview.missingColumns.join(', ')}
                </Text>
              )}

              {preview.sample.length > 0 && (
                <View style={styles.sampleList}>
                  {preview.sample.map((d, idx) => (
                    <View key={idx} style={styles.sampleRow}>
                      <Text style={styles.sampleName}>{d.name}</Text>
                      <Text style={styles.sampleMeta}>
                        {d.address}
                        {d.number != null ? `, ${d.number}` : ''} — CEP {d.cep}
                      </Text>
                    </View>
                  ))}
                </View>
              )}

              {preview.errors.length > 0 && (
                <View style={styles.errorsList}>
                  <Text style={styles.errorsTitle}>Erros nas linhas:</Text>
                  {preview.errors.slice(0, 10).map((err, idx) => (
                    <Text key={idx} style={styles.errorLine}>
                      Linha {err.rowNumber}: {err.messages.join(' ')}
                    </Text>
                  ))}
                  {preview.errors.length > 10 && (
                    <Text style={styles.errorMore}>
                      ... e mais {preview.errors.length - 10} linha(s).
                    </Text>
                  )}
                </View>
              )}

              <View style={styles.confirmRow}>
                <Pressable
                  style={[
                    styles.actionButton,
                    styles.primaryButton,
                    isSaving && styles.disabled,
                  ]}
                  onPress={handleConfirm}
                  disabled={preview.validCount === 0 || isSaving}
                >
                  {isSaving ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <View style={styles.buttonContent}>
                      <CheckCircle2 size={ICON_SIZE} color="#ffffff" />
                      <Text style={styles.primaryButtonText}>
                        Confirmar importação ({preview.validCount})
                      </Text>
                    </View>
                  )}
                </Pressable>
                <Pressable
                  style={[styles.cancelButton, isSaving && styles.disabled]}
                  onPress={() => setPhase('idle')}
                  disabled={isSaving}
                >
                  <View style={[styles.buttonContent, { gap: 4 }]}>
                    <X size={ICON_SIZE} color="#475569" />
                    <Text style={styles.cancelButtonText}>Cancelar</Text>
                  </View>
                </Pressable>
              </View>
            </View>
          )}

          {showList ? (
            loadingList ? (
              <ActivityIndicator style={styles.listLoading} color="#2563eb" />
            ) : (
              <View style={styles.list}>
                {deliveries.length === 0 ? (
                  <Text style={styles.emptyText}>Nenhuma entrega importada ainda.</Text>
                ) : (
                  deliveries.map((d) => {
                    if (d.id == null) return null;
                    const entrega = entregasMap.get(d.id);
                    const badge = geocodingBadgeColor(entrega?.geocodingStatus);
                    return (
                      <View key={d.id} style={styles.deliveryRow}>
                        <View style={styles.deliveryInfo}>
                          <View style={styles.deliveryHeader}>
                            <Text style={styles.deliveryName}>{d.name}</Text>
                            <View
                              style={[
                                styles.statusBadge,
                                { backgroundColor: badge.bg },
                              ]}
                            >
                              <Text style={[styles.statusBadgeText, { color: badge.text }]}>
                                {badge.label}
                              </Text>
                            </View>
                          </View>
                          <Text style={styles.deliveryMeta}>
                            {d.address}
                            {d.number != null ? `, ${d.number}` : ''}
                            {d.city ? ` — ${d.city}` : ''} • CEP {d.cep}
                          </Text>
                          {d.trackingCode && (
                            <Text style={styles.deliveryTracking}>
                              Código: {d.trackingCode}
                            </Text>
                          )}
                          {entrega?.latitude != null && entrega.longitude != null && (
                            <Text style={styles.deliveryCoords}>
                              {entrega.latitude.toFixed(5)}, {entrega.longitude.toFixed(5)}
                            </Text>
                          )}
                        </View>
                        <View style={styles.deliveryActions}>
                          <Pressable
                            style={styles.editButton}
                            onPress={() => entrega && handleOpenManual(entrega)}
                          >
                            <MapPin size={ROW_ICON_SIZE} color="#0e7490" />
                            <Text style={styles.editButtonText}>Coords</Text>
                          </Pressable>
                          <Pressable
                            style={styles.deleteButton}
                            onPress={() => d.id != null && handleDelete(d.id)}
                          >
                            <Trash2 size={ROW_ICON_SIZE} color="#dc2626" />
                            <Text style={styles.deleteButtonText}>Excluir</Text>
                          </Pressable>
                        </View>
                      </View>
                    );
                  })
                )}
              </View>
            )
          ) : (
            <Pressable
              style={({ pressed }) => [
                styles.expandListBtn,
                pressed && { opacity: 0.7 },
              ]}
              onPress={() => setShowList(true)}
            >
              <List size={16} color="#0f172a" />
              <Text style={styles.expandListBtnText}>
                Mostrar {deliveries.length} entrega(s)
              </Text>
              <ChevronDown size={14} color="#0f172a" />
            </Pressable>
          )}
        </>
      )}

      {showMiniHeaderOnly && (
        <Pressable
          style={({ pressed }) => [
            styles.expandListBtn,
            styles.miniExpandBtn,
            pressed && { opacity: 0.7 },
          ]}
          onPress={cycleSizeMode}
        >
          <List size={14} color="#0f172a" />
          <Text style={styles.expandListBtnText}>
            {totalCount} entrega(s) • tocar para expandir
          </Text>
          <ChevronUp size={14} color="#0f172a" />
        </Pressable>
      )}

      <ManualCoordinatePicker
        entrega={pickerEntrega}
        visible={pickerVisible}
        onClose={() => {
          setPickerVisible(false);
          setPickerEntrega(null);
        }}
        onSaved={() => {
          void reloadDeliveries();
        }}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#ffffff',
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
  },
  containerContent: {
    padding: 12,
    gap: 8,
  },
  containerContentMin: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 6,
  },
  containerContentMax: {
    padding: 14,
    gap: 10,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  headerTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  gripButton: {
    padding: 2,
    marginRight: 2,
  },
  headerTrailing: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  collapseButton: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 8,
    backgroundColor: '#eef2ff',
    borderWidth: 1,
    borderColor: '#c7d2fe',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  collapseButtonText: {
    color: '#4338ca',
    fontWeight: '700',
    fontSize: 12,
  },
  sizeButton: {
    paddingVertical: 4,
    paddingHorizontal: 6,
    borderRadius: 8,
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: '#cbd5e1',
  },
  expandListBtn: {
    alignSelf: 'center',
    marginTop: 6,
    marginBottom: 4,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  miniExpandBtn: {
    alignSelf: 'stretch',
    justifyContent: 'center',
  },
  expandListBtnText: {
    color: '#0f172a',
    fontWeight: '700',
    fontSize: 13,
  },
  title: {
    fontSize: 16,
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
  geoStatsRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 8,
  },
  geoBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'center',
  },
  geoBadgeOk: { backgroundColor: '#dcfce7' },
  geoBadgePending: { backgroundColor: '#e0f2fe' },
  geoBadgeFailed: { backgroundColor: '#fef3c7' },
  geoBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  actionButton: {
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
  },
  buttonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  primaryButton: {
    backgroundColor: '#2563eb',
    flex: 1,
  },
  primaryButtonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
  secondaryButton: {
    backgroundColor: '#0891b2',
  },
  secondaryButtonText: {
    color: '#ffffff',
    fontWeight: '600',
    fontSize: 13,
  },
  warnButton: {
    backgroundColor: '#d97706',
  },
  warnButtonText: {
    color: '#ffffff',
    fontWeight: '600',
    fontSize: 13,
  },
  optimizeButton: {
    backgroundColor: '#7c3aed',
    flex: 1,
  },
  optimizeButtonText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 14,
  },
  startRouteButton: {
    backgroundColor: '#15803d',
    flex: 1,
  },
  startRouteButtonText: {
    color: '#ffffff',
    fontWeight: '800',
    fontSize: 15,
    letterSpacing: 0.2,
  },
  clearButton: {
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
    flex: 0,
  },
  clearRouteButton: {
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
    flex: 0,
  },
  clearButtonText: {
    color: '#dc2626',
    fontWeight: '600',
    fontSize: 14,
  },
  cancelButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    flex: 0,
  },
  cancelButtonText: {
    color: '#475569',
    fontWeight: '600',
  },
  disabled: {
    opacity: 0.6,
  },
  errorBox: {
    backgroundColor: '#fef2f2',
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
  },
  errorText: {
    color: '#dc2626',
    fontSize: 13,
    flex: 1,
  },
  previewBox: {
    backgroundColor: '#f8fafc',
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
  },
  previewTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 4,
  },
  previewMeta: {
    fontSize: 12,
    color: '#64748b',
    marginBottom: 4,
  },
  previewValid: {
    fontSize: 13,
    color: '#16a34a',
    fontWeight: '600',
  },
  previewInvalid: {
    fontSize: 13,
    color: '#d97706',
    fontWeight: '600',
  },
  previewWarning: {
    fontSize: 12,
    color: '#dc2626',
    marginTop: 2,
  },
  sampleList: {
    marginTop: 8,
  },
  sampleRow: {
    backgroundColor: '#ffffff',
    borderRadius: 6,
    padding: 8,
    marginBottom: 4,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  sampleName: {
    fontSize: 13,
    fontWeight: '600',
    color: '#0f172a',
  },
  sampleMeta: {
    fontSize: 12,
    color: '#475569',
  },
  errorsList: {
    marginTop: 8,
  },
  errorsTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#dc2626',
    marginBottom: 4,
  },
  errorLine: {
    fontSize: 12,
    color: '#b91c1c',
    marginBottom: 2,
  },
  errorMore: {
    fontSize: 12,
    color: '#64748b',
  },
  confirmRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  routeSummaryBox: {
    flexDirection: 'row',
    gap: 8,
    padding: 10,
    borderRadius: 8,
    backgroundColor: '#f5f3ff',
    borderWidth: 1,
    borderColor: '#ddd6fe',
    marginBottom: 8,
  },
  routeSummaryCol: {
    flex: 1,
    gap: 2,
  },
  routeSummaryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  routeSummaryLabel: {
    fontSize: 10,
    color: '#6d28d9',
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  routeSummaryValue: {
    fontSize: 13,
    color: '#1e1b4b',
    fontWeight: '800',
  },
  list: {
    marginTop: 4,
  },
  listLoading: {
    marginVertical: 16,
  },
  emptyText: {
    fontSize: 13,
    color: '#94a3b8',
    textAlign: 'center',
    paddingVertical: 16,
  },
  deliveryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    borderRadius: 8,
    padding: 10,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  deliveryInfo: {
    flex: 1,
  },
  deliveryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 2,
  },
  deliveryName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0f172a',
    flexShrink: 1,
  },
  statusBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: 'hidden',
  },
  statusBadgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  deliveryMeta: {
    fontSize: 12,
    color: '#475569',
  },
  deliveryTracking: {
    fontSize: 11,
    color: '#2563eb',
    marginTop: 2,
  },
  deliveryCoords: {
    fontSize: 11,
    color: '#0891b2',
    marginTop: 2,
  },
  deliveryActions: {
    flexDirection: 'column',
    gap: 6,
    marginLeft: 6,
  },
  editButton: {
    backgroundColor: '#ecfeff',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#a5f3fc',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    justifyContent: 'center',
  },
  editButtonText: {
    color: '#0e7490',
    fontSize: 11,
    fontWeight: '700',
  },
  deleteButton: {
    backgroundColor: '#fef2f2',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#fecaca',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    justifyContent: 'center',
  },
  deleteButtonText: {
    color: '#dc2626',
    fontSize: 11,
    fontWeight: '600',
  },
});

export default DeliveryManagerPanel;
