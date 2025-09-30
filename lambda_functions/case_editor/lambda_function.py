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
    """PUT /edit-case - Editar un caso de prueba existente"""
    try:
        if event.get('httpMethod') == 'OPTIONS':
            return cors_response()
        
        body = json.loads(event['body']) if isinstance(event['body'], str) else event['body']
        
        required_fields = ['session_id', 'case_id', 'updated_case']
        missing_fields = [field for field in required_fields if field not in body]
        
        if missing_fields:
            return error_response(400, f'Missing required fields: {", ".join(missing_fields)}')
        
        session_id = body['session_id']
        case_id = body['case_id']
        updated_case = body['updated_case']
        
        # Validar estructura del caso actualizado
        case_required_fields = ['title', 'description', 'preconditions', 'steps', 'expected_result']
        case_missing_fields = [field for field in case_required_fields if field not in updated_case]
        
        if case_missing_fields:
            return error_response(400, f'Missing required case fields: {", ".join(case_missing_fields)}')
        
        # Obtener la sesión actual
        try:
            response = sessions_table.get_item(Key={'id': session_id})
            if 'Item' not in response:
                return error_response(404, 'Session not found')
            
            session_data = response['Item']
        except Exception as e:
            logger.error(f"Error retrieving session: {str(e)}")
            return error_response(500, 'Error retrieving session data')
        
        # Buscar y actualizar el caso de prueba
        case_found = False
        updated_iterations = []
        
        for iteration in session_data.get('iterations', []):
            if 'test_cases' in iteration:
                updated_cases = []
                for case in iteration['test_cases']:
                    if case.get('id') == case_id:
                        # Actualizar el caso encontrado
                        updated_case_data = {
                            'id': case_id,
                            'title': updated_case['title'],
                            'description': updated_case['description'],
                            'preconditions': updated_case['preconditions'],
                            'steps': updated_case['steps'],
                            'expected_result': updated_case['expected_result'],
                            'priority': updated_case.get('priority', case.get('priority', 'MEDIUM')),
                            'category': updated_case.get('category', case.get('category', 'FUNCTIONAL')),
                            'estimated_time': updated_case.get('estimated_time', case.get('estimated_time', 30)),
                            'requirements_covered': updated_case.get('requirements_covered', case.get('requirements_covered', [])),
                            'created_at': case.get('created_at', datetime.utcnow().isoformat()),
                            'updated_at': datetime.utcnow().isoformat(),
                            'updated_by': body.get('tester_id', 'anonymous')
                        }
                        updated_cases.append(updated_case_data)
                        case_found = True
                        logger.info(f"Case {case_id} updated successfully")
                    else:
                        updated_cases.append(case)
                
                iteration['test_cases'] = updated_cases
            
            updated_iterations.append(iteration)
        
        if not case_found:
            return error_response(404, f'Test case with ID {case_id} not found')
        
        # Actualizar la sesión en DynamoDB
        current_time = datetime.utcnow().isoformat()
        
        try:
            sessions_table.update_item(
                Key={'id': session_id},
                UpdateExpression='SET iterations = :iterations, updated_at = :updated_at',
                ExpressionAttributeValues={
                    ':iterations': updated_iterations,
                    ':updated_at': current_time
                }
            )
        except Exception as e:
            logger.error(f"Error updating session: {str(e)}")
            return error_response(500, 'Error updating session data')
        
        # Recalcular métricas de cobertura
        coverage_metrics = calculate_coverage_metrics(updated_iterations)
        
        return success_response({
            'session_id': session_id,
            'case_id': case_id,
            'updated_case': updated_case_data,
            'coverage_metrics': coverage_metrics,
            'status': 'updated',
            'message': 'Test case updated successfully'
        })
        
    except Exception as e:
        logger.error(f"Error: {str(e)}")
        return error_response(500, 'Internal server error', str(e))

def calculate_coverage_metrics(iterations):
    """Calcular métricas de cobertura básicas"""
    total_cases = 0
    total_requirements = set()
    covered_requirements = set()
    
    for iteration in iterations:
        if 'test_cases' in iteration:
            total_cases += len(iteration['test_cases'])
            for case in iteration['test_cases']:
                requirements = case.get('requirements_covered', [])
                for req in requirements:
                    total_requirements.add(req)
                    covered_requirements.add(req)
    
    coverage_percentage = (len(covered_requirements) / len(total_requirements) * 100) if total_requirements else 0
    
    return {
        'total_test_cases': total_cases,
        'total_requirements': len(total_requirements),
        'covered_requirements': len(covered_requirements),
        'coverage_percentage': round(coverage_percentage, 2)
    }

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
        'Access-Control-Allow-Methods': 'PUT,OPTIONS'
    }
