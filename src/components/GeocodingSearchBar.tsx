import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  Search,
  MapPin,
  CheckCircle2,
  AlertTriangle,
  XCircle,
} from 'lucide-react-native';
import { geocodingService } from '../geocoding/GeocodingService';
import { normalizeAddress } from '../geocoding/AddressNormalizer';
import { errorReporting } from '../services/errorReporting';
import type { GeocodeResult } from '../geocoding/types';

export type GeocodingSearchMode = 'search' | 'geocode';

export interface GeocodingSearchBarProps {
  searchValue: string;
  onChangeSearch: (value: string) => void;
  placeholder?: string;
  onGeocodingStart?: (query: string) => void;
  onGeocodingResult?: (query: string, result: GeocodeResult) => void;
  accentColor?: string;
}

type GeoState = 'idle' | 'loading' | 'success' | 'failed' | 'ambiguous';

function geoStateFromResult(r: GeocodeResult): GeoState {
  if (r.status === 'GEOCODED') return 'success';
  if (r.status === 'AMBIGUOUS') return 'ambiguous';
  return 'failed';
}

export function GeocodingSearchBar(props: GeocodingSearchBarProps) {
  const {
    searchValue,
    onChangeSearch,
    placeholder,
    onGeocodingStart,
    onGeocodingResult,
    accentColor = '#2563eb',
  } = props;

  const [mode, setMode] = useState<GeocodingSearchMode>('search');
  const [geoState, setGeoState] = useState<GeoState>('idle');
  const [lastResult, setLastResult] = useState<GeocodeResult | null>(null);
  const [text, setText] = useState<string>(searchValue ?? '');

  /**
   * Refs: guardam o valor textual atual sem forçar re-render, para
   * que runGeocode / notifyParent captem sempre o último valor sem
   * depender de states em arrays de dependência (evita loop + cria
   * callbacks estáveis).
   */
  const lastSearchValueRef = useRef<string>(searchValue ?? '');
  const textRef = useRef<string>(searchValue ?? '');
  const runningRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    textRef.current = text;
  }, [text]);

  useEffect(() => {
    const val = searchValue ?? '';
    if (val !== lastSearchValueRef.current && val !== textRef.current) {
      lastSearchValueRef.current = val;
      textRef.current = val;
      setText(val);
    }
  }, [searchValue]);

  const toggleMode = useCallback(() => {
    setMode((prev) => (prev === 'search' ? 'geocode' : 'search'));
    setGeoState('idle');
    setLastResult(null);
  }, []);

  const notifyParent = useCallback(
    (value: string) => {
      lastSearchValueRef.current = value;
      onChangeSearch(value);
    },
    [onChangeSearch],
  );

  const handleChangeText = useCallback(
    (next: string) => {
      textRef.current = next;
      setText(next);
      setGeoState('idle');
      setLastResult(null);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        notifyParent(next);
      }, 220);
    },
    [notifyParent],
  );

  const runGeocode = useCallback(async () => {
    if (runningRef.current) return;
    const rawQuery = textRef.current.trim();
    if (rawQuery.length < 3) return;
    if (lastSearchValueRef.current !== rawQuery) {
      notifyParent(rawQuery);
    }
    runningRef.current = true;
    setGeoState('loading');
    setLastResult(null);
    onGeocodingStart?.(rawQuery);

    let result: GeocodeResult;
    try {
      const normalized = normalizeAddress({
        endereco: rawQuery,
        city: /marica|maricá|rj|rio de janeiro/i.test(rawQuery)
          ? undefined
          : 'Maricá',
        state: 'RJ',
      });
      result = await geocodingService.geocodeNormalized(normalized);
    } catch (error) {
      errorReporting.report(error, {
        context: 'GeocodingSearchBar.runGeocode',
        query: rawQuery,
      });
      result = {
        status: 'FAILED',
        note: error instanceof Error ? error.message : 'Erro desconhecido.',
        processedAt: new Date().toISOString(),
        provider: 'error',
      };
    } finally {
      runningRef.current = false;
    }

    setGeoState(geoStateFromResult(result));
    setLastResult(result);
    onGeocodingResult?.(rawQuery, result);
  }, [notifyParent, onGeocodingResult, onGeocodingStart]);

  const handleSubmit = useCallback(() => {
    if (mode === 'geocode') {
      void runGeocode();
      Keyboard.dismiss();
    } else {
      notifyParent(textRef.current);
      Keyboard.dismiss();
    }
  }, [mode, runGeocode, notifyParent]);

  const handlePressIcon = useCallback(() => {
    if (mode === 'geocode') {
      void runGeocode();
    }
  }, [mode, runGeocode]);

  const inputPlaceholder =
    placeholder ??
    (mode === 'search'
      ? 'Pesquisar por nome, endereço, CEP...'
      : 'Digite um endereço e pressione Enviar para geocodificar');

  const modeChip = (
    <Pressable
      onPress={toggleMode}
      style={[styles.modeChip, { borderColor: accentColor }]}
    >
      {mode === 'search' ? (
        <Search size={14} color={accentColor} />
      ) : (
        <MapPin size={14} color={accentColor} />
      )}
      <Text style={[styles.modeChipText, { color: accentColor }, { marginLeft: 4 }]}>
        {mode === 'search' ? 'Pesq.' : 'Geo.'}
      </Text>
    </Pressable>
  );

  let statusChip: React.ReactNode = null;
  if (geoState === 'loading') {
    statusChip = (
      <View style={styles.chipLoading}>
        <ActivityIndicator color="#fff" size="small" />
        <Text style={styles.chipLoadingText}>Buscando...</Text>
      </View>
    );
  } else if (geoState === 'success') {
    statusChip = (
      <View style={[styles.chipState, styles.chipSuccess]}>
        <CheckCircle2 size={12} color="#ffffff" />
        <Text style={styles.chipStateText}> OK</Text>
      </View>
    );
  } else if (geoState === 'ambiguous') {
    statusChip = (
      <View style={[styles.chipState, styles.chipAmbiguous]}>
        <AlertTriangle size={12} color="#ffffff" />
        <Text style={styles.chipStateText}> Ambíguo</Text>
      </View>
    );
  } else if (geoState === 'failed') {
    statusChip = (
      <View style={[styles.chipState, styles.chipFailed]}>
        <XCircle size={12} color="#ffffff" />
        <Text style={styles.chipStateText}> Falhou</Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.inputRow}>
        <Pressable
          style={styles.iconBtn}
          onPress={handlePressIcon}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          {mode === 'search' ? (
            <Search size={18} color="#475569" />
          ) : (
            <MapPin size={18} color="#2563eb" />
          )}
        </Pressable>

        <TextInput
          style={styles.input}
          placeholder={inputPlaceholder}
          placeholderTextColor="#94a3b8"
          value={text}
          onChangeText={handleChangeText}
          onSubmitEditing={handleSubmit}
          returnKeyType={mode === 'geocode' ? 'search' : 'done'}
          blurOnSubmit
          autoCorrect={false}
        />

        <View style={styles.trailingRow}>
          {statusChip}
          {modeChip}
        </View>
      </View>

      {lastResult ? (
        <View
          style={[
            styles.resultBox,
            lastResult.status === 'GEOCODED'
              ? styles.resultBoxSuccess
              : lastResult.status === 'AMBIGUOUS'
                ? styles.resultBoxAmbiguous
                : styles.resultBoxFailed,
          ]}
        >
          {lastResult.status === 'GEOCODED' ? (
            <View style={styles.resultCols}>
              <View style={styles.resultCol}>
                <Text style={styles.resultLabel}>Latitude</Text>
                <Text style={styles.resultValue}>
                  {lastResult.latitude != null ? lastResult.latitude.toFixed(6) : '—'}
                </Text>
              </View>
              <View style={styles.resultCol}>
                <Text style={styles.resultLabel}>Longitude</Text>
                <Text style={styles.resultValue}>
                  {lastResult.longitude != null ? lastResult.longitude.toFixed(6) : '—'}
                </Text>
              </View>
              <View style={styles.resultCol}>
                <Text style={styles.resultLabel}>Confiança</Text>
                <Text style={styles.resultValue}>
                  {lastResult.confidence != null
                    ? `${(lastResult.confidence * 100).toFixed(0)}%`
                    : '—'}
                </Text>
              </View>
            </View>
          ) : null}

          {lastResult.matchedAddress ? (
            <Text style={styles.resultAddress} numberOfLines={3}>
              {lastResult.matchedAddress}
            </Text>
          ) : null}

          {lastResult.note ? (
            <Text style={styles.resultNote} numberOfLines={3}>
              {lastResult.note}
            </Text>
          ) : null}

          <View style={styles.resultFooter}>
            <Text style={styles.resultProvider}>
              Provider: {lastResult.provider} •{' '}
              {new Date(lastResult.processedAt).toLocaleTimeString('pt-BR')}
            </Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    width: '100%',
    gap: 8,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 10,
    backgroundColor: '#f8fafc',
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  iconBtn: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
  iconBtnText: {
    fontSize: 16,
  },
  input: {
    flex: 1,
    paddingHorizontal: 4,
    paddingVertical: 8,
    fontSize: 14,
    color: '#0f172a',
  },
  trailingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginRight: 4,
  },
  modeChip: {
    borderWidth: 1.5,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  modeChipText: {
    fontSize: 11,
    fontWeight: '700',
  },
  chipLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: '#475569',
  },
  chipLoadingText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '600',
  },
  chipState: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  chipSuccess: { backgroundColor: '#16a34a' },
  chipAmbiguous: { backgroundColor: '#d97706' },
  chipFailed: { backgroundColor: '#dc2626' },
  chipStateText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '700',
  },
  resultBox: {
    borderRadius: 10,
    padding: 10,
    gap: 6,
    borderWidth: 1,
  },
  resultBoxSuccess: {
    backgroundColor: '#f0fdf4',
    borderColor: '#86efac',
  },
  resultBoxAmbiguous: {
    backgroundColor: '#fffbeb',
    borderColor: '#fcd34d',
  },
  resultBoxFailed: {
    backgroundColor: '#fef2f2',
    borderColor: '#fecaca',
  },
  resultCols: {
    flexDirection: 'row',
    gap: 8,
  },
  resultCol: {
    flex: 1,
    gap: 2,
  },
  resultLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  resultValue: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0f172a',
  },
  resultAddress: {
    fontSize: 12,
    color: '#334155',
    fontWeight: '500',
  },
  resultNote: {
    fontSize: 12,
    color: '#92400e',
  },
  resultFooter: {
    marginTop: 2,
  },
  resultProvider: {
    fontSize: 10,
    color: '#94a3b8',
  },
});

export default GeocodingSearchBar;
