/**
 * Teste de Enriquecimento - OAB 361329 SP Sidney
 */

import { buscarPorOABEnriquecido, salvarLoteProcessos } from '../src/services/ProcessoEnriquecimentoService';

async function main() {
  const oab = '361329 SP';

  console.log('='.repeat(60));
  console.log(`TESTE DE ENRIQUECIMENTO - OAB ${oab}`);
  console.log('='.repeat(60));

  try {
    // 1. Busca e enriquecimento
    console.log('\n[1] BUSCA E ENRIQUECIMENTO');
    console.log('-'.repeat(40));

    const resultado = await buscarPorOABEnriquecido(oab, true);

    console.log(`Total de processos encontrados: ${resultado.total}`);
    console.log(`Processos novos: ${resultado.novos.length}`);
    console.log(`Processos ja salvos: ${resultado.atualizados.length}`);

    if (resultado.processos.length > 0) {
      console.log('\nPrimeiros 3 processos enriquecidos:');
      resultado.processos.slice(0, 3).forEach((p, i) => {
        console.log(`  ${i + 1}. ${p.numeroProcesso}`);
        console.log(`     Fonte: ${p.fonte} | Enriquecido: ${p.enriquecido}`);
        if (p.dados && typeof p.dados === 'object') {
          const d = p.dados as any;
          if (d.classe) console.log(`     Classe: ${d.classe}`);
          if (d.orgaoJulgador) console.log(`     Orgao: ${d.orgaoJulgador}`);
          if (d.valorCausa) console.log(`     Valor: R$ ${d.valorCausa}`);
          if (d.partes && d.partes.length > 0) {
            console.log(`     Partes (${d.partes.length}):`);
            d.partes.slice(0, 2).forEach((pa: any) => {
              console.log(`       - ${pa.nome} (${pa.tipo})`);
              if (pa.advogados && pa.advogados.length > 0) {
                pa.advogados.forEach((adv: any) => {
                  console.log(`         Adv: ${adv.nome} OAB ${adv.numeroOAB}`);
                });
              }
            });
          }
          if (d.movimentacoes && d.movimentacoes.length > 0) {
            console.log(`     Movimentacoes: ${d.movimentacoes.length}`);
          }
        }
      });
    }

    // 2. Salvar processos novos
    console.log('\n[2] SALVANDO PROCESSOS NOVAS');
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

    console.log('\n' + '='.repeat(60));
    console.log('TESTE DE ENRIQUECIMENTO FINALIZADO');
    console.log('='.repeat(60));

  } catch (error: any) {
    console.error(`\nERRO: ${error.message}`);
    console.error(error.stack);
  }
}

main().catch(console.error);
