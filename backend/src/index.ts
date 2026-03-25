import fs from 'fs';
import Fastify, { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import websocketPlugin from '@fastify/websocket';
import prismaPlugin from './plugins/prisma';
import { authRoutes } from './routes/auth';
import { folderRoutes } from './routes/folders';
import { connectionRoutes } from './routes/connections';
import { profileRoutes } from './routes/profiles';
import { importRoutes } from './routes/import';
import { exportRoutes } from './routes/export';
import { sshWebsocket } from './websocket/ssh';
import { rdpWebsocket } from './websocket/rdp';
import { sftpWebsocket } from './websocket/sftp';
import { encrypt } from './utils/encryption';

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

function getTlsOptions(): { https?: { cert: string | Buffer; key: string | Buffer } } {
  // Use BACKEND_TLS_ENABLED (not TLS_ENABLED) — in Docker Compose, nginx handles TLS
  // termination and proxies to the backend over plain HTTP. Only enable this when the
  // backend is exposed directly without a reverse proxy.
  if (process.env.BACKEND_TLS_ENABLED !== 'true') return {};

  // Option B: base64 inline
  if (process.env.TLS_CERT_B64 && process.env.TLS_KEY_B64) {
    return {
      https: {
        cert: Buffer.from(process.env.TLS_CERT_B64, 'base64').toString('utf8'),
        key: Buffer.from(process.env.TLS_KEY_B64, 'base64').toString('utf8'),
      },
    };
  }

  // Option A: file paths
  if (process.env.TLS_CERT_FILE && process.env.TLS_KEY_FILE) {
    return {
      https: {
        cert: fs.readFileSync(process.env.TLS_CERT_FILE),
        key: fs.readFileSync(process.env.TLS_KEY_FILE),
      },
    };
  }

  throw new Error(
    'TLS_ENABLED=true but no certificate provided. Set TLS_CERT_FILE/TLS_KEY_FILE or TLS_CERT_B64/TLS_KEY_B64'
  );
}

async function buildApp(): Promise<FastifyInstance> {
  const fastify = Fastify({ logger: true, ...getTlsOptions() });

  await fastify.register(cors, { origin: true, credentials: true });

  await fastify.register(jwt, {
    secret: (() => {
      const s = process.env.JWT_SECRET;
      if (!s) throw new Error('JWT_SECRET environment variable is required');
      return s;
    })(),
  });

  await fastify.register(websocketPlugin);

  await fastify.register(multipart, { limits: { fileSize: 50 * 1024 * 1024 } });

  await fastify.register(prismaPlugin);

  // Reusable auth preHandler
  fastify.decorate('authenticate', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      await req.jwtVerify();
    } catch (err) {
      reply.send(err);
    }
  });

  // REST routes
  await fastify.register(authRoutes, { prefix: '/api/auth' });
  await fastify.register(folderRoutes, { prefix: '/api/folders' });
  await fastify.register(connectionRoutes, { prefix: '/api/connections' });
  await fastify.register(profileRoutes, { prefix: '/api/profiles' });
  await fastify.register(importRoutes, { prefix: '/api/import' });
  await fastify.register(exportRoutes, { prefix: '/api/export' });

  // WebSocket routes
  await fastify.register(sshWebsocket);
  await fastify.register(rdpWebsocket);
  await fastify.register(sftpWebsocket);

  return fastify;
}

/** One-time migration: encrypt any plaintext private keys left in the DB.
 *  Encrypted values contain a ":" (iv:ciphertext), plaintext keys don't. */
async function migratePrivateKeys(app: FastifyInstance) {
  for (const table of ['connection', 'profile'] as const) {
    const rows = await (app.prisma[table] as any).findMany({
      where: { privateKey: { not: null } },
      select: { id: true, privateKey: true },
    });
    for (const row of rows) {
      if (row.privateKey && !row.privateKey.includes(':')) {
        await (app.prisma[table] as any).update({
          where: { id: row.id },
          data: { privateKey: encrypt(row.privateKey) },
        });
        app.log.info(`[migrate] Encrypted plaintext privateKey in ${table} ${row.id}`);
      }
    }
  }
}

async function main() {
  const app = await buildApp();
  await migratePrivateKeys(app);
  const port = Number(process.env.PORT) || 3000;
  await app.listen({ port, host: '0.0.0.0' });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
