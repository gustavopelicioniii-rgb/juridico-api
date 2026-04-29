import { Sequelize, Dialect } from 'sequelize';
import dotenv from 'dotenv';

dotenv.config();

interface DatabaseConfig {
  dialect: Dialect;
  storage?: string;
  host?: string;
  port?: number;
  database?: string;
  username?: string;
  password?: string;
  logging?: boolean | ((message: string) => void);
  pool?: {
    max: number;
    min: number;
    acquire: number;
    idle: number;
  };
}

const env = process.env.NODE_ENV || 'development';

const configMap: Record<string, DatabaseConfig> = {
  development: {
    dialect: 'sqlite',
    storage: process.env.DB_STORAGE || './data/database.sqlite',
    logging: console.log,
    pool: {
      max: 5,
      min: 0,
      acquire: 30000,
      idle: 10000,
    },
  },
  production: {
    dialect: 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME || 'juridico_api',
    username: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    logging: false,
    pool: {
      max: 20,
      min: 5,
      acquire: 30000,
      idle: 10000,
    },
  },
  test: {
    dialect: 'sqlite',
    storage: ':memory:',
    logging: false,
  },
};

const dbConfig = configMap[env] || configMap.development;

// Sempre usa DATABASE_URL se existir (production PostgreSQL do Render)
const useUrl = !!process.env.DATABASE_URL;
console.log(`[DB] useUrl=${useUrl}, NODE_ENV=${env}, DATABASE_URL=${useUrl ? 'SET' : 'NOT SET'}`);

export const sequelize = new Sequelize(
  useUrl
    ? {
        url: process.env.DATABASE_URL,
        logging: false,
        pool: dbConfig.pool,
        define: { timestamps: true, underscored: true },
        dialectOptions: { ssl: { rejectUnauthorized: false } },
      }
    : {
        dialect: dbConfig.dialect,
        storage: dbConfig.storage,
        host: dbConfig.host,
        port: dbConfig.port,
        database: dbConfig.database,
        username: dbConfig.username,
        password: dbConfig.password,
        logging: dbConfig.logging,
        pool: dbConfig.pool,
        define: { timestamps: true, underscored: true },
      }
);

export const connectDatabase = async (): Promise<void> => {
  try {
    await sequelize.authenticate();
    console.log('✅ Database connection established successfully.');

    // Roda migrations pendentes
    const { migrator } = await import('../migrations');
    await migrator.up();
    console.log('✅ Migrations applied.');
  } catch (error) {
    console.error('❌ Unable to connect to the database:', error);
    throw error;
  }
};

export default sequelize;
