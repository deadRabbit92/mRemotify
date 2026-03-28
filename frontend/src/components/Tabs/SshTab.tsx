import React, { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { useStore } from '../../store';
import { Session } from '../../types';

interface Props {
  session: Session;
}

function getWsUrl(connectionId: string, token: string): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  // In dev, Vite proxies /ws → backend. In prod, nginx proxies /ws → backend.
  const host = window.location.host;
  return `${proto}//${host}/ws/ssh/${connectionId}?token=${encodeURIComponent(token)}`;
}

export const SshTab: React.FC<Props> = ({ session }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const token = useStore((s) => s.token) ?? '';
  const profiles = useStore((s) => s.profiles);
  const folders = useStore((s) => s.folders);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Resolve scrollback: connection override > profile > folder-inherited profile > default
    const conn = session.connection;
    let scrollback = conn.scrollbackLines;
    if (scrollback == null && conn.profileId) {
      const profile = profiles.find((p) => p.id === conn.profileId);
      scrollback = profile?.scrollbackLines ?? null;
    }
    if (scrollback == null && conn.folderId) {
      // Walk up folder tree to find inherited SSH profile
      const folderMap = new Map(folders.map((f) => [f.id, f]));
      let currentId: string | null | undefined = conn.folderId;
      while (currentId) {
        const folder = folderMap.get(currentId);
        if (!folder) break;
        if (folder.sshProfileId) {
          const inherited = profiles.find((p) => p.id === folder.sshProfileId);
          if (inherited?.scrollbackLines != null) {
            scrollback = inherited.scrollbackLines;
            break;
          }
        }
        currentId = folder.parentId;
      }
    }

    // --- Terminal setup ---
    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: 'Menlo, Consolas, "Courier New", monospace',
      fontSize: 14,
      scrollback: scrollback ?? 1000,
      theme: {
        background: '#1a1a2e',
        foreground: '#e0e0e0',
        cursor: '#e0e0e0',
      },
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(container);
    // Defer initial fit to ensure the container has been fully laid out
    requestAnimationFrame(() => {
      fitAddon.fit();
    });

    // --- PuTTY-style copy/paste ---
    // Select → auto-copy to clipboard
    terminal.onSelectionChange(() => {
      const selection = terminal.getSelection();
      if (selection) {
        navigator.clipboard.writeText(selection).catch(() => {});
      }
    });

    // Track whether the remote shell has enabled bracketed paste mode.
    // Shells like bash/zsh enable it with \x1b[?2004h and disable with \x1b[?2004l.
    // Programs like docker login never enable it, so we must not send the
    // bracket sequences or they appear as literal ^[[200~ garbage.
    let bracketedPasteEnabled = false;
    terminal.parser.registerCsiHandler({ prefix: '?', final: 'h' }, (params) => {
      if (params[0] === 2004) bracketedPasteEnabled = true;
      return false; // let xterm.js handle it too
    });
    terminal.parser.registerCsiHandler({ prefix: '?', final: 'l' }, (params) => {
      if (params[0] === 2004) bracketedPasteEnabled = false;
      return false;
    });

    // Right-click → paste from clipboard (suppress browser context menu)
    const termEl = container.querySelector('.xterm') as HTMLElement | null;
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      navigator.clipboard.readText().then((text) => {
        if (text && ws.readyState === WebSocket.OPEN) {
          const payload = bracketedPasteEnabled
            ? `\x1b[200~${text}\x1b[201~`
            : text;
          ws.send(new TextEncoder().encode(payload));
        }
      }).catch(() => {});
    };
    termEl?.addEventListener('contextmenu', handleContextMenu);

    // --- Intercept Ctrl+W so it reaches nano/vim instead of closing the browser tab ---
    // 1. Window-level capture phase handler (earliest possible interception)
    const handleBrowserShortcut = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.code === 'KeyW' || e.key === 'w' || e.key === 'W')) {
        if (container.contains(document.activeElement)) {
          e.preventDefault();
          e.stopImmediatePropagation();
        }
      }
    };
    window.addEventListener('keydown', handleBrowserShortcut, true);

    // 2. xterm.js custom key handler (backup — intercepts on the internal textarea)
    terminal.attachCustomKeyEventHandler((e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.code === 'KeyW' || e.key === 'w' || e.key === 'W')) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
      return true;
    });

    // 3. Safety net: warn before unload when a terminal session is open
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', handleBeforeUnload);

    // --- WebSocket ---
    const ws = new WebSocket(getWsUrl(session.connection.id, token));
    ws.binaryType = 'arraybuffer';

    ws.addEventListener('open', () => {
      // Send initial size so the backend opens the PTY with correct dimensions
      ws.send(
        JSON.stringify({ type: 'resize', cols: terminal.cols, rows: terminal.rows })
      );
    });

    // On first data from the server, re-fit and send corrected dimensions.
    // By this point the container is guaranteed to be laid out.
    let firstData = true;
    ws.addEventListener('message', (event) => {
      if (event.data instanceof ArrayBuffer) {
        terminal.write(new Uint8Array(event.data));
      } else {
        terminal.write(event.data as string);
      }

      if (firstData) {
        firstData = false;
        requestAnimationFrame(() => {
          fitAddon.fit();
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(
              JSON.stringify({ type: 'resize', cols: terminal.cols, rows: terminal.rows })
            );
          }
        });
      }
    });

    ws.addEventListener('close', (e) => {
      terminal.writeln(`\r\n\x1b[33mConnection closed (${e.code}).\x1b[0m`);
    });

    ws.addEventListener('error', () => {
      terminal.writeln('\r\n\x1b[31mWebSocket error.\x1b[0m');
    });

    // Terminal input → WS (binary frame)
    // Buffer rapid keystrokes and flush once per animation frame to avoid
    // sending many tiny WebSocket frames, which causes visible stutter.
    const encoder = new TextEncoder();
    let inputBuffer = '';
    let flushScheduled = false;
    const flushInput = () => {
      flushScheduled = false;
      if (inputBuffer && ws.readyState === WebSocket.OPEN) {
        ws.send(encoder.encode(inputBuffer));
      }
      inputBuffer = '';
    };
    terminal.onData((data) => {
      inputBuffer += data;
      if (!flushScheduled) {
        flushScheduled = true;
        requestAnimationFrame(flushInput);
      }
    });

    // Resize → WS (JSON text frame)
    terminal.onResize(({ cols, rows }) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols, rows }));
      }
    });

    // Observe container size changes
    const resizeObserver = new ResizeObserver(() => {
      try {
        fitAddon.fit();
      } catch {
        // ignore layout errors during unmount
      }
    });
    resizeObserver.observe(container);

    return () => {
      termEl?.removeEventListener('contextmenu', handleContextMenu);
      window.removeEventListener('keydown', handleBrowserShortcut, true);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      resizeObserver.disconnect();
      ws.close();
      terminal.dispose();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- profiles/folders only needed at mount for scrollback resolution
  }, [session.connection.id, token]);

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        background: '#1a1a2e',
        overflow: 'hidden',
      }}
    />
  );
};
