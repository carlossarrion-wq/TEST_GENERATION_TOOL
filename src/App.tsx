import React, { useState, useEffect, useRef } from 'react';
import { appConfig, validateConfig, createLogger } from './config';
import type { 
  PlanConfiguration, 
  TestPlan, 
  Session, 
  PlanType, 
  ConversationMessage, 
  ChatSession
} from './types';
import './styles/App.css';

const logger = createLogger('App');

// Componente principal de la aplicación
const App: React.FC = () => {
  // Estados principales
  const [currentStep, setCurrentStep] = useState(0);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [selectedTestCase, setSelectedTestCase] = useState<any>(null);
  const [exportLoading, setExportLoading] = useState(false);
  const [isConfigValid, setIsConfigValid] = useState(false);
  const [currentSession, setCurrentSession] = useState<Session | null>(null);
  const [planConfig, setPlanConfig] = useState<PlanConfiguration | null>(null);
  const [testPlan, setTestPlan] = useState<TestPlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [systemReady, setSystemReady] = useState(false);
  const [validationErrors, setValidationErrors] = useState<{[key: string]: boolean}>({});

  // Estados del formulario de configuración
  const [formData, setFormData] = useState({
    plan_title: '',
    plan_type: 'UNITARIAS' as PlanType,
    coverage_percentage: 80,
    min_test_cases: 5,
    max_test_cases: 8,
    project_context: '',
  });

  // Estados del chat con Knowledge Base
  const [chatSession, setChatSession] = useState<ChatSession | null>(null);
  const [chatMessages, setChatMessages] = useState<ConversationMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const chatMessagesRef = useRef<HTMLDivElement>(null);

  // Estados para eliminación de casos
  const [deletedCase, setDeletedCase] = useState<{case: any, index: number} | null>(null);
  const [showUndoPopup, setShowUndoPopup] = useState(false);
  const [undoTimer, setUndoTimer] = useState<number | null>(null);

  // Estados para edición de casos
  const [isEditingCase, setIsEditingCase] = useState(false);
  const [editingCaseData, setEditingCaseData] = useState<any>(null);
  const [originalCaseData, setOriginalCaseData] = useState<any>(null);


  // Verificar configuración al cargar
  useEffect(() => {
    const initializeSystem = async () => {
      const configValid = validateConfig();
      setIsConfigValid(configValid);
      
      if (configValid) {
        logger.info('Configuración válida, aplicación lista');
        setSystemReady(true);
      } else {
        logger.error('Configuración inválida');
        setError('Configuración de la aplicación inválida. Verifica las variables de entorno.');
        setSystemReady(true); // Permitir continuar en modo limitado
      }
    };

    initializeSystem();
  }, []);


  // Función de validación
  const validateForm = () => {
    const errors: {[key: string]: boolean} = {};
    
    if (!formData.plan_title.trim()) {
      errors.plan_title = true;
    }
    
    if (!formData.project_context.trim()) {
      errors.project_context = true;
    }
    
    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // Navegación entre pasos
  const nextStep = () => {
    if (currentStep < 3) {
      setCurrentStep(currentStep + 1);
    }
  };

  const prevStep = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  // Función para configurar un nuevo plan
  const handleConfigurePlan = async () => {
    // Validar formulario antes de continuar
    if (!validateForm()) {
      setError('Por favor, completa todos los campos obligatorios marcados en rojo.');
      return;
    }

    if (!isConfigValid) {
      setError('Configuración de la aplicación inválida');
      return;
    }

    setLoading(true);
    setError(null);
    setValidationErrors({}); // Limpiar errores de validación

    try {
      const response = await fetch(`${appConfig.api.gatewayUrl}/configure-plan`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': appConfig.api.apiKey,
        },
        body: JSON.stringify({
          plan_title: formData.plan_title,
          plan_type: formData.plan_type,
          coverage_percentage: formData.coverage_percentage,
          min_test_cases: formData.min_test_cases,
          max_test_cases: formData.max_test_cases,
          project_context: formData.project_context,
          // user_id no requerido por ahora - será agregado cuando se implemente login
        }),
      });

      if (!response.ok) {
        throw new Error(`Error ${response.status}: ${response.statusText}`);
      }

      const rawData = await response.json();
      logger.info('Respuesta raw de plan_configurator:', rawData);
      
      // Manejar respuesta de invocación directa vs API Gateway
      let data;
      if (rawData.body && typeof rawData.body === 'string') {
        // Respuesta de invocación directa - el body está como string JSON
        logger.info('Detectada respuesta de invocación directa, parseando body...');
        data = JSON.parse(rawData.body);
      } else if (rawData.session_id) {
        // Respuesta directa de API Gateway
        logger.info('Detectada respuesta directa de API Gateway');
        data = rawData;
      } else {
        // Formato desconocido
        logger.error('Formato de respuesta desconocido:', rawData);
        throw new Error(`Formato de respuesta desconocido: ${JSON.stringify(rawData)}`);
      }
      
      logger.info('Data procesada:', data);
      logger.info('session_id en data:', data.session_id);
      
      // Verificar que tenemos session_id
      if (!data.session_id) {
        logger.error('session_id faltante. Data procesada:', JSON.stringify(data, null, 2));
        throw new Error(`No se recibió session_id del servidor. Data: ${JSON.stringify(data)}`);
      }
      
      // Crear sesión local
      const newSession: Session = {
        id: data.session_id,
        tester_id: 'user',
        project_context: formData.project_context,
        plan_configuration: formData,
        iterations: [],
        status: 'active',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      logger.info('Creando sesión local:', newSession);
      setCurrentSession(newSession);
      setPlanConfig(formData);
      
      // Pequeño delay para asegurar consistencia de DynamoDB
      setTimeout(() => {
        nextStep();
      }, 1000);
      
      logger.info('Plan configurado exitosamente', data);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Error desconocido';
      setError(`Error al configurar el plan: ${errorMessage}`);
      logger.error('Error al configurar plan:', err);
    } finally {
      setLoading(false);
    }
  };

  // Función para generar plan de pruebas
  const handleGeneratePlan = async () => {
    logger.info('=== HANDLE_GENERATE_PLAN STARTED ===');
    logger.info('Estado de currentSession:', currentSession);
    logger.info('Estado de planConfig:', planConfig);
    
    if (!currentSession) {
      logger.error('currentSession es null - no hay sesión activa');
      setError('No hay sesión activa');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      logger.info('Iniciando conexión con Knowledge Base...', {
        url: `${appConfig.api.gatewayUrl}/generate-plan`,
        sessionId: currentSession.id
      });
      
      const requestBody = {
        session_id: currentSession.id,
        generation_prompt: `Generar plan de pruebas para: ${planConfig?.project_context}`,
      };
      
      logger.info('Request body que se enviará:', requestBody);

      const response = await fetch(`${appConfig.api.gatewayUrl}/generate-plan`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': appConfig.api.apiKey,
        },
        body: JSON.stringify({
          session_id: currentSession.id,
          generation_prompt: `Generar plan de pruebas para: ${planConfig?.project_context}

ESPECIFICACIONES DEL PLAN:
- Tipo de pruebas: ${planConfig?.plan_type}
- Cobertura objetivo: ${planConfig?.coverage_percentage}%
- Número de casos de prueba: Entre ${planConfig?.min_test_cases} y ${planConfig?.max_test_cases} casos
- Título del plan: ${planConfig?.plan_title}

INSTRUCCIONES:
Genera entre ${planConfig?.min_test_cases} y ${planConfig?.max_test_cases} casos de prueba de tipo ${planConfig?.plan_type} que cubran el ${planConfig?.coverage_percentage}% del proyecto descrito. Ajusta la cantidad de casos según la complejidad del contexto proporcionado, pero respeta siempre el rango especificado.`,
        }),
      });

      if (!response.ok) {
        // Diagnóstico específico por código de error
        let errorDetails = '';
        let causeDescription = '';

        switch (response.status) {
          case 404:
            causeDescription = 'Knowledge Base no encontrada en la URL configurada';
            errorDetails = `La URL ${appConfig.api.gatewayUrl}/generate-plan no existe`;
            break;
          case 401:
            causeDescription = 'Error de autenticación con la Knowledge Base';
            errorDetails = 'API Key inválida o faltante';
            break;
          case 403:
            causeDescription = 'Acceso denegado a la Knowledge Base';
            errorDetails = 'Permisos insuficientes para acceder al recurso';
            break;
          case 500:
            causeDescription = 'Error interno del servidor de Knowledge Base';
            errorDetails = 'El servidor está experimentando problemas internos';
            break;
          case 502:
            causeDescription = 'Gateway error en Knowledge Base';
            errorDetails = 'Problema de conectividad entre servicios';
            break;
          case 503:
            causeDescription = 'Knowledge Base temporalmente no disponible';
            errorDetails = 'El servicio está en mantenimiento o sobrecargado';
            break;
          default:
            causeDescription = `Error HTTP ${response.status} en Knowledge Base`;
            errorDetails = response.statusText || 'Error desconocido del servidor';
        }

        const diagnosticMessage = `❌ Error de Conexión con Knowledge Base

🔍 Diagnóstico:
• URL: ${appConfig.api.gatewayUrl}/generate-plan
• Código de Error: ${response.status}
• Estado: ${response.statusText}

💡 Causa probable:
${causeDescription}

📋 Detalles técnicos:
${errorDetails}`;

        setError(diagnosticMessage);
        logger.error('Error HTTP de Knowledge Base:', { status: response.status, statusText: response.statusText });
        return;
      }

      const data = await response.json();
      logger.info('Respuesta recibida de Knowledge Base:', data);
      
      // Verificar si hay casos generados
      if (data.generated_cases && data.generated_cases.length > 0) {
        const generatedPlan: TestPlan = {
          id: currentSession.id,
          configuration: planConfig!,
          test_cases: data.generated_cases,
          coverage_metrics: {
            target_coverage: planConfig?.coverage_percentage || 80,
            actual_coverage: 0,
            total_requirements: 0,
            covered_requirements: 0,
            uncovered_requirements: [],
          },
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          status: 'draft',
        };

        setTestPlan(generatedPlan);
        nextStep();
        logger.info('Plan generado exitosamente desde Knowledge Base');
      } else {
        // La API respondió correctamente pero sin casos
        const diagnosticMessage = `⚠️ Knowledge Base Conectada pero Sin Resultados

🔍 Diagnóstico:
• URL: ${appConfig.api.gatewayUrl}/generate-plan
• Estado de Conexión: ✅ Exitosa
• Respuesta del Servidor: ✅ Recibida

💡 Causa probable:
La Knowledge Base no pudo generar casos de prueba para el contexto proporcionado

📋 Detalles de la respuesta:
• Casos generados: ${data.generated_cases ? data.generated_cases.length : 0}
• Formato de respuesta: ${JSON.stringify(Object.keys(data))}`;

        setError(diagnosticMessage);
        logger.warn('Knowledge Base conectada pero sin casos generados:', data);
      }
      
    } catch (err) {
      // Diagnóstico de errores de red/conectividad
      let diagnosticMessage = '';
      
      if (err instanceof TypeError && err.message.includes('fetch')) {
        diagnosticMessage = `🌐 Error de Conectividad con Knowledge Base

🔍 Diagnóstico:
• URL: ${appConfig.api.gatewayUrl}/generate-plan
• Tipo de Error: Error de red
• Estado: Sin conexión

💡 Causa probable:
No se puede establecer conexión con la Knowledge Base

📋 Detalles técnicos:
• Error de red o timeout
• Posible problema de CORS
• Servidor no disponible`;
      } else if (err instanceof Error && err.message.includes('CORS')) {
        diagnosticMessage = `🔒 Error CORS con Knowledge Base

🔍 Diagnóstico:
• URL: ${appConfig.api.gatewayUrl}/generate-plan
• Tipo de Error: CORS policy violation
• Estado: Bloqueado por navegador

💡 Causa probable:
La Knowledge Base no permite conexiones desde este dominio

📋 Detalles técnicos:
• Política CORS restrictiva
• Dominio no autorizado
• Headers no permitidos`;
      } else {
        const errorMessage = err instanceof Error ? err.message : 'Error desconocido';
        diagnosticMessage = `❌ Error Crítico de Knowledge Base

🔍 Diagnóstico:
• URL: ${appConfig.api.gatewayUrl}/generate-plan
• Tipo de Error: ${err instanceof Error ? err.constructor.name : 'Unknown'}
• Estado: Error crítico

💡 Causa probable:
Error inesperado en la comunicación con Knowledge Base

📋 Detalles técnicos:
${errorMessage}`;
      }

      setError(diagnosticMessage);
      logger.error('Error crítico al conectar con Knowledge Base:', err);
    } finally {
      setLoading(false);
    }
  };

  // Función para generar JSON localmente
  const generateJSONContent = (testPlan: TestPlan, planConfig: PlanConfiguration) => {
    const exportData = {
      plan_configuration: planConfig,
      test_plan: testPlan,
      exported_at: new Date().toISOString(),
      format: 'json'
    };
    return JSON.stringify(exportData, null, 2);
  };

  // Función para generar contenido BDD/Gherkin
  const generateBDDContent = (testPlan: TestPlan, planConfig: PlanConfiguration) => {
    const featureName = planConfig.plan_title || 'Plan de Pruebas';
    const projectContext = planConfig.project_context || 'Funcionalidades del sistema';
    
    let bddContent = `# ${featureName}\n# Generado automáticamente el ${new Date().toLocaleDateString()}\n\n`;
    
    bddContent += `Feature: ${featureName}\n`;
    bddContent += `  Como tester del sistema\n`;
    bddContent += `  Quiero ejecutar pruebas ${planConfig.plan_type.toLowerCase()}\n`;
    bddContent += `  Para garantizar ${planConfig.coverage_percentage}% de cobertura\n\n`;
    bddContent += `  Background:\n`;
    bddContent += `    Given que el sistema está configurado correctamente\n`;
    bddContent += `    And el entorno de pruebas está disponible\n\n`;

    testPlan.test_cases.forEach((testCase, index) => {
      // Convertir el nombre del caso a formato más legible para BDD
      const scenarioName = testCase.test_case_name || `Caso de prueba ${index + 1}`;
      
      bddContent += `  Scenario: ${scenarioName}\n`;
      bddContent += `    # ${testCase.test_case_description}\n`;
      bddContent += `    # Prioridad: ${testCase.priority}\n\n`;
      
      // Precondiciones como Given
      if (testCase.preconditions && testCase.preconditions.trim() !== '' && testCase.preconditions !== 'No especificadas') {
        const preconditions = testCase.preconditions.split(/[.\n]/).filter(p => p.trim() !== '');
        preconditions.forEach(precondition => {
          if (precondition.trim()) {
            bddContent += `    Given ${precondition.trim()}\n`;
          }
        });
      } else {
        bddContent += `    Given las precondiciones están establecidas\n`;
      }
      
      // Pasos de prueba como When
      if (testCase.test_steps) {
        const steps = Array.isArray(testCase.test_steps) 
          ? testCase.test_steps 
          : (testCase.test_steps as string).split(/\n/).filter((s: string) => s.trim() !== '');
        
        steps.forEach((step: string, stepIndex: number) => {
          if (step.trim()) {
            const stepText = step.trim().replace(/^\d+\.?\s*/, ''); // Remover numeración
            if (stepIndex === 0) {
              bddContent += `    When ${stepText}\n`;
            } else {
              bddContent += `    And ${stepText}\n`;
            }
          }
        });
      } else {
        bddContent += `    When se ejecuta la funcionalidad\n`;
      }
      
      // Resultados esperados como Then
      if (testCase.expected_results && testCase.expected_results.trim() !== '') {
        const results = testCase.expected_results.split(/[.\n]/).filter(r => r.trim() !== '');
        results.forEach((result, resultIndex) => {
          if (result.trim()) {
            if (resultIndex === 0) {
              bddContent += `    Then ${result.trim()}\n`;
            } else {
              bddContent += `    And ${result.trim()}\n`;
            }
          }
        });
      } else {
        bddContent += `    Then el sistema responde correctamente\n`;
      }
      
      // Datos de prueba como comentario
      if (testCase.test_data && testCase.test_data.trim() !== '' && testCase.test_data !== 'No especificados') {
        bddContent += `    # Datos de prueba: ${testCase.test_data}\n`;
      }
      
      // Requisitos como comentario
      if (testCase.requirements && testCase.requirements.trim() !== '' && testCase.requirements !== 'No especificados') {
        bddContent += `    # Requisitos: ${testCase.requirements}\n`;
      }
      
      bddContent += `\n`;
    });
    
    // Agregar información adicional al final
    bddContent += `# Información del Plan:\n`;
    bddContent += `# - Tipo de pruebas: ${planConfig.plan_type}\n`;
    bddContent += `# - Cobertura objetivo: ${planConfig.coverage_percentage}%\n`;
    bddContent += `# - Total de casos: ${testPlan.test_cases.length}\n`;
    bddContent += `# - Contexto del proyecto: ${projectContext}\n`;
    
    return bddContent;
  };

  // Función para generar CSV compatible con Excel
  const generateExcelCSVContent = (testPlan: TestPlan, planConfig: PlanConfiguration) => {
    // Información del plan
    const planInfo = [
      ['PLAN DE PRUEBAS'],
      [''],
      ['Título:', planConfig.plan_title],
      ['Tipo:', planConfig.plan_type],
      ['Cobertura objetivo:', `${planConfig.coverage_percentage}%`],
      ['Total de casos:', testPlan.test_cases.length.toString()],
      ['Fecha de generación:', new Date().toLocaleDateString()],
      [''],
      ['CASOS DE PRUEBA'],
      ['']
    ];

    // Headers de la tabla
    const headers = [
      '#',
      'Nombre del Caso',
      'Descripción',
      'Precondiciones',
      'Pasos de Prueba',
      'Resultados Esperados',
      'Prioridad',
      'Estado'
    ];

    // Casos de prueba
    const testCaseRows = testPlan.test_cases.map((testCase, index) => {
      const steps = Array.isArray(testCase.test_steps) 
        ? testCase.test_steps.join('; ') 
        : testCase.test_steps || '';

      return [
        (index + 1).toString(),
        testCase.test_case_name || '',
        testCase.test_case_description || '',
        testCase.preconditions || '',
        steps,
        testCase.expected_results || '',
        testCase.priority || 'MEDIA',
        testCase.status || 'PROPOSED'
      ];
    });

    // Combinar todo
    const allRows = [
      ...planInfo,
      headers,
      ...testCaseRows
    ];

    // Convertir a CSV con escape de comillas
    const csvContent = allRows.map(row => 
      row.map(cell => {
        // Escapar comillas dobles y envolver en comillas si contiene comas, saltos de línea o comillas
        const cellStr = cell.toString();
        if (cellStr.includes(',') || cellStr.includes('\n') || cellStr.includes('"')) {
          return `"${cellStr.replace(/"/g, '""')}"`;
        }
        return cellStr;
      }).join(',')
    ).join('\n');

    return csvContent;
  };

  // Función para descargar Excel (CSV)
  const handleDownloadExcel = async () => {
    if (!testPlan || !planConfig) return;

    setExportLoading(true);
    try {
      const content = generateExcelCSVContent(testPlan, planConfig);
      const fileName = `plan_${planConfig.plan_title?.replace(/[^a-zA-Z0-9]/g, '_') || 'pruebas'}_${new Date().toISOString().split('T')[0]}.csv`;
      
      // Añadir BOM para que Excel reconozca correctamente los caracteres UTF-8
      const BOM = '\uFEFF';
      const blob = new Blob([BOM + content], { type: 'text/csv;charset=utf-8;' });
      const url = window.URL.createObjectURL(blob);
      
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      
      logger.info('Excel CSV descargado exitosamente', { fileName });
      setShowPreviewModal(false);
    } catch (err) {
      logger.error('Error al descargar Excel CSV:', err);
    } finally {
      setExportLoading(false);
    }
  };

  // Función para descargar JSON
  const handleDownloadJSON = async () => {
    if (!testPlan || !planConfig) return;

    setExportLoading(true);
    try {
      const content = generateJSONContent(testPlan, planConfig);
      const fileName = `plan_${planConfig.plan_title?.replace(/[^a-zA-Z0-9]/g, '_') || 'pruebas'}_${new Date().toISOString().split('T')[0]}.json`;
      
      const blob = new Blob([content], { type: 'application/json;charset=utf-8;' });
      const url = window.URL.createObjectURL(blob);
      
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      
      logger.info('JSON descargado exitosamente', { fileName });
      setShowPreviewModal(false);
    } catch (err) {
      logger.error('Error al descargar JSON:', err);
    } finally {
      setExportLoading(false);
    }
  };

  // Función para descargar BDD/Gherkin
  const handleDownloadBDD = async () => {
    if (!testPlan || !planConfig) return;

    setExportLoading(true);
    try {
      const content = generateBDDContent(testPlan, planConfig);
      const fileName = `plan_${planConfig.plan_title?.replace(/[^a-zA-Z0-9]/g, '_') || 'pruebas'}_${new Date().toISOString().split('T')[0]}.feature`;
      
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8;' });
      const url = window.URL.createObjectURL(blob);
      
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      
      logger.info('BDD/Gherkin descargado exitosamente', { fileName });
      setShowPreviewModal(false);
    } catch (err) {
      logger.error('Error al descargar BDD:', err);
    } finally {
      setExportLoading(false);
    }
  };

  // Función para calcular cobertura
  const handleCalculateCoverage = async () => {
    logger.info('=== HANDLE_CALCULATE_COVERAGE STARTED ===');
    logger.info('Estado de currentSession:', currentSession);
    logger.info('Estado de testPlan:', testPlan);
    
    if (!currentSession) {
      logger.error('currentSession es null - no hay sesión activa');
      setError('No hay sesión activa para calcular cobertura');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      logger.info('Iniciando cálculo de cobertura...', {
        url: `${appConfig.api.gatewayUrl}/calculate-coverage`,
        sessionId: currentSession.id
      });

      const response = await fetch(`${appConfig.api.gatewayUrl}/calculate-coverage`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': appConfig.api.apiKey,
        },
        body: JSON.stringify({
          session_id: currentSession.id,
        }),
      });

      logger.info('Respuesta recibida:', { status: response.status, statusText: response.statusText });

      if (!response.ok) {
        throw new Error(`Error ${response.status}: ${response.statusText}`);
      }

      const rawData = await response.json();
      logger.info('Datos de cobertura recibidos:', rawData);
      
      // Manejar respuesta de API Gateway - parsear el body si es string
      let data;
      if (rawData.body && typeof rawData.body === 'string') {
        logger.info('Parseando body de API Gateway...');
        data = JSON.parse(rawData.body);
      } else {
        data = rawData;
      }
      
      logger.info('Datos parseados:', data);
      
      if (testPlan && data.coverage_metrics) {
        const updatedPlan = {
          ...testPlan,
          coverage_metrics: data.coverage_metrics.summary || data.coverage_metrics,
        };
        logger.info('Actualizando testPlan con métricas:', updatedPlan);
        setTestPlan(updatedPlan);
      } else {
        logger.warn('No se pudo actualizar testPlan:', { testPlan: !!testPlan, coverage_metrics: !!data.coverage_metrics });
      }
      
      logger.info('Cobertura calculada exitosamente', data);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Error desconocido';
      setError(`Error al calcular cobertura: ${errorMessage}`);
      logger.error('Error al calcular cobertura:', err);
    } finally {
      setLoading(false);
    }
  };

  // Funciones del chat con Knowledge Base
  const initializeChatSession = () => {
    if (!testPlan || !planConfig) return;

    const initialMessage: ConversationMessage = {
      role: 'system',
      content: `¡Hola! 👋 He generado exitosamente tu plan de pruebas personalizado.\n\n📋 **PLAN DE PRUEBAS:** ${planConfig.plan_title}\n\n🎯 **INFORMACIÓN DEL PLAN**\n• Tipo de pruebas: ${planConfig.plan_type}\n• Cobertura objetivo: ${planConfig.coverage_percentage}%\n• Casos generados: ${testPlan.test_cases.length} casos de prueba\n• Rango solicitado: ${planConfig.min_test_cases} - ${planConfig.max_test_cases} casos\n\n💬 **¿CÓMO PUEDO AYUDARTE?**\n\nPuedes preguntarme sobre:\n• Detalles específicos de cualquier caso de prueba\n• Sugerencias para mejorar la cobertura\n• Modificaciones o casos adicionales\n• Explicaciones sobre la metodología utilizada\n\n¡Estoy aquí para ayudarte a perfeccionar tu plan de pruebas! 🚀`,
      timestamp: new Date().toISOString(),
    };

    const newChatSession: ChatSession = {
      id: currentSession?.id || 'chat-' + Date.now(),
      messages: [initialMessage],
      isActive: true,
      created_at: new Date().toISOString(),
    };

    setChatSession(newChatSession);
    setChatMessages([initialMessage]);
  };

  const scrollToBottom = () => {
    if (chatMessagesRef.current) {
      chatMessagesRef.current.scrollTop = chatMessagesRef.current.scrollHeight;
    }
  };

  const addMessage = (message: ConversationMessage) => {
    setChatMessages(prev => [...prev, message]);
    setTimeout(scrollToBottom, 100);
  };

  // Función para procesar comandos de la IA
  const processAICommands = (assistantResponse: string) => {
    if (!testPlan) {
      console.log('❌ No hay testPlan disponible para procesar comandos');
      return;
    }

    console.log('🔍 Procesando respuesta de IA para comandos:', assistantResponse);
    console.log('📊 Casos actuales en testPlan:', testPlan.test_cases.length);

    // Patrones más amplios para detectar comandos de eliminación
    const deletePatterns = [
      /eliminar\s+(?:el\s+)?caso\s+(\d+)/gi,
      /remover\s+(?:el\s+)?caso\s+(\d+)/gi,
      /quitar\s+(?:el\s+)?caso\s+(\d+)/gi,
      /borrar\s+(?:el\s+)?caso\s+(\d+)/gi,
      /eliminar\s+tc[_-]?(\d+)/gi,
      /caso\s+(\d+).*(?:eliminar|remover|quitar|borrar)/gi,
      /(?:eliminar|remover|quitar|borrar).*caso\s+(\d+)/gi
    ];

    let foundCommands = false;

    deletePatterns.forEach((pattern, patternIndex) => {
      const matches = Array.from(assistantResponse.matchAll(pattern));
      if (matches.length > 0) {
        console.log(`✅ Patrón ${patternIndex + 1} encontró comandos:`, matches);
        foundCommands = true;
        
        matches.forEach((match, matchIndex) => {
          const caseNumber = parseInt(match[1]);
          console.log(`🎯 Comando ${matchIndex + 1}: Eliminar caso ${caseNumber}`);
          
          if (caseNumber > 0 && caseNumber <= testPlan.test_cases.length) {
            const caseIndex = caseNumber - 1;
            const caseToDelete = testPlan.test_cases[caseIndex];
            
            console.log(`✅ Caso válido encontrado:`, {
              numero: caseNumber,
              indice: caseIndex,
              nombre: caseToDelete.test_case_name
            });
            
            // Ejecutar eliminación con delay
            setTimeout(() => {
              console.log(`🗑️ Ejecutando eliminación del caso ${caseNumber}`);
              handleDeleteTestCase(caseIndex);
            }, 1000);
          } else {
            console.log(`❌ Número de caso inválido: ${caseNumber}. Debe estar entre 1 y ${testPlan.test_cases.length}`);
          }
        });
      }
    });

    if (!foundCommands) {
      console.log('ℹ️ No se encontraron comandos de eliminación en la respuesta');
      
      // Mostrar fragmentos de la respuesta para debugging
      const words = assistantResponse.toLowerCase().split(' ');
      const relevantWords = words.filter(word => 
        ['eliminar', 'remover', 'quitar', 'borrar', 'caso'].some(keyword => 
          word.includes(keyword)
        )
      );
      
      if (relevantWords.length > 0) {
        console.log('🔍 Palabras relevantes encontradas:', relevantWords);
      }
    }

    // Detectar comandos de modificación (futuro)
    const modifyPattern = /modificar caso (\d+)|cambiar caso (\d+)|actualizar caso (\d+)/gi;
    const modifyMatches = Array.from(assistantResponse.matchAll(modifyPattern));
    
    if (modifyMatches.length > 0) {
      console.log('🔧 Comandos de modificación detectados:', modifyMatches);
    }
  };

  const handleSendMessage = async () => {
    if (!chatInput.trim() || isChatLoading) return;

    const userMessage: ConversationMessage = {
      role: 'user',
      content: chatInput.trim(),
      timestamp: new Date().toISOString(),
    };

    addMessage(userMessage);
    setChatInput('');
    setIsChatLoading(true);
    setIsTyping(true);

    try {
      logger.info('=== CHAT MESSAGE STARTED ===');
      logger.info('Enviando consulta a KB:', {
        query: userMessage.content,
        url: `${appConfig.api.gatewayUrl}/hybrid_search`,
        hasApiKey: !!appConfig.api.apiKey,
        hasTestPlan: !!testPlan
      });

      // Llamada real a la Knowledge Base usando hybrid_search con contexto del plan y historial
      const requestBody = {
        session_id: currentSession?.id,
        query: userMessage.content,
        max_results: 5,
        plan_context: testPlan ? {
          plan_title: planConfig?.plan_title,
          plan_type: planConfig?.plan_type,
          coverage_percentage: planConfig?.coverage_percentage,
          project_context: planConfig?.project_context,
          test_cases_count: testPlan.test_cases.length,
          test_cases: testPlan.test_cases.map((tc, index) => ({
            number: index + 1,
            name: tc.test_case_name,
            description: tc.test_case_description,
            priority: tc.priority,
            preconditions: tc.preconditions,
            test_steps: tc.test_steps,
            expected_results: tc.expected_results,
            test_data: tc.test_data || 'N/A',
            requirements: tc.requirements || 'N/A'
          }))
        } : null,
        conversation_history: chatMessages
          .filter(msg => msg.role !== 'system') // Excluir mensaje inicial del sistema
          .slice(-6) // Solo los últimos 6 mensajes para no sobrecargar
          .map(msg => ({
            role: msg.role,
            content: msg.content,
            timestamp: msg.timestamp
          })),
        // Incluir información sobre capacidades de modificación
        system_capabilities: {
          can_modify_plan: true,
          supported_commands: [
            "eliminar caso [número]",
            "modificar caso [número]",
            "agregar caso"
          ]
        }
      };

      logger.info('Request body para KB:', requestBody);

      const response = await fetch(`${appConfig.api.gatewayUrl}/hybrid_search`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': appConfig.api.apiKey,
        },
        body: JSON.stringify(requestBody),
      });

      logger.info('Respuesta HTTP de KB:', {
        status: response.status,
        statusText: response.statusText,
        ok: response.ok
      });

      let assistantResponse = '';

      if (response.ok) {
        const rawData = await response.json();
        logger.info('Datos raw de KB:', rawData);
        
        // Manejar respuesta de API Gateway - parsear el body si es string
        let data;
        if (rawData.body && typeof rawData.body === 'string') {
          logger.info('Parseando body de API Gateway...');
          data = JSON.parse(rawData.body);
        } else {
          data = rawData;
        }
        
        logger.info('Datos procesados de KB:', data);
        logger.info('Campo response en data:', data.response);
        logger.info('Tipo de data.response:', typeof data.response);
        logger.info('Todas las claves en data:', Object.keys(data));
        
        // Usar la respuesta conversacional que ya viene del hybrid_search
        if (data.response && data.response.trim()) {
          assistantResponse = data.response.trim();
          logger.info('Usando respuesta de Claude:', assistantResponse.substring(0, 100) + '...');
        } else {
          logger.warn('No se encontró data.response válida, usando fallback');
          assistantResponse = 'Lo siento, no pude generar una respuesta adecuada en este momento.';
        }
        
        // Si no hay respuesta pero hay resultados, mostrar que se encontró información
        if (!data.response && (data.search_results || data.retrieval_results)) {
          assistantResponse = 'Encontré información relevante en la Knowledge Base, pero no pude generar una respuesta conversacional. Por favor, intenta reformular tu pregunta.';
        }
      } else {
        const errorText = await response.text();
        logger.error('Error detallado de KB:', {
          status: response.status,
          statusText: response.statusText,
          errorText: errorText
        });
        
        assistantResponse = `Lo siento, hubo un problema al conectar con la Knowledge Base (Error ${response.status}). Sin embargo, puedo ayudarte con información sobre tu plan de pruebas actual. ¿Qué te gustaría saber sobre los ${testPlan?.test_cases.length} casos generados?`;
      }

      // Simular tiempo de procesamiento más realista
      setTimeout(() => {
        setIsTyping(false);
        const assistantMessage: ConversationMessage = {
          role: 'assistant',
          content: assistantResponse,
          timestamp: new Date().toISOString(),
        };
        addMessage(assistantMessage);
        
        // Procesar comandos de la IA después de mostrar la respuesta
        processAICommands(assistantResponse);
      }, 2000);

    } catch (error) {
      logger.error('Error crítico en chat con KB:', error);
      setTimeout(() => {
        setIsTyping(false);
        const errorMessage: ConversationMessage = {
          role: 'assistant',
          content: `Disculpa, ocurrió un error de conexión. Mientras tanto, puedo ayudarte con tu plan actual que tiene ${testPlan?.test_cases.length} casos de prueba de tipo ${planConfig?.plan_type}. ¿Qué aspecto específico te gustaría revisar?`,
          timestamp: new Date().toISOString(),
        };
        addMessage(errorMessage);
      }, 1500);
    } finally {
      setIsChatLoading(false);
    }
  };

  const handleSuggestionClick = (suggestion: string) => {
    setChatInput(suggestion);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  // Inicializar chat cuando se carga la pantalla de resultados
  useEffect(() => {
    if (currentStep === 3 && testPlan && !chatSession) {
      initializeChatSession();
    }
  }, [currentStep, testPlan, chatSession]);

  // Auto-scroll cuando hay nuevos mensajes
  useEffect(() => {
    scrollToBottom();
  }, [chatMessages]);

  // Función para eliminar un caso de prueba
  const handleDeleteTestCase = (index: number) => {
    if (!testPlan) return;

    const caseToDelete = testPlan.test_cases[index];
    
    // Guardar el caso eliminado para poder deshacerlo
    setDeletedCase({ case: caseToDelete, index });
    
    // Crear nueva versión del plan sin el caso eliminado
    const updatedTestCases = testPlan.test_cases.filter((_, i) => i !== index);
    const updatedTestPlan = {
      ...testPlan,
      test_cases: updatedTestCases
    };
    
    setTestPlan(updatedTestPlan);
    setShowUndoPopup(true);
    
    // Timer para auto-ocultar el popup después de 5 segundos
    const timer = window.setTimeout(() => {
      setShowUndoPopup(false);
      setDeletedCase(null);
    }, 5000);
    
    setUndoTimer(timer);
  };

  // Función para deshacer la eliminación
  const handleUndoDelete = () => {
    if (!deletedCase || !testPlan) return;

    // Recrear el array con el caso restaurado en su posición original
    const restoredTestCases = [...testPlan.test_cases];
    restoredTestCases.splice(deletedCase.index, 0, deletedCase.case);
    
    const updatedTestPlan = {
      ...testPlan,
      test_cases: restoredTestCases
    };
    
    setTestPlan(updatedTestPlan);
    setShowUndoPopup(false);
    setDeletedCase(null);
    
    // Limpiar el timer
    if (undoTimer) {
      window.clearTimeout(undoTimer);
      setUndoTimer(null);
    }
  };

  // Limpiar timer cuando el componente se desmonta
  useEffect(() => {
    return () => {
      if (undoTimer) {
        window.clearTimeout(undoTimer);
      }
    };
  }, [undoTimer]);

  // Funciones para edición de casos
  const handleStartEditing = () => {
    if (!selectedTestCase) return;
    
    setOriginalCaseData({ ...selectedTestCase });
    setEditingCaseData({ ...selectedTestCase });
    setIsEditingCase(true);
  };

  const handleSaveChanges = () => {
    if (!editingCaseData || !testPlan || selectedTestCase === null) return;

    // Actualizar el caso en el testPlan
    const updatedTestCases = [...testPlan.test_cases];
    updatedTestCases[selectedTestCase.index] = {
      ...editingCaseData,
      last_modified: new Date().toISOString()
    };

    const updatedTestPlan = {
      ...testPlan,
      test_cases: updatedTestCases,
      updated_at: new Date().toISOString()
    };

    setTestPlan(updatedTestPlan);
    
    // Actualizar el caso seleccionado con los nuevos datos
    setSelectedTestCase({
      ...editingCaseData,
      index: selectedTestCase.index,
      last_modified: new Date().toISOString()
    });

    // Salir del modo edición
    setIsEditingCase(false);
    setEditingCaseData(null);
    setOriginalCaseData(null);
  };

  const handleCancelEditing = () => {
    // Restaurar datos originales
    if (originalCaseData) {
      setSelectedTestCase(originalCaseData);
    }
    
    // Salir del modo edición
    setIsEditingCase(false);
    setEditingCaseData(null);
    setOriginalCaseData(null);
  };

  const handleEditingFieldChange = (field: string, value: string | string[]) => {
    if (!editingCaseData) return;
    
    setEditingCaseData({
      ...editingCaseData,
      [field]: value
    });
  };

  // Función para manejar el cierre del modal
  const handleCloseModal = () => {
    if (isEditingCase) {
      // Si está editando, cancelar la edición
      handleCancelEditing();
    }
    
    setShowPreviewModal(false);
    setSelectedTestCase(null);
  };

  // Renderizar modal de vista previa
  const renderPreviewModal = () => {
    if (!showPreviewModal || !testPlan || !planConfig) return null;

    return (
      <div className="modal-overlay" onClick={() => {
        setShowPreviewModal(false);
        setSelectedTestCase(null);
      }}>
        <div className="modal-content" onClick={(e) => e.stopPropagation()}>
          <div className="modal-header">
            <h2>
              {selectedTestCase ? '🔍 Detalle del Caso de Prueba' : '👁️ Vista Previa del Plan'}
            </h2>
            <button 
              className="modal-close"
              onClick={() => {
                setShowPreviewModal(false);
                setSelectedTestCase(null);
              }}
            >
              ✕
            </button>
          </div>
          
          <div className="modal-body">
            {selectedTestCase ? (
              // Vista detallada del caso seleccionado
              <div className="test-case-detail">
                <div className="detail-header">
                  <button 
                    className="btn btn-secondary"
                    onClick={() => setSelectedTestCase(null)}
                    style={{ marginBottom: '20px' }}
                  >
                    ← Volver a la lista
                  </button>
                  <div className="case-number-large">
                    TC_{String(selectedTestCase.index + 1).padStart(3, '0')}
                  </div>
                </div>

                <div className="detail-content">
                  {/* Nombre del Caso - Siempre se muestra */}
                  <div className="detail-section">
                    <h4>📝 Nombre del Caso</h4>
                    {isEditingCase ? (
                      <input
                        type="text"
                        className="form-control"
                        value={editingCaseData?.test_case_name || ''}
                        onChange={(e) => handleEditingFieldChange('test_case_name', e.target.value)}
                        placeholder="Nombre del caso de prueba"
                      />
                    ) : (
                      <p>{selectedTestCase.test_case_name}</p>
                    )}
                  </div>

                  {/* Descripción - Siempre se muestra */}
                  <div className="detail-section">
                    <h4>📄 Descripción</h4>
                    {isEditingCase ? (
                      <textarea
                        className="form-control"
                        rows={3}
                        value={editingCaseData?.test_case_description || ''}
                        onChange={(e) => handleEditingFieldChange('test_case_description', e.target.value)}
                        placeholder="Descripción del caso de prueba"
                      />
                    ) : (
                      <p>{selectedTestCase.test_case_description}</p>
                    )}
                  </div>

                  {/* Prioridad - Siempre se muestra */}
                  <div className="detail-section">
                    <h4>🎯 Prioridad</h4>
                    {isEditingCase ? (
                      <select
                        className="form-control"
                        value={editingCaseData?.priority || 'MEDIA'}
                        onChange={(e) => handleEditingFieldChange('priority', e.target.value)}
                      >
                        <option value="ALTA">ALTA</option>
                        <option value="MEDIA">MEDIA</option>
                        <option value="BAJA">BAJA</option>
                      </select>
                    ) : (
                      <span className={`priority-badge priority-${selectedTestCase.priority?.toLowerCase()}`}>
                        {selectedTestCase.priority}
                      </span>
                    )}
                  </div>

                  {/* Precondiciones - Siempre editable en modo edición */}
                  <div className="detail-section">
                    <h4>⚙️ Precondiciones</h4>
                    {isEditingCase ? (
                      <textarea
                        className="form-control"
                        rows={2}
                        value={editingCaseData?.preconditions || ''}
                        onChange={(e) => handleEditingFieldChange('preconditions', e.target.value)}
                        placeholder="Precondiciones del caso de prueba"
                      />
                    ) : (
                      selectedTestCase.preconditions && 
                      selectedTestCase.preconditions.trim() !== '' && 
                      selectedTestCase.preconditions !== 'No especificadas' ? (
                        <p>{selectedTestCase.preconditions}</p>
                      ) : (
                        <p style={{ color: '#9ca3af', fontStyle: 'italic' }}>No especificadas</p>
                      )
                    )}
                  </div>

                  {/* Pasos de Prueba - Siempre editable en modo edición */}
                  <div className="detail-section">
                    <h4>📋 Pasos de Prueba</h4>
                    {isEditingCase ? (
                      <textarea
                        className="form-control"
                        rows={4}
                        value={Array.isArray(editingCaseData?.test_steps) 
                          ? editingCaseData.test_steps.join('\n') 
                          : editingCaseData?.test_steps || ''}
                        onChange={(e) => {
                          const steps = e.target.value.split('\n').filter(step => step.trim() !== '');
                          handleEditingFieldChange('test_steps', steps);
                        }}
                        placeholder="Escribe los pasos separados por líneas"
                      />
                    ) : (
                      ((Array.isArray(selectedTestCase.test_steps) && selectedTestCase.test_steps.length > 0) ||
                        (selectedTestCase.test_steps && 
                         selectedTestCase.test_steps.trim() !== '' && 
                         selectedTestCase.test_steps !== 'No especificados')) ? (
                        Array.isArray(selectedTestCase.test_steps) ? (
                          <ol className="test-steps-list">
                            {selectedTestCase.test_steps.map((step: string, index: number) => (
                              <li key={index}>{step}</li>
                            ))}
                          </ol>
                        ) : (
                          <p>{selectedTestCase.test_steps}</p>
                        )
                      ) : (
                        <p style={{ color: '#9ca3af', fontStyle: 'italic' }}>No especificados</p>
                      )
                    )}
                  </div>

                  {/* Resultados Esperados - Siempre se muestra */}
                  <div className="detail-section">
                    <h4>✅ Resultados Esperados</h4>
                    {isEditingCase ? (
                      <textarea
                        className="form-control"
                        rows={3}
                        value={editingCaseData?.expected_results || ''}
                        onChange={(e) => handleEditingFieldChange('expected_results', e.target.value)}
                        placeholder="Resultados esperados del caso de prueba"
                      />
                    ) : (
                      <p>{selectedTestCase.expected_results}</p>
                    )}
                  </div>

                  {/* Datos de Prueba - Siempre editable en modo edición */}
                  <div className="detail-section">
                    <h4>📊 Datos de Prueba</h4>
                    {isEditingCase ? (
                      <textarea
                        className="form-control"
                        rows={2}
                        value={editingCaseData?.test_data || ''}
                        onChange={(e) => handleEditingFieldChange('test_data', e.target.value)}
                        placeholder="Datos de prueba necesarios"
                      />
                    ) : (
                      selectedTestCase.test_data && 
                      selectedTestCase.test_data.trim() !== '' && 
                      selectedTestCase.test_data !== 'No especificados' ? (
                        <p>{selectedTestCase.test_data}</p>
                      ) : (
                        <p style={{ color: '#9ca3af', fontStyle: 'italic' }}>No especificados</p>
                      )
                    )}
                  </div>

                  {/* Requisitos - Siempre editable en modo edición */}
                  <div className="detail-section">
                    <h4>📋 Requisitos</h4>
                    {isEditingCase ? (
                      <textarea
                        className="form-control"
                        rows={2}
                        value={editingCaseData?.requirements || ''}
                        onChange={(e) => handleEditingFieldChange('requirements', e.target.value)}
                        placeholder="Requisitos asociados"
                      />
                    ) : (
                      selectedTestCase.requirements && 
                      selectedTestCase.requirements.trim() !== '' && 
                      selectedTestCase.requirements !== 'No especificados' ? (
                        <p>{selectedTestCase.requirements}</p>
                      ) : (
                        <p style={{ color: '#9ca3af', fontStyle: 'italic' }}>No especificados</p>
                      )
                    )}
                  </div>

                  {/* Información Adicional - Solo en modo vista */}
                  {!isEditingCase && (
                    <div className="detail-section">
                      <h4>ℹ️ Información Adicional</h4>
                      <div className="additional-info">
                        <p><strong>Estado:</strong> {selectedTestCase.status}</p>
                        <p><strong>Creado por:</strong> {selectedTestCase.created_by}</p>
                        <p><strong>Última modificación:</strong> {new Date(selectedTestCase.last_modified).toLocaleString()}</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              // Vista de lista de casos
              <>
                {/* Resumen del plan */}
                <div className="preview-summary">
                  <h3>📋 {planConfig.plan_title}</h3>
                  <div className="preview-stats">
                    <span>📊 {testPlan.test_cases.length} casos</span>
                    <span>🎯 {planConfig.plan_type}</span>
                    <span>📈 {testPlan.coverage_metrics.target_coverage}% cobertura</span>
                  </div>
                </div>

                {/* Lista de casos de prueba */}
                <div className="preview-cases-list">
                  <h4>Casos de Prueba: <small>(Haz click en un caso para ver los detalles)</small></h4>
                  <div className="cases-container">
                    {testPlan.test_cases.map((testCase, index) => (
                      <div 
                        key={index} 
                        className="preview-case-item clickable"
                        onClick={() => setSelectedTestCase({ ...testCase, index })}
                      >
                        <div className="case-number">TC_{String(index + 1).padStart(3, '0')}</div>
                        <div className="case-details">
                          <div className="case-name">{testCase.test_case_name}</div>
                          <div className="case-description">{testCase.test_case_description}</div>
                          <div className="case-priority">Prioridad: {testCase.priority}</div>
                        </div>
                        <div className="case-arrow">→</div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="modal-footer">
            {selectedTestCase ? (
              // Footer para vista de caso individual
              <>
                {isEditingCase ? (
                  // Botones durante edición
                  <>
                    <button 
                      className="btn btn-secondary"
                      onClick={handleCancelEditing}
                    >
                      ❌ Cancelar
                    </button>
                    <button 
                      className="btn btn-primary"
                      onClick={handleSaveChanges}
                    >
                      💾 Guardar Cambios
                    </button>
                  </>
                ) : (
                  // Botón para iniciar edición
                  <button 
                    className="btn btn-primary"
                    onClick={handleStartEditing}
                  >
                    ✏️ Editar Caso
                  </button>
                )}
              </>
            ) : (
              // Footer para vista de lista (solo botones de descarga)
              <>
                <button 
                  className="btn btn-primary"
                  onClick={handleDownloadExcel}
                  disabled={exportLoading}
                >
                  {exportLoading ? 'Descargando...' : '📊 Descargar Excel'}
                </button>
                <button 
                  className="btn btn-primary"
                  onClick={handleDownloadJSON}
                  disabled={exportLoading}
                >
                  {exportLoading ? 'Descargando...' : '🔧 Descargar JSON'}
                </button>
                <button 
                  className="btn btn-primary"
                  onClick={handleDownloadBDD}
                  disabled={exportLoading}
                >
                  {exportLoading ? 'Descargando...' : '🥒 Descargar BDD'}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    );
  };

  // Renderizar pantalla de bienvenida
  const renderWelcomeScreen = () => (
    <div className="step-content">
      <div style={{ textAlign: 'center', marginBottom: '30px' }}>
        <div style={{ fontSize: '4rem', marginBottom: '20px' }}>
          {isConfigValid ? '✅' : '⚠️'}
        </div>
        <h2 style={{ color: '#1e293b', marginBottom: '10px' }}>
          Generador de Planes de Prueba
        </h2>
        <p style={{ color: '#64748b', fontSize: '18px', marginBottom: '30px' }}>
          {isConfigValid ? 'Sistema listo para generar planes de prueba' : 'Sistema listo con limitaciones'}
        </p>
      </div>

      {/* Estado del sistema */}
      <div className="knowledge-base-status status-success" style={{ marginBottom: '30px' }}>
        <div className="status-header">
          <div className="status-icon">🧠</div>
          <div className="status-text">
            <strong>Estado del Sistema</strong>
            <div className="status-details">
              {isConfigValid ? 'Todas las configuraciones están correctas' : 'Configuración con limitaciones'}
            </div>
          </div>
          <div className={`connection-indicator ${isConfigValid ? 'connected' : 'error'}`}>
            <div className="connection-pulse"></div>
            {isConfigValid ? 'Conectado' : 'Limitado'}
          </div>
        </div>
      </div>

      {/* Información sobre las capacidades del sistema */}
      <div className="alert info" style={{ marginBottom: '30px' }}>
        <strong>🚀 Capacidades del Sistema:</strong>
        <ul style={{ margin: '10px 0 0 20px', paddingLeft: '0' }}>
          <li><strong>IA Avanzada:</strong> Generación automática con Claude Sonnet 4</li>
          <li><strong>Knowledge Base:</strong> {isConfigValid ? 'Conectada - Patrones y mejores prácticas disponibles' : 'Modo limitado - Usando patrones básicos'}</li>
          <li><strong>Múltiples tipos:</strong> Unitarias, Integración, Performance, Regresión</li>
          <li><strong>Exportación:</strong> Múltiples formatos (Excel, PDF, JSON, CSV)</li>
          <li><strong>Cobertura inteligente:</strong> Cálculo automático de métricas</li>
        </ul>
      </div>

      {!isConfigValid && (
        <div className="alert warning" style={{ marginBottom: '30px' }}>
          <strong>⚠️ Modo Limitado:</strong> Algunas configuraciones no están disponibles, pero puedes continuar. 
          El sistema utilizará configuraciones básicas para generar casos de prueba.
        </div>
      )}

      {/* Botón para continuar */}
      <div className="action-buttons" style={{ textAlign: 'center' }}>
        <button 
          type="button" 
          className="btn btn-primary"
          onClick={nextStep}
          disabled={!systemReady}
          style={{ 
            fontSize: '18px', 
            padding: '15px 30px',
            minWidth: '250px'
          }}
        >
          {systemReady ? (
            <>
              <span>🎯</span>
              Comenzar Generación
            </>
          ) : (
            <>
              <div className="loading-spinner" style={{ marginRight: '10px' }}></div>
              Verificando Sistema...
            </>
          )}
        </button>
      </div>

      {/* Información adicional */}
      <div style={{ 
        marginTop: '30px', 
        padding: '15px', 
        backgroundColor: '#f8fafc', 
        borderRadius: '8px',
        border: '1px solid #e2e8f0',
        fontSize: '12px',
        color: '#64748b',
        textAlign: 'center'
      }}>
        <strong>💡 Tip:</strong> Este sistema utiliza inteligencia artificial avanzada para generar 
        casos de prueba personalizados basados en tus requisitos y contexto del proyecto.
      </div>
    </div>
  );

  // Renderizar formulario de configuración
  const renderConfigurationForm = () => (
    <div className="step-content">
      <div className="form-group">
        <label className="form-label important-label">
          📝 Título del Plan {validationErrors.plan_title && <span style={{ color: '#dc2626' }}>*</span>}
        </label>
        <input
          type="text"
          value={formData.plan_title}
          onChange={(e) => {
            setFormData({ ...formData, plan_title: e.target.value });
            // Limpiar error cuando el usuario empiece a escribir
            if (validationErrors.plan_title && e.target.value.trim()) {
              setValidationErrors({ ...validationErrors, plan_title: false });
            }
          }}
          className={`form-control important-field ${validationErrors.plan_title ? 'error' : ''}`}
          placeholder="Ej: Plan de Pruebas - Sistema de Gestión"
          style={{
            borderColor: validationErrors.plan_title ? '#dc2626' : undefined,
            boxShadow: validationErrors.plan_title ? '0 0 0 1px #dc2626' : undefined
          }}
        />
        {validationErrors.plan_title && (
          <div style={{ color: '#dc2626', fontSize: '14px', marginTop: '5px' }}>
            Este campo es obligatorio
          </div>
        )}
      </div>

      <div className="form-group">
        <label className="form-label important-label">
          📋 Requisitos del Proyecto {validationErrors.project_context && <span style={{ color: '#dc2626' }}>*</span>}
        </label>
        <textarea
          value={formData.project_context}
          onChange={(e) => {
            setFormData({ ...formData, project_context: e.target.value });
            // Limpiar error cuando el usuario empiece a escribir
            if (validationErrors.project_context && e.target.value.trim()) {
              setValidationErrors({ ...validationErrors, project_context: false });
            }
          }}
          rows={6}
          className={`form-control important-field ${validationErrors.project_context ? 'error' : ''}`}
          placeholder="Describe los requisitos del proyecto, funcionalidades a probar, casos de uso principales..."
          style={{
            borderColor: validationErrors.project_context ? '#dc2626' : undefined,
            boxShadow: validationErrors.project_context ? '0 0 0 1px #dc2626' : undefined
          }}
        />
        {validationErrors.project_context && (
          <div style={{ color: '#dc2626', fontSize: '14px', marginTop: '5px' }}>
            Este campo es obligatorio
          </div>
        )}
      </div>

      {/* Selector de tipo de plan refinado */}
      <div className="plan-type-selector">
        <div className="plan-type-header">
          <div className="plan-type-title">
            Tipo de Plan de Pruebas
          </div>
        </div>
        <div className="plan-type-options">
          {[
            { value: 'UNITARIAS', name: 'Pruebas Unitarias', desc: 'Validación de componentes individuales y funciones específicas' },
            { value: 'INTEGRACIÓN', name: 'Pruebas de Integración', desc: 'Verificación de interacciones entre módulos y sistemas' },
            { value: 'PERFORMANCE', name: 'Pruebas de Performance', desc: 'Evaluación de rendimiento, carga y tiempo de respuesta' },
            { value: 'REGRESIÓN', name: 'Pruebas de Regresión', desc: 'Validación de funcionalidades tras cambios o actualizaciones' },
          ].map((type) => (
            <div key={type.value} className="plan-type-option">
              <input
                type="radio"
                id={type.value}
                name="plan_type"
                value={type.value}
                checked={formData.plan_type === type.value}
                onChange={(e) => setFormData({ ...formData, plan_type: e.target.value as PlanType })}
              />
              <label htmlFor={type.value} className="plan-type-card">
                <div className="plan-type-indicator"></div>
                <div className="plan-type-content">
                  <div className="plan-type-name">{type.name}</div>
                  <div className="plan-type-description">{type.desc}</div>
                </div>
              </label>
            </div>
          ))}
        </div>
      </div>

      {/* Contenedor para cobertura y número de casos */}
      <div className="config-row">
        {/* Selector de cobertura mejorado */}
        <div className="coverage-slider-container">
          <div className="coverage-slider-header">
            <div className="coverage-title">
              📊 Porcentaje de Cobertura Objetivo
            </div>
            <div className="coverage-value">
              {formData.coverage_percentage}%
            </div>
          </div>
          <div className="coverage-slider-track">
            <input
              type="range"
              min="10"
              max="100"
              value={formData.coverage_percentage}
              onChange={(e) => setFormData({ ...formData, coverage_percentage: parseInt(e.target.value) })}
              className="coverage-range"
            />
          </div>
          <div className="coverage-labels" style={{ position: 'relative', marginTop: '10px', height: '40px' }}>
            <div className="coverage-label" style={{ 
              position: 'absolute', 
              left: '0%', 
              transform: 'translateX(0%)',
              textAlign: 'center'
            }}>
              <span>10%</span>
              <small style={{ display: 'block', fontSize: '11px', color: '#64748b' }}>Básico</small>
            </div>
            <div className="coverage-label" style={{ 
              position: 'absolute', 
              left: `${((50 - 10) / (100 - 10)) * 100}%`, 
              transform: 'translateX(-50%)',
              textAlign: 'center'
            }}>
              <span>50%</span>
              <small style={{ display: 'block', fontSize: '11px', color: '#64748b' }}>Medio</small>
            </div>
            <div className="coverage-label" style={{ 
              position: 'absolute', 
              left: `${((80 - 10) / (100 - 10)) * 100}%`, 
              transform: 'translateX(-50%)',
              textAlign: 'center'
            }}>
              <span>80%</span>
              <small style={{ display: 'block', fontSize: '11px', color: '#64748b' }}>Alto</small>
            </div>
            <div className="coverage-label" style={{ 
              position: 'absolute', 
              left: '100%', 
              transform: 'translateX(-100%)',
              textAlign: 'center'
            }}>
              <span>100%</span>
              <small style={{ display: 'block', fontSize: '11px', color: '#64748b' }}>Completo</small>
            </div>
          </div>
        </div>

        {/* Selector de número de casos con slider dual compacto */}
        <div className="test-cases-slider-container">
          <div className="test-cases-slider-header">
            <div className="test-cases-title">
              🔢 Número de Casos de Prueba
            </div>
            <div className="test-cases-values">
              <span className="test-cases-min">{formData.min_test_cases}</span>
              <span className="test-cases-separator">-</span>
              <span className="test-cases-max">{formData.max_test_cases}</span>
              <span className="test-cases-unit">casos</span>
            </div>
          </div>
          
          <div className="test-cases-slider-track">
            <div className="dual-range-container">
              {/* Slider para valor mínimo */}
              <input
                type="range"
                min="1"
                max="50"
                value={formData.min_test_cases}
                onChange={(e) => {
                  const minValue = parseInt(e.target.value);
                  const maxValue = Math.max(minValue, formData.max_test_cases);
                  setFormData({ 
                    ...formData, 
                    min_test_cases: minValue,
                    max_test_cases: maxValue
                  });
                }}
                className="test-cases-range test-cases-range-min"
              />
              
              {/* Slider para valor máximo */}
              <input
                type="range"
                min="1"
                max="50"
                value={formData.max_test_cases}
                onChange={(e) => {
                  const maxValue = parseInt(e.target.value);
                  const minValue = Math.min(formData.min_test_cases, maxValue);
                  setFormData({ 
                    ...formData, 
                    min_test_cases: minValue,
                    max_test_cases: maxValue
                  });
                }}
                className="test-cases-range test-cases-range-max"
              />
              
              {/* Barra de rango visual */}
              <div 
                className="test-cases-range-fill"
                style={{
                  left: `${((formData.min_test_cases - 1) / (50 - 1)) * 100}%`,
                  width: `${((formData.max_test_cases - formData.min_test_cases) / (50 - 1)) * 100}%`
                }}
              ></div>
            </div>
          </div>
          
          <div className="test-cases-labels" style={{ position: 'relative', marginTop: '10px', height: '40px' }}>
            <div className="test-cases-label" style={{ 
              position: 'absolute', 
              left: '0%', 
              transform: 'translateX(0%)',
              textAlign: 'center'
            }}>
              <span>1</span>
              <small style={{ display: 'block', fontSize: '11px', color: '#64748b' }}>Mínimo</small>
            </div>
            <div className="test-cases-label" style={{ 
              position: 'absolute', 
              left: '25%', 
              transform: 'translateX(-50%)',
              textAlign: 'center'
            }}>
              <span>13</span>
              <small style={{ display: 'block', fontSize: '11px', color: '#64748b' }}>Medio</small>
            </div>
            <div className="test-cases-label" style={{ 
              position: 'absolute', 
              left: '75%', 
              transform: 'translateX(-50%)',
              textAlign: 'center'
            }}>
              <span>38</span>
              <small style={{ display: 'block', fontSize: '11px', color: '#64748b' }}>Alto</small>
            </div>
            <div className="test-cases-label" style={{ 
              position: 'absolute', 
              left: '100%', 
              transform: 'translateX(-100%)',
              textAlign: 'center'
            }}>
              <span>50</span>
              <small style={{ display: 'block', fontSize: '11px', color: '#64748b' }}>Máximo</small>
            </div>
          </div>
          
        </div>
      </div>

      <div className="action-buttons" style={{ marginTop: '1rem' }}>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={prevStep}
        >
          ← Volver
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={handleConfigurePlan}
          disabled={loading}
        >
          {loading ? (
            <>
              <div className="loading-spinner"></div>
              Configurando...
            </>
          ) : (
            'Continuar →'
          )}
        </button>
      </div>
    </div>
  );

  // Renderizar generador de plan
  const renderPlanGenerator = () => (
    <div className="step-content">
      <h2 style={{ color: '#1e293b', marginBottom: '30px', textAlign: 'center' }}>
        🤖 Generación del Plan
      </h2>
      
      {planConfig && (
        <div className="plan-summary">
          <h3>📋 Resumen de Configuración</h3>
          <div className="summary-stats">
            <div className="stat-item">
              <div className="stat-label">Tipo</div>
              <div className="stat-value">{planConfig.plan_type}</div>
            </div>
            <div className="stat-item">
              <div className="stat-label">Cobertura</div>
              <div className="stat-value">{planConfig.coverage_percentage}%</div>
            </div>
          </div>
          
          <div className="plan-title-section">
            <div className="plan-title-label">📝 Título del Plan</div>
            <div className="plan-title-value">{planConfig.plan_title}</div>
          </div>
          
          <div className="plan-context-section">
            <div className="plan-context-label">🏗️ Contexto del Proyecto</div>
            <div className="plan-context-value">{planConfig.project_context}</div>
          </div>
        </div>
      )}

      <div className="action-buttons">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={prevStep}
          disabled={loading}
        >
          ← Volver
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={handleGeneratePlan}
          disabled={loading || !currentSession}
        >
          {loading ? (
            <>
              <div className="loading-spinner"></div>
              Generando con IA...
            </>
          ) : (
            <>
              🚀 Generar Plan
            </>
          )}
        </button>
      </div>
    </div>
  );

  // Renderizar resultados con tabla de casos y chat
  const renderResults = () => (
    <div className="step-content">
      {/* Contenedor principal dividido en dos secciones */}
      <div className="results-container">
        {/* Sección 1: Tabla de casos de prueba */}
        <div className="test-cases-section">
          <div className="section-header">
            <h3>📝 Casos de Prueba Generados</h3>
            <div className="section-actions">
              <button
                type="button"
                className="btn btn-primary btn-small"
                onClick={() => setShowPreviewModal(true)}
                disabled={!testPlan}
              >
                📊 Exportar
              </button>
            </div>
          </div>
          
          {testPlan && testPlan.test_cases.length > 0 ? (
            <div className="test-cases-table-container">
              <table className="test-cases-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Nombre del Caso</th>
                    <th>Descripción</th>
                    <th>Prioridad</th>
                    <th>Interacción</th>
                  </tr>
                </thead>
                <tbody>
                  {testPlan.test_cases.map((testCase, index) => (
                    <tr 
                      key={index}
                      onClick={() => {
                        setSelectedTestCase({ ...testCase, index });
                        setShowPreviewModal(true);
                      }}
                      className="clickable-row"
                    >
                      <td className="case-number-cell">
                        <span className="case-number-badge">
                          TC_{String(index + 1).padStart(3, '0')}
                        </span>
                      </td>
                      <td className="case-name-cell">
                        <div className="case-name">{testCase.test_case_name}</div>
                      </td>
                      <td className="case-description-cell">
                        <div className="case-description-truncated">
                          {testCase.test_case_description}
                        </div>
                      </td>
                      <td className="case-priority-cell">
                        <span className={`priority-badge priority-${testCase.priority?.toLowerCase()}`}>
                          {testCase.priority}
                        </span>
                      </td>
                      <td className="case-interaction-cell">
                        <button
                          className="btn-delete"
                          onClick={(e) => {
                            e.stopPropagation(); // Evitar que se abra el modal de detalles
                            handleDeleteTestCase(index);
                          }}
                        >
                          Eliminar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="no-cases-message">
              <div className="no-cases-icon">📄</div>
              <div className="no-cases-text">No hay casos de prueba generados</div>
              <div className="no-cases-subtext">Genera un plan para ver los casos aquí</div>
            </div>
          )}
        </div>

        {/* Sección 2: Chat con asistente */}
        <div className="chat-section">
          <div className="chat-container">
            {/* Header del chat */}
            <div className="chat-header">
              <div className="chat-header-icon">🤖</div>
              <div className="chat-header-text">
                <div className="chat-header-title">Asistente IA</div>
                <div className="chat-header-subtitle">Pregúntame sobre tu plan</div>
              </div>
              <div className="chat-status">
                <div className="chat-status-indicator"></div>
                Conectado
              </div>
            </div>

            {/* Mensajes del chat */}
            <div className="chat-messages" ref={chatMessagesRef}>
              {chatMessages.map((message, index) => (
                <div key={index} className={`chat-message ${message.role}`}>
                  <div className="chat-message-avatar">
                    {message.role === 'user' ? '👤' : message.role === 'assistant' ? '🤖' : '💡'}
                  </div>
                  <div className="chat-message-content">
                    <div className="chat-message-bubble">
                      {message.content}
                    </div>
                    <div className="chat-message-time">
                      {new Date(message.timestamp).toLocaleTimeString()}
                    </div>
                  </div>
                </div>
              ))}
              
              {/* Indicador de escritura */}
              {isTyping && (
                <div className="chat-message assistant">
                  <div className="chat-message-avatar">🤖</div>
                  <div className="chat-message-content">
                    <div className="chat-typing">
                      <div className="chat-typing-dots">
                        <div className="chat-typing-dot"></div>
                        <div className="chat-typing-dot"></div>
                        <div className="chat-typing-dot"></div>
                      </div>
                      <div className="chat-typing-text">Escribiendo...</div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Sugerencias de chat */}
            <div className="chat-suggestions">
              {[
                "¿Puedes explicar los casos generados?",
                "¿Cómo modificar la cobertura?",
                "¿Qué casos adicionales recomiendas?",
                "¿Puedes revisar un caso específico?"
              ].map((suggestion, index) => (
                <div
                  key={index}
                  className="chat-suggestion"
                  onClick={() => handleSuggestionClick(suggestion)}
                >
                  {suggestion}
                </div>
              ))}
            </div>

            {/* Input del chat */}
            <div className="chat-input-container">
              <textarea
                className="chat-input"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="Pregúntame sobre el plan de pruebas..."
                rows={1}
                disabled={isChatLoading}
              />
              <button
                className="chat-send-button"
                onClick={handleSendMessage}
                disabled={!chatInput.trim() || isChatLoading}
              >
                {isChatLoading ? (
                  <div className="loading-spinner" style={{ width: '16px', height: '16px' }}></div>
                ) : (
                  '➤'
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Botones de acción */}
      <div className="action-buttons" style={{ marginTop: '20px' }}>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => {
            setCurrentStep(0);
            setPlanConfig(null);
            setCurrentSession(null);
            setTestPlan(null);
            setChatSession(null);
            setChatMessages([]);
            setChatInput('');
            setFormData({
              plan_title: '',
              plan_type: 'UNITARIAS' as PlanType,
              coverage_percentage: 80,
              min_test_cases: 5,
              max_test_cases: 8,
              project_context: '',
            });
          }}
        >
          🔄 Nuevo Plan
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={handleCalculateCoverage}
          disabled={loading}
        >
          {loading ? (
            <>
              <div className="loading-spinner"></div>
              Calculando...
            </>
          ) : (
            '📊 Calcular Cobertura'
          )}
        </button>
      </div>
    </div>
  );

  return (
    <div className="app">
      <div className="app-container">
        {/* Header con estilo del MVP */}
        <div className="app-header">
          <h1>{appConfig.app.name}</h1>
        </div>

        {/* Card principal */}
        <div className="main-card">
          {/* Indicador de progreso - Solo mostrar cuando no estemos en la pantalla de bienvenida */}
          {currentStep > 0 && (
            <div className="progress-indicator">
              {[1, 2, 3].map((step) => (
                <div key={step} className={`step ${currentStep === step ? 'active' : ''} ${currentStep > step ? 'completed' : ''}`}>
                  <div className="step-number">{step}</div>
                  <div className="step-label">
                    {step === 1 && 'Configuración'}
                    {step === 2 && 'Generación'}
                    {step === 3 && 'Resultados'}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div className="alert warning" style={{ marginBottom: '20px' }}>
              <strong>❌ Error:</strong> {error}
              <button
                onClick={() => setError(null)}
                style={{ 
                  float: 'right', 
                  background: 'none', 
                  border: 'none', 
                  cursor: 'pointer',
                  fontSize: '16px'
                }}
              >
                ✕
              </button>
            </div>
          )}

          {/* Contenido del paso actual */}
          {currentStep === 0 && renderWelcomeScreen()}
          {currentStep === 1 && renderConfigurationForm()}
          {currentStep === 2 && renderPlanGenerator()}
          {currentStep === 3 && renderResults()}
        </div>

        {/* Modal de vista previa */}
        {renderPreviewModal()}

        {/* Popup de confirmación de eliminación */}
        {showUndoPopup && deletedCase && (
          <div className="undo-popup">
            <div className="undo-popup-content">
              <span className="undo-popup-text">
                Se ha eliminado el caso "{deletedCase.case.test_case_name}"
              </span>
              <button
                className="undo-button"
                onClick={handleUndoDelete}
              >
                Deshacer
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default App;
