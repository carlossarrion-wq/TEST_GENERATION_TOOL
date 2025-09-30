import json
import logging
import boto3
import uuid
from datetime import datetime
from typing import Dict, Any, List
import os
import csv
import io
import base64

logger = logging.getLogger()
logger.setLevel(logging.INFO)

dynamodb = boto3.resource('dynamodb')
s3_client = boto3.client('s3')
sessions_table = dynamodb.Table(os.environ.get('SESSIONS_TABLE', 'test-plan-sessions'))

def lambda_handler(event: Dict[str, Any], context) -> Dict[str, Any]:
    """POST /export-plan - Exportar plan de pruebas en múltiples formatos"""
    try:
        if event.get('httpMethod') == 'OPTIONS':
            return cors_response()
        
        body = json.loads(event['body']) if isinstance(event['body'], str) else event['body']
        
        required_fields = ['session_id', 'export_format']
        missing_fields = [field for field in required_fields if field not in body]
        
        if missing_fields:
            return error_response(400, f'Missing required fields: {", ".join(missing_fields)}')
        
        session_id = body['session_id']
        export_format = body['export_format'].upper()
        
        # Validar formato de exportación
        valid_formats = ['JSON', 'CSV', 'EXCEL', 'PDF']
        if export_format not in valid_formats:
            return error_response(400, f'Invalid export format. Must be one of: {", ".join(valid_formats)}')
        
        # Obtener la sesión actual
        try:
            response = sessions_table.get_item(Key={'id': session_id})
            if 'Item' not in response:
                return error_response(404, 'Session not found')
            
            session_data = response['Item']
        except Exception as e:
            logger.error(f"Error retrieving session: {str(e)}")
            return error_response(500, 'Error retrieving session data')
        
        # Opciones de exportación
        export_options = {
            'include_metrics': body.get('include_metrics', True),
            'include_iterations': body.get('include_iterations', True),
            'include_requirements': body.get('include_requirements', True),
            'filter_by_priority': body.get('filter_by_priority', None),
            'filter_by_category': body.get('filter_by_category', None),
            'custom_fields': body.get('custom_fields', [])
        }
        
        # Generar el contenido exportado según el formato
        if export_format == 'JSON':
            export_content, content_type = export_to_json(session_data, export_options)
            file_extension = 'json'
        elif export_format == 'CSV':
            export_content, content_type = export_to_csv(session_data, export_options)
            file_extension = 'csv'
        elif export_format == 'EXCEL':
            export_content, content_type = export_to_excel(session_data, export_options)
            file_extension = 'xlsx'
        elif export_format == 'PDF':
            export_content, content_type = export_to_pdf(session_data, export_options)
            file_extension = 'pdf'
        
        # Generar nombre de archivo
        plan_title = session_data.get('plan_configuration', {}).get('plan_title', 'test_plan')
        safe_title = "".join(c for c in plan_title if c.isalnum() or c in (' ', '-', '_')).rstrip()
        timestamp = datetime.utcnow().strftime('%Y%m%d_%H%M%S')
        filename = f"{safe_title}_{timestamp}.{file_extension}"
        
        # Subir a S3 si está configurado
        download_url = None
        bucket_name = os.environ.get('EXPORTS_BUCKET')
        
        if bucket_name:
            try:
                s3_key = f"exports/{session_id}/{filename}"
                
                if export_format in ['EXCEL', 'PDF']:
                    # Para archivos binarios
                    s3_client.put_object(
                        Bucket=bucket_name,
                        Key=s3_key,
                        Body=export_content,
                        ContentType=content_type,
                        ContentDisposition=f'attachment; filename="{filename}"'
                    )
                else:
                    # Para archivos de texto
                    s3_client.put_object(
                        Bucket=bucket_name,
                        Key=s3_key,
                        Body=export_content.encode('utf-8'),
                        ContentType=content_type,
                        ContentDisposition=f'attachment; filename="{filename}"'
                    )
                
                # Generar URL de descarga presignada (válida por 1 hora)
                download_url = s3_client.generate_presigned_url(
                    'get_object',
                    Params={'Bucket': bucket_name, 'Key': s3_key},
                    ExpiresIn=3600
                )
                
                logger.info(f"File exported to S3: {s3_key}")
                
            except Exception as e:
                logger.error(f"Error uploading to S3: {str(e)}")
                # Continuar sin S3 si hay error
        
        # Preparar respuesta
        response_data = {
            'session_id': session_id,
            'export_format': export_format,
            'filename': filename,
            'file_size_bytes': len(export_content) if isinstance(export_content, bytes) else len(export_content.encode('utf-8')),
            'download_url': download_url,
            'export_options': export_options,
            'status': 'exported',
            'message': f'Test plan exported successfully in {export_format} format'
        }
        
        # Si no hay S3, incluir el contenido en base64 para formatos pequeños
        if not download_url and export_format in ['JSON', 'CSV']:
            if len(export_content) < 1000000:  # Menos de 1MB
                response_data['content_base64'] = base64.b64encode(export_content.encode('utf-8')).decode('utf-8')
        
        return success_response(response_data)
        
    except Exception as e:
        logger.error(f"Error: {str(e)}")
        return error_response(500, 'Internal server error', str(e))

