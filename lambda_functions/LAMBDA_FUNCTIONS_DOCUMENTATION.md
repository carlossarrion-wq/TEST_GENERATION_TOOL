# Lambda Functions Documentation
## Test Plan Generator System

Este documento describe las 8 funciones Lambda que componen el sistema de generación de planes de prueba.

---

## 1. **plan_configurator**
**Endpoint:** `POST /configure-plan`  
**Propósito:** Configurar un nuevo plan de pruebas y crear una sesión

### Funcionalidades:
- Valida la configuración del plan de pruebas
- Crea una nueva sesión en DynamoDB
- Establece parámetros como tipo de plan, porcentaje de cobertura objetivo
- Inicializa el contexto del proyecto

### Campos requeridos:
- `plan_title`: Título del plan de pruebas
- `plan_type`: Tipo de plan (UNITARIAS, INTEGRACIÓN, PERFORMANCE, REGRESIÓN)
- `coverage_percentage`: Porcentaje de cobertura objetivo (10-100)
- `project_context`: Contexto del proyecto

### Respuesta:
- `session_id`: ID único de la sesión creada
- `plan_configuration`: Configuración guardada del plan
- `status`: Estado de la configuración

---

## 2. **requirements_processor**
**Endpoint:** `POST /upload-requirements`  
**Propósito:** Procesar documentos de requisitos subidos

### Funcionalidades:
- Procesa documentos de requisitos (PDF, DOCX, TXT)
- Almacena archivos en S3
- Extrae metadatos y contenido de los documentos
- Valida formato y tamaño de archivos

### Campos requeridos:
- `session_id`: ID de la sesión
- `file_content`: Contenido del archivo en base64
- `file_name`: Nombre del archivo
- `file_type`: Tipo de archivo

### Respuesta:
- `document_id`: ID único del documento procesado
- `s3_location`: Ubicación del archivo en S3
- `metadata`: Metadatos extraídos del documento

---

## 3. **hybrid_search**
**Endpoint:** `POST /hybrid-search`  
**Propósito:** Realizar búsqueda híbrida en la base de conocimientos

### Funcionalidades:
- Ejecuta búsqueda semántica usando Amazon Bedrock
- Combina búsqueda por palabras clave y semántica
- Retorna contexto relevante para generación de casos de prueba
- Filtra resultados por relevancia

### Campos requeridos:
- `session_id`: ID de la sesión
- `query`: Consulta de búsqueda
- `max_results`: Número máximo de resultados (opcional)

### Respuesta:
- `search_results`: Resultados de la búsqueda
- `relevance_scores`: Puntuaciones de relevancia
- `context_summary`: Resumen del contexto encontrado

---

## 4. **plan_generator**
**Endpoint:** `POST /generate-plan`  
**Propósito:** Generar plan de pruebas usando IA con contexto RAG

### Funcionalidades:
- Utiliza Claude Sonnet 4 para generar casos de prueba
- Integra contexto de búsqueda RAG
- Crea casos estructurados con pasos detallados
- Asigna prioridades y categorías automáticamente

### Campos requeridos:
- `session_id`: ID de la sesión
- `generation_prompt`: Prompt específico para generación (opcional)
- `context_data`: Datos de contexto adicionales (opcional)

### Respuesta:
- `generated_cases`: Casos de prueba generados
- `iteration_number`: Número de iteración creada
- `generation_metadata`: Metadatos de la generación

---

## 5. **case_editor**
**Endpoint:** `PUT /edit-case`  
**Propósito:** Editar casos de prueba existentes

### Funcionalidades:
- Modifica casos de prueba específicos dentro de una sesión
- Actualiza registros en DynamoDB
- Recalcula métricas de cobertura después de modificaciones
- Mantiene historial de cambios y atribución de usuario

### Campos requeridos:
- `session_id`: ID de la sesión
- `case_id`: ID del caso a editar
- `updated_case`: Datos actualizados del caso

### Estructura del caso:
- `title`: Título del caso
- `description`: Descripción detallada
- `preconditions`: Precondiciones necesarias
- `steps`: Lista de pasos a ejecutar
- `expected_result`: Resultado esperado
- `priority`: Prioridad (HIGH, MEDIUM, LOW)
- `category`: Categoría del caso

### Respuesta:
- `updated_case`: Caso actualizado
- `coverage_metrics`: Métricas de cobertura recalculadas
- `status`: Estado de la actualización

---

## 6. **coverage_calculator**
**Endpoint:** `POST /calculate-coverage`  
**Propósito:** Calcular métricas detalladas de cobertura

### Funcionalidades:
- Analiza cobertura de requisitos por casos de prueba
- Calcula distribución por prioridades y categorías
- Genera recomendaciones basadas en gaps de cobertura
- Proporciona análisis por iteración
- Identifica requisitos sin cobertura

### Campos requeridos:
- `session_id`: ID de la sesión

### Métricas calculadas:
- **Resumen general**: Total de casos, requisitos cubiertos, porcentaje de cobertura
- **Análisis de prioridades**: Distribución HIGH/MEDIUM/LOW
- **Análisis de categorías**: Distribución por tipos de prueba
- **Detalle de requisitos**: Cobertura específica por requisito
- **Análisis por iteración**: Métricas específicas de cada iteración
- **Recomendaciones**: Sugerencias para mejorar cobertura

### Respuesta:
- `coverage_metrics`: Métricas completas de cobertura
- `recommendations`: Recomendaciones de mejora
- `status`: Estado del cálculo

---

## 7. **manual_case_creator**
**Endpoint:** `POST /create-manual-case`  
**Propósito:** Crear casos de prueba manualmente

