# Implementación de RDS PostgreSQL para Sistema de Generación de Planes de Prueba

## Resumen Ejecutivo

Esta propuesta detalla la migración del almacenamiento actual (DynamoDB) hacia **Amazon RDS PostgreSQL** para mejorar la persistencia de conversaciones, planes de prueba y datos relacionales. La implementación permitirá guardar conversaciones completas con planes generados para acceso posterior, mejorando la experiencia del usuario y la trazabilidad del sistema.

## Análisis de la Situación Actual

### Estado Actual del Sistema
- **Almacenamiento**: DynamoDB para sesiones y datos temporales
- **Limitaciones identificadas**:
  - Falta de persistencia a largo plazo de conversaciones
  - Dificultad para consultas complejas y reportes
  - No hay historial de planes generados accesible
  - Estructura NoSQL limita relaciones entre entidades

### Arquitectura Actual vs Propuesta

```
ACTUAL (DynamoDB)                    PROPUESTA (RDS PostgreSQL)
═══════════════════                  ═══════════════════════════

┌─────────────────┐                  ┌─────────────────┐
│   DynamoDB      │                  │  RDS PostgreSQL │
│                 │                  │                 │
│ • Sessions      │       ──────►    │ • conversations │
│ • Iterations    │                  │ • test_plans    │
│ • Temp Data     │                  │ • test_cases    │
└─────────────────┘                  │ • sessions      │
                                     │ • users         │
                                     │ • projects      │
                                     └─────────────────┘

Limitaciones:                        Beneficios:
• Sin relaciones                     • Relaciones ACID
• Consultas limitadas                • SQL complejo
• Sin historial                      • Historial completo
• Escalabilidad costosa              • Reportes avanzados
```

## Diseño del Esquema de Base de Datos

### Diagrama Entidad-Relación

