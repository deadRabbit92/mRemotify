import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

interface JwtPayload {
  id: string;
  username: string;
}

interface CreateFolderBody {
  name: string;
  parentId?: string;
  sshProfileId?: string | null;
  rdpProfileId?: string | null;
}

interface UpdateFolderBody {
  name?: string;
  parentId?: string | null;
  sshProfileId?: string | null;
  rdpProfileId?: string | null;
}

export async function folderRoutes(fastify: FastifyInstance) {
  // All folder routes require authentication
  fastify.addHook('preHandler', fastify.authenticate);

  // GET /api/folders — list all folders for the current user
  fastify.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as JwtPayload;
    const folders = await fastify.prisma.folder.findMany({
      where: { userId: user.id },
      orderBy: { name: 'asc' },
    });
    return reply.send(folders);
  });

  // POST /api/folders — create folder
  fastify.post<{ Body: CreateFolderBody }>(
    '/',
    {
      schema: {
        body: {
          type: 'object',
          required: ['name'],
          properties: {
            name: { type: 'string' },
            parentId: { type: 'string', nullable: true },
            sshProfileId: { type: 'string', nullable: true },
            rdpProfileId: { type: 'string', nullable: true },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Body: CreateFolderBody }>, reply: FastifyReply) => {
      const user = request.user as JwtPayload;
      const { name, parentId, sshProfileId, rdpProfileId } = request.body;

      const folder = await fastify.prisma.folder.create({
        data: {
          name,
          parentId: parentId || null,
          sshProfileId: sshProfileId || null,
          rdpProfileId: rdpProfileId || null,
          userId: user.id,
        },
      });
      return reply.status(201).send(folder);
    }
  );

  // PATCH /api/folders/:id — update folder
  fastify.patch<{ Params: { id: string }; Body: UpdateFolderBody }>(
    '/:id',
    async (request, reply) => {
      const user = request.user as JwtPayload;
      const { id } = request.params;
      const { name, parentId, sshProfileId, rdpProfileId } = request.body;

      const folder = await fastify.prisma.folder.findFirst({
        where: { id, userId: user.id },
      });
      if (!folder) return reply.status(404).send({ error: 'Folder not found' });

      const updated = await fastify.prisma.folder.update({
        where: { id },
        data: {
          ...(name !== undefined && { name }),
          ...(parentId !== undefined && { parentId: parentId ?? null }),
          ...(sshProfileId !== undefined && { sshProfileId: sshProfileId ?? null }),
          ...(rdpProfileId !== undefined && { rdpProfileId: rdpProfileId ?? null }),
        },
      });
      return reply.send(updated);
    }
  );

  // DELETE /api/folders/:id — delete folder (connections become root-level)
  fastify.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const user = request.user as JwtPayload;
    const { id } = request.params;

    const folder = await fastify.prisma.folder.findFirst({ where: { id, userId: user.id } });
    if (!folder) return reply.status(404).send({ error: 'Folder not found' });

    await fastify.prisma.folder.delete({ where: { id } });
    return reply.status(204).send();
  });
}
