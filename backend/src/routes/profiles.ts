import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { encrypt, decrypt } from '../utils/encryption';

interface JwtPayload {
  id: string;
  username: string;
}

interface ProfileBody {
  name: string;
  protocol: 'ssh' | 'rdp';
  username?: string;
  password?: string;
  privateKey?: string;
  domain?: string;
  clipboardEnabled?: boolean;
  scrollbackLines?: number | null;
}

export async function profileRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.authenticate);

  // GET /api/profiles
  fastify.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as JwtPayload;
    const profiles = await fastify.prisma.profile.findMany({
      where: { userId: user.id },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        protocol: true,
        username: true,
        domain: true,
        clipboardEnabled: true,
        scrollbackLines: true,
        privateKey: true,
        encryptedPassword: true,
        createdAt: true,
      },
    });
    // Return hasPassword/hasPrivateKey flags instead of raw values
    const result = profiles.map(({ encryptedPassword, privateKey, ...rest }) => ({
      ...rest,
      hasPassword: !!encryptedPassword,
      hasPrivateKey: !!privateKey,
    }));
    return reply.send(result);
  });

  // GET /api/profiles/:id
  fastify.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const user = request.user as JwtPayload;
    const profile = await fastify.prisma.profile.findFirst({
      where: { id: request.params.id, userId: user.id },
      select: {
        id: true,
        name: true,
        protocol: true,
        username: true,
        domain: true,
        clipboardEnabled: true,
        scrollbackLines: true,
        privateKey: true,
        encryptedPassword: true,
        createdAt: true,
      },
    });
    if (!profile) return reply.status(404).send({ error: 'Profile not found' });
    const { encryptedPassword, privateKey, ...rest } = profile;
    return reply.send({
      ...rest,
      privateKey: privateKey ? decrypt(privateKey) : null,
      hasPassword: !!encryptedPassword,
      hasPrivateKey: !!privateKey,
    });
  });

  // POST /api/profiles
  fastify.post<{ Body: ProfileBody }>('/', async (request, reply) => {
    const user = request.user as JwtPayload;
    const { password, privateKey, ...rest } = request.body;

    const profile = await fastify.prisma.profile.create({
      data: {
        ...rest,
        encryptedPassword: password ? encrypt(password) : null,
        privateKey: privateKey ? encrypt(privateKey) : null,
        userId: user.id,
      },
      select: {
        id: true,
        name: true,
        protocol: true,
        username: true,
        domain: true,
        clipboardEnabled: true,
        scrollbackLines: true,
        createdAt: true,
      },
    });
    return reply.status(201).send(profile);
  });

  // PATCH /api/profiles/:id
  fastify.patch<{ Params: { id: string }; Body: Partial<ProfileBody> }>(
    '/:id',
    async (request, reply) => {
      const user = request.user as JwtPayload;
      const { id } = request.params;
      const { password, privateKey, ...rest } = request.body;

      const existing = await fastify.prisma.profile.findFirst({
        where: { id, userId: user.id },
      });
      if (!existing) return reply.status(404).send({ error: 'Profile not found' });

      const updated = await fastify.prisma.profile.update({
        where: { id },
        data: {
          ...rest,
          ...(password !== undefined && {
            encryptedPassword: password ? encrypt(password) : null,
          }),
          ...(privateKey !== undefined && {
            privateKey: privateKey ? encrypt(privateKey) : null,
          }),
        },
        select: {
          id: true,
          name: true,
          username: true,
          domain: true,
          clipboardEnabled: true,
          scrollbackLines: true,
          createdAt: true,
        },
      });
      return reply.send(updated);
    }
  );

  // DELETE /api/profiles/:id
  fastify.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const user = request.user as JwtPayload;
    const { id } = request.params;

    const existing = await fastify.prisma.profile.findFirst({
      where: { id, userId: user.id },
    });
    if (!existing) return reply.status(404).send({ error: 'Profile not found' });

    await fastify.prisma.profile.delete({ where: { id } });
    return reply.status(204).send();
  });
}
