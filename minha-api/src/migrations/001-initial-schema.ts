import { QueryInterface, DataTypes } from 'sequelize';

const normalizeTableName = (table: unknown): string => {
  if (typeof table === 'string') return table;
  if (table && typeof table === 'object' && 'tableName' in table) {
    return String((table as { tableName: string }).tableName);
  }
  return String(table);
};

const addIndexIfMissing = async (
  context: QueryInterface,
  tableName: string,
  fields: string[],
  existingIndexes: string[]
) => {
  const indexName = `${tableName}_${fields.join('_')}`;
  if (!existingIndexes.includes(indexName)) {
    await context.addIndex(tableName, fields, { name: indexName });
  }
};

export const up = async ({ context }: { context: QueryInterface }) => {
  const existingTablesRaw = await context.showAllTables();
  const existingTables = new Set(existingTablesRaw.map(normalizeTableName));
  const hasTable = (name: string) => existingTables.has(name);

  if (!hasTable('advogados')) {
    await context.createTable('advogados', {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      oab: { type: DataTypes.STRING(20), allowNull: false, unique: true },
      nome: { type: DataTypes.STRING(255), allowNull: false },
      email: { type: DataTypes.STRING(255), allowNull: true },
      password_hash: { type: DataTypes.STRING(255), allowNull: true },
      ativo: { type: DataTypes.BOOLEAN, defaultValue: true },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    });
    existingTables.add('advogados');
  }

  if (!hasTable('tribunais')) {
    await context.createTable('tribunais', {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      codigo: { type: DataTypes.STRING(10), allowNull: false, unique: true },
      nome: { type: DataTypes.STRING(100), allowNull: false },
      base_url: { type: DataTypes.TEXT, allowNull: false },
      tipo: { type: DataTypes.ENUM('TJ', 'STJ', 'STF', 'TRT', 'TRF'), allowNull: false },
      usa_captcha: { type: DataTypes.BOOLEAN, defaultValue: false },
      scraper_config: { type: DataTypes.JSONB, allowNull: true },
      ativo: { type: DataTypes.BOOLEAN, defaultValue: true },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    });
    existingTables.add('tribunais');
  }

  if (!hasTable('processos')) {
    await context.createTable('processos', {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      numero_processo: { type: DataTypes.STRING(50), allowNull: false, unique: true },
      tribunal_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: 'tribunais', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      advogado_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: 'advogados', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      classe: { type: DataTypes.STRING(255), allowNull: true },
      classe_codigo: { type: DataTypes.INTEGER, allowNull: true },
      assunto: { type: DataTypes.TEXT, allowNull: true },
      assunto_principal: { type: DataTypes.STRING(500), allowNull: true },
      instancia: { type: DataTypes.ENUM('PRIMEIRA', 'SEGUNDA', 'SUPERIOR'), defaultValue: 'PRIMEIRA' },
      status: { type: DataTypes.ENUM('MONITORANDO', 'ARQUIVADO', 'ENCERRADO', 'ERRO'), defaultValue: 'MONITORANDO' },
      primeira_instancia: { type: DataTypes.DATE, allowNull: true },
      ultima_movimentacao: { type: DataTypes.DATE, allowNull: true },
      data_ajuizamento: { type: DataTypes.DATE, allowNull: true },
      valor_causa: { type: DataTypes.BIGINT, allowNull: true },
      orgao_julgador: { type: DataTypes.STRING(255), allowNull: true },
      orgao_julgador_codigo: { type: DataTypes.INTEGER, allowNull: true },
      nivel_sigilo: { type: DataTypes.INTEGER, allowNull: true },
      sistema: { type: DataTypes.STRING(100), allowNull: true },
      formato: { type: DataTypes.STRING(50), allowNull: true },
      dados_originais: { type: DataTypes.JSONB, allowNull: true },
      enriquecido: { type: DataTypes.BOOLEAN, defaultValue: false },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    });
    existingTables.add('processos');
  }

  if (!hasTable('partes')) {
    await context.createTable('partes', {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      processo_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'processos', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      tipo: { type: DataTypes.ENUM('AUTOR', 'REU', 'ADVOGADO', 'OUTRO', 'LITISDENUNCIANTE', 'LITISDENUNCIADO', 'TERCEIRO'), allowNull: false },
      nome: { type: DataTypes.STRING(255), allowNull: false },
      documento: { type: DataTypes.STRING(50), allowNull: true },
      is_advogado: { type: DataTypes.BOOLEAN, defaultValue: false },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    });
    existingTables.add('partes');
  }

  if (!hasTable('movimentacoes')) {
    await context.createTable('movimentacoes', {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      processo_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'processos', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      descricao: { type: DataTypes.TEXT, allowNull: false },
      data: { type: DataTypes.DATE, allowNull: false },
      origem: { type: DataTypes.STRING(50), allowNull: true },
      dados_originais: { type: DataTypes.JSONB, allowNull: true },
      nova: { type: DataTypes.BOOLEAN, defaultValue: true },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    });
    existingTables.add('movimentacoes');
  }

  if (!hasTable('jobs')) {
    await context.createTable('jobs', {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      processo_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: 'processos', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      tipo: { type: DataTypes.ENUM('SCRAPE', 'NOTIFY', 'RETRY'), allowNull: false },
      status: { type: DataTypes.ENUM('PENDENTE', 'PROCESSANDO', 'CONCLUIDO', 'FALHO'), defaultValue: 'PENDENTE' },
      payload: { type: DataTypes.JSONB, allowNull: true },
      erro: { type: DataTypes.TEXT, allowNull: true },
      scheduled_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
      started_at: { type: DataTypes.DATE, allowNull: true },
      completed_at: { type: DataTypes.DATE, allowNull: true },
      tentativas: { type: DataTypes.INTEGER, defaultValue: 0 },
      max_tentativas: { type: DataTypes.INTEGER, defaultValue: 3 },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    });
    existingTables.add('jobs');
  }

  if (!hasTable('monitoramentos')) {
    await context.createTable('monitoramentos', {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      advogado_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'advogados', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      processo_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'processos', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      intervalo_minutos: { type: DataTypes.INTEGER, defaultValue: 1440 },
      ativo: { type: DataTypes.BOOLEAN, defaultValue: true },
      ultimo_poll: { type: DataTypes.DATE, allowNull: true },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    });
    existingTables.add('monitoramentos');
  }

  if (!hasTable('notifications')) {
    await context.createTable('notifications', {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      advogado_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'advogados', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      processo_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: 'processos', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      tipo: { type: DataTypes.ENUM('NOVA_MOVIMENTACAO', 'SCRAPING_COMPLETO', 'ERRO_SCRAPING', 'PROCESSO_ATUALIZADO'), allowNull: false },
      mensagem: { type: DataTypes.TEXT, allowNull: false },
      lida: { type: DataTypes.BOOLEAN, defaultValue: false },
      dados: { type: DataTypes.JSONB, allowNull: true },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    });
    existingTables.add('notifications');
  }

  if (!hasTable('oabs_monitoradas')) {
    await context.createTable('oabs_monitoradas', {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      oab: { type: DataTypes.STRING(20), allowNull: false, unique: true },
      ativo: { type: DataTypes.BOOLEAN, defaultValue: true },
      intervalo_minutos: { type: DataTypes.INTEGER, defaultValue: 5 },
      usuario_id: { type: DataTypes.INTEGER, allowNull: true },
      ultima_verificacao: { type: DataTypes.DATE, allowNull: true },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    });
    existingTables.add('oabs_monitoradas');
  }

  for (const tableName of ['advogados', 'tribunais', 'processos', 'partes', 'movimentacoes', 'jobs', 'monitoramentos', 'notifications', 'oabs_monitoradas']) {
    if (!hasTable(tableName)) continue;
    const indexes = await context.showIndex(tableName);
    const existingIndexNames = (indexes as Array<{ name: string }>).map((idx: { name: string }) => idx.name);
    if (tableName === 'advogados') await addIndexIfMissing(context, tableName, ['ativo'], existingIndexNames);
    if (tableName === 'tribunais') {
      await addIndexIfMissing(context, tableName, ['ativo'], existingIndexNames);
      await addIndexIfMissing(context, tableName, ['tipo'], existingIndexNames);
    }
    if (tableName === 'processos') {
      await addIndexIfMissing(context, tableName, ['tribunal_id'], existingIndexNames);
      await addIndexIfMissing(context, tableName, ['advogado_id'], existingIndexNames);
      await addIndexIfMissing(context, tableName, ['status'], existingIndexNames);
      await addIndexIfMissing(context, tableName, ['ultima_movimentacao'], existingIndexNames);
    }
    if (tableName === 'partes') {
      await addIndexIfMissing(context, tableName, ['processo_id'], existingIndexNames);
      await addIndexIfMissing(context, tableName, ['tipo'], existingIndexNames);
    }
    if (tableName === 'movimentacoes') {
      await addIndexIfMissing(context, tableName, ['processo_id', 'data'], existingIndexNames);
      await addIndexIfMissing(context, tableName, ['nova'], existingIndexNames);
    }
    if (tableName === 'jobs') {
      await addIndexIfMissing(context, tableName, ['processo_id'], existingIndexNames);
      await addIndexIfMissing(context, tableName, ['tipo'], existingIndexNames);
      await addIndexIfMissing(context, tableName, ['status', 'scheduled_at'], existingIndexNames);
    }
    if (tableName === 'monitoramentos') {
      await addIndexIfMissing(context, tableName, ['advogado_id', 'ativo'], existingIndexNames);
      await addIndexIfMissing(context, tableName, ['processo_id'], existingIndexNames);
      await addIndexIfMissing(context, tableName, ['ativo'], existingIndexNames);
    }
    if (tableName === 'notifications') {
      await addIndexIfMissing(context, tableName, ['advogado_id', 'lida'], existingIndexNames);
      await addIndexIfMissing(context, tableName, ['processo_id'], existingIndexNames);
      await addIndexIfMissing(context, tableName, ['created_at'], existingIndexNames);
    }
    if (tableName === 'oabs_monitoradas') {
      await addIndexIfMissing(context, tableName, ['ativo'], existingIndexNames);
      await addIndexIfMissing(context, tableName, ['usuario_id'], existingIndexNames);
    }
  }
};

export const down = async ({ context }: { context: QueryInterface }) => {
  const tables = new Set((await context.showAllTables()).map(normalizeTableName));
  const maybeDrop = async (name: string) => {
    if (tables.has(name)) await context.dropTable(name);
  };

  await maybeDrop('oabs_monitoradas');
  await maybeDrop('notifications');
  await maybeDrop('monitoramentos');
  await maybeDrop('jobs');
  await maybeDrop('movimentacoes');
  await maybeDrop('partes');
  await maybeDrop('processos');
  await maybeDrop('tribunais');
  await maybeDrop('advogados');
};
