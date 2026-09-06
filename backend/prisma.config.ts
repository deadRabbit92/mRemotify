import { defineConfig } from 'prisma/config';

/**
 * Prisma 7 moved the datasource URL out of schema.prisma and into this file.
 * The schema now only declares the provider; the connection string is read
 * here for the CLI (migrate/introspect) and passed to PrismaClient at runtime
 * through the pg driver adapter in src/plugins/prisma.ts.
 *
 * POSTGRES_URL is intentionally not required at load time — `prisma generate`
 * runs during the Docker build, where no database is reachable.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx src/seed.ts',
  },
  datasource: {
    url: process.env.POSTGRES_URL ?? '',
  },
});
