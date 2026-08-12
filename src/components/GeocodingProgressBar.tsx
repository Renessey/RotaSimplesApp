import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { GeocodingProgress } from '../geocoding/types';

/**
 * GeocodingProgressBar (TASK 6.12).
 *
 * Exibe o progresso do processamento de geocodificação em lote sem
 * bloquear a UI. A atualização dos valores é feita via `progress`
 * recebido das callbacks da fila, que rodam em microtasks separadas
 * para manter a thread principal livre.
 */

export interface GeocodingProgressBarProps {
  progress: GeocodingProgress | null;
  /** Se true, exibe a barra; se false, oculta. */
  visible: boolean;
}

/** Escolhe a cor de acordo com o progresso e falhas. */
function pickProgressColor(fraction: number, hasFailed: boolean): string {
  if (hasFailed) return '#f59e0b'; // amber (há falhas ou ambíguos)
  if (fraction >= 1) return '#16a34a'; // verde (100%)
  return '#2563eb'; // azul (em progresso)
}

export function GeocodingProgressBar({
  progress,
  visible,
}: GeocodingProgressBarProps) {
  if (!visible || !progress) return null;

  const pct = Math.max(0, Math.min(1, progress.fraction));
  const pctText = `${Math.round(pct * 100)}%`;
  const hasFailed = progress.failedCount > 0 || progress.ambiguousCount > 0;
  const color = pickProgressColor(pct, hasFailed);

  return (
    <View style={styles.container} accessible accessibilityRole="progressbar">
      <View style={styles.topRow}>
        <Text style={styles.title}>Geocodificando endereços...</Text>
        <Text style={styles.percent}>{pctText}</Text>
      </View>

      {progress.currentName ? (
        <Text style={styles.currentName} numberOfLines={1}>
          {progress.currentName}
        </Text>
      ) : null}

      <View style={styles.track}>
        <View
          style={[
            styles.fill,
            { width: `${pct * 100}%`, backgroundColor: color },
          ]}
        />
      </View>

      <View style={styles.statsRow}>
        <Text style={[styles.stat, styles.statSuccess]}>
          ✓ {progress.successCount} OK
        </Text>
        {progress.ambiguousCount > 0 ? (
          <Text style={[styles.stat, styles.statAmbiguous]}>
            ? {progress.ambiguousCount} ambíguo(s)
          </Text>
        ) : null}
        {progress.failedCount > 0 ? (
          <Text style={[styles.stat, styles.statFailed]}>
            ✗ {progress.failedCount} falha(s)
          </Text>
        ) : null}
        <Text style={styles.statTotal}>
          {progress.completed}/{progress.total}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: 12,
    marginBottom: 8,
    padding: 12,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 10,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  title: {
    fontSize: 13,
    fontWeight: '600',
    color: '#0f172a',
  },
  percent: {
    fontSize: 13,
    fontWeight: '700',
    color: '#475569',
  },
  currentName: {
    fontSize: 12,
    color: '#64748b',
    marginBottom: 8,
  },
  track: {
    width: '100%',
    height: 8,
    backgroundColor: '#e2e8f0',
    borderRadius: 4,
    overflow: 'hidden',
  },
  fill: {
    height: 8,
    borderRadius: 4,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  stat: {
    fontSize: 11,
    fontWeight: '600',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: 'hidden',
  },
  statSuccess: {
    color: '#15803d',
    backgroundColor: '#dcfce7',
  },
  statAmbiguous: {
    color: '#92400e',
    backgroundColor: '#fef3c7',
  },
  statFailed: {
    color: '#b91c1c',
    backgroundColor: '#fee2e2',
  },
  statTotal: {
    marginLeft: 'auto',
    fontSize: 11,
    color: '#64748b',
    fontWeight: '500',
  },
});

export default GeocodingProgressBar;
