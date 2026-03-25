import { FastifyInstance, FastifyRequest } from 'fastify';
import { SocketStream } from '@fastify/websocket';
import { WebSocket } from 'ws';
import { resolveCredentials } from '../utils/resolveCredentials';

interface JwtPayload {
  id: string;
  username: string;
}

// ---------------------------------------------------------------------------
// RDP WebSocket handler — proxies between browser and rdpd
// ---------------------------------------------------------------------------

export async function rdpWebsocket(fastify: FastifyInstance) {
  fastify.get(
    '/ws/rdp/:connectionId',
    { websocket: true },
    async (connection: SocketStream, request: FastifyRequest) => {
      const socket = connection.socket;

      // --- Auth ---
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

      // --- Fetch connection from DB ---
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

      const rdpdUrl = process.env.RDPD_URL || 'ws://localhost:7777';
      const creds = resolveCredentials(conn, allFolders);

      fastify.log.info(
        { host: conn.host, port: conn.port, user: creds.username, rdpdUrl },
        'RDP: connecting to rdpd'
      );

      // --- Connect to rdpd ---
      let rdpd: WebSocket;
      try {
        rdpd = await new Promise<WebSocket>((resolve, reject) => {
          const ws = new WebSocket(rdpdUrl);
          ws.once('open', () => resolve(ws));
          ws.once('error', reject);
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'rdpd connect failed';
        fastify.log.warn({ err }, 'rdpd connect failed');
        socket.close(1011, msg);
        return;
      }

      // --- Send connect message with credentials ---
      const connectMsg = JSON.stringify({
        type: 'connect',
        host: conn.host,
        port: conn.port,
        username: creds.username,
        password: creds.password,
        domain: creds.domain,
        width: 1280,
        height: 720,
        clipboard: creds.clipboardEnabled,
      });

      rdpd.send(connectMsg);
      fastify.log.info('RDP: connect message sent to rdpd');

      // --- Bidirectional proxy ---

      // rdpd → browser: forward both binary (JPEG frames) and text (JSON control)
      rdpd.on('message', (data: Buffer | string, isBinary: boolean) => {
        if (socket.readyState !== WebSocket.OPEN) return;

        if (isBinary) {
          // JPEG frame — forward as binary
          socket.send(data as Buffer, { binary: true });
        } else {
          // JSON control message — forward as text
          const text = typeof data === 'string' ? data : (data as Buffer).toString('utf8');
          socket.send(text);
        }
      });

      // browser → rdpd: forward all messages (JSON input events)
      socket.on('message', (data: Buffer | string) => {
        if (rdpd.readyState !== WebSocket.OPEN) return;

        const text = typeof data === 'string' ? data : data.toString('utf8');
        rdpd.send(text);
      });

      // --- Cleanup on either side closing ---
      rdpd.on('close', () => {
        fastify.log.info('RDP: rdpd connection closed');
        if (socket.readyState === WebSocket.OPEN) {
          socket.close();
        }
      });

      rdpd.on('error', (err) => {
        fastify.log.warn({ err }, 'rdpd WebSocket error');
        if (socket.readyState === WebSocket.OPEN) {
          socket.close(1011, err.message);
        }
      });

      socket.on('close', () => {
        fastify.log.info('RDP: browser WebSocket closed');
        if (rdpd.readyState === WebSocket.OPEN) {
          rdpd.close();
        }
      });

      socket.on('error', (err) => {
        fastify.log.warn({ err }, 'browser WebSocket error');
        if (rdpd.readyState === WebSocket.OPEN) {
          rdpd.close();
        }
      });
    }
  );
}
