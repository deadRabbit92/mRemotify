import { FastifyInstance, FastifyRequest } from 'fastify';
import { SocketStream } from '@fastify/websocket';
import { WebSocket } from 'ws';
import { Client as SshClient, ConnectConfig, SFTPWrapper } from 'ssh2';
import { resolveCredentials } from '../utils/resolveCredentials';

interface JwtPayload {
  id: string;
  username: string;
}

function sendJson(socket: WebSocket, msg: object) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(msg));
  }
}

export async function sftpWebsocket(fastify: FastifyInstance) {
  fastify.get(
    '/ws/sftp/:connectionId',
    { websocket: true },
    async (connection: SocketStream, request: FastifyRequest) => {
      const socket = connection.socket;

      // --- Auth via ?token= query param ---
      const query = request.query as { token?: string };
      let userId: string;

      try {
        if (!query.token) throw new Error('No token');
        const payload = fastify.jwt.verify<JwtPayload>(query.token);
        userId = payload.id;
      } catch {
        socket.close(1008, 'Unauthorized');
        return;
      }

      // --- Fetch connection ---
      const { connectionId } = request.params as { connectionId: string };
      const conn = await fastify.prisma.connection.findFirst({
        where: { id: connectionId, userId },
        include: { profile: true },
      });

      if (!conn) {
        socket.close(1008, 'Connection not found');
        return;
      }

      // Fetch all user folders for profile inheritance resolution
      const allFolders = await fastify.prisma.folder.findMany({
        where: { userId },
        include: { sshProfile: true, rdpProfile: true },
      });

      // --- Build SSH config ---
      const creds = resolveCredentials(conn, allFolders);
      const sshConfig: ConnectConfig = {
        host: conn.host,
        port: conn.port,
        username: creds.username,
        readyTimeout: 10_000,
      };

      if (creds.privateKey) {
        sshConfig.privateKey = creds.privateKey;
      } else if (creds.password) {
        sshConfig.password = creds.password;
      }

      // --- Open SSH + SFTP session ---
      const ssh = new SshClient();
      let sftp: SFTPWrapper | null = null;

      // Upload state
      let uploadPath: string | null = null;
      let uploadStream: ReturnType<SFTPWrapper['createWriteStream']> | null = null;

      ssh.on('ready', () => {
        ssh.sftp((err, sftpSession) => {
          if (err) {
            sendJson(socket, { type: 'error', message: err.message });
            socket.close();
            ssh.end();
            return;
          }

          sftp = sftpSession;

          // Resolve home directory and send ready
          sftp.realpath('.', (rpErr, home) => {
            sendJson(socket, {
              type: 'ready',
              home: rpErr ? '/' : home,
            });
          });
        });
      });

      // --- Handle incoming messages ---
      socket.on('message', (message: Buffer | string, isBinary: boolean) => {
        if (!sftp) return;

        // Binary frames → upload data
        if (isBinary) {
          if (uploadStream) {
            const buf = Buffer.isBuffer(message) ? message : Buffer.from(message as string);
            uploadStream.write(buf);
          }
          return;
        }

        // JSON commands
        let msg: any;
        try {
          msg = JSON.parse(message.toString());
        } catch {
          sendJson(socket, { type: 'error', message: 'Invalid JSON' });
          return;
        }

        switch (msg.type) {
          case 'list': {
            const dirPath: string = msg.path || '/';
            sftp.readdir(dirPath, (err, list) => {
              if (err) {
                sendJson(socket, { type: 'error', message: err.message });
                return;
              }
              const entries = list
                .filter((item) => item.filename !== '.' && item.filename !== '..')
                .map((item) => ({
                  name: item.filename,
                  isDir: (item.attrs.mode! & 0o40000) !== 0,
                  size: item.attrs.size ?? 0,
                  modTime: (item.attrs.mtime ?? 0) * 1000,
                }))
                .sort((a, b) => {
                  // Directories first, then alphabetical
                  if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
                  return a.name.localeCompare(b.name);
                });
              sendJson(socket, { type: 'entries', path: dirPath, entries });
            });
            break;
          }

          case 'download': {
            const filePath: string = msg.path;
            if (!filePath) {
              sendJson(socket, { type: 'error', message: 'Missing path' });
              return;
            }
            sftp.stat(filePath, (err, stats) => {
              if (err) {
                sendJson(socket, { type: 'error', message: err.message });
                return;
              }
              const name = filePath.split('/').pop() || 'download';
              sendJson(socket, { type: 'downloadStart', name, size: stats.size });

              const rs = sftp!.createReadStream(filePath);
              rs.on('data', (chunk: Buffer) => {
                if (socket.readyState === WebSocket.OPEN) {
                  socket.send(chunk);
                }
              });
              rs.on('end', () => {
                sendJson(socket, { type: 'downloadEnd' });
              });
              rs.on('error', (readErr: Error) => {
                sendJson(socket, { type: 'error', message: readErr.message });
              });
            });
            break;
          }

          case 'upload': {
            const upPath: string = msg.path;
            if (!upPath) {
              sendJson(socket, { type: 'error', message: 'Missing path' });
              return;
            }
            uploadPath = upPath;
            uploadStream = sftp.createWriteStream(upPath);
            uploadStream.on('error', (writeErr: Error) => {
              sendJson(socket, { type: 'error', message: writeErr.message });
              uploadStream = null;
              uploadPath = null;
            });
            break;
          }

          case 'uploadEnd': {
            if (uploadStream) {
              const dirPath = uploadPath ? uploadPath.substring(0, uploadPath.lastIndexOf('/')) || '/' : '/';
              uploadStream.end(() => {
                sendJson(socket, { type: 'ok', path: dirPath });
                uploadStream = null;
                uploadPath = null;
              });
            }
            break;
          }

          case 'mkdir': {
            const mkPath: string = msg.path;
            if (!mkPath) {
              sendJson(socket, { type: 'error', message: 'Missing path' });
              return;
            }
            const mkParent = mkPath.substring(0, mkPath.lastIndexOf('/')) || '/';
            sftp.mkdir(mkPath, (err) => {
              if (err) {
                sendJson(socket, { type: 'error', message: err.message });
              } else {
                sendJson(socket, { type: 'ok', path: mkParent });
              }
            });
            break;
          }

          case 'delete': {
            const delPath: string = msg.path;
            if (!delPath) {
              sendJson(socket, { type: 'error', message: 'Missing path' });
              return;
            }
            sftp.stat(delPath, (statErr, stats) => {
              if (statErr) {
                sendJson(socket, { type: 'error', message: statErr.message });
                return;
              }
              const isDir = (stats.mode! & 0o40000) !== 0;
              const delDir = delPath.substring(0, delPath.lastIndexOf('/')) || '/';
              const cb = (err: Error | null | undefined) => {
                if (err) {
                  sendJson(socket, { type: 'error', message: err.message });
                } else {
                  sendJson(socket, { type: 'ok', path: delDir });
                }
              };
              if (isDir) {
                sftp!.rmdir(delPath, cb);
              } else {
                sftp!.unlink(delPath, cb);
              }
            });
            break;
          }

          case 'rename': {
            const { oldPath, newPath } = msg;
            if (!oldPath || !newPath) {
              sendJson(socket, { type: 'error', message: 'Missing oldPath or newPath' });
              return;
            }
            const renameDir = oldPath.substring(0, oldPath.lastIndexOf('/')) || '/';
            sftp.rename(oldPath, newPath, (err) => {
              if (err) {
                sendJson(socket, { type: 'error', message: err.message });
              } else {
                sendJson(socket, { type: 'ok', path: renameDir });
              }
            });
            break;
          }

          default:
            sendJson(socket, { type: 'error', message: `Unknown command: ${msg.type}` });
        }
      });

      ssh.on('error', (err) => {
        fastify.log.error({ err }, 'SFTP SSH connection error');
        sendJson(socket, { type: 'error', message: err.message });
        if (socket.readyState === WebSocket.OPEN) {
          socket.close(1011, err.message);
        }
      });

      ssh.connect(sshConfig);

      socket.on('close', () => {
        if (uploadStream) {
          uploadStream.destroy();
          uploadStream = null;
        }
        ssh.end();
      });
    }
  );
}
