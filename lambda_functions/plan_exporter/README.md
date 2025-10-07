# Plan Exporter Lambda Function

Esta función Lambda maneja la exportación de planes de prueba en múltiples formatos.

## Funcionalidad

- **Endpoint**: `POST /export-plan`
- **Formatos soportados**: Excel (.xlsx), PDF, JSON, CSV
- **Almacenamiento**: S3 con URLs pre-firmadas
- **Fallback**: Base64 si S3 no está disponible

## Parámetros de entrada

```json
{
  "session_id": "uuid-de-la-sesion",
  "format": "excel|pdf|json|csv",
  "include_metadata": true
}
```

## Respuesta

```json
{
  "download_url": "https://s3-presigned-url-or-data-url",
  "file_name": "plan_20241006_143000.xlsx",
  "expires_at": "2024-10-06T15:30:00Z",
  "format": "excel",
  "file_size": 15420
}
```

## Dependencias

- `boto3`: Cliente AWS
- `openpyxl`: Generación de archivos Excel
- `reportlab`: Generación de archivos PDF

## Variables de entorno

- `SESSIONS_TABLE`: Tabla DynamoDB de sesiones
- `S3_BUCKET`: Bucket S3 para almacenar archivos

## Instalación de dependencias

```bash
pip install -r requirements.txt
```

## Despliegue

1. Crear la función Lambda en AWS
2. Configurar las variables de entorno
3. Asignar permisos para DynamoDB y S3
4. Configurar el endpoint en API Gateway

## Permisos IAM requeridos

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "dynamodb:GetItem"
      ],
      "Resource": "arn:aws:dynamodb:*:*:table/test-plan-sessions"
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject"
      ],
      "Resource": "arn:aws:s3:::test-plan-exports/*"
    }
  ]
}
