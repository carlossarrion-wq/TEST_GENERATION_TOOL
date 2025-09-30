import { BedrockAgentClient, ListKnowledgeBasesCommand } from '@aws-sdk/client-bedrock-agent';
import type { IAMUser, KnowledgeBase } from '../types';
import { createLogger } from '../config';

const logger = createLogger('KnowledgeBaseService');

/**
 * Servicio para gestionar Knowledge Bases de AWS Bedrock específicas para Test Plan Generator
 */
export const knowledgeBaseService = {
  /**
   * Obtiene todas las Knowledge Bases disponibles
   * @param credentials Credenciales AWS del usuario
   * @returns Lista de Knowledge Bases
   */
  async listKnowledgeBases(credentials: IAMUser): Promise<KnowledgeBase[]> {
    try {
      logger.info('Obteniendo lista de Knowledge Bases para Test Plan Generator...');
      
      const client = new BedrockAgentClient({
        region: credentials.region,
        credentials: {
          accessKeyId: credentials.accessKeyId,
          secretAccessKey: credentials.secretAccessKey,
          sessionToken: credentials.sessionToken,
        },
      });

      const command = new ListKnowledgeBasesCommand({
        maxResults: 50, // Máximo número de resultados
      });

      const response = await client.send(command);
      
      if (!response.knowledgeBaseSummaries) {
        logger.warn('No se encontraron Knowledge Bases');
        return [];
      }

      const knowledgeBases: KnowledgeBase[] = response.knowledgeBaseSummaries.map(kb => ({
        id: kb.knowledgeBaseId || '',
        name: kb.name || 'Sin nombre',
        description: kb.description,
        status: kb.status || 'UNKNOWN',
        createdAt: kb.createdAt,
        updatedAt: kb.updatedAt,
      }));

      // Filtrar Knowledge Bases relacionadas con testing si es necesario
      const testPlanKnowledgeBases = knowledgeBases.filter(kb => 
        kb.name.toLowerCase().includes('test') || 
        kb.name.toLowerCase().includes('plan') ||
        kb.name.toLowerCase().includes('prueba') ||
        kb.description?.toLowerCase().includes('test') ||
        kb.description?.toLowerCase().includes('plan') ||
        kb.description?.toLowerCase().includes('prueba')
      );

      logger.info(`Se encontraron ${knowledgeBases.length} Knowledge Bases totales, ${testPlanKnowledgeBases.length} relacionadas con testing`);
      
      // Retornar todas las Knowledge Bases, pero loggear las específicas de testing
      return knowledgeBases;
      
    } catch (error) {
      logger.error('Error al obtener Knowledge Bases:', error);
      
      // Manejo específico de errores
      if (error instanceof Error) {
        if (error.message.includes('AccessDenied')) {
          throw new Error('No tienes permisos para acceder a las Knowledge Bases. Verifica tus credenciales AWS.');
        }
        if (error.message.includes('UnauthorizedOperation')) {
          throw new Error('Operación no autorizada. Verifica que tu usuario tenga permisos para Bedrock Agent.');
        }
      }
      
      throw new Error('Error al obtener las Knowledge Bases. Verifica tu conexión y credenciales.');
    }
  },

  /**
   * Obtiene información detallada de una Knowledge Base específica
   * @param credentials Credenciales AWS del usuario
   * @param knowledgeBaseId ID de la Knowledge Base
   * @returns Información detallada de la Knowledge Base
   */
  async getKnowledgeBase(credentials: IAMUser, knowledgeBaseId: string): Promise<KnowledgeBase | null> {
    try {
      logger.info(`Obteniendo información de Knowledge Base: ${knowledgeBaseId}`);
      
      const client = new BedrockAgentClient({
        region: credentials.region,
        credentials: {
          accessKeyId: credentials.accessKeyId,
          secretAccessKey: credentials.secretAccessKey,
          sessionToken: credentials.sessionToken,
        },
      });

      const command = new ListKnowledgeBasesCommand({
        maxResults: 50,
      });

      const response = await client.send(command);
      
      if (!response.knowledgeBaseSummaries) {
        return null;
      }

      const kb = response.knowledgeBaseSummaries.find(
        kb => kb.knowledgeBaseId === knowledgeBaseId
      );

      if (!kb) {
        logger.warn(`Knowledge Base no encontrada: ${knowledgeBaseId}`);
        return null;
      }

      return {
        id: kb.knowledgeBaseId || '',
        name: kb.name || 'Sin nombre',
        description: kb.description,
        status: kb.status || 'UNKNOWN',
        createdAt: kb.createdAt,
        updatedAt: kb.updatedAt,
      };
      
    } catch (error) {
      logger.error('Error al obtener Knowledge Base específica:', error);
      return null;
    }
  },

  /**
   * Valida si una Knowledge Base es adecuada para generación de planes de prueba
   * @param knowledgeBase Knowledge Base a validar
   * @returns true si es adecuada para testing
   */
  validateTestPlanKnowledgeBase(knowledgeBase: KnowledgeBase): boolean {
    const testingKeywords = [
      'test', 'testing', 'plan', 'prueba', 'qa', 'quality',
      'case', 'scenario', 'requirement', 'functional'
    ];

    const name = knowledgeBase.name.toLowerCase();
    const description = knowledgeBase.description?.toLowerCase() || '';

    return testingKeywords.some(keyword => 
      name.includes(keyword) || description.includes(keyword)
    );
  },

  /**
   * Obtiene Knowledge Bases recomendadas para generación de planes de prueba
   * @param credentials Credenciales AWS del usuario
   * @returns Lista de Knowledge Bases recomendadas
   */
  async getRecommendedTestPlanKnowledgeBases(credentials: IAMUser): Promise<KnowledgeBase[]> {
    try {
      const allKnowledgeBases = await this.listKnowledgeBases(credentials);
      
      const recommended = allKnowledgeBases.filter(kb => 
        this.validateTestPlanKnowledgeBase(kb) && kb.status === 'ACTIVE'
      );

      logger.info(`Se encontraron ${recommended.length} Knowledge Bases recomendadas para generación de planes de prueba`);
      
      return recommended;
    } catch (error) {
      logger.error('Error al obtener Knowledge Bases recomendadas:', error);
      throw error;
    }
  },
};
