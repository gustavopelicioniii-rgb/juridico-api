import { sequelize } from '../src/models';
import logger from '../src/config/logger';

const migrate = async (): Promise<void> => {
  try {
    logger.info('🚀 Starting database migration...');
    
    await sequelize.authenticate();
    logger.info('✅ Database connected');
    
    // Sync all models (creates tables if they don't exist)
    await sequelize.sync({ alter: true });
    logger.info('✅ All tables synchronized');
    
    logger.info('✅ Migration completed successfully!');
    process.exit(0);
  } catch (error) {
    logger.error('❌ Migration failed:', error);
    process.exit(1);
  }
};

migrate();