def export_to_json(session_data: Dict[str, Any], options: Dict[str, Any]) -> tuple:
    """Exportar a formato JSON"""
    
    export_data = {
        'export_info': {
            'exported_at': datetime.utcnow().isoformat(),
            'format': 'JSON',
            'version': '1.0'
        },
        'plan_configuration': session_data.get('plan_configuration', {}),
        'session_info': {
            'id': session_data.get('id'),
            'tester_id': session_data.get('tester_id'),
            'status': session_data.get('status'),
            'created_at': session_data.get('created_at'),
            'updated_at': session_data.get('updated_at')
        }
    }
    
    # Filtrar y procesar casos de prueba
    if options.get('include_iterations', True):
        filtered_iterations = []
        for iteration in session_data.get('iterations', []):
            filtered_cases = filter_test_cases(
                iteration.get('test_cases', []), 
                options.get('filter_by_priority'),
                options.get('filter_by_category')
            )
            
            if filtered_cases:
                filtered_iteration = {
                    'iteration_number': iteration.get('iteration_number'),
                    'created_at': iteration.get('created_at'),
                    'test_cases': filtered_cases
                }
                filtered_iterations.append(filtered_iteration)
        
        export_data['iterations'] = filtered_iterations
    
    # Incluir métricas si se solicita
    if options.get('include_metrics', True):
        export_data['coverage_metrics'] = session_data.get('coverage_metrics', {})
    
    return json.dumps(export_data, indent=2, ensure_ascii=False), 'application/json'

def export_to_csv(session_data: Dict[str, Any], options: Dict[str, Any]) -> tuple:
    """Exportar a formato CSV"""
    
    output = io.StringIO()
    writer = csv.writer(output)
    
    # Encabezados
    headers = [
        'Iteration', 'Case ID', 'Title', 'Description', 'Priority', 'Category',
        'Preconditions', 'Steps', 'Expected Result', 'Estimated Time (min)',
        'Requirements Covered', 'Tags', 'Created At', 'Updated At'
    ]
    
    # Agregar campos personalizados
    if options.get('custom_fields'):
        headers.extend(options['custom_fields'])
    
    writer.writerow(headers)
    
    # Datos
    for iteration in session_data.get('iterations', []):
        filtered_cases = filter_test_cases(
            iteration.get('test_cases', []),
            options.get('filter_by_priority'),
            options.get('filter_by_category')
        )
        
        for case in filtered_cases:
            row = [
                iteration.get('iteration_number', ''),
                case.get('id', ''),
                case.get('title', ''),
                case.get('description', ''),
                case.get('priority', ''),
                case.get('category', ''),
                case.get('preconditions', ''),
                ' | '.join(case.get('steps', [])),
                case.get('expected_result', ''),
                case.get('estimated_time', ''),
                ', '.join(case.get('requirements_covered', [])),
                ', '.join(case.get('tags', [])),
                case.get('created_at', ''),
                case.get('updated_at', '')
            ]
            
            # Agregar campos personalizados
            for field in options.get('custom_fields', []):
                row.append(case.get(field, ''))
            
            writer.writerow(row)
    
    return output.getvalue(), 'text/csv'

