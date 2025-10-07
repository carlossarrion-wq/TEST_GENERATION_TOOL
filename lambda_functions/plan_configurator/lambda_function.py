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
    """POST /configure-plan - Configurar un nuevo plan de pruebas"""
    logger.info("=== PLAN_CONFIGURATOR STARTED ===")
    logger.info(f"Raw event received: {json.dumps(event, default=str)}")
    
    try:
        if event.get('httpMethod') == 'OPTIONS':
            logger.info("OPTIONS request detected, returning CORS response")
            return cors_response()
        
        logger.info("Processing POST request")
        
        # Manejo robusto del body - soporta API Gateway y invocación directa
        try:
            logger.info("Starting body parsing...")
            
            if 'body' in event:
                # Formato API Gateway
                if event['body'] is None:
                    return error_response(400, 'Request body is null')
                
                if isinstance(event['body'], str):
                    body = json.loads(event['body'])
                else:
                    body = event['body']
            else:
                # Invocación directa - el evento ES el body
                body = event
                logger.info("Direct invocation detected, using event as body")
                
        except json.JSONDecodeError as e:
            return error_response(400, f'Invalid JSON in request body: {str(e)}')
        except Exception as e:
            return error_response(400, f'Error parsing request body: {str(e)}')
        
        required_fields = ['plan_title', 'plan_type', 'coverage_percentage', 'min_test_cases', 'max_test_cases', 'project_context']
        missing_fields = [field for field in required_fields if field not in body]
        
        if missing_fields:
            return error_response(400, f'Missing required fields: {", ".join(missing_fields)}')
        
        valid_plan_types = ['UNITARIAS', 'INTEGRACIÓN', 'PERFORMANCE', 'REGRESIÓN']
        if body['plan_type'] not in valid_plan_types:
            return error_response(400, f'Invalid plan_type. Must be one of: {", ".join(valid_plan_types)}')
        
        coverage = body['coverage_percentage']
        if not isinstance(coverage, (int, float)) or coverage < 10 or coverage > 100:
            return error_response(400, 'Coverage percentage must be between 10 and 100')
        
        # Validar número de casos de prueba
        min_cases = body['min_test_cases']
        max_cases = body['max_test_cases']
        
        if not isinstance(min_cases, int) or min_cases < 1 or min_cases > 100:
            return error_response(400, 'min_test_cases must be an integer between 1 and 100')
        
        if not isinstance(max_cases, int) or max_cases < 1 or max_cases > 100:
            return error_response(400, 'max_test_cases must be an integer between 1 and 100')
        
        if min_cases > max_cases:
            return error_response(400, 'min_test_cases cannot be greater than max_test_cases')
        
        session_id = str(uuid.uuid4())
        current_time = datetime.utcnow().isoformat()
        
        logger.info(f"Creating new session with ID: {session_id}")
        
        plan_configuration = {
            'plan_title': body['plan_title'],
            'plan_type': body['plan_type'],
            'coverage_percentage': coverage,
            'min_test_cases': min_cases,
            'max_test_cases': max_cases,
            'project_context': body['project_context']
        }
        
        session_data = {
            'id': session_id,
            'tester_id': body.get('tester_id', 'anonymous'),
            'project_context': body['project_context'],
            'plan_configuration': plan_configuration,
            'iterations': [],
            'status': 'active',
            'created_at': current_time,
            'updated_at': current_time
        }
        
        logger.info(f"Session data to be saved: {json.dumps(session_data, default=str)}")
        
        try:
            sessions_table.put_item(Item=session_data)
            logger.info(f"Session {session_id} saved successfully to DynamoDB")
        except Exception as put_error:
            logger.error(f"Error saving session to DynamoDB: {str(put_error)}")
            raise put_error
        
        return success_response({
            'session_id': session_id,
            'plan_configuration': plan_configuration,
            'status': 'configured',
            'message': 'Plan configuration saved successfully'
        })
        
    except Exception as e:
        logger.error(f"Error: {str(e)}")
        return error_response(500, 'Internal server error', str(e))

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
