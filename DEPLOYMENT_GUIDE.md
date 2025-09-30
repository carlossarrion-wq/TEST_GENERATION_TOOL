# Guía de Despliegue - Test Plan Generator

## Variables de Entorno Requeridas

Para configurar correctamente el Test Plan Generator, necesitas obtener y configurar las siguientes variables de entorno:

### 1. VITE_API_GATEWAY_URL

Esta es la URL de tu API Gateway de AWS que expondrá las funciones Lambda del backend.

**¿Cómo obtenerla?**

1. **Crear API Gateway en AWS Console:**
   - Ve a AWS Console → API Gateway
   - Crea una nueva REST API
   - Configura los endpoints según el README (ej: `/generate-plan`, `/configure-plan`, etc.)
   - Despliega la API en un stage (ej: `prod`, `dev`)

2. **Formato de la URL:**
   ```
   https://{api-id}.execute-api.{region}.amazonaws.com/{stage}
   ```

**Ejemplo:**
```bash
VITE_API_GATEWAY_URL=https://abc123def4.execute-api.eu-west-1.amazonaws.com/prod
```

### 2. VITE_API_KEY

Esta es la clave de API para autenticar las peticiones a tu API Gateway.

**¿Cómo obtenerla?**

1. **En AWS Console → API Gateway:**
   - Ve a tu API creada
   - En el menú lateral, selecciona "API Keys"
   - Crea una nueva API Key
   - Copia el valor generado

2. **Configurar Usage Plan:**
   - Ve a "Usage Plans" en API Gateway
   - Crea un nuevo Usage Plan
   - Asocia tu API Key con el Usage Plan
   - Asocia el Usage Plan con tu API

**Ejemplo:**
```bash
VITE_API_KEY=abcd1234efgh5678ijkl9012mnop3456
```

### 3. VITE_DEFAULT_KNOWLEDGE_BASE_ID

Este es el ID de tu Knowledge Base específica para Test Plan Generator.

**¿Cómo obtenerla?**

1. **Crear Knowledge Base en AWS Console:**
   - Ve a AWS Console → Amazon Bedrock
   - En el menú lateral, selecciona "Knowledge bases"
   - Crea una nueva Knowledge Base específica para documentación de testing
   - Sube documentos relacionados con:
     - Patrones de testing
     - Documentación de QA
     - Ejemplos de casos de prueba
     - Metodologías de testing

2. **Obtener el ID:**
   - Una vez creada, copia el Knowledge Base ID
   - Tiene un formato similar a: `ABCD1234EF`

**Ejemplo:**
```bash
VITE_DEFAULT_KNOWLEDGE_BASE_ID=TESTPLAN123KB
```

## Pasos de Configuración Completos

### Paso 1: Crear el archivo .env

```bash
# Copia el archivo de ejemplo
cp .env.example .env
```

### Paso 2: Configurar las variables

Edita el archivo `.env` con tus valores reales:

```bash
# AWS Configuration
VITE_AWS_REGION=eu-west-1

# API Gateway Configuration (REEMPLAZAR CON TUS VALORES)
VITE_API_GATEWAY_URL=https://tu-api-id.execute-api.eu-west-1.amazonaws.com/prod
VITE_API_KEY=tu-api-key-aqui

# Bedrock Configuration (REEMPLAZAR CON TU KNOWLEDGE BASE ID)
VITE_DEFAULT_KNOWLEDGE_BASE_ID=TU_TEST_PLAN_KB_ID
VITE_DEFAULT_MODEL_ID=anthropic.claude-sonnet-4-20250514-v1:0
VITE_ALTERNATIVE_MODEL_ID=amazon.nova-pro-v1:0

# Application Configuration
VITE_APP_NAME=Test Plan Generator
VITE_APP_VERSION=1.0.0
VITE_APP_DESCRIPTION=Sistema de Generación de Planes de Prueba Basado en Agentes IA

# Development Configuration
VITE_DEV_MODE=true
VITE_LOG_LEVEL=info
```

### Paso 3: Verificar la configuración

Una vez configuradas las variables, puedes verificar que todo funciona:

```bash
# Instalar dependencias
npm install

# Ejecutar en modo desarrollo
npm run dev
```

## Arquitectura del Backend Requerida

Para que el frontend funcione correctamente, necesitas desplegar las siguientes Lambda functions:

### Funciones Lambda Requeridas

1. **plan_configurator** - `POST /configure-plan`
2. **requirements_processor** - `POST /upload-requirements`
3. **hybrid_search** - `POST /hybrid-search`
4. **plan_generator** - `POST /generate-plan`
5. **case_editor** - `PUT /edit-case`
6. **coverage_calculator** - `POST /calculate-coverage`
7. **manual_case_creator** - `POST /create-manual-case`
8. **plan_exporter** - `POST /export-plan`

### Servicios AWS Adicionales Necesarios

- **RDS PostgreSQL**: Para persistencia de sesiones y datos
- **S3 Bucket**: Para almacenamiento de documentos
- **Amazon Bedrock**: Acceso a Claude
- **Knowledge Base**: Con documentación de testing

## Permisos IAM Requeridos

Tu usuario AWS necesita los siguientes permisos:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "bedrock:InvokeModel",
        "bedrock:ListFoundationModels",
        "bedrock-agent:RetrieveAndGenerate",
        "bedrock-agent:ListKnowledgeBases"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "execute-api:Invoke"
      ],
      "Resource": "arn:aws:execute-api:*:*:*"
    }
  ]
}
```

## Troubleshooting

### Error: "Knowledge Base ID no configurado"
- Verifica que `VITE_DEFAULT_KNOWLEDGE_BASE_ID` esté configurado correctamente
- Asegúrate de que la Knowledge Base existe y está activa

### Error: "URL base de API no configurada"
- Verifica que `VITE_API_GATEWAY_URL` esté configurado correctamente
- Asegúrate de que la URL incluye el protocolo `https://`

### Error: "AccessDenied" al acceder a Knowledge Base
- Verifica que tus credenciales AWS tienen permisos para Bedrock
- Asegúrate de que la Knowledge Base está en la misma región configurada

## Próximos Pasos

1. Configura las variables de entorno según esta guía
2. Despliega las Lambda functions del backend
3. Configura API Gateway con los endpoints requeridos
4. Crea y configura tu Knowledge Base específica para testing
5. Ejecuta `npm run dev` para probar el frontend

Para más detalles sobre la implementación del backend, consulta el archivo README.md del proyecto.
