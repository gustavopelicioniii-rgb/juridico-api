import OABBuscaCache from '../src/models/OABBuscaCache';
import Processo from '../src/models/Processo';
import { sequelize } from '../src/config/database';
import { Op } from 'sequelize';

const oab = process.argv[2] || '361329SP';
const tribunal = process.argv[3] || 'TJSP';

(async () => {
  await sequelize.authenticate();
  const entry = await OABBuscaCache.findOne({ where: { oab, tribunalCodigo: tribunal } });
  if (!entry) {
    console.log('[]');
    process.exit(0);
  }
  const nums = (entry.resultadoJson?.numerosProcessos as string[]) || [];
  const rows = await Processo.findAll({ where: { numeroProcesso: { [Op.in]: nums } } });
  const byNum = new Map(rows.map((r) => [r.numeroProcesso, r]));
  const out = nums.map((n) => {
    const r = byNum.get(n);
    return r
      ? {
          numeroProcesso: r.numeroProcesso,
          classe: r.classe,
          assunto: r.assunto,
          assuntoPrincipal: r.assuntoPrincipal,
          orgaoJulgador: r.orgaoJulgador,
          dataAjuizamento: r.dataAjuizamento,
          ultimaMovimentacao: r.ultimaMovimentacao,
          valorCausa: r.valorCausa,
        }
      : { numeroProcesso: n };
  });
  console.log(JSON.stringify(out));
  process.exit(0);
})();