```sql
-- Esquema completo de la base de datos PostgreSQL

-- Tabla de usuarios/testers
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username VARCHAR(100) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE,
    full_name VARCHAR(255),
    role VARCHAR(50) DEFAULT 'tester',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT true
);

-- Tabla de proyectos
CREATE TABLE projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    context TEXT,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT true
);

-- Tabla de conversaciones (sesiones de chat)
CREATE TABLE conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),
    project_id UUID REFERENCES projects(id),
    title VARCHAR(255) NOT NULL,
    status VARCHAR(50) DEFAULT 'active', -- active, completed, archived
    plan_type VARCHAR(50), -- UNITARIAS, INTEGRACIÓN, PERFORMANCE, REGRESIÓN
    coverage_percentage INTEGER,
    min_test_cases INTEGER,
    max_test_cases INTEGER,
    project_context TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP WITH TIME ZONE,
    
    -- Índices para búsquedas frecuentes
    INDEX idx_conversations_user_id (user_id),
    INDEX idx_conversations_project_id (project_id),
    INDEX idx_conversations_status (status),
    INDEX idx_conversations_created_at (created_at DESC)
);

-- Tabla de mensajes de conversación
CREATE TABLE conversation_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL, -- user, assistant, system
    content TEXT NOT NULL,
    metadata JSONB, -- Para datos adicionales como processing_time, model_used, etc.
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Índices
    INDEX idx_messages_conversation_id (conversation_id),
    INDEX idx_messages_created_at (created_at),
    INDEX idx_messages_role (role)
);

-- Tabla de planes de prueba
CREATE TABLE test_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    plan_type VARCHAR(50) NOT NULL,
    status VARCHAR(50) DEFAULT 'draft', -- draft, active, completed, archived
    target_coverage INTEGER,
    actual_coverage DECIMAL(5,2),
    total_requirements INTEGER DEFAULT 0,
    covered_requirements INTEGER DEFAULT 0,
    configuration JSONB, -- Configuración completa del plan
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Índices
    INDEX idx_test_plans_conversation_id (conversation_id),
    INDEX idx_test_plans_status (status),
    INDEX idx_test_plans_plan_type (plan_type)
);

-- Tabla de casos de prueba
CREATE TABLE test_cases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    test_plan_id UUID REFERENCES test_plans(id) ON DELETE CASCADE,
    testcase_number VARCHAR(50) NOT NULL,
    test_case_name VARCHAR(255) NOT NULL,
    test_case_description TEXT,
    preconditions TEXT,
    test_data TEXT,
    test_steps JSONB, -- Array de pasos
    expected_results TEXT,
    requirements TEXT,
    
    -- Campos específicos del dominio
    address_master_status VARCHAR(100),
    cache_availability VARCHAR(100),
    manual_modal_status VARCHAR(100),
    address_fields VARCHAR(255),
    address_standardization VARCHAR(255),
    order_status VARCHAR(100),
    
    -- Campos de gestión
    priority VARCHAR(20) DEFAULT 'MEDIA', -- ALTA, MEDIA, BAJA
    status VARCHAR(20) DEFAULT 'PROPOSED', -- PROPOSED, ACCEPTED, DISCARDED, MANUAL
    created_by VARCHAR(20) DEFAULT 'AI_AGENT', -- AI_AGENT, MANUAL
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Índices
    INDEX idx_test_cases_test_plan_id (test_plan_id),
    INDEX idx_test_cases_status (status),
    INDEX idx_test_cases_priority (priority),
    INDEX idx_test_cases_created_by (created_by)
);

-- Tabla de modificaciones (log de cambios)
CREATE TABLE test_case_modifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    test_case_id UUID REFERENCES test_cases(id) ON DELETE CASCADE,
    field_name VARCHAR(100) NOT NULL,
    old_value TEXT,
    new_value TEXT,
    action VARCHAR(50) NOT NULL, -- CREATE, UPDATE, DELETE
    modified_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Índices
    INDEX idx_modifications_test_case_id (test_case_id),
    INDEX idx_modifications_created_at (created_at DESC)
);

-- Tabla de documentos de requerimientos
CREATE TABLE requirement_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
    filename VARCHAR(255) NOT NULL,
    s3_key VARCHAR(500) NOT NULL,
    file_size INTEGER,
    content_type VARCHAR(100),
    processed_at TIMESTAMP WITH TIME ZONE,
    processing_status VARCHAR(50) DEFAULT 'pending', -- pending, processed, failed
    extracted_content TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Índices
    INDEX idx_documents_conversation_id (conversation_id),
    INDEX idx_documents_processing_status (processing_status)
);

-- Tabla de exportaciones
CREATE TABLE plan_exports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    test_plan_id UUID REFERENCES test_plans(id) ON DELETE CASCADE,
    format VARCHAR(20) NOT NULL, -- excel, pdf, json, csv
    s3_key VARCHAR(500) NOT NULL,
    filename VARCHAR(255) NOT NULL,
    file_size INTEGER,
    include_metadata BOOLEAN DEFAULT false,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP WITH TIME ZONE,
    
    -- Índices
    INDEX idx_exports_test_plan_id (test_plan_id),
    INDEX idx_exports_created_at (created_at DESC)
);

-- Triggers para updated_at automático
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_projects_updated_at BEFORE UPDATE ON projects FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_conversations_updated_at BEFORE UPDATE ON conversations FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_test_plans_updated_at BEFORE UPDATE ON test_plans FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_test_cases_updated_at BEFORE UPDATE ON test_cases FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
```

### Relaciones y Cardinalidades

```
users (1) ──────── (N) conversations
users (1) ──────── (N) projects
projects (1) ─────── (N) conversations
conversations (1) ── (N) conversation_messages
conversations (1) ── (N) test_plans
conversations (1) ── (N) requirement_documents
test_plans (1) ──── (N) test_cases
test_plans (1) ──── (N) plan_exports
test_cases (1) ──── (N) test_case_modifications
users (1) ──────── (N) test_case_modifications
users (1) ──────── (N) plan_exports
```

## Integración con la Aplicación Actual

### Modificaciones en las Lambda Functions

#### 1. Nueva Lambda: `database_manager`

