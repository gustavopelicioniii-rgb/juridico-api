/**
 * Serviço de Tribunal
 * Orquestra a busca de processos usando os adaptadores e salva no banco
 */

import { registry, DadosProcesso } from '../tribunais';
import Tribunal from '../models/Tribunal';
import Processo from '../models/Processo';
import Parte from '../models/Parte';
import Movimentacao from '../models/Movimentacao';
import Job from '../models/Job';
import { sequelize } from '../config/database';
import { Transaction } from 'sequelize';
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
   * Usa transação para garantir atomicidade em partes + movimentações
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

    const dadosProcesso = await adapter.buscarProcesso(numeroProcesso);

    const tribunal = await Tribunal.findOne({ where: { codigo: tribunalCodigo } });

    if (!tribunal) {
      throw new Error(`Tribunal não encontrado no banco: ${tribunalCodigo}`);
    }

    return sequelize.transaction(async (t: Transaction) => {
      const processoExistente = await Processo.findOne({
        where: { numeroProcesso: dadosProcesso.numeroProcesso },
        transaction: t,
      });

      const ehNovo = !processoExistente;
      let processo: Processo;

      if (ehNovo) {
        processo = await Processo.create(
          {
            numeroProcesso: dadosProcesso.numeroProcesso,
            tribunalId: tribunal.id,
            advogadoId: advogadoId || '00000000-0000-0000-0000-000000000000',
            status: 'MONITORANDO',
            classe: dadosProcesso.classe,
            classeCodigo: dadosProcesso.classeCodigo,
            assunto: dadosProcesso.assunto,
            assuntoPrincipal: dadosProcesso.assuntoPrincipal,
            instancia: dadosProcesso.instancia || 'PRIMEIRA',
            primeiraInstancia: dadosProcesso.dataDistribuicao,
            dataAjuizamento: dadosProcesso.dataAjuizamento,
            valorCausa: dadosProcesso.valorCausa,
            orgaoJulgador: dadosProcesso.orgaoJulgador,
            orgaoJulgadorCodigo: dadosProcesso.orgaoJulgadorCodigo,
            nivelSigilo: dadosProcesso.nivelSigilo,
            sistema: dadosProcesso.sistema,
            formato: dadosProcesso.formato,
            ultimaMovimentacao:
              dadosProcesso.movimentacoes.length > 0
                ? dadosProcesso.movimentacoes[dadosProcesso.movimentacoes.length - 1].data
                : undefined,
            dadosOriginais: dadosProcesso.dadosOriginais,
          },
          { transaction: t }
        );

        logger.info(`Novo processo criado: ${processo.numeroProcesso}`);
      } else {
        processo = processoExistente;
        await processo.update(
          {
            classe: dadosProcesso.classe || processo.classe,
            assunto: dadosProcesso.assunto || processo.assunto,
            assuntoPrincipal: dadosProcesso.assuntoPrincipal || processo.assuntoPrincipal,
            ultimaMovimentacao:
              dadosProcesso.movimentacoes.length > 0
                ? dadosProcesso.movimentacoes[dadosProcesso.movimentacoes.length - 1].data
                : processo.ultimaMovimentacao,
            valorCausa: dadosProcesso.valorCausa || processo.valorCausa,
            orgaoJulgador: dadosProcesso.orgaoJulgador || processo.orgaoJulgador,
            nivelSigilo: dadosProcesso.nivelSigilo ?? processo.nivelSigilo,
            dadosOriginais: dadosProcesso.dadosOriginais,
          },
          { transaction: t }
        );

        logger.info(`Processo atualizado: ${processo.numeroProcesso}`);
      }

      // Salva/atualiza partes atomicamente
      await this.salvarPartes(processo.id, dadosProcesso.partes, t);

      // Salva movimentações atomicamente
      const resultadoMovimentacoes = await this.salvarMovimentacoes(
        processo.id,
        dadosProcesso.movimentacoes,
        t
      );

      return {
        processo,
        ehNovo,
        totalMovimentacoes: dadosProcesso.movimentacoes.length,
        novasMovimentacoes: resultadoMovimentacoes.novas,
      };
    });
  }

  /**
   * Salva partes do processo (dentro de transação)
   */
  private async salvarPartes(
    processoId: string,
    partes: DadosProcesso['partes'],
    t: Transaction
  ): Promise<void> {
    await Parte.destroy({ where: { processoId }, transaction: t });

    const partesData = partes.map(p => ({
      processoId,
      nome: p.nome,
      tipo: p.tipo,
      documento: p.documento,
      isAdvogado: p.isAdvogado,
    }));

    if (partesData.length > 0) {
      await Parte.bulkCreate(partesData, { transaction: t });
    }
  }

  /**
   * Salva movimentações (apenas as que ainda não existem, dentro de transação)
   */
  private async salvarMovimentacoes(
    processoId: string,
    movimentacoes: DadosProcesso['movimentacoes'],
    t: Transaction
  ): Promise<{ novas: number; total: number }> {
    const ultimaMovimentacao = await Movimentacao.findOne({
      where: { processoId },
      order: [['data', 'DESC']],
      transaction: t,
    });

    const dataUltimaRegistrada = ultimaMovimentacao?.data || new Date(0);

    const movimentacoesNovas = movimentacoes.filter(m => m.data > dataUltimaRegistrada);

    if (movimentacoesNovas.length === 0) {
      return { novas: 0, total: movimentacoes.length };
    }

    // Apenas movimentações dos últimos 30 dias são marcadas como "nova"
    // para evitar marcar todo o histórico como "novo" na primeira vez
    const dataLimiteNova = new Date();
    dataLimiteNova.setDate(dataLimiteNova.getDate() - 30);

    // Deduplica movimentações com mesma data + descrição dentro do mesmo scraping.
    // Isso evita inserir linhas duplicadas quando o tribunal retorna eventos repetidos.
    const chavesMovimentacoes = new Set<string>();
    const movimentacoesSemDuplicidade = movimentacoesNovas.filter((m) => {
      const chave = `${m.data.toISOString()}::${m.descricao.trim().toLowerCase()}`;
      if (chavesMovimentacoes.has(chave)) {
        return false;
      }
      chavesMovimentacoes.add(chave);
      return true;
    });

    const movimentacoesData = movimentacoesSemDuplicidade.map(m => ({
      processoId,
      descricao: m.descricao,
      data: m.data,
      origem: m.origem,
      dadosOriginais: m.dadosOriginais,
      nova: m.data >= dataLimiteNova,
    }));

    await Movimentacao.bulkCreate(movimentacoesData, { transaction: t });

    const totalNovasRecentes = movimentacoesData.filter(m => m.nova).length;
    const totalDuplicadasIgnoradas = movimentacoesNovas.length - movimentacoesSemDuplicidade.length;
    logger.info(
      `Salvas ${movimentacoesSemDuplicidade.length} movimentações para processo ${processoId} (${totalNovasRecentes} recentes, ${totalDuplicadasIgnoradas} duplicadas ignoradas)`
    );

    return { novas: movimentacoesSemDuplicidade.length, total: movimentacoes.length };
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
