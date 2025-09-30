import json
import logging
import boto3
import uuid
from datetime import datetime
from typing import Dict, Any
import os

logger = logging.getLogger()
logger.setLevel(logging.INFO)

dynamodb = boto3.resource('dynamodb')
sessions_table = dynamodb.Table(os.environ.get('SESSIONS_TABLE', 'test-plan-sessions'))

def lambda_handler(event: Dict[str, Any], context) -> Dict[str, Any]:
    """POST /create-manual-case - Crear un caso de prueba manual"""
    try:
        if event.get('httpMethod') == 'OPTIONS':
            return cors_response()
        
        body = json.loads(event['body']) if isinstance(event['body'], str) else event['body']
        
        required_fields = ['session_id', 'test_case']
        missing_fields = [field for field in required_fields if field not in body]
        
        if missing_fields:
            return error_response(400, f'Missing required fields: {", ".join(missing_fields)}')
        
        session_id = body['session_id']
        test_case_data = body['test_case']
        
        # Validar estructura del caso de prueba
        case_required_fields = ['title', 'description', 'preconditions', 'steps', 'expected_result']
        case_missing_fields = [field for field in case_required_fields if field not in test_case_data]
        
        if case_missing_fields:
            return error_response(400, f'Missing required test case fields: {", ".join(case_missing_fields)}')
        
        # Validar tipos de datos
        if not isinstance(test_case_data['steps'], list):
            return error_response(400, 'Steps must be an array of strings')
        
        if len(test_case_data['steps']) == 0:
            return error_response(400, 'At least one step is required')
        
        # Obtener la sesión actual
        try:
            response = sessions_table.get_item(Key={'id': session_id})
            if 'Item' not in response:
                return error_response(404, 'Session not found')
            
            session_data = response['Item']
        except Exception as e:
            logger.error(f"Error retrieving session: {str(e)}")
            return error_response(500, 'Error retrieving session data')
        
        # Crear el nuevo caso de prueba
        case_id = str(uuid.uuid4())
        current_time = datetime.utcnow().isoformat()
        
        new_test_case = {
            'id': case_id,
            'title': test_case_data['title'].strip(),
            'description': test_case_data['description'].strip(),
            'preconditions': test_case_data['preconditions'].strip(),
            'steps': [step.strip() for step in test_case_data['steps'] if step.strip()],
            'expected_result': test_case_data['expected_result'].strip(),
            'priority': test_case_data.get('priority', 'MEDIUM'),
            'category': test_case_data.get('category', 'FUNCTIONAL'),
            'estimated_time': test_case_data.get('estimated_time', 30),
            'requirements_covered': test_case_data.get('requirements_covered', []),
            'tags': test_case_data.get('tags', []),
            'automation_candidate': test_case_data.get('automation_candidate', False),
            'created_at': current_time,
            'updated_at': current_time,
            'created_by': body.get('tester_id', 'anonymous'),
            'source': 'manual'
        }
        
        # Validar prioridad
        valid_priorities = ['HIGH', 'MEDIUM', 'LOW']
        if new_test_case['priority'] not in valid_priorities:
            return error_response(400, f'Invalid priority. Must be one of: {", ".join(valid_priorities)}')
        
        # Validar categoría
        valid_categories = ['FUNCTIONAL', 'NON_FUNCTIONAL', 'INTEGRATION', 'PERFORMANCE', 'SECURITY', 'USABILITY', 'REGRESSION']
        if new_test_case['category'] not in valid_categories:
            return error_response(400, f'Invalid category. Must be one of: {", ".join(valid_categories)}')
        
        # Validar tiempo estimado
        if not isinstance(new_test_case['estimated_time'], (int, float)) or new_test_case['estimated_time'] <= 0:
            return error_response(400, 'Estimated time must be a positive number')
        
        # Determinar en qué iteración agregar el caso
        iteration_number = body.get('iteration_number', None)
        iterations = session_data.get('iterations', [])
        
        if iteration_number is not None:
            # Agregar a una iteración específica
            if iteration_number < 1 or iteration_number > len(iterations):
                return error_response(400, f'Invalid iteration number. Must be between 1 and {len(iterations)}')
            
            target_iteration = iterations[iteration_number - 1]
        else:
            # Agregar a la última iteración o crear una nueva
            if not iterations:
                # Crear primera iteración
                target_iteration = {
                    'iteration_number': 1,
                    'test_cases': [],
                    'created_at': current_time
                }
                iterations.append(target_iteration)
            else:
                target_iteration = iterations[-1]
        
        # Agregar el caso a la iteración
        if 'test_cases' not in target_iteration:
            target_iteration['test_cases'] = []
        
        target_iteration['test_cases'].append(new_test_case)
        
        # Actualizar la sesión en DynamoDB
        try:
            sessions_table.update_item(
                Key={'id': session_id},
                UpdateExpression='SET iterations = :iterations, updated_at = :updated_at',
                ExpressionAttributeValues={
                    ':iterations': iterations,
                    ':updated_at': current_time
                }
            )
        except Exception as e:
            logger.error(f"Error updating session: {str(e)}")
            return error_response(500, 'Error updating session data')
        
        # Calcular métricas actualizadas
        updated_metrics = calculate_session_metrics(iterations)
        
        # Generar sugerencias para el caso creado
        suggestions = generate_case_suggestions(new_test_case, session_data)
        
        return success_response({
            'session_id': session_id,
            'case_id': case_id,
            'test_case': new_test_case,
            'iteration_number': target_iteration['iteration_number'],
            'updated_metrics': updated_metrics,
            'suggestions': suggestions,
            'status': 'created',
            'message': 'Manual test case created successfully'
        })
        
    except Exception as e:
        logger.error(f"Error: {str(e)}")
        return error_response(500, 'Internal server error', str(e))

