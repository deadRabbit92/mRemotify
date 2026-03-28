import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { encrypt, decrypt } from '../utils/encryption';

interface JwtPayload {
  id: string;
  username: string;
}

interface ConnectionBody {
  name: string;
  host: string;
  port: number;
  protocol: 'ssh' | 'rdp';
  username: string;
  password?: string;
  privateKey?: string;
  domain?: string;
  osType?: string;
  notes?: string;
  clipboardEnabled?: boolean;
  scrollbackLines?: number | null;
  folderId?: string | null;
  profileId?: string | null;
}

export async function connectionRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.authenticate);

  // GET /api/connections
  fastify.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as JwtPayload;
    const connections = await fastify.prisma.connection.findMany({
      where: { userId: user.id },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        host: true,
        port: true,
        protocol: true,
        username: true,
        domain: true,
        osType: true,
        notes: true,
        clipboardEnabled: true,
        scrollbackLines: true,
        folderId: true,
        profileId: true,
        createdAt: true,
        // Do NOT expose encryptedPassword or privateKey in list
      },
    });
    return reply.send(connections);
  });

  // GET /api/connections/:id
  fastify.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const user = request.user as JwtPayload;
    const conn = await fastify.prisma.connection.findFirst({
      where: { id: request.params.id, userId: user.id },
      select: {
        id: true,
        name: true,
        host: true,
        port: true,
        protocol: true,
        username: true,
        domain: true,
        osType: true,
        notes: true,
        clipboardEnabled: true,
        scrollbackLines: true,
        folderId: true,
        profileId: true,
        privateKey: true,
        createdAt: true,
        // still omit encryptedPassword
      },
    });
    if (!conn) return reply.status(404).send({ error: 'Connection not found' });
    return reply.send({
      ...conn,
      privateKey: conn.privateKey ? decrypt(conn.privateKey) : null,
    });
  });

  // POST /api/connections
  fastify.post<{ Body: ConnectionBody }>('/', async (request, reply) => {
    const user = request.user as JwtPayload;
    const { password, privateKey, ...rest } = request.body;

    const connection = await fastify.prisma.connection.create({
      data: {
        ...rest,
        folderId: rest.folderId || null,
        profileId: rest.profileId || null,
        encryptedPassword: password ? encrypt(password) : null,
        privateKey: privateKey ? encrypt(privateKey) : null,
        userId: user.id,
      },
      select: {
        id: true,
        name: true,
        host: true,
        port: true,
        protocol: true,
        username: true,
        domain: true,
        osType: true,
        notes: true,
        clipboardEnabled: true,
        scrollbackLines: true,
        folderId: true,
        profileId: true,
        createdAt: true,
      },
    });
    return reply.status(201).send(connection);
  });

  // PATCH /api/connections/:id
  fastify.patch<{ Params: { id: string }; Body: Partial<ConnectionBody> }>(
    '/:id',
    async (request, reply) => {
      const user = request.user as JwtPayload;
      const { id } = request.params;
      const { password, privateKey, folderId, profileId, ...rest } = request.body;

      const existing = await fastify.prisma.connection.findFirst({
        where: { id, userId: user.id },
      });
      if (!existing) return reply.status(404).send({ error: 'Connection not found' });

      const updated = await fastify.prisma.connection.update({
        where: { id },
        data: {
          ...rest,
          ...(folderId !== undefined && { folderId: folderId ?? null }),
          ...(profileId !== undefined && { profileId: profileId ?? null }),
          ...(password !== undefined && { encryptedPassword: password ? encrypt(password) : null }),
          ...(privateKey !== undefined && { privateKey: privateKey ? encrypt(privateKey) : null }),
        },
        select: {
          id: true,
          name: true,
          host: true,
          port: true,
          protocol: true,
          username: true,
          domain: true,
          osType: true,
          notes: true,
          clipboardEnabled: true,
          scrollbackLines: true,
          folderId: true,
          profileId: true,
          createdAt: true,
        },
      });
      return reply.send(updated);
    }
  );

  // DELETE /api/connections/:id
  fastify.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const user = request.user as JwtPayload;
    const { id } = request.params;

    const existing = await fastify.prisma.connection.findFirst({
      where: { id, userId: user.id },
    });
    if (!existing) return reply.status(404).send({ error: 'Connection not found' });

    await fastify.prisma.connection.delete({ where: { id } });
    return reply.status(204).send();
  });
}
