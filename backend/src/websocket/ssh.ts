import { FastifyInstance, FastifyRequest } from 'fastify';
import { SocketStream } from '@fastify/websocket';
import { WebSocket } from 'ws';
import { Client as SshClient, ConnectConfig } from 'ssh2';
import { resolveCredentials } from '../utils/resolveCredentials';

interface JwtPayload {
  id: string;
  username: string;
}

interface ResizeMessage {
  type: 'resize';
  cols: number;
  rows: number;
}

export async function sshWebsocket(fastify: FastifyInstance) {
  fastify.get(
    '/ws/ssh/:connectionId',
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

      // --- Open SSH session ---
      const ssh = new SshClient();

      // Queue messages received before the shell stream is ready
      let pendingMessages: { message: Buffer | string; isBinary: boolean }[] | null = [];

      // Register the WebSocket message handler immediately so no messages are lost
      socket.on('message', (message: Buffer | string, isBinary: boolean) => {
        if (pendingMessages !== null) {
          pendingMessages.push({ message, isBinary });
          return;
        }
        handleMessage(message, isBinary);
      });

      // Track initial terminal size from the first resize message
      let initialCols = 80;
      let initialRows = 24;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let shellStream: any = null;

      function handleMessage(message: Buffer | string, isBinary: boolean) {
        if (!shellStream || !shellStream.writable) return;

        if (isBinary) {
          shellStream.write(Buffer.isBuffer(message) ? message : Buffer.from(message as string));
        } else {
          try {
            const msg: ResizeMessage = JSON.parse(message.toString());
            if (msg.type === 'resize') {
              shellStream.setWindow(msg.rows || 24, msg.cols || 80, 0, 0);
            }
          } catch {
            shellStream.write(message.toString());
          }
        }
      }

      ssh.on('ready', () => {
        // Extract initial dimensions from any queued resize messages
        if (pendingMessages) {
          for (const pm of pendingMessages) {
            if (!pm.isBinary) {
              try {
                const msg = JSON.parse(pm.message.toString());
                if (msg.type === 'resize') {
                  initialCols = msg.cols || 80;
                  initialRows = msg.rows || 24;
                }
              } catch {
                // not JSON, ignore
              }
            }
          }
        }

        ssh.shell({ term: 'xterm-256color', cols: initialCols, rows: initialRows }, (err, stream) => {
          if (err) {
            socket.send(JSON.stringify({ type: 'error', message: err.message }));
            socket.close();
            ssh.end();
            return;
          }

          shellStream = stream;

          // SSH stdout/stderr → WebSocket (binary frames)
          stream.on('data', (data: Buffer) => {
            if (socket.readyState === WebSocket.OPEN) socket.send(data);
          });

          stream.stderr.on('data', (data: Buffer) => {
            if (socket.readyState === WebSocket.OPEN) socket.send(data);
          });

          stream.on('close', () => {
            socket.close();
            ssh.end();
          });

          // Replay any queued non-resize messages (resize already applied via initialCols/Rows)
          if (pendingMessages) {
            const queued = pendingMessages;
            pendingMessages = null;
            for (const pm of queued) {
              if (!pm.isBinary) {
                try {
                  const msg = JSON.parse(pm.message.toString());
                  if (msg.type === 'resize') continue; // already applied
                } catch {
                  // not JSON, replay as input
                }
              }
              handleMessage(pm.message, pm.isBinary);
            }
          }

          socket.on('close', () => {
            stream.close();
            ssh.end();
          });
        });
      });

      ssh.on('error', (err) => {
        fastify.log.error({ err }, 'SSH connection error');
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(`\r\n\x1b[31mSSH error: ${err.message}\x1b[0m\r\n`);
          socket.close(1011, err.message);
        }
      });

      ssh.connect(sshConfig);

      socket.on('close', () => ssh.end());
    }
  );
}
