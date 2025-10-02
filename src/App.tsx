import React, { useState, useEffect } from 'react';
import { appConfig, validateConfig, createLogger } from './config';
import type { PlanConfiguration, TestPlan, Session, PlanType } from './types';
import './styles/App.css';

const logger = createLogger('App');

// Componente principal de la aplicación
const App: React.FC = () => {
  // Estados principales
  const [currentStep, setCurrentStep] = useState(0);
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
    project_context: '',
  });

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
    if (currentStep < 4) {
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
          generation_prompt: `Generar plan de pruebas para: ${planConfig?.project_context}`,
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

  // Renderizar resultados
  const renderResults = () => (
    <div className="step-content">
      <h2 style={{ color: '#1e293b', marginBottom: '30px', textAlign: 'center' }}>
        📊 Plan de Pruebas Generado
      </h2>
      
      {testPlan && (
        <div className="plan-summary">
          <h3>✅ Plan Completado</h3>
          <div className="summary-stats">
            <div className="stat-item">
              <div className="stat-label">Casos</div>
              <div className="stat-value">{testPlan.test_cases.length}</div>
            </div>
            <div className="stat-item">
              <div className="stat-label">Estado</div>
              <div className="stat-value">{testPlan.status}</div>
            </div>
            <div className="stat-item">
              <div className="stat-label">Cobertura</div>
              <div className="stat-value">{testPlan.coverage_metrics.target_coverage}%</div>
            </div>
          </div>

          {testPlan.test_cases.length > 0 && (
            <div style={{ marginTop: '20px' }}>
              <h4>📝 Casos de Prueba Generados:</h4>
              <div className="results-table" style={{ maxHeight: '300px', overflowY: 'auto' }}>
                <table style={{ width: '100%' }}>
                  <thead>
                    <tr>
                      <th>Caso</th>
                      <th>Descripción</th>
                      <th>Prioridad</th>
                    </tr>
                  </thead>
                  <tbody>
                    {testPlan.test_cases.map((testCase, index) => (
                      <tr key={index}>
                        <td style={{ fontWeight: 'bold' }}>{testCase.test_case_name}</td>
                        <td>{testCase.test_case_description}</td>
                        <td>
                          <span style={{ 
                            padding: '4px 8px', 
                            borderRadius: '12px', 
                            fontSize: '12px',
                            backgroundColor: testCase.priority === 'ALTA' ? '#fee2e2' : 
                                           testCase.priority === 'MEDIA' ? '#fef3c7' : '#f0fdf4',
                            color: testCase.priority === 'ALTA' ? '#dc2626' : 
                                   testCase.priority === 'MEDIA' ? '#d97706' : '#16a34a'
                          }}>
                            {testCase.priority}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="action-buttons">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => {
            setCurrentStep(0);
            setPlanConfig(null);
            setCurrentSession(null);
            setTestPlan(null);
            setFormData({
              plan_title: '',
              plan_type: 'UNITARIAS' as PlanType,
              coverage_percentage: 80,
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
          <p>{appConfig.app.description}</p>
        </div>

        {/* Card principal */}
        <div className="main-card">
          {/* Indicador de progreso - Solo mostrar cuando no estemos en la pantalla de bienvenida */}
          {currentStep > 0 && (
            <div className="progress-indicator">
              {[1, 2, 3, 4].map((step) => (
                <div key={step} className={`step ${currentStep === step ? 'active' : ''} ${currentStep > step ? 'completed' : ''}`}>
                  <div className="step-number">{step}</div>
                  <div className="step-label">
                    {step === 1 && 'Configuración'}
                    {step === 2 && 'Generación'}
                    {step === 3 && 'Resultados'}
                    {step === 4 && 'Exportar'}
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
      </div>
    </div>
  );
};

export default App;
