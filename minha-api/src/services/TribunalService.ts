/**
 * Serviço de Tribunal
 * Orquestra a busca de processos usando os adaptadores e salva no banco
 */

import { Op } from 'sequelize';
import { registry, DadosProcesso, ITribunalAdapter } from '../tribunais';
import Tribunal from '../models/Tribunal';
import Processo from '../models/Processo';
import Parte from '../models/Parte';
import Movimentacao from '../models/Movimentacao';
import Job from '../models/Job';
import logger from '../config/logger';

export interface ResultadoBuscaProcesso {
  processo: Processo;
  ehNovo: boolean;
  totalMovimentacoes: number;
  novasMovimentacoes: number;
}

class TribunalService {
  /**
   * Busca um processo pelo número e salva/atualiza no banco
   */
  async buscarESalvarProcesso(
    numeroProcesso: string,
    tribunalCodigo: string,
    advogadoId?: string
  ): Promise<ResultadoBuscaProcesso> {
    const adapter = registry.get(tribunalCodigo);
    
    if (!adapter) {
      throw new Error(`Tribunal não suportado: ${tribunalCodigo}`);
    }
    
    logger.info(`Buscando processo ${numeroProcesso} no ${tribunalCodigo}`);
    
    // Busca dados do processo via adapter
    const dadosProcesso = await adapter.buscarProcesso(numeroProcesso);
    
    // Busca tribunal no banco
    const tribunal = await Tribunal.findOne({
      where: { codigo: tribunalCodigo },
    });
    
    if (!tribunal) {
      throw new Error(`Tribunal não encontrado no banco: ${tribunalCodigo}`);
    }
    
    // Verifica se processo já existe
    const processoExistente = await Processo.findOne({
      where: { numeroProcesso: dadosProcesso.numeroProcesso },
    });
    
    const ehNovo = !processoExistente;
    let processo: Processo;
    
    if (ehNovo) {
      // Cria novo processo
      processo = await Processo.create({
        numeroProcesso: dadosProcesso.numeroProcesso,
        tribunalId: tribunal.id,
        advogadoId: advogadoId || '00000000-0000-0000-0000-000000000000', // UUID placeholder
        status: 'MONITORANDO',
        classe: dadosProcesso.classe,
        assunto: dadosProcesso.assunto,
        instancia: dadosProcesso.instancia || 'PRIMEIRA',
        primeiraInstancia: dadosProcesso.dataDistribuicao,
        ultimaMovimentacao: dadosProcesso.movimentacoes.length > 0
          ? dadosProcesso.movimentacoes[dadosProcesso.movimentacoes.length - 1].data
          : undefined,
        dadosOriginais: dadosProcesso.dadosOriginais,
      });
      
      logger.info(`Novo processo criado: ${processo.numeroProcesso}`);
    } else {
      // Atualiza processo existente
      processo = processoExistente;
      await processo.update({
        classe: dadosProcesso.classe || processo.classe,
        assunto: dadosProcesso.assunto || processo.assunto,
        ultimaMovimentacao: dadosProcesso.movimentacoes.length > 0
          ? dadosProcesso.movimentacoes[dadosProcesso.movimentacoes.length - 1].data
          : processo.ultimaMovimentacao,
        dadosOriginais: dadosProcesso.dadosOriginais,
      });
      
      logger.info(`Processo atualizado: ${processo.numeroProcesso}`);
    }
    
    // Salva/atualiza partes
    await this.salvarPartes(processo.id, dadosProcesso.partes);
    
    // Salva movimentações (apenas as novas)
    const resultadoMovimentacoes = await this.salvarMovimentacoes(
      processo.id,
      dadosProcesso.movimentacoes
    );
    
    return {
      processo,
      ehNovo,
      totalMovimentacoes: dadosProcesso.movimentacoes.length,
      novasMovimentacoes: resultadoMovimentacoes.novas,
    };
  }
  
  /**
   * Salva partes do processo
   */
  private async salvarPartes(processoId: string, partes: DadosProcesso['partes']): Promise<void> {
    // Remove partes existentes
    await Parte.destroy({ where: { processoId } });
    
    // Insere novas partes
    const partesData = partes.map(p => ({
      processoId,
      nome: p.nome,
      tipo: p.tipo,
      documento: p.documento,
      isAdvogado: p.isAdvogado,
    }));
    
    if (partesData.length > 0) {
      await Parte.bulkCreate(partesData);
    }
  }
  
