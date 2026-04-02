import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Alert, Spin } from 'antd';
import { useStore } from '../../store';
import { Session } from '../../types';

interface Props {
  session: Session;
}

type Status = 'connecting' | 'connected' | 'disconnected' | 'error';

// ---------------------------------------------------------------------------
// X11 KeySym lookup table — maps browser event.code / event.key to X11 keysyms
// ---------------------------------------------------------------------------
const KEY_CODE_TO_KEYSYM: Record<string, number> = {
  // Letters (lowercase keysyms — X11 uses lowercase for letter keys)
  KeyA: 0x61, KeyB: 0x62, KeyC: 0x63, KeyD: 0x64, KeyE: 0x65,
  KeyF: 0x66, KeyG: 0x67, KeyH: 0x68, KeyI: 0x69, KeyJ: 0x6a,
  KeyK: 0x6b, KeyL: 0x6c, KeyM: 0x6d, KeyN: 0x6e, KeyO: 0x6f,
  KeyP: 0x70, KeyQ: 0x71, KeyR: 0x72, KeyS: 0x73, KeyT: 0x74,
  KeyU: 0x75, KeyV: 0x76, KeyW: 0x77, KeyX: 0x78, KeyY: 0x79,
  KeyZ: 0x7a,
  // Digits
  Digit0: 0x30, Digit1: 0x31, Digit2: 0x32, Digit3: 0x33, Digit4: 0x34,
  Digit5: 0x35, Digit6: 0x36, Digit7: 0x37, Digit8: 0x38, Digit9: 0x39,
  // Function keys
  F1: 0xffbe, F2: 0xffbf, F3: 0xffc0, F4: 0xffc1, F5: 0xffc2,
  F6: 0xffc3, F7: 0xffc4, F8: 0xffc5, F9: 0xffc6, F10: 0xffc7,
  F11: 0xffc8, F12: 0xffc9,
  // Navigation
  ArrowUp: 0xff52, ArrowDown: 0xff54, ArrowLeft: 0xff51, ArrowRight: 0xff53,
  Home: 0xff50, End: 0xff57, PageUp: 0xff55, PageDown: 0xff56,
  Insert: 0xff63,
  // Editing
  Backspace: 0xff08, Delete: 0xffff, Enter: 0xff0d, NumpadEnter: 0xff0d,
  Tab: 0xff09, Escape: 0xff1b, Space: 0x20,
  // Modifiers
  ShiftLeft: 0xffe1, ShiftRight: 0xffe2,
  ControlLeft: 0xffe3, ControlRight: 0xffe4,
  AltLeft: 0xffe9, AltRight: 0xffea,
  MetaLeft: 0xffeb, MetaRight: 0xffec,
  CapsLock: 0xffe5, NumLock: 0xff7f, ScrollLock: 0xff14,
  // Punctuation / symbols
  Minus: 0x2d, Equal: 0x3d, BracketLeft: 0x5b, BracketRight: 0x5d,
  Backslash: 0x5c, Semicolon: 0x3b, Quote: 0x27, Backquote: 0x60,
  Comma: 0x2c, Period: 0x2e, Slash: 0x2f,
  // Numpad
  Numpad0: 0xffb0, Numpad1: 0xffb1, Numpad2: 0xffb2, Numpad3: 0xffb3,
  Numpad4: 0xffb4, Numpad5: 0xffb5, Numpad6: 0xffb6, Numpad7: 0xffb7,
  Numpad8: 0xffb8, Numpad9: 0xffb9,
  NumpadDecimal: 0xffae, NumpadAdd: 0xffab, NumpadSubtract: 0xffad,
  NumpadMultiply: 0xffaa, NumpadDivide: 0xffaf,
  // Misc
  PrintScreen: 0xff61, Pause: 0xff13, ContextMenu: 0xff67,
};

// Shifted symbol mapping — when Shift is held, browser sends the symbol as event.key
const SHIFTED_KEY_TO_KEYSYM: Record<string, number> = {
  '!': 0x21, '@': 0x40, '#': 0x23, '$': 0x24, '%': 0x25,
  '^': 0x5e, '&': 0x26, '*': 0x2a, '(': 0x28, ')': 0x29,
  '_': 0x5f, '+': 0x2b, '{': 0x7b, '}': 0x7d, '|': 0x7c,
  ':': 0x3a, '"': 0x22, '~': 0x7e, '<': 0x3c, '>': 0x3e,
  '?': 0x3f,
};

function getKeySym(e: KeyboardEvent): number | null {
  // Try code-based lookup first (position-independent)
  const codeSym = KEY_CODE_TO_KEYSYM[e.code];
  if (codeSym !== undefined) {
    // For letter keys, return uppercase keysym if shift is held
    if (e.code.startsWith('Key') && e.shiftKey) {
      return codeSym - 0x20; // lowercase → uppercase in ASCII/X11
    }
    return codeSym;
  }

  // Try shifted symbol lookup
  const shiftedSym = SHIFTED_KEY_TO_KEYSYM[e.key];
  if (shiftedSym !== undefined) return shiftedSym;

  // Single printable character — use char code as keysym (works for ASCII)
  if (e.key.length === 1) {
    return e.key.charCodeAt(0);
  }

  return null;
}

