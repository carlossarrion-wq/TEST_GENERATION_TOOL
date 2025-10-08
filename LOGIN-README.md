# Sistema de Autenticación con IAM Access Key/Secret Key

## Resumen Ejecutivo

Esta propuesta detalla la implementación de un sistema de autenticación basado en **AWS IAM Access Key/Secret Key** como pantalla inicial (Paso 0) de la aplicación. El sistema permitirá identificar y autenticar usuarios antes de acceder a las funcionalidades de generación de planes de prueba, estableciendo la relación usuario-plan necesaria para la integración con RDS PostgreSQL.

## Análisis de la Situación Actual

### Estado Actual del Frontend
- **Pantalla inicial**: Pantalla de bienvenida (Paso 0) con verificación de configuración
- **Identificación de usuario**: Actualmente usa `'anonymous'` o `'user'` como identificador
- **Flujo actual**: 4 pasos (0: Bienvenida, 1: Configuración, 2: Generación, 3: Resultados)

### Necesidades Identificadas
- **Autenticación real**: Reemplazar usuarios anónimos con credenciales IAM
- **Relación usuario-plan**: Establecer vínculo entre usuario autenticado y planes generados
- **Seguridad**: Validar credenciales AWS antes de permitir acceso
- **Persistencia**: Mantener sesión de usuario durante el uso de la aplicación

## Diseño del Sistema de Autenticación

### Arquitectura de Autenticación

```
FLUJO DE AUTENTICACIÓN PROPUESTO
═══════════════════════════════════

┌─────────────────────────────────────────────────────────────────┐
│                        PASO 0: LOGIN                           │
│                                                                 │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────┐ │
│  │   Formulario    │    │   Validación    │    │   Sesión    │ │
│  │   Login IAM     │───►│   AWS STS       │───►│   Usuario   │ │
│  │                 │    │                 │    │             │ │
│  └─────────────────┘    └─────────────────┘    └─────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────┐
│                   PASOS 1-3: APLICACIÓN                        │
│                                                                 │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────┐ │
│  │ Configuración   │    │   Generación    │    │ Resultados  │ │
│  │ (con user_id)   │───►│ (con user_id)   │───►│(con user_id)│ │
│  │                 │    │                 │    │             │ │
│  └─────────────────┘    └─────────────────┘    └─────────────┘ │
└─────────────────────────────────────────────────────────────────┘

COMPONENTES DE SEGURIDAD:
• AWS STS para validación de credenciales
• Almacenamiento seguro en sessionStorage
• Timeout automático de sesión
• Validación de permisos mínimos requeridos
```

### Flujo de Autenticación Detallado

```
PASO A PASO DEL LOGIN
═══════════════════════

1. PANTALLA DE LOGIN (Nuevo Paso 0)
   ┌─────────────────────────────────────┐
   │  🔐 Autenticación AWS IAM           │
   │                                     │
   │  Access Key ID: [____________]      │
   │  Secret Key:    [____________]      │
   │  Región:        [us-east-1  ▼]      │
   │                                     │
   │  [ Iniciar Sesión ]                 │
   └─────────────────────────────────────┘

2. VALIDACIÓN CON AWS STS
   Usuario ──────► Frontend ──────► Lambda auth_validator ──────► AWS STS
   Credenciales    Validar          Verificar credenciales       GetCallerIdentity
        │              │                      │                        │
        │              └◄─────────────────────┘                        │
        │              Respuesta de validación                         │
        └◄─────────────────────────────────────────────────────────────┘
                    Sesión establecida o error

3. ESTABLECIMIENTO DE SESIÓN
   ┌─────────────────────────────────────┐
   │  ✅ Autenticación Exitosa           │
   │                                     │
   │  Usuario: arn:aws:iam::123:user/... │
   │  Región:  us-east-1                 │
   │  Permisos: ✓ Bedrock ✓ RDS ✓ S3    │
   │                                     │
   │  [ Continuar a la Aplicación ]      │
   └─────────────────────────────────────┘

4. INTEGRACIÓN CON APLICACIÓN EXISTENTE
   • currentStep pasa de 0 (login) a 1 (bienvenida)
   • user_id se establece con ARN del usuario IAM
   • Todas las llamadas posteriores incluyen user_id real
```