```python
# lambda_functions/database_manager/lambda_function.py
import psycopg2
import json
import os
from typing import Dict, Any, List, Optional
import uuid
from datetime import datetime

class DatabaseManager:
    def __init__(self):
        self.connection = psycopg2.connect(
            host=os.environ['RDS_HOST'],
            database=os.environ['RDS_DATABASE'],
            user=os.environ['RDS_USER'],
            password=os.environ['RDS_PASSWORD'],
            port=os.environ.get('RDS_PORT', 5432)
        )
    
    def create_conversation(self, user_id: str, project_id: str, config: Dict) -> str:
        """Crear nueva conversación"""
        with self.connection.cursor() as cursor:
            conversation_id = str(uuid.uuid4())
            cursor.execute("""
                INSERT INTO conversations 
                (id, user_id, project_id, title, plan_type, coverage_percentage, 
                 min_test_cases, max_test_cases, project_context)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            """, (
                conversation_id, user_id, project_id, config['plan_title'],
                config['plan_type'], config['coverage_percentage'],
                config['min_test_cases'], config['max_test_cases'],
                config['project_context']
            ))
            self.connection.commit()
            return conversation_id
    
    def add_message(self, conversation_id: str, role: str, content: str, metadata: Dict = None):
        """Agregar mensaje a conversación"""
        with self.connection.cursor() as cursor:
            cursor.execute("""
                INSERT INTO conversation_messages (conversation_id, role, content, metadata)
                VALUES (%s, %s, %s, %s)
            """, (conversation_id, role, content, json.dumps(metadata or {})))
            self.connection.commit()
    
    def save_test_plan(self, conversation_id: str, plan_data: Dict) -> str:
        """Guardar plan de pruebas completo"""
        with self.connection.cursor() as cursor:
            plan_id = str(uuid.uuid4())
            
            # Insertar plan
            cursor.execute("""
                INSERT INTO test_plans 
                (id, conversation_id, title, plan_type, target_coverage, 
                 actual_coverage, configuration)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
            """, (
                plan_id, conversation_id, plan_data['configuration']['plan_title'],
                plan_data['configuration']['plan_type'], 
                plan_data['configuration']['coverage_percentage'],
                plan_data['coverage_metrics']['actual_coverage'],
                json.dumps(plan_data['configuration'])
            ))
            
            # Insertar casos de prueba
            for case in plan_data['test_cases']:
                cursor.execute("""
                    INSERT INTO test_cases 
                    (test_plan_id, testcase_number, test_case_name, test_case_description,
                     preconditions, test_data, test_steps, expected_results, requirements,
                     address_master_status, cache_availability, manual_modal_status,
                     address_fields, address_standardization, order_status,
                     priority, status, created_by)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """, (
                    plan_id, case['testcase_number'], case['test_case_name'],
                    case['test_case_description'], case['preconditions'], case['test_data'],
                    json.dumps(case['test_steps']), case['expected_results'], case['requirements'],
                    case['address_master_status'], case['cache_availability'], case['manual_modal_status'],
                    case['address_fields'], case['address_standardization'], case['order_status'],
                    case['priority'], case['status'], case['created_by']
                ))
            
            self.connection.commit()
            return plan_id
    
    def get_conversation_history(self, conversation_id: str) -> Dict:
        """Recuperar historial completo de conversación"""
        with self.connection.cursor() as cursor:
            # Obtener conversación
            cursor.execute("""
                SELECT c.*, u.username, p.name as project_name
                FROM conversations c
                LEFT JOIN users u ON c.user_id = u.id
                LEFT JOIN projects p ON c.project_id = p.id
                WHERE c.id = %s
            """, (conversation_id,))
            conversation = cursor.fetchone()
            
            if not conversation:
                return None
            
            # Obtener mensajes
            cursor.execute("""
                SELECT role, content, metadata, created_at
                FROM conversation_messages
                WHERE conversation_id = %s
                ORDER BY created_at ASC
            """, (conversation_id,))
            messages = cursor.fetchall()
            
            # Obtener planes de prueba
            cursor.execute("""
                SELECT tp.*, 
                       COUNT(tc.id) as total_test_cases,
                       COUNT(CASE WHEN tc.status = 'ACCEPTED' THEN 1 END) as accepted_cases
                FROM test_plans tp
                LEFT JOIN test_cases tc ON tp.id = tc.test_plan_id
                WHERE tp.conversation_id = %s
                GROUP BY tp.id
                ORDER BY tp.created_at DESC
            """, (conversation_id,))
            plans = cursor.fetchall()
            
            return {
                'conversation': conversation,
                'messages': messages,
                'test_plans': plans
            }
    
    def search_conversations(self, user_id: str, filters: Dict = None) -> List[Dict]:
        """Buscar conversaciones con filtros"""
        with self.connection.cursor() as cursor:
            base_query = """
                SELECT c.id, c.title, c.status, c.plan_type, c.created_at, c.updated_at,
                       COUNT(tp.id) as total_plans,
                       COUNT(tc.id) as total_test_cases
                FROM conversations c
                LEFT JOIN test_plans tp ON c.id = tp.conversation_id
                LEFT JOIN test_cases tc ON tp.id = tc.test_plan_id
                WHERE c.user_id = %s
            """
            params = [user_id]
            
            if filters:
                if filters.get('plan_type'):
                    base_query += " AND c.plan_type = %s"
                    params.append(filters['plan_type'])
                
                if filters.get('status'):
                    base_query += " AND c.status = %s"
                    params.append(filters['status'])
                
                if filters.get('date_from'):
                    base_query += " AND c.created_at >= %s"
                    params.append(filters['date_from'])
            
            base_query += """
                GROUP BY c.id, c.title, c.status, c.plan_type, c.created_at, c.updated_at
                ORDER BY c.updated_at DESC
                LIMIT 50
            """
            
            cursor.execute(base_query, params)
            return cursor.fetchall()
```

