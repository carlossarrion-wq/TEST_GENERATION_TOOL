// Configuración principal del Test Plan Generator

import type { AppConfig } from '../types';

// Validar variables de entorno requeridas
const requiredEnvVars = [
  'VITE_AWS_REGION',
  'VITE_API_GATEWAY_URL',
  'VITE_DEFAULT_KNOWLEDGE_BASE_ID',
  'VITE_DEFAULT_MODEL_ID'
];

const missingVars = requiredEnvVars.filter(varName => !import.meta.env[varName]);
if (missingVars.length > 0) {
  console.warn('Variables de entorno faltantes:', missingVars);
}

// Configuración de la aplicación
export const appConfig: AppConfig = {
  aws: {
    region: import.meta.env.VITE_AWS_REGION || 'eu-west-1',
    userPoolId: '', // No usado en autenticación IAM
    userPoolClientId: '', // No usado en autenticación IAM
  },
  api: {
    baseUrl: import.meta.env.VITE_API_GATEWAY_URL || '',
    gatewayUrl: import.meta.env.VITE_API_GATEWAY_URL || '',
    apiKey: import.meta.env.VITE_API_KEY || '',
  },
  bedrock: {
    // Knowledge Base específica para Test Plan Generator (diferente a NewRAG_proyect)
    defaultKnowledgeBaseId: import.meta.env.VITE_DEFAULT_KNOWLEDGE_BASE_ID || 'TEST_PLAN_KB_ID',
    defaultModelId: import.meta.env.VITE_DEFAULT_MODEL_ID || 'anthropic.claude-sonnet-4-20250514-v1:0',
    alternativeModelId: import.meta.env.VITE_ALTERNATIVE_MODEL_ID || 'amazon.nova-pro-v1:0',
  },
  app: {
    name: import.meta.env.VITE_APP_NAME || 'Test Plan Generator',
    version: import.meta.env.VITE_APP_VERSION || '1.0.0',
    description: import.meta.env.VITE_APP_DESCRIPTION || 'Sistema de Generación de Planes de Prueba Basado en Agentes IA',
  },
  dev: {
    mode: import.meta.env.VITE_DEV_MODE === 'true',
    logLevel: import.meta.env.VITE_LOG_LEVEL || 'info',
  },
};

// Validación de configuración
export const validateConfig = (): boolean => {
  const errors: string[] = [];

  // Validar configuración AWS
  if (!appConfig.aws.region) {
    errors.push('AWS region no configurada');
  }

  // Validar configuración API
  if (!appConfig.api.baseUrl) {
    errors.push('URL base de API no configurada');
  }

  // Validar configuración Bedrock
  if (!appConfig.bedrock.defaultKnowledgeBaseId) {
    errors.push('Knowledge Base ID no configurado');
  }

  if (!appConfig.bedrock.defaultModelId) {
    errors.push('Model ID no configurado');
  }

  if (errors.length > 0) {
    console.error('Errores de configuración:', errors);
    return false;
  }

  return true;
};

// Logger simple
export const createLogger = (context: string) => {
  const logLevel = appConfig.dev.logLevel;
  const isDev = appConfig.dev.mode;

  return {
    debug: (message: string, ...args: any[]) => {
      if (isDev && (logLevel === 'debug' || logLevel === 'verbose')) {
        console.debug(`[${context}] ${message}`, ...args);
      }
    },
    info: (message: string, ...args: any[]) => {
      if (isDev && ['debug', 'info', 'verbose'].includes(logLevel)) {
        console.info(`[${context}] ${message}`, ...args);
      }
    },
    warn: (message: string, ...args: any[]) => {
      if (isDev) {
        console.warn(`[${context}] ${message}`, ...args);
      }
    },
    error: (message: string, ...args: any[]) => {
      console.error(`[${context}] ${message}`, ...args);
    },
  };
};

// Constantes de la aplicación
export const APP_CONSTANTS = {
  // Timeouts
  API_TIMEOUT: 30000, // 30 segundos
  AUTH_TIMEOUT: 10000, // 10 segundos
  
  // Límites
  MAX_MESSAGE_LENGTH: 4000,
  MAX_MESSAGES_HISTORY: 50,
  MAX_TEST_CASES: 100,
  MAX_FILE_SIZE: 10 * 1024 * 1024, // 10MB
  
  // Configuración de retry
  MAX_RETRIES: 3,
  RETRY_DELAY: 1000, // 1 segundo
  
  // Configuración de UI
  SIDEBAR_WIDTH: 256,
  HEADER_HEIGHT: 64,
  
  // Configuración de almacenamiento
  STORAGE_KEYS: {
    AWS_CREDENTIALS: 'test-plan-aws-credentials',
    PLAN_CONFIGURATION: 'test-plan-configuration',
    CURRENT_SESSION: 'test-plan-current-session',
    USER_PREFERENCES: 'test-plan-user-preferences',
  },
  
  // Configuración de cobertura
  MIN_COVERAGE_PERCENTAGE: 10,
  MAX_COVERAGE_PERCENTAGE: 100,
  DEFAULT_COVERAGE_PERCENTAGE: 80,
} as const;

// Configuración de regiones AWS disponibles
export const AWS_REGIONS = [
  { value: 'us-east-1', label: 'US East (N. Virginia)' },
  { value: 'us-west-2', label: 'US West (Oregon)' },
  { value: 'eu-west-1', label: 'Europe (Ireland)' },
  { value: 'eu-central-1', label: 'Europe (Frankfurt)' },
  { value: 'ap-southeast-1', label: 'Asia Pacific (Singapore)' },
  { value: 'ap-northeast-1', label: 'Asia Pacific (Tokyo)' },
] as const;

// Configuración de modelos disponibles
export const AVAILABLE_MODELS = [
  {
    id: 'anthropic.claude-sonnet-4-20250514-v1:0',
    name: 'Claude Sonnet 4',
    description: 'Modelo principal de Claude Sonnet 4 con capacidades avanzadas para generación de planes de prueba',
    provider: 'Anthropic',
    recommended: true,
  },
  {
    id: 'amazon.nova-pro-v1:0',
    name: 'Nova Pro',
    description: 'Modelo alternativo Nova Pro de Amazon para generación de contenido',
    provider: 'Amazon',
    recommended: false,
  },
] as const;

// Configuración de tipos de archivo soportados
export const SUPPORTED_FILE_TYPES = {
  documents: ['.pdf', '.docx', '.doc', '.txt', '.md'],
  images: ['.jpg', '.jpeg', '.png', '.gif'],
  spreadsheets: ['.xlsx', '.xls', '.csv'],
} as const;

// Función para obtener la configuración actual
export const getCurrentConfig = () => {
  return {
    ...appConfig,
    isValid: validateConfig(),
    timestamp: new Date().toISOString(),
  };
};

// Función para verificar si estamos en modo desarrollo
export const isDevelopment = () => appConfig.dev.mode;

// Función para verificar si estamos en producción
export const isProduction = () => !appConfig.dev.mode;

// Exportar configuración por defecto
export default appConfig;
