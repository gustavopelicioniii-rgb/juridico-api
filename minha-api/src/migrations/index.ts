import { Umzug, SequelizeStorage } from 'umzug';
import { sequelize } from '../config/database';

export const migrator = new Umzug({
  storage: new SequelizeStorage({ sequelize }),
  context: sequelize.getQueryInterface(),
  logger: console,
  migrations: {
    glob: 'src/migrations/[0-9]*.ts',
  },
});

export type Migration = typeof migrator._types.migration;