#### 2. Modificaciones en `plan_configurator`

```python
# Cambios en lambda_functions/plan_configurator/lambda_function.py

# Reemplazar DynamoDB con PostgreSQL
def lambda_handler(event: Dict[str, Any], context) -> Dict[str, Any]:
    try:
        # ... validación de entrada ...
        
        # Crear conversación en PostgreSQL en lugar de DynamoDB
        db_manager = DatabaseManager()
        
        # Obtener o crear usuario
        user_id = get_or_create_user(body.get('tester_id', 'anonymous'))
        
        # Obtener o crear proyecto
        project_id = get_or_create_project(body['project_context'], user_id)
        
        # Crear conversación
        conversation_id = db_manager.create_conversation(user_id, project_id, plan_configuration)
        
        # Agregar mensaje inicial del sistema
        db_manager.add_message(
            conversation_id, 
            'system', 
            f"Conversación iniciada para plan de pruebas: {plan_configuration['plan_title']}"
        )
        
        return success_response({
            'conversation_id': conversation_id,  # Cambiar de session_id
            'plan_configuration': plan_configuration,
            'status': 'configured',
            'message': 'Plan configuration saved successfully'
        })
        
    except Exception as e:
        logger.error(f"Error: {str(e)}")
        return error_response(500, 'Internal server error', str(e))
```

#### 3. Modificaciones en `plan_generator`

```python
# Cambios en lambda_functions/plan_generator/lambda_function.py

def lambda_handler(event: Dict[str, Any], context) -> Dict[str, Any]:
    try:
        # ... validación de entrada ...
        
        conversation_id = body['conversation_id']  # Cambiar de session_id
        user_instructions = body.get('user_instructions', '')
        
        db_manager = DatabaseManager()
        
        # Obtener historial de conversación
        conversation_data = db_manager.get_conversation_history(conversation_id)
        if not conversation_data:
            return error_response(404, f'Conversation not found: {conversation_id}')
        
        # Agregar mensaje del usuario
        if user_instructions:
            db_manager.add_message(conversation_id, 'user', user_instructions)
        
        # ... generación con Claude ...
        
        # Guardar plan generado
        plan_id = db_manager.save_test_plan(conversation_id, test_plan)
        
        # Agregar respuesta del asistente
        db_manager.add_message(
            conversation_id, 
            'assistant', 
            f"Plan generado con {len(test_cases)} casos de prueba",
            {
                'plan_id': plan_id,
                'processing_time_ms': processing_time,
                'model_used': model_id,
                'total_test_cases': len(test_cases)
            }
        )
        
        return success_response({
            'generated_cases': test_cases,
            'test_plan': test_plan,
            'conversation_id': conversation_id,
            'plan_id': plan_id
        })
        
    except Exception as e:
        logger.error(f"Error: {str(e)}")
        return error_response(500, 'Test plan generation failed', str(e))
```

