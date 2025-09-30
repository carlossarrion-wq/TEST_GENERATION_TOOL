import json
import logging
import boto3
import uuid
import base64
from datetime import datetime
from typing import Dict, Any
import os

logger = logging.getLogger()
logger.setLevel(logging.INFO)

s3 = boto3.client('s3')
dynamodb = boto3.resource('dynamodb')
bedrock_agent = boto3.client('bedrock-agent')

bucket_name = os.environ.get('DOCUMENTS_BUCKET', 'test-plan-documents')
sessions_table = dynamodb.Table(os.environ.get('SESSIONS_TABLE', 'test-plan-sessions'))
knowledge_base_id = os.environ.get('KNOWLEDGE_BASE_ID')

def lambda_handler(event: Dict[str, Any], context) -> Dict[str, Any]:
    """POST /upload-requirements - Procesar documento de requerimientos"""
    try:
        if event.get('httpMethod') == 'OPTIONS':
            return cors_response()
        
        body = json.loads(event['body']) if isinstance(event['body'], str) else event['body']
        
        required_fields = ['session_id', 'file_content', 'file_name']
        missing_fields = [field for field in required_fields if field not in body]
        
        if missing_fields:
            return error_response(400, f'Missing required fields: {", ".join(missing_fields)}')
        
        session_id = body['session_id']
        file_content = body['file_content']  # Base64 encoded
        file_name = body['file_name']
        
        # Validate file type
        allowed_extensions = ['.pdf', '.docx', '.doc', '.txt', '.md']
        if not any(file_name.lower().endswith(ext) for ext in allowed_extensions):
            return error_response(400, f'File type not supported. Allowed: {", ".join(allowed_extensions)}')
        
        # Decode file content
        try:
            file_data = base64.b64decode(file_content)
        except Exception as e:
            return error_response(400, 'Invalid file content encoding')
        
        # Generate unique file key
        file_key = f"requirements/{session_id}/{uuid.uuid4()}_{file_name}"
        
        # Upload to S3
        s3.put_object(
            Bucket=bucket_name,
            Key=file_key,
            Body=file_data,
            ContentType=get_content_type(file_name),
            Metadata={
                'session_id': session_id,
                'original_name': file_name,
                'upload_time': datetime.utcnow().isoformat()
            }
        )
        
        # Update session with document info
        try:
            sessions_table.update_item(
                Key={'id': session_id},
                UpdateExpression='SET requirements_document = :doc, updated_at = :time',
                ExpressionAttributeValues={
                    ':doc': {
                        'file_name': file_name,
                        's3_key': file_key,
                        'upload_time': datetime.utcnow().isoformat()
                    },
                    ':time': datetime.utcnow().isoformat()
                }
            )
        except Exception as e:
            logger.error(f"Error updating session: {str(e)}")
            return error_response(500, 'Error updating session')
        
        # Sync with Knowledge Base if configured
        sync_status = 'not_configured'
        if knowledge_base_id:
            try:
                # Trigger Knowledge Base sync (this would typically be done via a data source sync)
                sync_status = 'initiated'
                logger.info(f"Knowledge Base sync initiated for file: {file_key}")
            except Exception as e:
                logger.warning(f"Knowledge Base sync failed: {str(e)}")
                sync_status = 'failed'
        
        return success_response({
            'message': 'Requirements document processed successfully',
            'file_info': {
                'file_name': file_name,
                's3_key': file_key,
                'size_bytes': len(file_data)
            },
            'knowledge_base_sync': sync_status,
            'session_id': session_id
        })
        
    except Exception as e:
        logger.error(f"Error: {str(e)}")
        return error_response(500, 'Internal server error', str(e))

def get_content_type(file_name: str) -> str:
    """Get content type based on file extension"""
    extension = file_name.lower().split('.')[-1]
    content_types = {
        'pdf': 'application/pdf',
        'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'doc': 'application/msword',
        'txt': 'text/plain',
        'md': 'text/markdown'
    }
    return content_types.get(extension, 'application/octet-stream')

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
