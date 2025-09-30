import json
import logging
import boto3
from datetime import datetime
from typing import Dict, Any, List
import os

logger = logging.getLogger()
logger.setLevel(logging.INFO)

dynamodb = boto3.resource('dynamodb')
sessions_table = dynamodb.Table(os.environ.get('SESSIONS_TABLE', 'test-plan-sessions'))

def lambda_handler(event: Dict[str, Any], context) -> Dict[str, Any]:
    """POST /calculate-coverage - Calcular métricas de cobertura para un plan de pruebas"""
    try:
        if event.get('httpMethod') == 'OPTIONS':
            return cors_response()
        
        body = json.loads(event['body']) if isinstance(event['body'], str) else event['body']
        
        required_fields = ['session_id']
        missing_fields = [field for field in required_fields if field not in body]
        
        if missing_fields:
            return error_response(400, f'Missing required fields: {", ".join(missing_fields)}')
        
        session_id = body['session_id']
        
        # Obtener la sesión actual
        try:
            response = sessions_table.get_item(Key={'id': session_id})
            if 'Item' not in response:
                return error_response(404, 'Session not found')
            
            session_data = response['Item']
        except Exception as e:
            logger.error(f"Error retrieving session: {str(e)}")
            return error_response(500, 'Error retrieving session data')
        
        # Calcular métricas detalladas de cobertura
        coverage_metrics = calculate_detailed_coverage(session_data)
        
        # Actualizar la sesión con las métricas calculadas
        current_time = datetime.utcnow().isoformat()
        
        try:
            sessions_table.update_item(
                Key={'id': session_id},
                UpdateExpression='SET coverage_metrics = :metrics, updated_at = :updated_at',
                ExpressionAttributeValues={
                    ':metrics': coverage_metrics,
                    ':updated_at': current_time
                }
            )
        except Exception as e:
            logger.error(f"Error updating session with metrics: {str(e)}")
            return error_response(500, 'Error updating session with coverage metrics')
        
        return success_response({
            'session_id': session_id,
            'coverage_metrics': coverage_metrics,
            'status': 'calculated',
            'message': 'Coverage metrics calculated successfully'
        })
        
    except Exception as e:
        logger.error(f"Error: {str(e)}")
        return error_response(500, 'Internal server error', str(e))

