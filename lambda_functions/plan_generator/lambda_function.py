import json
import logging
import boto3
from datetime import datetime
from typing import Dict, Any, List
import os

logger = logging.getLogger()
logger.setLevel(logging.INFO)

bedrock_runtime = boto3.client('bedrock-runtime')
bedrock_agent = boto3.client('bedrock-agent-runtime')
dynamodb = boto3.resource('dynamodb')

sessions_table = dynamodb.Table(os.environ.get('SESSIONS_TABLE', 'test-plan-sessions'))
knowledge_base_id = os.environ.get('KNOWLEDGE_BASE_ID')
model_id = os.environ.get('BEDROCK_MODEL_ID', 'anthropic.claude-sonnet-4-20250514-v1:0')

def lambda_handler(event: Dict[str, Any], context) -> Dict[str, Any]:
    """POST /generate-plan - Generar plan de pruebas usando Claude y Knowledge Base"""
    try:
        logger.info(f"Lambda invoked with event: {json.dumps(event, default=str)}")
        
        if event.get('httpMethod') == 'OPTIONS':
            return cors_response()
        
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
        
        # Get session data
        try:
            session_response = sessions_table.get_item(Key={'id': session_id})
            if 'Item' not in session_response:
                return error_response(404, 'Session not found')
            
            session_data = session_response['Item']
            plan_config = session_data['plan_configuration']
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
                            'score': result.get('score', 0.0)
                        })
                
                logger.info(f"Retrieved {len(context_results)} context results from Knowledge Base")
                
            except Exception as e:
                logger.warning(f"Knowledge Base retrieval failed: {str(e)}")
        
        # Generate test plan using Claude
        try:
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
                'iteration_number': len(session_data.get('iterations', [])) + 1,
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
        
    except Exception as e:
        logger.error(f"Error: {str(e)}")
        return error_response(500, 'Internal server error', str(e))

def generate_test_cases_with_claude(plan_config: Dict, context_results: List[Dict], user_instructions: str) -> List[Dict]:
    """Generate test cases using Claude with RAG context"""
    
    # Build context from Knowledge Base results
    context_text = "\n\n".join([
        f"Context {i+1}: {result['content'][:500]}..."
        for i, result in enumerate(context_results[:5])
    ])
    
    # Build prompt for Claude
    prompt = f"""
Eres un experto en testing de software. Genera casos de prueba detallados basándote en la siguiente información:

CONFIGURACIÓN DEL PLAN:
- Título: {plan_config['plan_title']}
- Tipo: {plan_config['plan_type']}
- Cobertura objetivo: {plan_config['coverage_percentage']}%
- Contexto del proyecto: {plan_config['project_context']}

CONTEXTO DE LA APLICACIÓN:
{context_text}

INSTRUCCIONES ADICIONALES:
{user_instructions if user_instructions else "Generar casos de prueba estándar"}

INSTRUCCIONES:
1. Genera entre 5 y 15 casos de prueba según el tipo y cobertura solicitada
2. Cada caso debe incluir todos los campos requeridos
3. Prioriza casos críticos y de alto impacto
4. Asegúrate de cubrir diferentes escenarios (positivos, negativos, edge cases)

FORMATO DE SALIDA (JSON):
{{
  "test_cases": [
    {{
      "testcase_number": 1,
      "test_case_name": "Nombre descriptivo del caso",
      "test_case_description": "Descripción detallada",
      "preconditions": "Condiciones previas necesarias",
      "test_data": "Datos de prueba específicos",
      "test_steps": ["Paso 1", "Paso 2", "Paso 3"],
      "expected_results": "Resultados esperados",
      "requirements": "Requerimientos cubiertos",
      "priority": "ALTA|MEDIA|BAJA",
      "status": "PROPOSED",
      "created_by": "AI_AGENT"
    }}
  ]
}}
"""
    
    try:
        # Call Claude
        response = bedrock_runtime.invoke_model(
            modelId=model_id,
            body=json.dumps({
                "anthropic_version": "bedrock-2023-05-31",
                "max_tokens": 4000,
                "temperature": 0.1,
                "messages": [{"role": "user", "content": prompt}]
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
        'actual_coverage': round(actual_coverage, 2),
        'total_requirements': 10,  # This would come from requirements analysis
        'covered_requirements': total_cases,
        'uncovered_requirements': []
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
        'Access-Control-Allow-Methods': 'POST,OPTIONS'
    }
