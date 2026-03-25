import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { parseMremoteng, ParsedFolder, ParsedConnection } from '../lib/mremoteng-parser';
import { decryptBackup } from '../lib/backup-crypto';
import { encrypt } from '../utils/encryption';

interface JwtPayload {
  id: string;
  username: string;
}

export async function importRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.authenticate);

  // ── mRemoteNG import ─────────────────────────────────────────────────

  fastify.post('/mremoteng', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as JwtPayload;
    const data = await request.file();
    if (!data) return reply.status(400).send({ error: 'No file uploaded' });

    const fileBuffer = await data.toBuffer();
    const xmlContent = fileBuffer.toString('utf8');

    // Extract fields from multipart
    const fields = data.fields as Record<string, any>;
    const masterPassword = fields.masterPassword?.value as string | undefined;
    const preview = fields.preview?.value === 'true';
    const importIntoFolder = fields.importIntoFolder?.value !== 'false';
    const folderName = (fields.folderName?.value as string) || 'mRemoteNG Import';
    const skipDuplicates = fields.skipDuplicates?.value === 'true';

    let result;
    try {
      result = parseMremoteng(xmlContent, masterPassword);
    } catch (err: any) {
      request.log.error({ err }, 'mRemoteNG parse error');
      return reply.status(400).send({ error: 'parse_error', message: err.message });
    }

    if (result.encrypted) {
      return reply.status(422).send({
        error: 'encrypted',
        message: 'Master password required',
      });
    }

    // Build preview response
    const previewResponse = {
      folders: stripPasswords(result.folders),
      connections: result.connections.map(stripConnectionPassword),
      totalConnections: result.totalConnections,
      totalFolders: result.totalFolders,
      warnings: result.warnings,
    };

    if (preview) {
      return reply.send(previewResponse);
    }

    // Get existing connections for duplicate detection
    let existingHosts: Set<string> | undefined;
    if (skipDuplicates) {
      const existing = await fastify.prisma.connection.findMany({
        where: { userId: user.id },
        select: { host: true },
      });
      existingHosts = new Set(existing.map((c) => c.host.toLowerCase()));
    }

    // Perform import in a transaction
    let importedConnections = 0;
    let importedFolders = 0;
    let skipped = 0;

    await fastify.prisma.$transaction(async (tx) => {
      let rootFolderId: string | null = null;

      if (importIntoFolder) {
        const folder = await tx.folder.create({
          data: { name: folderName, userId: user.id },
        });
        rootFolderId = folder.id;
        importedFolders++;
      }

      const importFolder = async (
        folder: ParsedFolder,
        parentId: string | null,
      ) => {
        const created = await tx.folder.create({
          data: { name: folder.name, parentId, userId: user.id },
        });
        importedFolders++;

        for (const conn of folder.connections) {
          if (existingHosts && existingHosts.has(conn.host.toLowerCase())) {
            skipped++;
            continue;
          }
          await tx.connection.create({
            data: connectionData(conn, created.id, user.id),
          });
          importedConnections++;
        }

        for (const child of folder.children) {
          await importFolder(child, created.id);
        }
      };

      // Import root-level connections
      for (const conn of result.connections) {
        if (existingHosts && existingHosts.has(conn.host.toLowerCase())) {
          skipped++;
          continue;
        }
        await tx.connection.create({
          data: connectionData(conn, rootFolderId, user.id),
        });
        importedConnections++;
      }

      // Import folders recursively
      for (const folder of result.folders) {
        await importFolder(folder, rootFolderId);
      }
    });

    return reply.send({
      success: true,
      imported: {
        connections: importedConnections,
        folders: importedFolders,
      },
      skipped,
      warnings: result.warnings,
    });
  });

  // ── Backup restore ───────────────────────────────────────────────────

  fastify.post('/backup', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as JwtPayload;
    const data = await request.file();
    if (!data) return reply.status(400).send({ error: 'No file uploaded' });

    const fileBuffer = await data.toBuffer();
    const fields = data.fields as Record<string, any>;
    const passphrase = fields.passphrase?.value as string;
    const mode = (fields.mode?.value as string) || 'merge';
    const preview = fields.preview?.value === 'true';

    if (!passphrase) {
      return reply.status(400).send({ error: 'Passphrase is required' });
    }

    let jsonStr: string;
    try {
      jsonStr = decryptBackup(fileBuffer, passphrase);
    } catch (err: any) {
      if (err.message === 'invalid_passphrase') {
        return reply.status(422).send({ error: 'invalid_passphrase', message: 'Wrong passphrase' });
      }
      return reply.status(400).send({ error: 'decrypt_error', message: err.message });
    }

    let backup: any;
    try {
      backup = JSON.parse(jsonStr);
    } catch {
      return reply.status(400).send({ error: 'invalid_json', message: 'Decrypted content is not valid JSON' });
    }

    if (!backup.version || backup.version !== 1) {
      return reply.status(400).send({ error: 'unsupported_version', message: `Unsupported backup version: ${backup.version}` });
    }

    const folders: any[] = backup.folders || [];
    const connections: any[] = backup.connections || [];
    const profiles: any[] = backup.profiles || [];

    if (preview) {
      return reply.send({
        exported_at: backup.exported_at,
        exported_by: backup.exported_by,
        folders: folders.length,
        connections: connections.length,
        profiles: profiles.length,
      });
    }

    let importedFolders = 0;
    let importedConnections = 0;
    let importedProfiles = 0;
    let skippedCount = 0;

    await fastify.prisma.$transaction(async (tx) => {
      if (mode === 'replace') {
        await tx.connection.deleteMany({ where: { userId: user.id } });
        await tx.folder.deleteMany({ where: { userId: user.id } });
        await tx.profile.deleteMany({ where: { userId: user.id } });
      }

      // Build sets for merge duplicate detection
      let existingConnections: Set<string> | undefined;
      let existingProfiles: Set<string> | undefined;

      if (mode === 'merge') {
        const existConns = await tx.connection.findMany({
          where: { userId: user.id },
          select: { name: true, host: true },
        });
        existingConnections = new Set(existConns.map((c) => `${c.name}|${c.host}`.toLowerCase()));

        const existProfs = await tx.profile.findMany({
          where: { userId: user.id },
          select: { name: true, protocol: true },
        });
        existingProfiles = new Set(existProfs.map((p) => `${p.name}|${p.protocol}`.toLowerCase()));
      }

      // Import profiles first (connections may reference them)
      const profileIdMap = new Map<string, string>();
      for (const profile of profiles) {
        const key = `${profile.name}|${profile.protocol}`.toLowerCase();
        if (existingProfiles && existingProfiles.has(key)) {
          skippedCount++;
          continue;
        }
        const created = await tx.profile.create({
          data: {
            name: profile.name,
            protocol: profile.protocol,
            username: profile.username || null,
            encryptedPassword: profile.password_plaintext ? encrypt(profile.password_plaintext) : null,
            privateKey: profile.private_key ? encrypt(profile.private_key) : null,
            domain: profile.domain || null,
            clipboardEnabled: profile.rdp_clipboard ?? null,
            userId: user.id,
          },
        });
        profileIdMap.set(profile.id, created.id);
        importedProfiles++;
      }

      // Import folders — flatten the tree and preserve parent relationships
      const folderIdMap = new Map<string, string>();
      const importFolderList = (folderList: any[], parentId: string | null) => {
        const ops: Array<() => Promise<void>> = [];
        for (const folder of folderList) {
          ops.push(async () => {
            const created = await tx.folder.create({
              data: {
                name: folder.name,
                parentId,
                userId: user.id,
              },
            });
            folderIdMap.set(folder.id, created.id);
            importedFolders++;
            if (folder.children && folder.children.length > 0) {
              const childOps = importFolderList(folder.children, created.id);
              for (const op of childOps) await op();
            }
          });
        }
        return ops;
      };

      const folderOps = importFolderList(folders, null);
      for (const op of folderOps) await op();

      // Import connections
      for (const conn of connections) {
        const key = `${conn.name}|${conn.host}`.toLowerCase();
        if (existingConnections && existingConnections.has(key)) {
          skippedCount++;
          continue;
        }

        const folderId = conn.folder_id ? (folderIdMap.get(conn.folder_id) || null) : null;
        const profileId = conn.profile_id ? (profileIdMap.get(conn.profile_id) || null) : null;

        await tx.connection.create({
          data: {
            name: conn.name,
            host: conn.host,
            port: conn.port || 22,
            protocol: conn.protocol,
            username: conn.username || '',
            encryptedPassword: conn.password_plaintext ? encrypt(conn.password_plaintext) : null,
            privateKey: conn.private_key ? encrypt(conn.private_key) : null,
            domain: conn.domain || null,
            osType: conn.os_type || null,
            notes: conn.notes || null,
            clipboardEnabled: conn.rdp_clipboard ?? true,
            folderId,
            profileId,
            userId: user.id,
          },
        });
        importedConnections++;
      }
    });

    return reply.send({
      success: true,
      imported: {
        folders: importedFolders,
        connections: importedConnections,
        profiles: importedProfiles,
      },
      skipped: skippedCount,
    });
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────

function connectionData(conn: ParsedConnection, folderId: string | null, userId: string) {
  return {
    name: conn.name,
    host: conn.host,
    port: conn.port,
    protocol: conn.protocol,
    username: conn.username,
    encryptedPassword: conn.password ? encrypt(conn.password) : null,
    domain: conn.domain || null,
    osType: conn.osType || null,
    notes: conn.notes || null,
    clipboardEnabled: conn.clipboardEnabled,
    folderId,
    userId,
  };
}

function stripConnectionPassword(conn: ParsedConnection) {
  return {
    name: conn.name,
    host: conn.host,
    port: conn.port,
    protocol: conn.protocol,
    username: conn.username,
    domain: conn.domain,
    notes: conn.notes,
    osType: conn.osType,
    clipboardEnabled: conn.clipboardEnabled,
  };
}

function stripPasswords(folders: ParsedFolder[]): any[] {
  return folders.map((f) => ({
    name: f.name,
    connections: f.connections.map(stripConnectionPassword),
    children: stripPasswords(f.children),
  }));
}
