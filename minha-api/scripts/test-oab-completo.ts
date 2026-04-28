/**
 * Teste completo do sistema de busca OAB 361329 SP
 *
 * Demonstra:
 * 1. Busca via DataJud (API CNJ) - rápida
 * 2. Enriquecimento com crawlers ESAJ/PJe (partes, advogados, valor)
 * 3. Identificação de processos novos vs existentes
 * 4. Salvar no banco com dados enriquecidos
 */

import { buscarPorOABEnriquecido, salvarLoteProcessos } from '../src/services/ProcessoEnriquecimentoService';
import monitoramentoService from '../src/services/ProcessoMonitoramentoService';

async function main() {
  const oab = '361329 SP';

  console.log('='.repeat(60));
  console.log(`TESTE COMPLETO - OAB ${oab}`);
  console.log('='.repeat(60));

  // 1. Busca enriquecida (DataJud + crawlers)
  console.log('\n[1] BUSCA ENRIQUECIDA (DataJud + Crawlers)');
  console.log('-'.repeat(40));

  try {
    const resultado = await buscarPorOABEnriquecido(oab, true);

    console.log(`Total de processos encontrados: ${resultado.total}`);
    console.log(`Processos novos: ${resultado.novos.length}`);
    console.log(`Processos já salvos: ${resultado.atualizados.length}`);

    if (resultado.processos.length > 0) {
      console.log('\nPrimeiros 3 processos:');
      resultado.processos.slice(0, 3).forEach((p, i) => {
        console.log(`  ${i + 1}. ${p.numeroProcesso}`);
        console.log(`     Fonte: ${p.fonte} | Enriquecido: ${p.enriquecido}`);
        if (p.dados.classe) console.log(`     Classe: ${p.dados.classe}`);
        if (p.dados.orgaoJulgador) console.log(`     Órgão: ${p.dados.orgaoJulgador}`);
        if (p.dados.valorCausa) console.log(`     Valor: R$ ${p.dados.valorCausa.toLocaleString('pt-BR')}`);
        if (p.dados.partes && p.dados.partes.length > 0) {
          console.log(`     Partes: ${p.dados.partes.map((pa: any) => `${pa.nome} (${pa.tipo})`).join(', ')}`);
        }
        if (p.dados.ultimaMovimentacao) console.log(`     Última mov.: ${p.dados.ultimaMovimentacao.substring(0, 80)}...`);
      });
    }

    // 2. Salvar processos novos
    console.log('\n[2] SALVANDO PROCESSOS NOVOS');
    console.log('-'.repeat(40));

    const novosProcessos = resultado.processos.filter(p =>
      resultado.novos.includes(p.numeroProcesso)
    );

    if (novosProcessos.length > 0) {
      const { salvos, erros } = await salvarLoteProcessos(novosProcessos);
      console.log(`Processos salvos com sucesso: ${salvos}`);
      console.log(`Erros ao salvar: ${erros}`);
    } else {
      console.log('Nenhum processo novo para salvar.');
    }

    // 3. Cadastrar OAB para monitoramento
    console.log('\n[3] CADASTRAR OAB PARA MONITORAMENTO');
    console.log('-'.repeat(40));

    const oabMonitorada = await monitoramentoService.cadastrarOABMonitorada(oab, undefined, 5);
    console.log(`OAB ${oab} cadastrada para monitoramento (intervalo: 5 min)`);

    // 4. Listar OABs monitoradas
    console.log('\n[4] OABs MONITORADAS');
    console.log('-'.repeat(40));

    const monitoradas = await monitoramentoService.listarOABsMonitoradas();
    console.log(`Total de OABs sendo monitoradas: ${monitoradas.length}`);
    monitoradas.forEach((o: any) => {
      console.log(`  - ${o.oab} | Ativo: ${o.ativo} | Intervalo: ${o.intervaloMinutos}min`);
    });

    // 5. Status do monitoramento
    console.log('\n[5] STATUS DO MONITORAMENTO');
    console.log('-'.repeat(40));

    const status = monitoramentoService.getStatus();
    console.log(`Rodando: ${status.rodando}`);
    console.log(`Última execução: ${status.ultimaExecucao || 'nunca'}`);
    console.log(`Total OABs: ${status.oabsMonitoradas}`);
    console.log(`Processos encontrados total: ${status.processosEncontradosTotal}`);
    console.log(`Erros: ${status.erros}`);

  } catch (error: any) {
    console.error(`\nERRO: ${error.message}`);
    console.error(error.stack);
  }

  console.log('\n' + '='.repeat(60));
  console.log('TESTE COMPLETO FINALIZADO');
  console.log('='.repeat(60));
}

main().catch(console.error);