def calculate_session_metrics(iterations):
    """Calcular métricas básicas de la sesión"""
    total_cases = 0
    total_time = 0
    priorities = {'HIGH': 0, 'MEDIUM': 0, 'LOW': 0}
    categories = {}
    
    for iteration in iterations:
        if 'test_cases' in iteration:
            total_cases += len(iteration['test_cases'])
            for case in iteration['test_cases']:
                total_time += case.get('estimated_time', 30)
                priority = case.get('priority', 'MEDIUM')
                priorities[priority] += 1
                category = case.get('category', 'FUNCTIONAL')
                categories[category] = categories.get(category, 0) + 1
    
    return {
        'total_test_cases': total_cases,
        'total_estimated_time_minutes': total_time,
        'total_estimated_time_hours': round(total_time / 60, 2),
        'priority_distribution': priorities,
        'category_distribution': categories,
        'total_iterations': len(iterations)
    }

def generate_case_suggestions(test_case, session_data):
    """Generar sugerencias para mejorar el caso de prueba"""
    suggestions = []
    
    # Sugerencias basadas en el contenido del caso
    if len(test_case['steps']) == 1:
        suggestions.append("Considere dividir el paso en múltiples pasos más específicos para mayor claridad")
    
    if len(test_case['description']) < 50:
        suggestions.append("La descripción es muy breve. Considere agregar más detalles sobre el objetivo del caso")
    
    if not test_case['requirements_covered']:
        suggestions.append("Considere especificar qué requisitos cubre este caso de prueba para mejorar la trazabilidad")
    
    if test_case['estimated_time'] > 60:
        suggestions.append("El tiempo estimado es alto. Considere dividir en casos más pequeños para facilitar la ejecución")
    
    # Sugerencias basadas en el contexto del plan
    plan_config = session_data.get('plan_configuration', {})
    plan_type = plan_config.get('plan_type', '')
    
    if plan_type == 'PERFORMANCE' and test_case['category'] != 'PERFORMANCE':
        suggestions.append("Este es un plan de performance. Considere si este caso debería ser categorizado como PERFORMANCE")
    
    if plan_type == 'REGRESIÓN' and not test_case.get('automation_candidate', False):
        suggestions.append("Para planes de regresión, considere marcar casos como candidatos para automatización")
    
    # Sugerencias de mejores prácticas
    if not test_case.get('tags'):
        suggestions.append("Considere agregar tags para facilitar la organización y filtrado de casos")
    
    if test_case['priority'] == 'HIGH' and test_case['estimated_time'] > 45:
        suggestions.append("Los casos de alta prioridad deberían ser ejecutables rápidamente. Considere optimizar o dividir")
    
    return suggestions

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