## Implementación Técnica

### 1. Nueva Lambda Function: `auth_validator`

```python
# lambda_functions/auth_validator/lambda_function.py
import json
import logging
import boto3
from datetime import datetime
from typing import Dict, Any
import os

logger = logging.getLogger()
logger.setLevel(logging.INFO)

def lambda_handler(event: Dict[str, Any], context) -> Dict[str, Any]:
    """POST /validate-credentials - Validar credenciales IAM del usuario"""
    logger.info("=== AUTH_VALIDATOR STARTED ===")
    
    try:
        if event.get('httpMethod') == 'OPTIONS':
            return cors_response()
        
        # Parsear body
        if 'body' in event:
            if isinstance(event['body'], str):
                body = json.loads(event['body'])
            else:
                body = event['body']
        else:
            body = event
        
        required_fields = ['access_key_id', 'secret_access_key', 'region']
        missing_fields = [field for field in required_fields if field not in body]
        
        if missing_fields:
            return error_response(400, f'Missing required fields: {", ".join(missing_fields)}')
        
        access_key_id = body['access_key_id']
        secret_access_key = body['secret_access_key']
        region = body['region']
        session_token = body.get('session_token')  # Opcional para roles temporales
        
        # Crear cliente STS con las credenciales proporcionadas
        try:
            sts_client = boto3.client(
                'sts',
                aws_access_key_id=access_key_id,
                aws_secret_access_key=secret_access_key,
                aws_session_token=session_token,
                region_name=region
            )
            
            # Validar credenciales con GetCallerIdentity
            caller_identity = sts_client.get_caller_identity()
            
            user_arn = caller_identity['Arn']
            account_id = caller_identity['Account']
            user_id = caller_identity['UserId']
            
            logger.info(f"Credenciales válidas para usuario: {user_arn}")
            
            # Verificar permisos mínimos requeridos
            permissions_check = check_required_permissions(
                access_key_id, secret_access_key, session_token, region
            )
            
            # Extraer nombre de usuario del ARN
            username = extract_username_from_arn(user_arn)
            
            return success_response({
                'valid': True,
                'user_info': {
                    'arn': user_arn,
                    'account_id': account_id,
                    'user_id': user_id,
                    'username': username,
                    'region': region
                },
                'permissions': permissions_check,
                'session_data': {
                    'access_key_id': access_key_id,  # Solo para referencia, no almacenar
                    'region': region,
                    'authenticated_at': datetime.utcnow().isoformat()
                }
            })
            
        except Exception as aws_error:
            logger.error(f"Error de validación AWS: {str(aws_error)}")
            
            # Determinar tipo de error específico
            error_message = str(aws_error)
            if 'InvalidUserID.NotFound' in error_message:
                return error_response(401, 'Access Key ID no válido')
            elif 'SignatureDoesNotMatch' in error_message:
                return error_response(401, 'Secret Access Key incorrecto')
            elif 'TokenRefreshRequired' in error_message:
                return error_response(401, 'Token de sesión expirado')
            elif 'AccessDenied' in error_message:
                return error_response(403, 'Credenciales válidas pero sin permisos suficientes')
            else:
                return error_response(401, f'Error de autenticación: {error_message}')
        
    except Exception as e:
        logger.error(f"Error en auth_validator: {str(e)}")
        return error_response(500, 'Error interno del servidor', str(e))

def check_required_permissions(access_key_id: str, secret_access_key: str, 
                             session_token: str, region: str) -> Dict[str, bool]:
    """Verificar permisos mínimos requeridos para la aplicación"""
    permissions = {
        'bedrock': False,
        'rds': False,
        's3': False,
        'dynamodb': False
    }
    
    try:
        # Verificar permisos de Bedrock
        bedrock_client = boto3.client(
            'bedrock',
            aws_access_key_id=access_key_id,
            aws_secret_access_key=secret_access_key,
            aws_session_token=session_token,
            region_name=region
        )
        bedrock_client.list_foundation_models()
        permissions['bedrock'] = True
    except:
        pass
    
    try:
        # Verificar permisos de RDS
        rds_client = boto3.client(
            'rds',
            aws_access_key_id=access_key_id,
            aws_secret_access_key=secret_access_key,
            aws_session_token=session_token,
            region_name=region
        )
        rds_client.describe_db_instances()
        permissions['rds'] = True
    except:
        pass
    
    try:
        # Verificar permisos de S3
        s3_client = boto3.client(
            's3',
            aws_access_key_id=access_key_id,
            aws_secret_access_key=secret_access_key,
            aws_session_token=session_token,
            region_name=region
        )
        s3_client.list_buckets()
        permissions['s3'] = True
    except:
        pass
    
    try:
        # Verificar permisos de DynamoDB
        dynamodb_client = boto3.client(
            'dynamodb',
            aws_access_key_id=access_key_id,
            aws_secret_access_key=secret_access_key,
            aws_session_token=session_token,
            region_name=region
        )
        dynamodb_client.list_tables()
        permissions['dynamodb'] = True
    except:
        pass
    
    return permissions

def extract_username_from_arn(arn: str) -> str:
    """Extraer nombre de usuario del ARN"""
    try:
        # ARN format: arn:aws:iam::123456789012:user/username
        if ':user/' in arn:
            return arn.split(':user/')[-1]
        elif ':role/' in arn:
            return arn.split(':role/')[-1]
        else:
            return arn.split('/')[-1]
    except:
        return 'unknown'

def success_response(data):
    return {
        'statusCode': 200,
        'headers': cors_headers(),
        'body': json.dumps({**data, 'timestamp': datetime.utcnow().isoformat()})
    }

def error_response(status_code, message, details=None):
    return {
        'statusCode': status_code,
        'headers': cors_headers(),
        'body': json.dumps({
            'error': message,
            'details': details,
            'timestamp': datetime.utcnow().isoformat()
        })
    }

def cors_response():
    return {'statusCode': 200, 'headers': cors_headers(), 'body': ''}

def cors_headers():
    return {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
        'Access-Control-Allow-Methods': 'POST,OPTIONS'
    }
```

