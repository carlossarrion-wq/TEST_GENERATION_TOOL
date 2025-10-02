import json
import logging
import boto3
from datetime import datetime
from typing import Dict, Any, List
import os
from decimal import Decimal

logger = logging.getLogger()
logger.setLevel(logging.INFO)

bedrock_runtime = boto3.client('bedrock-runtime')
bedrock_agent = boto3.client('bedrock-agent-runtime')
dynamodb = boto3.resource('dynamodb')

sessions_table = dynamodb.Table(os.environ.get('SESSIONS_TABLE', 'test-plan-sessions'))
knowledge_base_id = os.environ.get('KNOWLEDGE_BASE_ID')
# Usar Inference Profile para Claude Sonnet 4
model_id = os.environ.get('BEDROCK_MODEL_ID', 'arn:aws:bedrock:eu-west-1:701055077130:inference-profile/eu.anthropic.claude-sonnet-4-20250514-v1:0')

def decimal_default(obj):
    """Helper function to convert Decimal objects to float for JSON seraialization"""
    if isinstance(obj, Decimal):
        return float(obj)
    raise TypeError(f"Object of type {type(obj)} is not JSON serializable")

def lambda_handler(event: Dict[str, Any], context) -> Dict[str, Any]:
    """POST /generate-plan - Generar plan de pruebas usando Claude y Knowledge Base"""
    logger.info("=== PLAN_GENERATOR STARTED ===")
    
    try:
        logger.info(f"Raw event received: {json.dumps(event, default=str)}")
        
        if event.get('httpMethod') == 'OPTIONS':
            logger.info("OPTIONS request detected, returning CORS response")
            return cors_response()
        
        logger.info("Processing POST request")
        
        # Manejo robusto del body - soporta API Gateway y invocación directa
        try:
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
        
        required_fields = ['session_id']
        missing_fields = [field for field in required_fields if field not in body]
        
        if missing_fields:
            return error_response(400, f'Missing required fields: {", ".join(missing_fields)}')
        
        session_id = body['session_id']
        user_instructions = body.get('user_instructions', '')
        
        logger.info(f"Searching for session with ID: {session_id}")
        
        # Get session data
        try:
            session_response = sessions_table.get_item(Key={'id': session_id})
            logger.info(f"DynamoDB get_item response: {json.dumps(session_response, default=str)}")
            
            if 'Item' not in session_response:
                logger.error(f"Session not found in DynamoDB. Session ID: {session_id}")
                # Let's also try to list all sessions to debug
                try:
                    scan_response = sessions_table.scan(Limit=5)
                    logger.info(f"Available sessions (first 5): {json.dumps(scan_response.get('Items', []), default=str)}")
                except Exception as scan_error:
                    logger.error(f"Error scanning sessions table: {str(scan_error)}")
                
                return error_response(404, f'Session not found: {session_id}')
            
            session_data = session_response['Item']
            plan_config = session_data['plan_configuration']
            logger.info(f"Session found successfully: {session_data.get('id', 'unknown')}")
        except Exception as e:
            logger.error(f"Error retrieving session: {str(e)}")
            return error_response(500, 'Error retrieving session data')
        
        # Build context from Knowledge Base
        context_results = []
        if knowledge_base_id:
            try:
                search_query = f"test plan {plan_config['plan_type']} {plan_config['project_context']}"
                
                kb_response = bedrock_agent.retrieve(
                    knowledgeBaseId=knowledge_base_id,
                    retrievalQuery={'text': search_query},
                    retrievalConfiguration={
                        'vectorSearchConfiguration': {
                            'numberOfResults': 10,
                            'overrideSearchType': 'HYBRID'
                        }
                    }
                )
                
                if 'retrievalResults' in kb_response:
                    for result in kb_response['retrievalResults']:
                        context_results.append({
                            'content': result.get('content', {}).get('text', ''),
                            'score': Decimal(str(result.get('score', 0.0)))
                        })
                
                logger.info(f"Retrieved {len(context_results)} context results from Knowledge Base")
                
            except Exception as e:
                logger.warning(f"Knowledge Base retrieval failed: {str(e)}")
        
        # Generate test plan using Claude with simplified prompt
        test_cases = generate_test_cases_with_claude(
            plan_config, 
            context_results, 
            user_instructions
        )
        
        # Calculate coverage metrics
        coverage_metrics = calculate_coverage_metrics(test_cases, plan_config)
        
        # Create test plan
        test_plan = {
            'id': f"plan_{session_id}",
            'configuration': plan_config,
            'test_cases': test_cases,
            'coverage_metrics': coverage_metrics,
            'created_at': datetime.utcnow().isoformat(),
            'updated_at': datetime.utcnow().isoformat(),
            'status': 'draft'
        }
        
        # Update session with generated plan
        iteration_data = {
            'iteration_number': Decimal(len(session_data.get('iterations', [])) + 1),
            'user_input': user_instructions or 'Generate initial plan',
            'system_response': f"Generated {len(test_cases)} test cases",
            'generated_plan': test_plan,
            'timestamp': datetime.utcnow().isoformat()
        }
        
        sessions_table.update_item(
            Key={'id': session_id},
            UpdateExpression='SET iterations = list_append(if_not_exists(iterations, :empty_list), :iteration), updated_at = :time',
            ExpressionAttributeValues={
                ':iteration': [iteration_data],
                ':empty_list': [],
                ':time': datetime.utcnow().isoformat()
            }
        )
        
        return success_response({
            'generated_cases': test_cases,  # ← Campo que espera el frontend
            'test_plan': test_plan,
            'generation_stats': {
                'total_test_cases': len(test_cases),
                'context_sources': len(context_results),
                'target_coverage': plan_config['coverage_percentage'],
                'actual_coverage': coverage_metrics['actual_coverage']
            },
            'session_id': session_id
        })
            
    except Exception as e:
        logger.error(f"Test plan generation failed: {str(e)}")
        return error_response(500, 'Test plan generation failed', str(e))

