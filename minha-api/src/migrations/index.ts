import path from 'path';
import { Umzug, SequelizeStorage } from 'umzug';
import { sequelize } from '../config/database';

const migrationsDir = path.resolve(__dirname);
const ext = __filename.endsWith('.ts') ? 'ts' : 'js';

export const migrator = new Umzug({
  storage: new SequelizeStorage({ sequelize }),
  context: sequelize.getQueryInterface(),
  logger: console,
  migrations: {
    glob: path.join(migrationsDir, `[0-9]*.${ext}`).replace(/\\/g, '/'),
  },
});

export type Migration = typeof migrator._types.migration;