def export_to_excel(session_data: Dict[str, Any], options: Dict[str, Any]) -> tuple:
    """Exportar a formato Excel (simulado como CSV mejorado)"""
    # En una implementación real, usarías openpyxl o xlsxwriter
    # Por simplicidad, retornamos CSV con metadata adicional
    
    csv_content, _ = export_to_csv(session_data, options)
    
    # Agregar metadata al inicio
    metadata = f"""# Test Plan Export
# Plan: {session_data.get('plan_configuration', {}).get('plan_title', 'N/A')}
# Type: {session_data.get('plan_configuration', {}).get('plan_type', 'N/A')}
# Exported: {datetime.utcnow().isoformat()}
# Format: Excel (CSV)

"""
    
    return (metadata + csv_content).encode('utf-8'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

def export_to_pdf(session_data: Dict[str, Any], options: Dict[str, Any]) -> tuple:
    """Exportar a formato PDF (simulado como texto estructurado)"""
    # En una implementación real, usarías reportlab o weasyprint
    
    content = []
    content.append("TEST PLAN EXPORT REPORT")
    content.append("=" * 50)
    content.append("")
    
    # Información del plan
    plan_config = session_data.get('plan_configuration', {})
    content.append(f"Plan Title: {plan_config.get('plan_title', 'N/A')}")
    content.append(f"Plan Type: {plan_config.get('plan_type', 'N/A')}")
    content.append(f"Target Coverage: {plan_config.get('coverage_percentage', 'N/A')}%")
    content.append(f"Exported: {datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')}")
    content.append("")
    
    # Métricas si se incluyen
    if options.get('include_metrics') and 'coverage_metrics' in session_data:
        metrics = session_data['coverage_metrics']
        content.append("COVERAGE METRICS")
        content.append("-" * 20)
        if 'summary' in metrics:
            summary = metrics['summary']
            content.append(f"Total Test Cases: {summary.get('total_test_cases', 0)}")
            content.append(f"Coverage: {summary.get('actual_coverage_percentage', 0)}%")
            content.append(f"Estimated Time: {summary.get('total_estimated_time_hours', 0)} hours")
        content.append("")
    
    # Casos de prueba
    content.append("TEST CASES")
    content.append("-" * 20)
    
    for iteration in session_data.get('iterations', []):
        filtered_cases = filter_test_cases(
            iteration.get('test_cases', []),
            options.get('filter_by_priority'),
            options.get('filter_by_category')
        )
        
        if filtered_cases:
            content.append(f"\nIteration {iteration.get('iteration_number', 'N/A')}:")
            
            for i, case in enumerate(filtered_cases, 1):
                content.append(f"\n{i}. {case.get('title', 'Untitled')}")
                content.append(f"   Priority: {case.get('priority', 'N/A')}")
                content.append(f"   Category: {case.get('category', 'N/A')}")
                content.append(f"   Description: {case.get('description', 'N/A')}")
                content.append(f"   Steps: {' | '.join(case.get('steps', []))}")
                content.append(f"   Expected: {case.get('expected_result', 'N/A')}")
    
    pdf_content = "\n".join(content)
    return pdf_content.encode('utf-8'), 'application/pdf'

def filter_test_cases(test_cases: List[Dict], priority_filter: str = None, category_filter: str = None) -> List[Dict]:
    """Filtrar casos de prueba según criterios"""
    filtered_cases = test_cases
    
    if priority_filter:
        filtered_cases = [case for case in filtered_cases if case.get('priority') == priority_filter]
    
    if category_filter:
        filtered_cases = [case for case in filtered_cases if case.get('category') == category_filter]
    
    return filtered_cases

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
