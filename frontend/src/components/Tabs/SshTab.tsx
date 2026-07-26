import React, { useEffect, useRef, useState } from 'react';
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
  const terminalRef = useRef<Terminal | null>(null);
  const resyncSizeRef = useRef<(() => void) | null>(null);
  // Transient "cols × rows" badge, shown briefly whenever the terminal resizes
  const [sizeBadge, setSizeBadge] = useState<{ cols: number; rows: number } | null>(null);
  const token = useStore((s) => s.token) ?? '';
  const profiles = useStore((s) => s.profiles);
  const folders = useStore((s) => s.folders);
  const isActive = useStore((s) => s.activeSessionId === session.id);
  // Reordering tabs moves this pane's DOM node, which blurs the terminal inside
  // it — track our position so we can restore focus afterwards.
  const tabIndex = useStore((s) => s.sessions.findIndex((x) => x.id === session.id));

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
    terminalRef.current = terminal;

    // Only fit while the tab pane is actually visible.
    // Inactive antd tab panes are hidden (display:none / zero height). FitAddon
    // measures the parent with getComputedStyle, which for a hidden element
    // returns the *specified* value ("100%" → parsed as 100px), so an unguarded
    // fit() shrinks the terminal to a few columns and sends that size to the
    // remote PTY — wrecking the output of anything running in a background tab.
    const isVisible = () =>
      container.isConnected && container.clientWidth > 0 && container.clientHeight > 0;

    const safeFit = () => {
      if (!isVisible()) return;
      try {
        fitAddon.fit();
      } catch {
        // ignore layout errors during unmount
      }
    };

    // Defer initial fit to ensure the container has been fully laid out
    requestAnimationFrame(safeFit);

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
          resyncSize();
          // From here on the session is established, so a resize is worth
          // reporting — don't flash the badge for the initial fit.
          badgeEnabled = true;
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

    // Push the terminal's current size to the remote PTY.
    const sendSize = () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({ type: 'resize', cols: terminal.cols, rows: terminal.rows })
        );
      }
    };

    // Re-fit and re-assert the size unconditionally. onResize only fires when the
    // size actually changes, so a single missed message — a fit skipped while the
    // pane was hidden, or a resize while the socket was still connecting — would
    // otherwise leave the PTY permanently wider than what we render. The remote
    // then emits lines too long for our viewport, we wrap them, and every \r it
    // sends lands at the start of the wrapped tail instead of the real line start.
    const resyncSize = () => {
      safeFit();
      sendSize();
    };
    resyncSizeRef.current = resyncSize;

    // Resize → WS (JSON text frame)
    let badgeTimer: ReturnType<typeof setTimeout> | null = null;
    let badgeEnabled = false;
    terminal.onResize(({ cols, rows }) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols, rows }));
      }
      // Show the new geometry briefly, the way a desktop terminal does
      if (!badgeEnabled) return;
      setSizeBadge({ cols, rows });
      if (badgeTimer) clearTimeout(badgeTimer);
      badgeTimer = setTimeout(() => setSizeBadge(null), 1500);
    });

    // Observe container size changes. Coalesce bursts (e.g. sidebar drag) into
    // one fit per frame so we don't spam the PTY with intermediate sizes.
    let fitScheduled = false;
    const resizeObserver = new ResizeObserver(() => {
      if (fitScheduled) return;
      fitScheduled = true;
      requestAnimationFrame(() => {
        fitScheduled = false;
        safeFit();
      });
    });
    resizeObserver.observe(container);

    return () => {
      termEl?.removeEventListener('contextmenu', handleContextMenu);
      window.removeEventListener('keydown', handleBrowserShortcut, true);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      resizeObserver.disconnect();
      if (badgeTimer) clearTimeout(badgeTimer);
      resyncSizeRef.current = null;
      terminalRef.current = null;
      ws.close();
      terminal.dispose();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- profiles/folders only needed at mount for scrollback resolution
  }, [session.connection.id, token]);

  // When this tab becomes active again its pane is re-shown (and a reorder moves
  // it in the DOM). Re-fit — the window may have been resized while it was
  // hidden — repaint the visible rows, and hand keyboard focus back.
  useEffect(() => {
    if (!isActive) return;
    const raf = requestAnimationFrame(() => {
      resyncSizeRef.current?.();
      const terminal = terminalRef.current;
      if (terminal) {
        terminal.refresh(0, terminal.rows - 1);
        terminal.focus();
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [isActive, tabIndex]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
      {/* xterm owns this element's children — keep React out of it */}
      <div
        ref={containerRef}
        style={{
          width: '100%',
          height: '100%',
          background: '#1a1a2e',
          overflow: 'hidden',
        }}
      />
      {sizeBadge && (
        <div
          style={{
            position: 'absolute',
            right: 14,
            bottom: 12,
            padding: '3px 9px',
            borderRadius: 4,
            background: 'rgba(0, 0, 0, 0.72)',
            border: '1px solid rgba(255, 255, 255, 0.15)',
            color: '#e0e0e0',
            fontFamily: 'Menlo, Consolas, "Courier New", monospace',
            fontSize: 12,
            lineHeight: 1.6,
            pointerEvents: 'none',
            userSelect: 'none',
          }}
        >
          {sizeBadge.cols} × {sizeBadge.rows}
        </div>
      )}
    </div>
  );
};