### 2. Modificaciones en el Frontend

#### Nuevos Estados y Tipos

```typescript
// Agregar a src/types/index.ts

// Información del usuario autenticado
export interface AuthenticatedUser {
  arn: string;
  account_id: string;
  user_id: string;
  username: string;
  region: string;
  authenticated_at: string;
}

// Credenciales de login
export interface LoginCredentials {
  access_key_id: string;
  secret_access_key: string;
  region: string;
  session_token?: string;
}

// Estado de autenticación
export interface AuthState {
  isAuthenticated: boolean;
  user: AuthenticatedUser | null;
  permissions: {
    bedrock: boolean;
    rds: boolean;
    s3: boolean;
    dynamodb: boolean;
  };
  loading: boolean;
  error: string | null;
}

// Respuesta de validación
export interface AuthValidationResponse {
  valid: boolean;
  user_info: AuthenticatedUser;
  permissions: {
    bedrock: boolean;
    rds: boolean;
    s3: boolean;
    dynamodb: boolean;
  };
  session_data: {
    access_key_id: string;
    region: string;
    authenticated_at: string;
  };
}
```

#### Componente de Login

```typescript
// Agregar al App.tsx - Nuevo renderLoginScreen()

const renderLoginScreen = () => {
  const [loginForm, setLoginForm] = useState<LoginCredentials>({
    access_key_id: '',
    secret_access_key: '',
    region: 'us-east-1'
  });
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [showCredentials, setShowCredentials] = useState(false);

  const handleLogin = async () => {
    if (!loginForm.access_key_id.trim() || !loginForm.secret_access_key.trim()) {
      setLoginError('Por favor, completa todos los campos obligatorios');
      return;
    }

    setLoginLoading(true);
    setLoginError(null);

    try {
      const response = await fetch(`${appConfig.api.gatewayUrl}/validate-credentials`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': appConfig.api.apiKey,
        },
        body: JSON.stringify(loginForm),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `Error ${response.status}`);
      }

      const data: AuthValidationResponse = await response.json();
      
      if (data.valid) {
        // Guardar información de usuario en sessionStorage (seguro para sesión)
        const authData: AuthState = {
          isAuthenticated: true,
          user: data.user_info,
          permissions: data.permissions,
          loading: false,
          error: null
        };
        
        sessionStorage.setItem('auth_state', JSON.stringify(authData));
        
        // Actualizar estado de la aplicación
        setCurrentUser(data.user_info);
        setUserPermissions(data.permissions);
        
        // Avanzar al siguiente paso (bienvenida)
        setCurrentStep(1);
        
        logger.info('Login exitoso:', data.user_info.username);
      } else {
        setLoginError('Credenciales inválidas');
      }
      
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Error de autenticación';
      setLoginError(errorMessage);
      logger.error('Error de login:', err);
    } finally {
      setLoginLoading(false);
    }
  };

  return (
    <div className="step-content">
      <div style={{ textAlign: 'center', marginBottom: '40px' }}>
        <div style={{ fontSize: '4rem', marginBottom: '20px' }}>🔐</div>
        <h2 style={{ color: '#1e293b', marginBottom: '10px' }}>
          Autenticación AWS IAM
        </h2>
        <p style={{ color: '#64748b', fontSize: '16px', marginBottom: '30px' }}>
          Ingresa tus credenciales de AWS para acceder al sistema
        </p>
      </div>

      {/* Formulario de login */}
      <div className="login-form">
        <div className="form-group">
          <label className="form-label">
            🔑 Access Key ID
          </label>
          <input
            type="text"
            value={loginForm.access_key_id}
            onChange={(e) => setLoginForm({ ...loginForm, access_key_id: e.target.value })}
            className="form-control"
            placeholder="AKIA..."
            autoComplete="username"
          />
        </div>

        <div className="form-group">
          <label className="form-label">
            🔒 Secret Access Key
          </label>
          <div className="password-input-container">
            <input
              type={showCredentials ? "text" : "password"}
              value={loginForm.secret_access_key}
              onChange={(e) => setLoginForm({ ...loginForm, secret_access_key: e.target.value })}
              className="form-control"
              placeholder="••••••••••••••••••••••••••••••••••••••••"
              autoComplete="current-password"
            />
            <button
              type="button"
              className="password-toggle"
              onClick={() => setShowCredentials(!showCredentials)}
            >
              {showCredentials ? '👁️' : '👁️‍🗨️'}
            </button>
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">
            🌍 Región AWS
          </label>
          <select
            value={loginForm.region}
            onChange={(e) => setLoginForm({ ...loginForm, region: e.target.value })}
            className="form-control"
          >
            <option value="us-east-1">US East (N. Virginia)</option>
            <option value="us-west-2">US West (Oregon)</option>
            <option value="eu-west-1">Europe (Ireland)</option>
            <option value="eu-central-1">Europe (Frankfurt)</option>
            <option value="ap-southeast-1">Asia Pacific (Singapore)</option>
          </select>
        </div>

        {/* Error de login */}
        {loginError && (
          <div className="alert warning" style={{ marginBottom: '20px' }}>
            <strong>❌ Error de Autenticación:</strong> {loginError}
          </div>
        )}

        {/* Información de seguridad */}
        <div className="alert info" style={{ marginBottom: '30px' }}>
          <strong>🔒 Seguridad:</strong>
          <ul style={{ margin: '10px 0 0 20px', paddingLeft: '0' }}>
            <li>Las credenciales se validan directamente con AWS</li>
            <li>No se almacenan permanentemente en el navegador</li>
            <li>La sesión expira automáticamente</li>
            <li>Se requieren permisos mínimos: Bedrock, RDS, S3</li>
          </ul>
        </div>

        {/* Botón de login */}
        <div className="action-buttons" style={{ textAlign: 'center' }}>
          <button 
            type="button" 
            className="btn btn-primary"
            onClick={handleLogin}
            disabled={loginLoading || !loginForm.access_key_id.trim() || !loginForm.secret_access_key.trim()}
            style={{ 
              fontSize: '18px', 
              padding: '15px 30px',
              minWidth: '250px'
            }}
          >
            {loginLoading ? (
              <>
                <div className="loading-spinner" style={{ marginRight: '10px' }}></div>
                Validando Credenciales...
              </>
            ) : (
              <>
                <span>🚀</span>
                Iniciar Sesión
              </>
            )}
          </button>
        </div>
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
        <strong>💡 Tip:</strong> Necesitas un usuario IAM con permisos para Bedrock, RDS y S3. 
        Si no tienes credenciales, contacta a tu administrador de AWS.
      </div>
    </div>
  );
};
```

