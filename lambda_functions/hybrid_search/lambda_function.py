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
        
        body = json.loads(event['body']) if isinstance(event['body'], str) else event['body']
        
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
            
            return success_response({
                'query': query,
                'knowledge_base_id': kb_id,
                'results_count': len(retrieval_results),
                'retrieval_results': retrieval_results,
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