// Module-level shared clipboard: stores the last clipboard text received from
// any RDP session. This enables cross-session clipboard (copy in session A,
// paste in session B) and acts as a fallback when navigator.clipboard.writeText
// fails due to missing user gesture or insecure context.
let sharedClipboardText = '';

function getWsUrl(connectionId: string, token: string): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host;
  return `${proto}//${host}/ws/rdp/${connectionId}?token=${encodeURIComponent(token)}`;
}

export const RdpTab: React.FC<Props> = ({ session }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const token = useStore((s) => s.token) ?? '';
  const activeSessionId = useStore((s) => s.activeSessionId);
  const [status, setStatus] = useState<Status>('connecting');
  const [errorMsg, setErrorMsg] = useState<string>('');

  // Track whether this tab is the active/visible one.
  // When inactive, skip JPEG frame decoding to avoid resource contention
  // that prevents multiple RDP sessions from working simultaneously.
  const isActiveRef = useRef(true);
  isActiveRef.current = activeSessionId === session.id;

  // Scale factor for translating mouse coordinates
  const scaleRef = useRef({ x: 1, y: 1 });

  const sendJson = useCallback((msg: object) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }, []);

  // When this tab becomes active again, send resume to restart frame capture
  const isActive = activeSessionId === session.id;
  useEffect(() => {
    if (isActive) {
      sendJson({ type: 'resume' });
    } else {
      sendJson({ type: 'pause' });
    }
  }, [isActive, sendJson]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    setStatus('connecting');
    setErrorMsg('');

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const url = getWsUrl(session.connection.id, token);
    const ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;

    // Track the remote resolution for coordinate mapping
    let remoteWidth = 1280;
    let remoteHeight = 720;

    const updateScale = () => {
      if (canvas.clientWidth > 0 && canvas.clientHeight > 0) {
        scaleRef.current = {
          x: remoteWidth / canvas.clientWidth,
          y: remoteHeight / canvas.clientHeight,
        };
      }
    };

    ws.onopen = () => {
      // The backend handles the connect message to rdpd — we just need
      // the WebSocket open. No client-side connect message needed.
    };

    ws.onmessage = async (event) => {
      if (event.data instanceof ArrayBuffer) {
        // Skip JPEG decoding when this tab is inactive to free CPU/memory
        // for the active RDP session. The capture loop on rdpd is also paused.
        if (!isActiveRef.current) return;

        // Binary frame — JPEG image
        const blob = new Blob([event.data], { type: 'image/jpeg' });
        try {
          const bitmap = await createImageBitmap(blob);
          // Update canvas size if the frame size changed
          if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
            canvas.width = bitmap.width;
            canvas.height = bitmap.height;
            remoteWidth = bitmap.width;
            remoteHeight = bitmap.height;
            updateScale();
          }
          ctx.drawImage(bitmap, 0, 0);
          bitmap.close();
        } catch (err) {
          console.warn('Failed to decode JPEG frame:', err);
        }
      } else {
        // Text frame — JSON control message
        try {
          const msg = JSON.parse(event.data);
          switch (msg.type) {
            case 'connected':
              setStatus('connected');
              break;
            case 'disconnected':
              setStatus('disconnected');
              break;
            case 'error':
              setStatus('error');
              setErrorMsg(msg.message || 'Unknown error');
              break;
            case 'clipboardRead':
              // Store in shared variable for cross-session clipboard and
              // as fallback when navigator.clipboard.writeText fails
              if (msg.text) {
                sharedClipboardText = msg.text;
                if (navigator.clipboard) {
                  navigator.clipboard.writeText(msg.text).catch(() => {
                    // Clipboard write may fail without user gesture —
                    // sharedClipboardText ensures the content is still
                    // available for paste in any session
                  });
                }
              }
              break;
          }
        } catch (err) {
          console.warn('Failed to parse control message:', err);
        }
      }
    };

    ws.onerror = () => {
      setStatus('error');
      setErrorMsg('WebSocket connection error');
    };

    ws.onclose = () => {
      if (status !== 'error') {
        setStatus('disconnected');
      }
    };

    // --- Mouse event handlers ---
    const translateCoords = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: Math.round((e.clientX - rect.left) * scaleRef.current.x),
        y: Math.round((e.clientY - rect.top) * scaleRef.current.y),
      };
    };

    const onMouseMove = (e: MouseEvent) => {
      const { x, y } = translateCoords(e);
      sendJson({ type: 'mouseMove', x, y });
    };

    const onMouseDown = (e: MouseEvent) => {
      e.preventDefault();
      canvas.focus();
      const { x, y } = translateCoords(e);
      // Browser button: 0=left, 1=middle, 2=right → X11: 1, 2, 3
      sendJson({ type: 'mouseDown', button: e.button + 1, x, y });
    };

    const onMouseUp = (e: MouseEvent) => {
      e.preventDefault();
      const { x, y } = translateCoords(e);
      sendJson({ type: 'mouseUp', button: e.button + 1, x, y });
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { x, y } = translateCoords(e);
      // Normalize delta: positive = scroll up, negative = scroll down
      const delta = e.deltaY < 0 ? 3 : -3;
      sendJson({ type: 'mouseScroll', delta, x, y });
    };

    const onContextMenu = (e: Event) => e.preventDefault();

    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', onContextMenu);

    // --- Keyboard event handlers ---
    const onKeyDown = (e: KeyboardEvent) => {
      // Ctrl+V / Cmd+V: read local clipboard → send to remote → delay → forward keystroke
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyV') {
        e.preventDefault();
        e.stopPropagation();

        const ctrlKeySym = e.ctrlKey ? 0xffe3 : 0xffeb;
        const injectPaste = (text: string) => {
          if (text) {
            sendJson({ type: 'clipboardWrite', text });
          }
          // Delay Ctrl+V injection to give xfreerdp time to detect the
          // X11 clipboard change and sync it to the RDP session. Without
          // this, the keystroke arrives before the Windows-side clipboard
          // has been updated, causing stale or empty paste.
          setTimeout(() => {
            sendJson({ type: 'keyDown', keySym: ctrlKeySym });
            sendJson({ type: 'keyDown', keySym: 0x76 }); // v
            sendJson({ type: 'keyUp', keySym: 0x76 });
            sendJson({ type: 'keyUp', keySym: ctrlKeySym });
          }, 150);
        };

        navigator.clipboard.readText().then((text) => {
          // Use navigator clipboard if available, otherwise fall back to
          // shared clipboard (enables cross-session copy/paste)
          injectPaste(text || sharedClipboardText);
        }).catch(() => {
          // Clipboard access denied — use shared clipboard as fallback
          injectPaste(sharedClipboardText);
        });
        return;
      }

      // Ctrl+C / Cmd+C: forward to remote, clipboard sync handled by rdpd monitor
      e.preventDefault();
      e.stopPropagation();
      const keySym = getKeySym(e);
      if (keySym !== null) {
        sendJson({ type: 'keyDown', keySym });
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      // Skip keyup for Ctrl+V since we sent synthetic keystrokes above
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyV') {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      const keySym = getKeySym(e);
      if (keySym !== null) {
        sendJson({ type: 'keyUp', keySym });
      }
    };

    canvas.addEventListener('keydown', onKeyDown);
    canvas.addEventListener('keyup', onKeyUp);

    // --- Resize observer: update scale + send dynamic resize to rdpd ---
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const resizeObserver = new ResizeObserver(() => {
      updateScale();

      // Debounce resize messages (300ms) to avoid spamming during drag
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        const w = container.clientWidth;
        const h = container.clientHeight;
        if (w > 0 && h > 0 && ws.readyState === WebSocket.OPEN) {
          // Use device pixel ratio for crisp rendering on HiDPI
          const dpr = window.devicePixelRatio || 1;
          const rw = Math.round(w * dpr);
          const rh = Math.round(h * dpr);
          ws.send(JSON.stringify({ type: 'resize', width: rw, height: rh }));
        }
      }, 300);
    });
    resizeObserver.observe(container);

    return () => {
      canvas.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('mousedown', onMouseDown);
      canvas.removeEventListener('mouseup', onMouseUp);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('contextmenu', onContextMenu);
      canvas.removeEventListener('keydown', onKeyDown);
      canvas.removeEventListener('keyup', onKeyUp);
      resizeObserver.disconnect();
      if (resizeTimer) clearTimeout(resizeTimer);
      ws.close();
      wsRef.current = null;
    };
  }, [session.connection.id, token, sendJson]);

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        background: '#000',
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <canvas
        ref={canvasRef}
        tabIndex={0}
        style={{
          width: '100%',
          height: '100%',
          outline: 'none',
          cursor: 'default',
        }}
      />

      {/* Status overlays */}
      {status === 'connecting' && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#000a',
          }}
        >
          <Spin size="large" tip="Connecting to RDP…" />
        </div>
      )}

      {status === 'error' && (
        <div style={{ position: 'absolute', top: 16, left: 16, right: 16 }}>
          <Alert
            type="error"
            showIcon
            message="RDP Connection Failed"
            description={errorMsg || 'See browser console for details.'}
          />
        </div>
      )}

      {status === 'disconnected' && (
        <div style={{ position: 'absolute', top: 16, left: 16, right: 16 }}>
          <Alert type="warning" showIcon message="RDP session disconnected." />
        </div>
      )}
    </div>
  );
};
