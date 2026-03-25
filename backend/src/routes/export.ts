import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { encryptBackup } from '../lib/backup-crypto';
import { decrypt } from '../utils/encryption';

interface JwtPayload {
  id: string;
  username: string;
}

export async function exportRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.authenticate);

  fastify.post('/backup', async (request: FastifyRequest<{ Body: { passphrase: string } }>, reply: FastifyReply) => {
    const user = request.user as JwtPayload;
    const { passphrase } = request.body;

    if (!passphrase || passphrase.length < 1) {
      return reply.status(400).send({ error: 'Passphrase is required' });
    }

    // Fetch all user data
    const [folders, connections, profiles] = await Promise.all([
      fastify.prisma.folder.findMany({ where: { userId: user.id } }),
      fastify.prisma.connection.findMany({ where: { userId: user.id } }),
      fastify.prisma.profile.findMany({ where: { userId: user.id } }),
    ]);

    // Build folder tree
    const folderTree = buildFolderTree(folders);

    // Build payload
    const payload = {
      version: 1,
      exported_at: new Date().toISOString(),
      exported_by: user.username,
      folders: folderTree,
      connections: connections.map((c) => ({
        id: c.id,
        name: c.name,
        folder_id: c.folderId,
        host: c.host,
        port: c.port,
        protocol: c.protocol,
        username: c.username,
        password_plaintext: safeDecrypt(c.encryptedPassword),
        private_key: safeDecrypt(c.privateKey),
        domain: c.domain || '',
        os_type: c.osType || '',
        notes: c.notes || '',
        profile_id: c.profileId,
        rdp_clipboard: c.clipboardEnabled,
      })),
      profiles: profiles.map((p) => ({
        id: p.id,
        name: p.name,
        protocol: p.protocol,
        username: p.username || null,
        password_plaintext: safeDecrypt(p.encryptedPassword),
        private_key: safeDecrypt(p.privateKey),
        passphrase_plaintext: null,
        domain: p.domain || null,
        rdp_clipboard: p.clipboardEnabled ?? null,
      })),
    };

    const json = JSON.stringify(payload);
    const encrypted = encryptBackup(json, passphrase);

    const dateStr = new Date().toISOString().split('T')[0];
    const filename = `mremotify-backup-${dateStr}.mrb`;

    return reply
      .header('Content-Type', 'application/octet-stream')
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .send(encrypted);
  });
}

function safeDecrypt(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return decrypt(value);
  } catch {
    return null;
  }
}

interface FolderRow {
  id: string;
  name: string;
  parentId: string | null;
}

function buildFolderTree(folders: FolderRow[]): any[] {
  const map = new Map<string, any>();
  for (const f of folders) {
    map.set(f.id, { id: f.id, name: f.name, parent_id: f.parentId, children: [] });
  }

  const roots: any[] = [];
  for (const f of folders) {
    const node = map.get(f.id)!;
    if (f.parentId && map.has(f.parentId)) {
      map.get(f.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}
