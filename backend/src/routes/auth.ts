import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { compare as bcryptCompare, hash as bcryptHash } from 'bcryptjs';

interface LoginBody {
  username: string;
  password: string;
}

interface ChangePasswordBody {
  oldPassword: string;
  newPassword: string;
}

export async function authRoutes(fastify: FastifyInstance) {
  // POST /api/auth/login
  fastify.post<{ Body: LoginBody }>(
    '/login',
    {
      schema: {
        body: {
          type: 'object',
          required: ['username', 'password'],
          properties: {
            username: { type: 'string' },
            password: { type: 'string' },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Body: LoginBody }>, reply: FastifyReply) => {
      const { username, password } = request.body;

      const user = await fastify.prisma.user.findUnique({ where: { username } });
      if (!user) {
        return reply.status(401).send({ error: 'Invalid credentials' });
      }

      const valid = await bcryptCompare(password, user.passwordHash);
      if (!valid) {
        return reply.status(401).send({ error: 'Invalid credentials' });
      }

      const token = fastify.jwt.sign(
        { id: user.id, username: user.username },
        { expiresIn: '12h' }
      );

      return reply.send({ token, user: { id: user.id, username: user.username } });
    }
  );

  // POST /api/auth/change-password
  fastify.post<{ Body: ChangePasswordBody }>(
    '/change-password',
    {
      preHandler: [fastify.authenticate],
      schema: {
        body: {
          type: 'object',
          required: ['oldPassword', 'newPassword'],
          properties: {
            oldPassword: { type: 'string' },
            newPassword: { type: 'string', minLength: 6 },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Body: ChangePasswordBody }>, reply: FastifyReply) => {
      const payload = request.user as { id: string; username: string };
      const { oldPassword, newPassword } = request.body;

      const user = await fastify.prisma.user.findUnique({ where: { id: payload.id } });
      if (!user) return reply.status(404).send({ error: 'User not found' });

      const valid = await bcryptCompare(oldPassword, user.passwordHash);
      if (!valid) return reply.status(401).send({ error: 'Current password is incorrect' });

      const passwordHash = await bcryptHash(newPassword, 10);
      await fastify.prisma.user.update({ where: { id: user.id }, data: { passwordHash } });

      return reply.send({ message: 'Password changed successfully' });
    }
  );

  // GET /api/auth/me — verify token and return current user
  fastify.get(
    '/me',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const payload = request.user as { id: string; username: string };
      const user = await fastify.prisma.user.findUnique({ where: { id: payload.id } });
      if (!user) return reply.status(404).send({ error: 'User not found' });
      return reply.send({ id: user.id, username: user.username });
    }
  );
}
