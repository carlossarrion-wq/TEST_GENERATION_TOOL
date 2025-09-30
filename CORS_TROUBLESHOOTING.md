# Solución de Problemas CORS - Test Plan Generator

## Problema Identificado

Error CORS al intentar configurar un plan:
```
Access to fetch at 'https://blnvunhvs3.execute-api.eu-west-1.amazonaws.com/dev/configure-plan' from origin 'http://localhost:3000' has been blocked by CORS policy: Response to preflight request doesn't pass access control check: No 'Access-Control-Allow-Origin' header is present on the requested resource.
```

## Causa del Problema

El error indica que el API Gateway no está devolviendo los headers CORS necesarios, aunque las funciones Lambda sí los incluyen en el código.

## Soluciones Posibles

### 1. Verificar Configuración de API Gateway

En la consola de AWS API Gateway:

1. Ve a tu API Gateway: `https://blnvunhvs3.execute-api.eu-west-1.amazonaws.com`
2. Selecciona el recurso `/configure-plan`
3. Verifica que existe el método `OPTIONS`
4. En el método `OPTIONS`, configura:
   - **Integration Response**:
     - Status: 200
     - Headers:
       - `Access-Control-Allow-Origin`: `'*'`
       - `Access-Control-Allow-Headers`: `'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token'`
       - `Access-Control-Allow-Methods`: `'POST,OPTIONS'`

### 2. Habilitar CORS en API Gateway

Para cada endpoint (`/configure-plan`, `/generate-plan`, etc.):

1. Selecciona el recurso
2. Click en "Actions" → "Enable CORS"
3. Configura:
   - **Access-Control-Allow-Origin**: `*`
   - **Access-Control-Allow-Headers**: `Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token`
   - **Access-Control-Allow-Methods**: Selecciona `POST` y `OPTIONS`
4. Click "Enable CORS and replace existing CORS headers"
5. **IMPORTANTE**: Click "Actions" → "Deploy API" para aplicar los cambios

### 3. Verificar Despliegue de Lambda Functions

Asegúrate de que todas las funciones Lambda estén desplegadas correctamente:

```bash
# Verificar que las funciones existen
aws lambda list-functions --region eu-west-1 | grep test-plan

# Verificar una función específica
aws lambda get-function --function-name plan_configurator --region eu-west-1
```

### 4. Probar Endpoints Manualmente

Usa curl para probar los endpoints:

```bash
# Probar OPTIONS request
curl -X OPTIONS \
  https://blnvunhvs3.execute-api.eu-west-1.amazonaws.com/dev/configure-plan \
  -H "Origin: http://localhost:3000" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: Content-Type,X-Api-Key" \
  -v

# Probar POST request
curl -X POST \
  https://blnvunhvs3.execute-api.eu-west-1.amazonaws.com/dev/configure-plan \
  -H "Content-Type: application/json" \
  -H "x-api-key: JbSVGaFTPga51SX0Lq9uI7kG3XtU3CGyar3NKmFN" \
  -d '{
    "plan_title": "Test Plan",
    "plan_type": "UNITARIAS",
    "coverage_percentage": 80,
    "project_context": "Test context"
  }' \
  -v
```

### 5. Configuración Alternativa - Proxy Integration

Si usas Lambda Proxy Integration, asegúrate de que la respuesta incluya todos los headers:

```python
def cors_headers():
    return {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,X-Amz-User-Agent',
        'Access-Control-Allow-Methods': 'POST,OPTIONS,GET,PUT,DELETE',
        'Access-Control-Max-Age': '86400'
    }
```

### 6. Verificar Variables de Entorno

Verifica que las funciones Lambda tengan las variables de entorno correctas:

- `SESSIONS_TABLE`: Nombre de la tabla DynamoDB
- `KNOWLEDGE_BASE_ID`: ID de la Knowledge Base
- `DOCUMENTS_BUCKET`: Bucket S3 para documentos
- `EXPORTS_BUCKET`: Bucket S3 para exportaciones

## Pasos Inmediatos para Resolver

1. **Ve a AWS API Gateway Console**
2. **Encuentra tu API**: `blnvunhvs3`
3. **Para cada recurso** (`/configure-plan`, `/generate-plan`, etc.):
   - Habilita CORS usando "Actions" → "Enable CORS"
   - Configura los headers mencionados arriba
4. **Despliega la API**: "Actions" → "Deploy API" → Selecciona "dev" stage
5. **Espera 1-2 minutos** para que los cambios se propaguen
6. **Prueba nuevamente** la aplicación

## Verificación Final

Una vez aplicados los cambios, deberías ver estos headers en la respuesta:

```
Access-Control-Allow-Origin: *
Access-Control-Allow-Headers: Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token
Access-Control-Allow-Methods: POST,OPTIONS
```

## Contacto

Si el problema persiste después de seguir estos pasos, verifica:

1. Los logs de CloudWatch de las funciones Lambda
2. Los logs de API Gateway
3. Que la API Key sea válida y esté asociada correctamente

El problema más común es **olvidar desplegar la API** después de habilitar CORS.