#### Estados Adicionales en App.tsx

```typescript
// Agregar al App.tsx - Nuevos estados

const [currentUser, setCurrentUser] = useState<AuthenticatedUser | null>(null);
const [userPermissions, setUserPermissions] = useState({
  bedrock: false,
  rds: false,
  s3: false,
  dynamodb: false
});
const [isAuthenticated, setIsAuthenticated] = useState(false);

// Verificar autenticación al cargar
useEffect(() => {
  const checkAuthState = () => {
    const savedAuth = sessionStorage.getItem('auth_state');
    if (savedAuth) {
      try {
        const authData: AuthState = JSON.parse(savedAuth);
        if (authData.isAuthenticated && authData.user) {
          setCurrentUser(authData.user);
          setUserPermissions(authData.permissions);
          setIsAuthenticated(true);
          setCurrentStep(1); // Ir a bienvenida si ya está autenticado
        }
      } catch (error) {
        logger.error('Error parsing auth state:', error);
        sessionStorage.removeItem('auth_state');
      }
    }
  };

  checkAuthState();
}, []);

// Función de logout
const handleLogout = () => {
  sessionStorage.removeItem('auth_state');
  setCurrentUser(null);
  setUserPermissions({ bedrock: false, rds: false, s3: false, dynamodb: false });
  setIsAuthenticated(false);
  setCurrentStep(0);
  setPlanConfig(null);
  setCurrentSession(null);
  setTestPlan(null);
  setChatSession(null);
  setChatMessages([]);
};
```