def generate_test_cases_with_claude(plan_config: Dict, context_results: List[Dict], user_instructions: str) -> List[Dict]:
    """Generate test cases using Claude with optimized system/user prompt structure"""
    
    # Log the model ID being used for debugging
    logger.info(f"Using model ID: {model_id}")
    logger.info(f"BEDROCK_MODEL_ID env var: {os.environ.get('BEDROCK_MODEL_ID', 'NOT_SET')}")
    
    # Build context from Knowledge Base results (reduced to 3 contexts, 300 chars each)
    context_text = "\n\n".join([
        f"{result['content'][:300]}..."
        for i, result in enumerate(context_results[:3])
    ])
    
    # Prompts ultra-optimizados para máxima velocidad
    system_prompt = "Genera casos de prueba en formato JSON. Devuelve únicamente JSON válido sin explicaciones."
    
    # Prompt conciso del usuario con información esencial únicamente
    user_prompt = f"""Genera 8 casos de prueba para testing {plan_config['plan_type']}:

REQUERIMIENTO:
{user_instructions if user_instructions else plan_config['project_context']}

Devuelve JSON:
{{
  "test_cases": [
    {{
      "testcase_number": "TC_001",
      "test_case_name": "Título breve",
      "test_case_description": "Descripción breve",
      "preconditions": "Precondiciones",
      "test_steps": "Pasos a ejecutar",
      "expected_results": "Resultados esperados",
      "priority": "HIGH|MEDIUM|LOW"
    }}
  ]
}}"""
    
    try:
        # Call Claude with system/user message structure
        response = bedrock_runtime.invoke_model(
            modelId=model_id,
            body=json.dumps({
                "anthropic_version": "bedrock-2023-05-31",
                "max_tokens": 3000,  # Reduced from 4000
                "temperature": 0.1,
                "system": system_prompt,
                "messages": [{"role": "user", "content": user_prompt}]
            })
        )
        
        response_body = json.loads(response['body'].read())
        content = response_body['content'][0]['text']
        
        # Extract JSON from response
        test_cases_data = extract_json_from_response(content)
        
        # Process and validate test cases
        test_cases = []
        for i, case in enumerate(test_cases_data.get('test_cases', [])):
            processed_case = {
                'testcase_number': case.get('testcase_number', i + 1),
                'test_case_name': case.get('test_case_name', f'Test Case {i + 1}'),
                'test_case_description': case.get('test_case_description', ''),
                'preconditions': case.get('preconditions', ''),
                'test_data': case.get('test_data', ''),
                'test_steps': case.get('test_steps', []),
                'expected_results': case.get('expected_results', ''),
                'requirements': case.get('requirements', ''),
                'address_master_status': case.get('address_master_status', 'N/A'),
                'cache_availability': case.get('cache_availability', 'N/A'),
                'manual_modal_status': case.get('manual_modal_status', 'N/A'),
                'address_fields': case.get('address_fields', 'N/A'),
                'address_standardization': case.get('address_standardization', 'N/A'),
                'order_status': case.get('order_status', 'N/A'),
                'priority': case.get('priority', 'MEDIA'),
                'status': 'PROPOSED',
                'created_by': 'AI_AGENT',
                'last_modified': datetime.utcnow().isoformat(),
                'modifications_log': []
            }
            test_cases.append(processed_case)
        
        return test_cases
        
    except Exception as e:
        logger.error(f"Claude generation error: {str(e)}")
        raise

def extract_json_from_response(content: str) -> Dict:
    """Extract JSON from Claude's response"""
    try:
        return json.loads(content)
    except json.JSONDecodeError:
        import re
        json_match = re.search(r'```(?:json)?\s*([\s\S]*?)\s*```', content)
        if json_match:
            try:
                return json.loads(json_match.group(1))
            except json.JSONDecodeError:
                pass
        
        json_pattern = r'{[\s\S]*}'
        json_match = re.search(json_pattern, content)
        if json_match:
            try:
                return json.loads(json_match.group(0))
            except json.JSONDecodeError:
                pass
        
        return {"test_cases": []}

def calculate_coverage_metrics(test_cases: List[Dict], plan_config: Dict) -> Dict:
    """Calculate coverage metrics for the test plan"""
    total_cases = len(test_cases)
    target_coverage = plan_config['coverage_percentage']
    
    # Simple coverage calculation (could be enhanced)
    actual_coverage = min(100, (total_cases / 10) * 100)  # Assume 10 cases = 100% coverage
    
    return {
        'target_coverage': target_coverage,
        'actual_coverage': Decimal(str(round(actual_coverage, 2))),
        'total_requirements': 10,  # This would come from requirements analysis
        'covered_requirements': total_cases,
        'uncovered_requirements': []
    }

def success_response(data):
    return {
        'statusCode': 200,
        'headers': cors_headers(),
        'body': json.dumps({**data, 'timestamp': datetime.utcnow().isoformat()}, default=decimal_default)
    }

def error_response(status_code, message, details=None):
    return {
        'statusCode': status_code,
        'headers': cors_headers(),
        'body': json.dumps({
            'error': message,
            'details': details,
            'timestamp': datetime.utcnow().isoformat()
        }, default=decimal_default)
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