  /**
   * Salva movimentações (apenas as que ainda não existem)
   */
  private async salvarMovimentacoes(
    processoId: string,
    movimentacoes: DadosProcesso['movimentacoes']
  ): Promise<{ novas: number; total: number }> {
    // Obtém última movimentação registrada
    const ultimaMovimentacao = await Movimentacao.findOne({
      where: { processoId },
      order: [['data', 'DESC']],
    });
    
    const dataUltimaRegistrada = ultimaMovimentacao?.data || new Date(0);
    
    // Filtra apenas movimentações novas (mais recentes que a última registrada)
    const movimentacoesNovas = movimentacoes.filter(m => m.data > dataUltimaRegistrada);
    
    if (movimentacoesNovas.length === 0) {
      return { novas: 0, total: movimentacoes.length };
    }
    
    // Insere novas movimentações
    const movimentacoesData = movimentacoesNovas.map(m => ({
      processoId,
      descricao: m.descricao,
      data: m.data,
      origem: m.origem,
      dadosOriginais: m.dadosOriginais,
      nova: true, // Marca como nova para notificação
    }));
    
    await Movimentacao.bulkCreate(movimentacoesData);
    
    logger.info(`Salvas ${movimentacoesNovas.length} novas movimentações para processo ${processoId}`);
    
    return { novas: movimentacoesNovas.length, total: movimentacoes.length };
  }
  
  /**
   * Busca processos por OAB
   */
  async buscarPorOAB(
    oab: string,
    nome?: string,
    advogadoId?: string
  ): Promise<Processo[]> {
    const tribunais = registry.listar();
    const processosEncontrados: Processo[] = [];
    
    for (const { codigo } of tribunais) {
      const adapter = registry.get(codigo);
      if (!adapter) continue;
      
      try {
        const resultado = await adapter.buscarPorOAB(oab, nome);
        
        for (const proc of resultado.processos) {
          // Busca/salva cada processo encontrado
          try {
            const resultadoProcesso = await this.buscarESalvarProcesso(
              proc.numeroProcesso,
              codigo,
              advogadoId
            );
            processosEncontrados.push(resultadoProcesso.processo);
          } catch (error) {
            logger.warn(`Falha ao processar processo ${proc.numeroProcesso}: ${error}`);
          }
        }
      } catch (error) {
        logger.warn(`Falha ao buscar no tribunal ${codigo}: ${error}`);
      }
    }
    
    return processosEncontrados;
  }
  
  /**
   * Atualiza processo (busca dados mais recentes)
   */
  async atualizarProcesso(processoId: string): Promise<ResultadoBuscaProcesso> {
    const processo = await Processo.findByPk(processoId);
    
    if (!processo) {
      throw new Error(`Processo não encontrado: ${processoId}`);
    }
    
    // Busca tribunal associado
    const tribunal = await Tribunal.findByPk(processo.tribunalId);
    
    if (!tribunal || !tribunal.ativo) {
      throw new Error(`Tribunal não encontrado para o processo: ${processoId}`);
    }
    
    return this.buscarESalvarProcesso(
      processo.numeroProcesso,
      tribunal.codigo,
      processo.advogadoId !== '00000000-0000-0000-0000-000000000000' ? processo.advogadoId : undefined
    );
  }
  
  /**
   * Lista tribunais disponíveis
   */
  async listarTribunais(): Promise<Array<{ codigo: string; nome: string; tipo: string; ativo: boolean }>> {
    const tribunais = await Tribunal.findAll({ where: { ativo: true } });
    return tribunais.map(t => ({
      codigo: t.codigo,
      nome: t.nome,
      tipo: t.tipo,
      ativo: t.ativo,
    }));
  }
  
  /**
   * Cria job de scraping para um processo
   */
  async criarJobScraping(processoId: string, tipo: 'SCRAPE' | 'RETRY' = 'SCRAPE'): Promise<Job> {
    const processo = await Processo.findByPk(processoId);
    
    if (!processo) {
      throw new Error(`Processo não encontrado: ${processoId}`);
    }
    
    return Job.create({
      processoId,
      tipo,
      status: 'PENDENTE',
      payload: { numeroProcesso: processo.numeroProcesso },
      scheduledAt: new Date(),
      tentativas: 0,
      maxTentativas: 3,
    });
  }
  
  /**
   * Marca movimentações como visualizadas
   */
  async marcarMovimentacoesVisualizadas(processoId: string): Promise<number> {
    const [updated] = await Movimentacao.update(
      { nova: false },
      { where: { processoId, nova: true } }
    );
    
    return updated;
  }
}

export default new TribunalService();
