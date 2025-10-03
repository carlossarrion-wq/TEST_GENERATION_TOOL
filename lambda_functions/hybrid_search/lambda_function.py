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
    """Generar respuesta conversacional basada en los resultados de búsqueda"""
    
    if not retrieval_results:
        return "Lo siento, no encontré información relevante en la Knowledge Base para responder tu consulta."
    
    # Obtener los mejores resultados (score > 0.3)
    relevant_results = [r for r in retrieval_results if r.get('score', 0) > 0.3]
    
    if not relevant_results:
        return "Encontré algunos resultados, pero no parecen muy relevantes para tu consulta. ¿Podrías reformular tu pregunta?"
    
    # Tomar los 3 mejores resultados para generar la respuesta
    top_results = relevant_results[:3]
    
    # Construir respuesta conversacional
    response_parts = []
    
    # Introducción contextual
    if 'caso de prueba' in query.lower() or 'test case' in query.lower():
        response_parts.append("Basándome en las mejores prácticas de testing, te puedo explicar:")
    elif 'prueba unitaria' in query.lower() or 'unit test' in query.lower():
        response_parts.append("Según la documentación de pruebas unitarias:")
    elif 'cobertura' in query.lower() or 'coverage' in query.lower():
        response_parts.append("Respecto a la cobertura de pruebas:")
    else:
        response_parts.append("Basándome en la información disponible:")
    
    # Agregar contenido de los resultados más relevantes
    for i, result in enumerate(top_results):
        content = result.get('content', '').strip()
        if content:
            # Limpiar y formatear el contenido
            content = content.replace('\\u00a0', ' ')  # Reemplazar espacios no-break
            content = content.replace('\\u00bf', '¿')  # Reemplazar caracteres especiales
            content = content.replace('\\u00f3', 'ó')
            content = content.replace('\\u00e9', 'é')
            content = content.replace('\\u00ed', 'í')
            content = content.replace('\\u00f1', 'ñ')
            content = content.replace('\\u00e1', 'á')
            content = content.replace('\\u00fa', 'ú')
            
            # Tomar las primeras 2-3 oraciones más relevantes
            sentences = content.split('.')[:3]
            clean_content = '. '.join(sentences).strip()
            
            if clean_content:
                response_parts.append(f"\n\n**Punto {i+1}:** {clean_content}")
    
    # Agregar información del contexto del plan si está disponible
    current_plan = body.get('current_plan')
    if current_plan and current_plan.get('test_cases'):
        test_cases_count = len(current_plan['test_cases'])
        response_parts.append(f"\n\n💡 **Contexto de tu plan:** Tienes {test_cases_count} casos de prueba generados. ¿Te gustaría que analice alguno específico o que sugiera mejoras?")
    
    # Agregar sugerencias de seguimiento
    if 'ejemplo' in query.lower() or 'example' in query.lower():
        response_parts.append("\n\n¿Te gustaría que te muestre cómo aplicar esto a tu plan específico?")
    elif 'modificar' in query.lower() or 'cambiar' in query.lower():
        response_parts.append("\n\n¿Qué aspectos específicos te gustaría modificar en tu plan?")
    else:
        response_parts.append("\n\n¿Hay algo más específico sobre este tema que te gustaría saber?")
    
    return ''.join(response_parts)

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