### Funcionalidades:
- Permite creación manual de casos de prueba
- Valida estructura y datos de entrada
- Agrega casos a iteraciones existentes o crea nuevas
- Proporciona sugerencias inteligentes para mejora
- Calcula métricas actualizadas después de la creación

### Campos requeridos:
- `session_id`: ID de la sesión
- `test_case`: Datos del caso de prueba

### Campos del caso de prueba:
- `title`: Título del caso (requerido)
- `description`: Descripción (requerido)
- `preconditions`: Precondiciones (requerido)
- `steps`: Array de pasos (requerido)
- `expected_result`: Resultado esperado (requerido)
- `priority`: Prioridad (opcional, default: MEDIUM)
- `category`: Categoría (opcional, default: FUNCTIONAL)
- `estimated_time`: Tiempo estimado en minutos (opcional, default: 30)
- `requirements_covered`: Lista de requisitos cubiertos (opcional)
- `tags`: Etiquetas del caso (opcional)
- `automation_candidate`: Si es candidato para automatización (opcional)

### Validaciones:
- Prioridades válidas: HIGH, MEDIUM, LOW
- Categorías válidas: FUNCTIONAL, NON_FUNCTIONAL, INTEGRATION, PERFORMANCE, SECURITY, USABILITY, REGRESSION
- Tiempo estimado debe ser positivo
- Al menos un paso es requerido

### Respuesta:
- `case_id`: ID del caso creado
- `test_case`: Caso de prueba completo
- `updated_metrics`: Métricas actualizadas de la sesión
- `suggestions`: Sugerencias para mejorar el caso

---

## 8. **plan_exporter**
**Endpoint:** `POST /export-plan`  
**Propósito:** Exportar planes de prueba en múltiples formatos

### Funcionalidades:
- Exporta planes en formatos JSON, CSV, Excel y PDF
- Permite filtrado por prioridad y categoría
- Integración con S3 para almacenamiento y URLs presignadas
- Soporte para campos personalizados
- Opciones flexibles de exportación

### Campos requeridos:
- `session_id`: ID de la sesión
- `export_format`: Formato de exportación (JSON, CSV, EXCEL, PDF)

### Opciones de exportación:
- `include_metrics`: Incluir métricas de cobertura (default: true)
- `include_iterations`: Incluir iteraciones (default: true)
- `include_requirements`: Incluir requisitos (default: true)
- `filter_by_priority`: Filtrar por prioridad específica (opcional)
- `filter_by_category`: Filtrar por categoría específica (opcional)
- `custom_fields`: Campos personalizados a incluir (opcional)

### Formatos soportados:

#### JSON
- Estructura completa con metadatos
- Incluye información de sesión y configuración
- Formato legible y estructurado

#### CSV
- Formato tabular para análisis en Excel
- Una fila por caso de prueba
- Columnas configurables

#### Excel
- Formato mejorado con metadatos
- Compatible con Microsoft Excel
- Incluye información del plan en encabezados

#### PDF
- Reporte estructurado para presentación
- Incluye métricas y casos de prueba
- Formato profesional para documentación

### Respuesta:
- `filename`: Nombre del archivo generado
- `file_size_bytes`: Tamaño del archivo
- `download_url`: URL de descarga (si S3 está configurado)
- `export_options`: Opciones utilizadas para la exportación
- `content_base64`: Contenido en base64 (para archivos pequeños sin S3)

---

## Arquitectura Común

Todas las funciones Lambda siguen un patrón arquitectónico consistente:

### Características compartidas:
- **Manejo de CORS**: Soporte completo para requests OPTIONS y headers CORS
- **Validación de entrada**: Validación robusta de campos requeridos y tipos de datos
- **Manejo de errores**: Logging detallado y respuestas de error estructuradas
- **Integración AWS**: Conexión con DynamoDB, S3 y Amazon Bedrock
- **Respuestas estandarizadas**: Formato JSON consistente con timestamps

### Variables de entorno utilizadas:
- `SESSIONS_TABLE`: Nombre de la tabla DynamoDB para sesiones
- `KNOWLEDGE_BASE_ID`: ID de la base de conocimientos de Bedrock
- `DOCUMENTS_BUCKET`: Bucket S3 para documentos
- `EXPORTS_BUCKET`: Bucket S3 para exportaciones
- `BEDROCK_MODEL_ID`: ID del modelo de Bedrock (Claude Sonnet 4)

### Estructura de respuesta estándar:
```json
{
  "statusCode": 200,
  "headers": {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token",
    "Access-Control-Allow-Methods": "POST,PUT,OPTIONS"
  },
  "body": {
    "data": "...",
    "timestamp": "2024-01-01T00:00:00.000Z"
  }
}
```

### Manejo de errores:
```json
{
  "statusCode": 400|404|500,
  "headers": { "..." },
  "body": {
    "error": "Error message",
    "details": "Detailed error information",
    "timestamp": "2024-01-01T00:00:00.000Z"
  }
}
```

---

## Flujo de trabajo típico:

1. **Configuración**: `plan_configurator` - Crear sesión y configurar plan
2. **Carga de requisitos**: `requirements_processor` - Subir documentos de requisitos
3. **Búsqueda de contexto**: `hybrid_search` - Buscar información relevante
4. **Generación**: `plan_generator` - Generar casos de prueba con IA
5. **Edición manual**: `case_editor` y `manual_case_creator` - Refinar casos
6. **Análisis**: `coverage_calculator` - Calcular métricas de cobertura
7. **Exportación**: `plan_exporter` - Exportar plan final

Este sistema proporciona una solución completa para la generación, gestión y exportación de planes de prueba utilizando inteligencia artificial y mejores prácticas de testing.
