// Tipos para el sistema de generación de planes de prueba

// Configuración de la aplicación
export interface AppConfig {
  aws: {
    region: string;
    userPoolId: string;
    userPoolClientId: string;
  };
  api: {
    baseUrl: string;
    gatewayUrl: string;
    apiKey: string;
  };
  bedrock: {
    defaultKnowledgeBaseId: string;
    defaultModelId: string;
    alternativeModelId: string;
  };
  app: {
    name: string;
    version: string;
    description: string;
  };
  dev: {
    mode: boolean;
    logLevel: string;
  };
}

// Credenciales AWS IAM
export interface IAMUser {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  region: string;
}

// Tipos de plan de pruebas
export enum PlanType {
  UNITARIAS = 'UNITARIAS',
  INTEGRACION = 'INTEGRACIÓN',
  PERFORMANCE = 'PERFORMANCE',
  REGRESION = 'REGRESIÓN'
}

// Prioridades de casos de prueba
export enum Priority {
  ALTA = 'ALTA',
  MEDIA = 'MEDIA',
  BAJA = 'BAJA'
}

// Estados de casos de prueba
export enum TestCaseStatus {
  PROPOSED = 'PROPOSED',
  ACCEPTED = 'ACCEPTED',
  DISCARDED = 'DISCARDED',
  MANUAL = 'MANUAL'
}

// Origen de creación
export enum CreatedBy {
  AI_AGENT = 'AI_AGENT',
  MANUAL = 'MANUAL'
}

// Configuración del plan
export interface PlanConfiguration {
  plan_title: string;
  plan_type: PlanType;
  functional_requirements_doc?: File;
  coverage_percentage: number;
  project_context: string;
}

// Caso de prueba
export interface TestCase {
  // Campos obligatorios del caso de prueba
  testcase_number: number;
  test_case_name: string;
  test_case_description: string;
  preconditions: string;
  test_data: string;
  test_steps: string[];
  expected_results: string;
  requirements: string;
  address_master_status: string;
  cache_availability: string;
  manual_modal_status: string;
  address_fields: string;
  address_standardization: string;
  order_status: string;
  
  // Campos de gestión
  priority: Priority;
  status: TestCaseStatus;
  created_by: CreatedBy;
  last_modified: string;
  modifications_log: ModificationLog[];
}

// Log de modificaciones
export interface ModificationLog {
  timestamp: string;
  action: string;
  field: string;
  old_value: string;
  new_value: string;
  modified_by: string;
}

// Plan de pruebas completo
export interface TestPlan {
  id: string;
  configuration: PlanConfiguration;
  test_cases: TestCase[];
  coverage_metrics: CoverageMetrics;
  created_at: string;
  updated_at: string;
  status: 'draft' | 'active' | 'completed' | 'archived';
}

// Métricas de cobertura
export interface CoverageMetrics {
  target_coverage: number;
  actual_coverage: number;
  total_requirements: number;
  covered_requirements: number;
  uncovered_requirements: string[];
}

// Knowledge Base
export interface KnowledgeBase {
  id: string;
  name: string;
  description?: string;
  status: string;
  createdAt?: Date;
  updatedAt?: Date;
}

// Respuesta de consulta a Knowledge Base
export interface KBQueryResponse {
  answer: string;
  processing_time_ms: number;
  retrievalResults: RetrievalResult[];
  query: string;
  model_used: string;
  knowledge_base_id: string;
  total_processing_time_ms: number;
}

// Resultado de recuperación
export interface RetrievalResult {
  content: string;
  location: string;
  similarity_score?: number;
  metadata?: Record<string, any>;
}

// Solicitud de consulta a Knowledge Base
export interface KBQueryRequest {
  query: string;
  model_id: string;
  knowledge_base_id: string;
}

// Mensaje de conversación
export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

// Error de API
export interface APIError {
  error: string;
  code: string;
  details?: string;
  timestamp: string;
}

// Sesión de trabajo
export interface Session {
  id: string;
  tester_id: string;
  project_context: string;
  plan_configuration: PlanConfiguration;
  iterations: SessionIteration[];
  final_plan?: TestPlan;
  status: 'active' | 'completed' | 'archived';
  created_at: string;
  updated_at: string;
}

// Iteración de sesión
export interface SessionIteration {
  iteration_number: number;
  user_input: string;
  system_response: string;
  generated_plan: Partial<TestPlan>;
  timestamp: string;
}

// Endpoints de API
export const API_ENDPOINTS = {
  // Configuración
  CONFIGURE_PLAN: '/configure-plan',
  UPLOAD_REQUIREMENTS: '/upload-requirements',
  
  // Generación
  GENERATE_PLAN: '/generate-plan',
  HYBRID_SEARCH: '/hybrid-search',
  
  // Edición
  EDIT_CASE: '/edit-case',
  CREATE_MANUAL_CASE: '/create-manual-case',
  DISCARD_CASE: '/discard-case',
  
  // Cobertura
  CALCULATE_COVERAGE: '/calculate-coverage',
  
  // Exportación
  EXPORT_PLAN: '/export-plan',
  
  // Sistema
  HEALTH: '/health',
  KB_QUERY: '/kb-query',
} as const;

// Formatos de exportación
export enum ExportFormat {
  EXCEL = 'excel',
  PDF = 'pdf',
  JSON = 'json',
  CSV = 'csv'
}

// Solicitud de exportación
export interface ExportRequest {
  plan_id: string;
  format: ExportFormat;
  include_metadata: boolean;
}

// Respuesta de exportación
export interface ExportResponse {
  download_url: string;
  file_name: string;
  expires_at: string;
}
