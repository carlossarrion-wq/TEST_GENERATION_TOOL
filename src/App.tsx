import React, { useState, useEffect, useRef } from 'react';
import { appConfig, validateConfig, createLogger } from './config';
import type { PlanConfiguration, TestPlan, Session, PlanType, ConversationMessage, ChatSession } from './types';
import './styles/App.css';

const logger = createLogger('App');

// Componente principal de la aplicación
const App: React.FC = () => {
  // Estados principales
  const [currentStep, setCurrentStep] = useState(0);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
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
    max_test_cases: 15,
    project_context: '',
  });

  // Estados del chat con Knowledge Base
  const [chatSession, setChatSession] = useState<ChatSession | null>(null);
  const [chatMessages, setChatMessages] = useState<ConversationMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const chatMessagesRef = useRef<HTMLDivElement>(null);

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

    // Crear lista detallada de casos de prueba con formato simple
    const testCasesList = testPlan.test_cases.map((testCase, index) => 
      `${index + 1}. ${testCase.test_case_name}\n - 📝 Descripción: ${testCase.test_case_description}\n - 🎯 Prioridad: ${testCase.priority}\n - ⚙️ Precondiciones: ${testCase.preconditions}\n - ✅ Resultados esperados: ${testCase.expected_results}`
    ).join('\n\n');

    const initialMessage: ConversationMessage = {
      role: 'system',
      content: `He generado un plan de pruebas para tu proyecto "${planConfig.plan_title}". 

📋 **Resumen del Plan:**
- Tipo: ${planConfig.plan_type}
- Cobertura objetivo: ${planConfig.coverage_percentage}%
- Total de casos: ${testPlan.test_cases.length}

📝 **Casos de Prueba Generados:**

${testCasesList}

¿Te gustaría revisar algún aspecto específico del plan, hacer modificaciones, o tienes preguntas sobre algún caso en particular?`,
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
          }))
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

  // Renderizar modal de vista previa
  const renderPreviewModal = () => {
    if (!showPreviewModal || !testPlan || !planConfig) return null;

    return (
      <div className="modal-overlay" onClick={() => setShowPreviewModal(false)}>
        <div className="modal-content" onClick={(e) => e.stopPropagation()}>
          <div className="modal-header">
            <h2>👁️ Vista Previa del Plan</h2>
            <button 
              className="modal-close"
              onClick={() => setShowPreviewModal(false)}
            >
              ✕
            </button>
          </div>
          
          <div className="modal-body">
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
              <h4>Casos de Prueba:</h4>
              <div className="cases-container">
                {testPlan.test_cases.map((testCase, index) => (
                  <div key={index} className="preview-case-item">
                    <div className="case-number">TC_{String(index + 1).padStart(3, '0')}</div>
                    <div className="case-details">
                      <div className="case-name">{testCase.test_case_name}</div>
                      <div className="case-description">{testCase.test_case_description}</div>
                      <div className="case-priority">Prioridad: {testCase.priority}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="modal-footer">
            <button 
              className="btn btn-secondary"
              onClick={() => setShowPreviewModal(false)}
              disabled={exportLoading}
            >
              Cerrar
            </button>
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
      <h2 style={{ color: '#1e293b', marginBottom: '30px', textAlign: 'center' }}>
        📋 Configuración del Plan
      </h2>
      
      <div className="form-group">
        <label className="form-label">
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
          className={`form-control ${validationErrors.plan_title ? 'error' : ''}`}
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

      {/* Selector de tipo de plan mejorado */}
      <div className="plan-type-selector">
        <div className="plan-type-header">
          <div className="plan-type-title">
            🎯 Tipo de Plan
          </div>
        </div>
        <div className="plan-type-options">
          {[
            { value: 'UNITARIAS', icon: '🔬', name: 'Unitarias', desc: 'Pruebas de componentes individuales' },
            { value: 'INTEGRACIÓN', icon: '🔗', name: 'Integración', desc: 'Pruebas de interacción entre módulos' },
            { value: 'PERFORMANCE', icon: '⚡', name: 'Performance', desc: 'Pruebas de rendimiento y carga' },
            { value: 'REGRESIÓN', icon: '🔄', name: 'Regresión', desc: 'Pruebas de funcionalidad existente' },
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
                <div className="plan-type-icon">{type.icon}</div>
                <div className="plan-type-name">{type.name}</div>
                <div className="plan-type-description">{type.desc}</div>
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
          <div className="coverage-description">
            <strong>Cobertura {formData.coverage_percentage}%:</strong> 
            {formData.coverage_percentage < 30 && ' Cobertura básica para pruebas esenciales'}
            {formData.coverage_percentage >= 30 && formData.coverage_percentage < 60 && ' Cobertura moderada para funcionalidades principales'}
            {formData.coverage_percentage >= 60 && formData.coverage_percentage < 85 && ' Cobertura alta para la mayoría de funcionalidades'}
            {formData.coverage_percentage >= 85 && ' Cobertura exhaustiva para máxima calidad'}
          </div>
        </div>

        {/* Selector de número de casos */}
        <div className="test-cases-selector">
          <div className="test-cases-header">
            <div className="test-cases-title">
              🔢 Número de Casos de Prueba
            </div>
          </div>
          
          <div className="test-cases-inputs">
            <div className="test-case-input-group">
              <label className="test-case-label">Mínimo</label>
              <div className="test-case-input-container">
                <input
                  type="number"
                  min="1"
                  max="50"
                  value={formData.min_test_cases}
                  onChange={(e) => {
                    const minValue = parseInt(e.target.value) || 1;
                    const maxValue = Math.max(minValue, formData.max_test_cases);
                    setFormData({ 
                      ...formData, 
                      min_test_cases: minValue,
                      max_test_cases: maxValue
                    });
                  }}
                  className="test-case-input"
                />
                <span className="test-case-unit">casos</span>
              </div>
            </div>
            
            <div className="test-case-separator">-</div>
            
            <div className="test-case-input-group">
              <label className="test-case-label">Máximo</label>
              <div className="test-case-input-container">
                <input
                  type="number"
                  min={formData.min_test_cases}
                  max="100"
                  value={formData.max_test_cases}
                  onChange={(e) => {
                    const maxValue = parseInt(e.target.value) || formData.min_test_cases;
                    setFormData({ 
                      ...formData, 
                      max_test_cases: Math.max(maxValue, formData.min_test_cases)
                    });
                  }}
                  className="test-case-input"
                />
                <span className="test-case-unit">casos</span>
              </div>
            </div>
          </div>
          
          <div className="test-cases-description">
            <strong>Rango: {formData.min_test_cases} - {formData.max_test_cases} casos</strong>
            <br />
            {formData.min_test_cases === formData.max_test_cases 
              ? `Se generarán exactamente ${formData.min_test_cases} casos de prueba`
              : `Se generarán entre ${formData.min_test_cases} y ${formData.max_test_cases} casos según la complejidad del proyecto`
            }
          </div>
        </div>
      </div>

      <div className="form-group">
        <label className="form-label">
          🏗️ Contexto del Proyecto {validationErrors.project_context && <span style={{ color: '#dc2626' }}>*</span>}
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
          rows={4}
          className={`form-control ${validationErrors.project_context ? 'error' : ''}`}
          placeholder="Describe el proyecto, funcionalidades principales, tecnologías utilizadas..."
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

      <div className="action-buttons">
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

  // Renderizar resultados con chat
  const renderResults = () => (
    <div className="step-content">
      <h2 style={{ color: '#1e293b', marginBottom: '30px', textAlign: 'center' }}>
        💬 Chat con Knowledge Base
      </h2>
      
      {/* Resumen del plan generado */}
      {testPlan && (
        <div className="plan-summary chat-mode">
          <h3>✅ Plan Generado</h3>
          <div className="summary-stats">
            <div className="stat-item">
              <div className="stat-label">Casos</div>
              <div className="stat-value">{testPlan.test_cases.length}</div>
            </div>
            <div className="stat-item">
              <div className="stat-label">Tipo</div>
              <div className="stat-value">{planConfig?.plan_type}</div>
            </div>
            <div className="stat-item">
              <div className="stat-label">Cobertura</div>
              <div className="stat-value">{testPlan.coverage_metrics.target_coverage}%</div>
            </div>
          </div>
        </div>
      )}

      {/* Interfaz de chat */}
      <div className="chat-container">
        {/* Header del chat */}
        <div className="chat-header">
          <div className="chat-header-icon">🤖</div>
          <div className="chat-header-text">
            <div className="chat-header-title">Asistente de Knowledge Base</div>
            <div className="chat-header-subtitle">Pregúntame sobre tu plan de pruebas</div>
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
            "¿Puedes explicar los casos de prueba generados?",
            "¿Cómo puedo modificar la cobertura del plan?",
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
            placeholder="Pregúntame sobre el plan de pruebas, modificaciones, cobertura..."
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
              max_test_cases: 15,
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
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => setShowPreviewModal(true)}
          disabled={!testPlan}
        >
          👁️ Vista Previa
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
          <p>{appConfig.app.description}</p>
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
      </div>
    </div>
  );
};

export default App;