### Nuevos Endpoints para Gestión de Conversaciones

#### 4. Nueva Lambda: `conversation_manager`

```python
# lambda_functions/conversation_manager/lambda_function.py

def lambda_handler(event: Dict[str, Any], context) -> Dict[str, Any]:
    """Gestionar conversaciones - GET, POST, PUT, DELETE"""
    
    method = event.get('httpMethod')
    path = event.get('path', '')
    
    if method == 'GET':
        if '/conversations' in path:
            return list_conversations(event)
        elif '/conversation/' in path:
            return get_conversation(event)
    elif method == 'POST':
        return create_conversation(event)
    elif method == 'PUT':
        return update_conversation(event)
    elif method == 'DELETE':
        return delete_conversation(event)
    
    return error_response(405, 'Method not allowed')

def list_conversations(event):
    """GET /conversations - Listar conversaciones del usuario"""
    query_params = event.get('queryStringParameters', {}) or {}
    user_id = query_params.get('user_id')
    
    if not user_id:
        return error_response(400, 'user_id is required')
    
    filters = {
        'plan_type': query_params.get('plan_type'),
        'status': query_params.get('status'),
        'date_from': query_params.get('date_from')
    }
    
    db_manager = DatabaseManager()
    conversations = db_manager.search_conversations(user_id, filters)
    
    return success_response({
        'conversations': conversations,
        'total': len(conversations)
    })

def get_conversation(event):
    """GET /conversation/{id} - Obtener conversación completa"""
    path_params = event.get('pathParameters', {})
    conversation_id = path_params.get('id')
    
    if not conversation_id:
        return error_response(400, 'conversation_id is required')
    
    db_manager = DatabaseManager()
    conversation_data = db_manager.get_conversation_history(conversation_id)
    
    if not conversation_data:
        return error_response(404, 'Conversation not found')
    
    return success_response(conversation_data)
```

## Flujo de Trabajo Actualizado

### Flujo Completo con Persistencia

```
FASE 1: INICIO DE CONVERSACIÓN
═══════════════════════════════

Usuario ──────► Frontend ──────► plan_configurator ──────► PostgreSQL
               Configurar         Crear conversación        Guardar conversación
               nuevo plan                │                         │
                    │                    └──────► database_manager ─┘
                    │                            Crear usuario/proyecto
                    └◄─────────────────────────────────────────────────────┘
                              conversation_id retornado

FASE 2: GENERACIÓN ITERATIVA
═════════════════════════════

Usuario ──────► Frontend ──────► plan_generator ──────► PostgreSQL
               "Genera plan"      Obtener historial      Recuperar conversación
                    │                    │                      │
                    │                    └──────► Claude ◄──────┘
                    │                            Generar         │
                    │                            con contexto    │
                    │                                   │        │
                    │            plan_generator ◄───────┘        │
                    │            Guardar plan ──────────────────►│
                    │                                            │
                    └◄─────────────────────────────────────────────┘
                              Plan guardado con historial

FASE 3: EDICIÓN Y REFINAMIENTO
═══════════════════════════════

Usuario ──────► Frontend ──────► case_editor ──────► PostgreSQL
               Editar caso        Actualizar caso     Guardar cambios
                    │                    │                   │
                    │                    └──────► database_manager
                    │                            Log modificación
                    │                                   │
                    └◄─────────────────────────────────────┘
                              Caso actualizado

FASE 4: ACCESO A CONVERSACIONES PREVIAS
════════════════════════════════════════

Usuario ──────► Frontend ──────► conversation_manager ──────► PostgreSQL
               Ver historial      Buscar conversaciones       Consultar BD
                    │                         │                      │
                    │                         └◄─────────────────────┘
                    │                        Lista de conversaciones
                    └◄─────────────────────────────────────────────────┘
                              Historial mostrado

Usuario ──────► Frontend ──────► conversation_manager ──────► PostgreSQL
               Abrir conversación  Obtener conversación       Recuperar completa
                    │                         │                      │
                    │                         └◄─────────────────────┘
                    │                        Conversación + mensajes + planes
                    └◄─────────────────────────────────────────────────┘
                              Conversación restaurada
```

### Casos de Uso Principales