### 3. Modificaciones en Lambda Functions Existentes

#### Actualizar plan_configurator para usar user_id real

```python
# Modificaciones en lambda_functions/plan_configurator/lambda_function.py

def lambda_handler(event: Dict[str, Any], context) -> Dict[str, Any]:
    try:
        # ... validación de entrada existente ...
        
        # Obtener user_id real del body (enviado desde frontend autenticado)
        user_id = body.get('user_id')  # ARN del usuario IAM
        if not user_id:
            return error_response(400, 'user_id is required (must be authenticated)')
        
        # Extraer username del ARN para logging
        username = user_id.split('/')[-1] if '/' in user_id else user_id
        logger.info(f"Creating session for authenticated user: {username}")
        
        # Crear sesión con user_id real
        session_data = {
            'id': session_id,
            'tester_id': user_id,  # ARN completo del usuario
            'username': username,  # Nombre extraído para facilidad
            'project_context': body['project_context'],
            'plan_configuration': plan_configuration,
            'iterations': [],
            'status': 'active',
            'created_at': current_time,
            'updated_at': current_time
        }
        
        # ... resto de la lógica existente ...
```

#### Actualizar plan_generator para incluir user_id

```python
# Modificaciones en lambda_functions/plan_generator/lambda_function.py

def lambda_handler(event: Dict[str, Any], context) -> Dict[str, Any]:
    try:
        # ... validación existente ...
        
        session_id = body['session_id']
        user_id = body.get('user_id')  # ARN del usuario autenticado
        
        if not user_id:
            return error_response(400, 'user_id is required (must be authenticated)')
        
        # Verificar que la sesión pertenece al usuario autenticado
        session_response = sessions_table.get_item(Key={'id': session_id})
        if 'Item' not in session_response:
            return error_response(404, f'Session not found: {session_id}')
        
        session_data = session_response['Item']
        if session_data.get('tester_id') != user_id:
            return error_response(403, 'Session does not belong to authenticated user')
        
        # ... resto de la lógica existente ...
```

