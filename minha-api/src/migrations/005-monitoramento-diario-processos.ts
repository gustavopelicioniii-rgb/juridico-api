import { QueryInterface, DataTypes, Op } from 'sequelize';

const TABLE_NAME = 'monitoramentos';
const DAILY_INTERVAL_MINUTES = 1440;

const normalizeTableName = (table: unknown): string => {
  if (typeof table === 'string') return table;
  if (table && typeof table === 'object' && 'tableName' in table) {
    return String((table as { tableName: string }).tableName);
  }
  return String(table);
};

export const up = async ({ context }: { context: QueryInterface }) => {
  const existingTables = new Set((await context.showAllTables()).map(normalizeTableName));
  if (!existingTables.has(TABLE_NAME)) return;

  await context.changeColumn(TABLE_NAME, 'intervalo_minutos', {
    type: DataTypes.INTEGER,
    defaultValue: DAILY_INTERVAL_MINUTES,
  });

  await context.bulkUpdate(
    TABLE_NAME,
    { intervalo_minutos: DAILY_INTERVAL_MINUTES },
    { [Op.or]: [{ intervalo_minutos: null }, { intervalo_minutos: 60 }] }
  );
};

export const down = async ({ context }: { context: QueryInterface }) => {
  const existingTables = new Set((await context.showAllTables()).map(normalizeTableName));
  if (!existingTables.has(TABLE_NAME)) return;

  await context.changeColumn(TABLE_NAME, 'intervalo_minutos', {
    type: DataTypes.INTEGER,
    defaultValue: 60,
  });
};
