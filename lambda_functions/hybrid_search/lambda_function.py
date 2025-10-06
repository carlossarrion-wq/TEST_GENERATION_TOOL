import json
import logging
import boto3
from datetime import datetime
from typing import Dict, Any, List
import os

logger = logging.getLogger()
logger.setLevel(logging.INFO)

bedrock_agent = boto3.client('bedrock-agent-runtime')
knowledge_base_id = os.environ.get('KNOWLEDGE_BASE_ID')

def lambda_handler(event: Dict[str, Any], context) -> Dict[str, Any]:
    """POST /hybrid-search - Realizar búsqueda híbrida en Knowledge Base"""
    try:
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
        
        required_fields = ['query']
        missing_fields = [field for field in required_fields if field not in body]
        
        if missing_fields:
            return error_response(400, f'Missing required fields: {", ".join(missing_fields)}')
        
        query = body['query']
        max_results = body.get('max_results', 10)
        kb_id = body.get('knowledge_base_id', knowledge_base_id)
        
        if not kb_id:
            return error_response(400, 'Knowledge Base ID not configured')
        
        # Validate max_results
        if not isinstance(max_results, int) or max_results < 1 or max_results > 50:
            max_results = 10
        
        logger.info(f"Performing hybrid search for query: {query[:100]}...")
        
        # Perform hybrid search using Knowledge Base
        try:
            response = bedrock_agent.retrieve(
                knowledgeBaseId=kb_id,
                retrievalQuery={
                    'text': query
                },
                retrievalConfiguration={
                    'vectorSearchConfiguration': {
                        'numberOfResults': max_results,
                        'overrideSearchType': 'HYBRID'  # Use hybrid search
                    }
                }
            )
            
            # Process retrieval results
            retrieval_results = []
            if 'retrievalResults' in response:
                for result in response['retrievalResults']:
                    retrieval_result = {
                        'content': result.get('content', {}).get('text', ''),
                        'score': result.get('score', 0.0),
                        'location': '',
                        'metadata': {}
                    }
                    
                    # Extract location information
                    if 'location' in result:
                        location_info = result['location']
                        if 's3Location' in location_info:
                            retrieval_result['location'] = location_info['s3Location'].get('uri', '')
                    
                    # Extract metadata
                    if 'metadata' in result:
                        retrieval_result['metadata'] = result['metadata']
                    
                    retrieval_results.append(retrieval_result)
            
            # Sort by relevance score (descending)
            retrieval_results.sort(key=lambda x: x['score'], reverse=True)
            
            logger.info(f"Retrieved {len(retrieval_results)} results from Knowledge Base")
            
            # Generar respuesta conversacional basada en los resultados
            conversational_response = generate_conversational_response(query, retrieval_results, body)
            
            return success_response({
                'query': query,
                'knowledge_base_id': kb_id,
                'results_count': len(retrieval_results),
                'retrieval_results': retrieval_results,
                'response': conversational_response,
                'search_type': 'hybrid'
            })
            
        except Exception as e:
            logger.error(f"Knowledge Base search error: {str(e)}")
            return error_response(500, 'Knowledge Base search failed', str(e))
        
    except Exception as e:
        logger.error(f"Error: {str(e)}")
        return error_response(500, 'Internal server error', str(e))

def filter_results_by_relevance(results: List[Dict], min_score: float = 0.3) -> List[Dict]:
    """Filter results by minimum relevance score"""
    return [result for result in results if result.get('score', 0) >= min_score]

def extract_key_concepts(results: List[Dict]) -> List[str]:
    """Extract key concepts from search results"""
    concepts = set()
    
    for result in results:
        content = result.get('content', '').lower()
        # Simple keyword extraction (could be enhanced with NLP)
        keywords = ['test', 'testing', 'requirement', 'functional', 'case', 'scenario', 
                   'validation', 'verification', 'quality', 'qa', 'bug', 'defect']
        
        for keyword in keywords:
            if keyword in content:
                concepts.add(keyword)
    
    return list(concepts)

