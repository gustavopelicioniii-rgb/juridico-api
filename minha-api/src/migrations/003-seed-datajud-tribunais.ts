import { QueryInterface } from 'sequelize';
import { randomUUID } from 'crypto';
import { listarTribunaisDataJud } from '../config/datajudTribunais';

export const up = async ({ context }: { context: QueryInterface }) => {
  const sequelize = context.sequelize;
  const dialect = sequelize.getDialect();

  if (dialect === 'postgres') {
    await sequelize.query("ALTER TYPE \"enum_tribunais_tipo\" ADD VALUE IF NOT EXISTS 'TSE'");
    await sequelize.query("ALTER TYPE \"enum_tribunais_tipo\" ADD VALUE IF NOT EXISTS 'STM'");
  }

  const now = new Date();
  for (const tribunal of listarTribunaisDataJud()) {
    if (dialect === 'postgres') {
      await sequelize.query(
        `INSERT INTO tribunais
          (id, codigo, nome, base_url, tipo, usa_captcha, scraper_config, ativo, created_at, updated_at)
         VALUES
          (:id, :codigo, :nome, :baseUrl, :tipo, :usaCaptcha, :scraperConfig::jsonb, true, :now, :now)
         ON CONFLICT (codigo) DO UPDATE SET
          nome = EXCLUDED.nome,
          base_url = EXCLUDED.base_url,
          tipo = EXCLUDED.tipo,
          usa_captcha = EXCLUDED.usa_captcha,
          scraper_config = EXCLUDED.scraper_config,
          ativo = true,
          updated_at = EXCLUDED.updated_at`,
        {
          replacements: {
            id: randomUUID(),
            codigo: tribunal.codigo,
            nome: tribunal.nome,
            baseUrl: tribunal.baseUrl,
            tipo: tribunal.tipo,
            usaCaptcha: tribunal.usaCaptcha,
            scraperConfig: JSON.stringify(tribunal.scraperConfig),
            now,
          },
        }
      );
    } else if (dialect === 'sqlite') {
      await sequelize.query(
        `INSERT OR IGNORE INTO tribunais
          (id, codigo, nome, base_url, tipo, usa_captcha, scraper_config, ativo, created_at, updated_at)
         VALUES
          (:id, :codigo, :nome, :baseUrl, :tipo, :usaCaptcha, :scraperConfig, true, :now, :now)`,
        {
          replacements: {
            id: randomUUID(),
            codigo: tribunal.codigo,
            nome: tribunal.nome,
            baseUrl: tribunal.baseUrl,
            tipo: tribunal.tipo,
            usaCaptcha: tribunal.usaCaptcha,
            scraperConfig: JSON.stringify(tribunal.scraperConfig),
            now,
          },
        }
      );
    }
  }
};

export const down = async () => {
  // Intencionalmente sem remoção: estes registros são seeds de referência nacional.
};
