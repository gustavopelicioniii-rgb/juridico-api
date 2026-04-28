import { DataTypes, QueryInterface } from 'sequelize';

export const up = async ({ context }: { context: QueryInterface }) => {
  // Created already by sequelize.sync(), this is for documentation/seed
};

export const down = async ({ context }: { context: QueryInterface }) => {
  // No down for initial schema (dangerous)
};