def calculate_detailed_coverage(session_data: Dict[str, Any]) -> Dict[str, Any]:
    """Calcular métricas detalladas de cobertura"""
    
    # Inicializar contadores
    total_cases = 0
    cases_by_priority = {'HIGH': 0, 'MEDIUM': 0, 'LOW': 0}
    cases_by_category = {}
    total_estimated_time = 0
    
    # Conjuntos para rastrear requisitos
    all_requirements = set()
    covered_requirements = set()
    requirements_coverage_detail = {}
    
    # Análisis por iteración
    iterations_analysis = []
    
    for i, iteration in enumerate(session_data.get('iterations', [])):
        iteration_metrics = {
            'iteration_number': i + 1,
            'test_cases_count': 0,
            'estimated_time': 0,
            'requirements_covered': set(),
            'priority_distribution': {'HIGH': 0, 'MEDIUM': 0, 'LOW': 0},
            'category_distribution': {}
        }
        
        if 'test_cases' in iteration:
            iteration_metrics['test_cases_count'] = len(iteration['test_cases'])
            total_cases += len(iteration['test_cases'])
            
            for case in iteration['test_cases']:
                # Análisis de prioridad
                priority = case.get('priority', 'MEDIUM')
                cases_by_priority[priority] += 1
                iteration_metrics['priority_distribution'][priority] += 1
                
                # Análisis de categoría
                category = case.get('category', 'FUNCTIONAL')
                cases_by_category[category] = cases_by_category.get(category, 0) + 1
                iteration_metrics['category_distribution'][category] = iteration_metrics['category_distribution'].get(category, 0) + 1
                
                # Tiempo estimado
                estimated_time = case.get('estimated_time', 30)
                total_estimated_time += estimated_time
                iteration_metrics['estimated_time'] += estimated_time
                
                # Análisis de requisitos
                requirements = case.get('requirements_covered', [])
                for req in requirements:
                    all_requirements.add(req)
                    covered_requirements.add(req)
                    iteration_metrics['requirements_covered'].add(req)
                    
                    # Detalle de cobertura por requisito
                    if req not in requirements_coverage_detail:
                        requirements_coverage_detail[req] = {
                            'requirement_id': req,
                            'test_cases': [],
                            'coverage_count': 0
                        }
                    
                    requirements_coverage_detail[req]['test_cases'].append({
                        'case_id': case.get('id'),
                        'case_title': case.get('title'),
                        'priority': priority,
                        'category': category
                    })
                    requirements_coverage_detail[req]['coverage_count'] += 1
        
        # Convertir sets a listas para JSON serialization
        iteration_metrics['requirements_covered'] = list(iteration_metrics['requirements_covered'])
        iterations_analysis.append(iteration_metrics)
    
    # Calcular porcentajes de cobertura
    plan_config = session_data.get('plan_configuration', {})
    target_coverage = plan_config.get('coverage_percentage', 80)
    
    actual_coverage = (len(covered_requirements) / len(all_requirements) * 100) if all_requirements else 0
    coverage_gap = target_coverage - actual_coverage
    
    # Análisis de distribución de prioridades
    priority_percentages = {}
    for priority, count in cases_by_priority.items():
        priority_percentages[priority] = (count / total_cases * 100) if total_cases > 0 else 0
    
    # Análisis de distribución de categorías
    category_percentages = {}
    for category, count in cases_by_category.items():
        category_percentages[category] = (count / total_cases * 100) if total_cases > 0 else 0
    
    # Identificar requisitos sin cobertura
    project_context = session_data.get('project_context', '')
    uncovered_requirements = list(all_requirements - covered_requirements) if all_requirements else []
    
    # Recomendaciones basadas en el análisis
    recommendations = generate_coverage_recommendations(
        actual_coverage, target_coverage, cases_by_priority, 
        cases_by_category, uncovered_requirements
    )
    
    return {
        'summary': {
            'total_test_cases': total_cases,
            'total_requirements': len(all_requirements),
            'covered_requirements': len(covered_requirements),
            'uncovered_requirements': len(uncovered_requirements),
            'target_coverage_percentage': target_coverage,
            'actual_coverage_percentage': round(actual_coverage, 2),
            'coverage_gap': round(coverage_gap, 2),
            'total_estimated_time_minutes': total_estimated_time,
            'total_estimated_time_hours': round(total_estimated_time / 60, 2)
        },
        'priority_analysis': {
            'distribution': cases_by_priority,
            'percentages': {k: round(v, 2) for k, v in priority_percentages.items()}
        },
        'category_analysis': {
            'distribution': cases_by_category,
            'percentages': {k: round(v, 2) for k, v in category_percentages.items()}
        },
        'requirements_detail': list(requirements_coverage_detail.values()),
        'uncovered_requirements': uncovered_requirements,
        'iterations_analysis': iterations_analysis,
        'recommendations': recommendations,
        'calculated_at': datetime.utcnow().isoformat()
    }

def generate_coverage_recommendations(actual_coverage: float, target_coverage: float, 
                                    cases_by_priority: Dict, cases_by_category: Dict, 
                                    uncovered_requirements: List) -> List[str]:
    """Generar recomendaciones basadas en el análisis de cobertura"""
    recommendations = []
    
    # Recomendaciones de cobertura
    if actual_coverage < target_coverage:
        gap = target_coverage - actual_coverage
        recommendations.append(f"La cobertura actual ({actual_coverage:.1f}%) está {gap:.1f}% por debajo del objetivo ({target_coverage}%)")
        
        if uncovered_requirements:
            recommendations.append(f"Se identificaron {len(uncovered_requirements)} requisitos sin cobertura que necesitan casos de prueba")
    
    # Recomendaciones de prioridad
    total_cases = sum(cases_by_priority.values())
    if total_cases > 0:
        high_priority_percentage = (cases_by_priority.get('HIGH', 0) / total_cases) * 100
        if high_priority_percentage < 20:
            recommendations.append("Considere agregar más casos de prueba de alta prioridad para funcionalidades críticas")
        elif high_priority_percentage > 60:
            recommendations.append("El plan tiene muchos casos de alta prioridad. Considere revisar las prioridades")
    
    # Recomendaciones de categoría
    if len(cases_by_category) == 1:
        recommendations.append("El plan se enfoca en una sola categoría. Considere agregar casos de otras categorías para mayor cobertura")
    
    # Recomendaciones generales
    if total_cases < 10:
        recommendations.append("El plan tiene pocos casos de prueba. Considere agregar más casos para mejorar la cobertura")
    elif total_cases > 100:
        recommendations.append("El plan tiene muchos casos de prueba. Considere priorizar y agrupar en fases de ejecución")
    
    return recommendations

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