#### 1. Crear Nueva Conversación
```javascript
// Frontend - Crear nueva conversación
const createNewConversation = async (config) => {
  const response = await fetch('/api/configure-plan', {
    method: 'POST',
    body: JSON.stringify({
      plan_title: config.title,
      plan_type: config.type,
      coverage_percentage: config.coverage,
      min_test_cases: config.minCases,
      max_test_cases: config.maxCases,
      project_context: config.context,
      tester_id: getCurrentUserId()
    })
  });
  
  const result = await response.json();
  return result.conversation_id;
};
```

#### 2. Recuperar Conversaciones Previas
```javascript
// Frontend - Listar conversaciones del usuario
const getUserConversations = async (filters = {}) => {
  const params = new URLSearchParams({
    user_id: getCurrentUserId(),
    ...filters
  });
  
  const response = await fetch(`/api/conversations?${params}`);
  const result = await response.json();
  return result.conversations;
};

// Frontend - Abrir conversación específica
const openConversation = async (conversationId) => {
  const response = await fetch(`/api/conversation/${conversationId}`);
  const result = await response.json();
  
  // Restaurar estado de la conversación
  setMessages(result.messages);
  setTestPlans(result.test_plans);
  setCurrentConversation(result.conversation);
};
```

#### 3. Continuar Conversación Existente
```javascript
// Frontend - Continuar generando en conversación existente
const continueConversation = async (conversationId, instructions) => {
  const response = await fetch('/api/generate-plan', {
    method: 'POST',
    body: JSON.stringify({
      conversation_id: conversationId,
      user_instructions: instructions
    })
  });
  
  const result = await response.json();
  
  // Actualizar UI con nuevos casos generados
  updateTestCases(result.generated_cases);
  addMessage('assistant', result.system_response);
};
```

## Configuración de Infraestructura

### Configuración de RDS PostgreSQL

```yaml
# cloudformation/rds-postgresql.yaml
AWSTemplateFormatVersion: '2010-09-09'
Description: 'RDS PostgreSQL para Sistema de Generación de Planes de Prueba'

Parameters:
  Environment:
    Type: String
    Default: 'dev'
    AllowedValues: ['dev', 'staging', 'prod']
  
  DBInstanceClass:
    Type: String
    Default: 'db.t3.micro'
    Description: 'RDS instance class'
  
  AllocatedStorage:
    Type: Number
    Default: 20
    MinValue: 20
    MaxValue: 1000

Resources:
  # VPC y Subnets para RDS
  VPC:
    Type: AWS::EC2::VPC
    Properties:
      CidrBlock: 10.0.0.0/16
      EnableDnsHostnames: true
      EnableDnsSupport: true
      Tags:
        - Key: Name
          Value: !Sub '${Environment}-test-plan-vpc'

  PrivateSubnet1:
    Type: AWS::EC2::Subnet
    Properties:
      VpcId: !Ref VPC
      CidrBlock: 10.0.1.0/24
      AvailabilityZone: !Select [0, !GetAZs '']
      Tags:
        - Key: Name
          Value: !Sub '${Environment}-private-subnet-1'

  PrivateSubnet2:
    Type: AWS::EC2::Subnet
    Properties:
      VpcId: !Ref VPC
      CidrBlock: 10.0.2.0/24
      AvailabilityZone: !Select [1, !GetAZs '']
      Tags:
        - Key: Name
          Value: !Sub '${Environment}-private-subnet-2'

  # DB Subnet Group
  DBSubnetGroup:
    Type: AWS::RDS::DBSubnetGroup
    Properties:
      DBSubnetGroupDescription: 'Subnet group for RDS PostgreSQL'
      SubnetIds:
        - !Ref PrivateSubnet1
        - !Ref PrivateSubnet2
      Tags:
        - Key: Name
          Value: !Sub '${Environment}-db-subnet-group'

  # Security Group para RDS
  DBSecurityGroup:
    Type: AWS::EC2::SecurityGroup
    Properties:
      GroupDescription: 'Security group for RDS PostgreSQL'
      VpcId: !Ref VPC
      SecurityGroupIngress:
        - IpProtocol: tcp
          FromPort: 5432
          ToPort: 5432
          SourceSecurityGroupId: !Ref Lambda
