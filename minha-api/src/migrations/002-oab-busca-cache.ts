import { QueryInterface, DataTypes } from 'sequelize';

const TABLE_NAME = 'oab_busca_cache';

const normalizeTableName = (table: unknown): string => {
  if (typeof table === 'string') return table;
  if (table && typeof table === 'object' && 'tableName' in table) {
    return String((table as { tableName: string }).tableName);
  }
  return String(table);
};

export const up = async ({ context }: { context: QueryInterface }) => {
  const existingTables = new Set((await context.showAllTables()).map(normalizeTableName));

  if (!existingTables.has(TABLE_NAME)) {
    await context.createTable(TABLE_NAME, {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      oab: { type: DataTypes.STRING(20), allowNull: false },
      tribunal_codigo: { type: DataTypes.STRING(10), allowNull: false },
      resultado_json: { type: DataTypes.JSONB, allowNull: false },
      total_processos: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      criado_em: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      expira_em: { type: DataTypes.DATE, allowNull: false },
    });
  }

  const indexes = await context.showIndex(TABLE_NAME);
  const indexNames = new Set((indexes as Array<{ name: string }>).map((idx) => idx.name));

  if (!indexNames.has('oab_tribunal_unique')) {
    await context.addIndex(TABLE_NAME, ['oab', 'tribunal_codigo'], {
      name: 'oab_tribunal_unique',
      unique: true,
    });
  }

  if (!indexNames.has('oab_busca_cache_oab')) {
    await context.addIndex(TABLE_NAME, ['oab'], { name: 'oab_busca_cache_oab' });
  }

  if (!indexNames.has('oab_busca_cache_expira_em')) {
    await context.addIndex(TABLE_NAME, ['expira_em'], { name: 'oab_busca_cache_expira_em' });
  }
};

export const down = async ({ context }: { context: QueryInterface }) => {
  const existingTables = new Set((await context.showAllTables()).map(normalizeTableName));
  if (existingTables.has(TABLE_NAME)) {
    await context.dropTable(TABLE_NAME);
  }
};