## Flujo de Trabajo Actualizado

### Flujo Completo con Autenticación

```
FLUJO COMPLETO CON AUTENTICACIÓN
═══════════════════════════════════

PASO 0: AUTENTICACIÓN
┌─────────────────────────────────────────────────────────────────┐
│ Usuario ──────► Frontend ──────► auth_validator ──────► AWS STS │
│ Credenciales    Formulario       Validar credenciales   Verify  │
│      │              │                    │                 │    │
│      │              └◄───────────────────┘                 │    │
│      │              Usuario autenticado                    │    │
│      └◄─────────────────────────────────────────────────────┘    │
│                    Sesión establecida                            │
└─────────────────────────────────────────────────────────────────┘

PASO 1: BIENVENIDA (Actualizada)
┌─────────────────────────────────────────────────────────────────┐
│ ✅ Usuario Autenticado: john.doe@company.com                    │
│ 🔑 Permisos: ✓ Bedrock ✓ RDS ✓ S3                              │
│ 🌍 Región: us-east-1                                            │
│                                                                 │
│ [ Continuar ] [ Cerrar Sesión ]                                 │
└─────────────────────────────────────────────────────────────────┘

PASO 2: CONFIGURACIÓN (Con user_id)
┌─────────────────────────────────────────────────────────────────┐
│ plan_configurator recibe:                                       │
│ • plan_title, plan_type, coverage_percentage                    │
│ • min_test_cases, max_test_cases, project_context              │
│ • user_id: "arn:aws:iam::123456789012:user/john.doe"          │
│                                                                 │
│ PostgreSQL/DynamoDB guarda sesión con user_id real             │
└─────────────────────────────────────────────────────────────────┘

PASO 3: GENERACIÓN (Con user_id)
┌─────────────────────────────────────────────────────────────────┐
│ plan_generator recibe:                                          │
│ • session_id                                                    │
│ • user_id: "arn:aws:iam::123456789012:user/john.doe"          │
│                                                                 │
│ Verifica que session pertenece al user_id autenticado          │
└─────────────────────────────────────────────────────────────────┘

PASO 4: RESULTADOS (Con user_id)
┌─────────────────────────────────────────────────────────────────┐
│ Todas las operaciones (edición, exportación, chat) incluyen:   │
│ • user_id para trazabilidad                                     │
│ • Verificación de propiedad de sesión                          │
│ • Logs de auditoría con usuario real                           │
└─────────────────────────────────────────────────────────────────┘
```

### Casos de Uso del Sistema de Login

#### 1. Login Exitoso
```javascript
// Frontend - Proceso de login exitoso
const handleSuccessfulLogin = (authData) => {
  // Guardar en sessionStorage (se borra al cerrar navegador)
  sessionStorage.setItem('auth_state', JSON.stringify({
    isAuthenticated: true,
    user: authData.user_info,
    permissions: authData.permissions,
    authenticated_at: new Date().toISOString()
  }));
  
  // Actualizar estado de la aplicación
  setCurrentUser(authData.user_info);
  setIsAuthenticated(true);
  
  // Avanzar a la aplicación
  setCurrentStep(1);
};
```

#### 2. Verificación de Permisos
```javascript
// Frontend - Verificar permisos antes de operaciones críticas
const checkPermissions = (requiredPermissions) => {
  const authState = JSON.parse(sessionStorage.getItem('auth_state') || '{}');
  
  for (const permission of requiredPermissions) {
    if (!authState.permissions?.[permission]) {
      throw new Error(`Permiso requerido no disponible: ${permission}`);
    }
  }
  
  return true;
};

// Uso antes de generar plan
const handleGeneratePlan = async () => {
  try {
    checkPermissions(['bedrock', 'rds']); // Verificar permisos necesarios
    // ... continuar con generación ...
  } catch (error) {
    setError(`Error de permisos: ${error.message}`);
  }
};
```

#### 3. Logout y Limpieza de Sesión