def generate_conversational_response(query: str, retrieval_results: List[Dict], body: Dict) -> str:
    """Generar respuesta conversacional usando Claude Sonnet 4 con historial"""
    
    logger.info(f"=== GENERATE_CONVERSATIONAL_RESPONSE CALLED ===")
    logger.info(f"Query received: {query}")
    logger.info(f"Session ID: {body.get('session_id')}")
    logger.info(f"Plan context available: {bool(body.get('plan_context'))}")
    logger.info(f"Conversation history length: {len(body.get('conversation_history', []))}")
    
    # Preparar contexto del plan con casos de prueba completos
    plan_info = body.get('plan_context')
    context_text = ""
    
    if plan_info:
        context_text = f"El usuario tiene un plan de pruebas llamado '{plan_info.get('plan_title', 'Sin título')}' de tipo {plan_info.get('plan_type', 'No especificado')} con {plan_info.get('test_cases_count', 0)} casos de prueba generados."
        
        # Agregar información detallada de los casos de prueba
        test_cases = plan_info.get('test_cases', [])
        if test_cases:
            context_text += "\n\nCasos de prueba del plan:\n"
            for case in test_cases:
                context_text += f"""
Caso {case.get('number', 'N/A')}: {case.get('name', 'Sin nombre')}
- Descripción: {case.get('description', 'Sin descripción')}
- Prioridad: {case.get('priority', 'No especificada')}
- Precondiciones: {case.get('preconditions', 'N/A')}
- Pasos: {case.get('test_steps', 'N/A')}
- Resultados esperados: {case.get('expected_results', 'N/A')}
- Datos de prueba: {case.get('test_data', 'N/A')}
- Requisitos: {case.get('requirements', 'N/A')}
"""
    
    # Intentar llamar a Claude con historial conversacional
    try:
        bedrock_runtime = boto3.client('bedrock-runtime')
        model_id = os.environ.get('BEDROCK_MODEL_ID', 'arn:aws:bedrock:eu-west-1:701055077130:inference-profile/eu.anthropic.claude-sonnet-4-20250514-v1:0')
        
        logger.info(f"Attempting Claude call with model: {model_id}")
        
        # Preparar mensajes con historial conversacional
        messages = []
        
        # Agregar historial de conversación si existe
        conversation_history = body.get('conversation_history', [])
        for msg in conversation_history:
            if msg.get('role') in ['user', 'assistant']:
                messages.append({
                    "role": msg['role'],
                    "content": msg['content']
                })
        
        # Agregar el mensaje actual del usuario
        messages.append({
            "role": "user",
            "content": query
        })
        
        # System prompt con contexto
        system_prompt = f"""Eres un experto en testing de software y planes de prueba. Mantén una conversación natural y útil.

{context_text}

Características:
- Conversacional y amigable, pero profesional
- Recuerda el contexto de la conversación anterior
- Proporciona consejos específicos sobre testing
- Sugiere mejoras cuando sea apropiado"""
        
        logger.info(f"Sending {len(messages)} messages to Claude")
        
        response = bedrock_runtime.invoke_model(
            modelId=model_id,
            body=json.dumps({
                "anthropic_version": "bedrock-2023-05-31",
                "max_tokens": 800,
                "system": system_prompt,
                "messages": messages,
                "temperature": 0.5
            })
        )
        
        response_body = json.loads(response['body'].read())
        claude_response = response_body['content'][0]['text']
        
        logger.info(f"Claude response successful: {len(claude_response)} chars")
        return claude_response.strip()
        
    except Exception as e:
        logger.error(f"Claude call failed: {type(e).__name__}: {str(e)}")
        
        # Fallback funcional (sabemos que funciona)
        if "hola" in query.lower():
            if plan_info:
                return f"¡Hola! Veo que estás trabajando en el plan '{plan_info.get('plan_title', 'Sin título')}' con {plan_info.get('test_cases_count', 0)} casos de prueba de tipo {plan_info.get('plan_type', 'No especificado')}. ¿En qué puedo ayudarte?"
            else:
                return "¡Hola! Soy tu asistente especializado en testing. ¿En qué puedo ayudarte?"
        
        if plan_info:
            return f"Entiendo tu consulta sobre '{query}'. Basándome en tu plan '{plan_info.get('plan_title', 'Sin título')}' con {plan_info.get('test_cases_count', 0)} casos de tipo {plan_info.get('plan_type', 'No especificado')}, puedo ayudarte con análisis y mejoras. ¿Qué aspecto específico te interesa?"
        
        return f"He recibido tu consulta: '{query}'. Como experto en testing, puedo ayudarte con planes de prueba, casos de prueba y mejores prácticas. ¿Podrías ser más específico?"

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
