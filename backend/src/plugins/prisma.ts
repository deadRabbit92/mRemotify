import fp from 'fastify-plugin';
import { FastifyInstance } from 'fastify';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}

/** Prisma 7 has no Rust query engine — the connection is owned by a driver
 *  adapter, so the URL comes from the environment here rather than the schema. */
export function createPrismaClient(): PrismaClient {
  const connectionString = process.env.POSTGRES_URL;
  if (!connectionString) throw new Error('POSTGRES_URL environment variable is required');

  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
    log: process.env.NODE_ENV === 'development' ? ['query', 'error'] : ['error'],
  });
}

async function prismaPlugin(fastify: FastifyInstance) {
  const prisma = createPrismaClient();

  await prisma.$connect();

  fastify.decorate('prisma', prisma);

  fastify.addHook('onClose', async () => {
    await prisma.$disconnect();
  });
}

export default fp(prismaPlugin, { name: 'prisma' });
