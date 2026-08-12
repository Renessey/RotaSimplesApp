import { API_URL, ENV, GEOCODING_API_KEY, MAPS_API_KEY, ERROR_REPORTING_DSN } from '@env';

export type AppEnvironment = 'development' | 'staging' | 'production';

export interface AppConfig {
  env: AppEnvironment;
  isDevelopment: boolean;
  isProduction: boolean;
  apiUrl: string;
  mapsApiKey: string;
  geocodingApiKey: string;
  errorReportingDsn?: string;
}

const normalizeEnv = (value: string | undefined): AppEnvironment => {
  if (value === 'production' || value === 'staging') {
    return value;
  }
  return 'development';
};

export const config: AppConfig = {
  env: normalizeEnv(ENV),
  isDevelopment: ENV !== 'production',
  isProduction: ENV === 'production',
  apiUrl: API_URL,
  mapsApiKey: MAPS_API_KEY,
  geocodingApiKey: GEOCODING_API_KEY,
  errorReportingDsn: ERROR_REPORTING_DSN || undefined,
};

/**
 * Valida as variáveis de ambiente obrigatórias.
 * Em desenvolvimento, apenas loga um aviso.
 * Em produção, lança um erro (fail-fast) para evitar execução com configuração inválida.
 */
export function validateEnv(configToValidate: AppConfig = config): void {
  const missing: string[] = [];

  if (!configToValidate.apiUrl) {
    missing.push('API_URL');
  }

  if (!configToValidate.mapsApiKey) {
    missing.push('MAPS_API_KEY');
  }

  if (!configToValidate.geocodingApiKey) {
    missing.push('GEOCODING_API_KEY');
  }

  if (missing.length > 0) {
    const message = `Variáveis de ambiente ausentes: ${missing.join(', ')}`;

    if (configToValidate.isProduction) {
      throw new Error(message);
    }

    console.warn(`[env] ${message}`);
  }
}
