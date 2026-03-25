use crate::capture::FrameCapture;
use crate::input::InputInjector;
use crate::protocol::{ClientMessage, ServerMessage};
use crate::xfreerdp;

use futures_util::stream::SplitSink;
use futures_util::{SinkExt, StreamExt};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Arc;
use tokio::net::TcpStream;
use tokio::sync::Mutex;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::WebSocketStream;
use tracing::{debug, error, info, warn};

/// Frame capture rate — ~15 fps.
const FRAME_INTERVAL_MS: u64 = 66;

/// JPEG quality (1-100).
const JPEG_QUALITY: u8 = 85;

type WsSink = Arc<Mutex<SplitSink<WebSocketStream<TcpStream>, Message>>>;

/// Represents a single active RDP session.
pub struct Session;

impl Session {
    /// Start a new RDP session: launch Xvfb, launch xfreerdp3, wire up frame
    /// capture and input injection, and proxy everything over the WebSocket.
    pub async fn run(
        display_num: u32,
        ws: WebSocketStream<TcpStream>,
        host: String,
        port: u16,
        username: String,
        password: String,
        domain: String,
        width: u16,
        height: u16,
        security: String,
        clipboard: bool,
    ) {
        let (ws_sink, mut ws_stream) = ws.split();
        let sink: WsSink = Arc::new(Mutex::new(ws_sink));

        // Helper to send a JSON control message
        let send_msg = |sink: WsSink, msg: ServerMessage| async move {
            let mut s = sink.lock().await;
            let _ = s.send(Message::Text(msg.to_json())).await;
        };

        // 1. Start Xvnc (TigerVNC) — provides full RandR support for dynamic resize
        let geometry = format!("{}x{}", width, height);
        let display_arg = format!(":{}", display_num);
        let rfb_port = format!("{}", 5900 + display_num); // VNC port (unused but required)

        info!(display_num, %geometry, "starting Xvnc");
        let xvfb_result = tokio::process::Command::new("Xvnc")
            .args([
                &display_arg,
                "-geometry", &geometry,
                "-depth", "24",
                "-SecurityTypes", "None",
                "-rfbport", &rfb_port,
                "-ac",           // disable access control
                "-NeverShared",
                "-DisconnectClients=0",
            ])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn();

        let mut xvfb = match xvfb_result {
            Ok(child) => child,
            Err(e) => {
                error!(err = %e, "failed to start Xvnc");
                send_msg(sink.clone(), ServerMessage::Error {
                    message: format!("Failed to start Xvnc: {}", e),
                }).await;
                return;
            }
        };

        // Give Xvnc a moment to initialize
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;

        // Check Xvnc is still running
        match xvfb.try_wait() {
            Ok(Some(status)) => {
                error!(?status, "Xvnc exited prematurely");
                send_msg(sink.clone(), ServerMessage::Error {
                    message: format!("Xvnc exited with status: {}", status),
                }).await;
                return;
            }
            Ok(None) => { /* still running, good */ }
            Err(e) => {
                error!(err = %e, "failed to check Xvnc status");
            }
        }

        // 2. Start xfreerdp3
        info!(display_num, host = %host, port, "starting xfreerdp3");
        let xfreerdp_result = xfreerdp::spawn_xfreerdp(
            display_num, &host, port, &username, &password, &domain, width, height, &security, clipboard,
        ).await;

        let mut xfreerdp = match xfreerdp_result {
            Ok(child) => child,
            Err(e) => {
                error!(err = %e, "failed to start xfreerdp3");
                send_msg(sink.clone(), ServerMessage::Error {
                    message: format!("Failed to start xfreerdp3: {}", e),
                }).await;
                let _ = xvfb.kill().await;
                return;
            }
        };

        // Wait a bit for xfreerdp to connect before we start capturing
        tokio::time::sleep(std::time::Duration::from_secs(2)).await;

        // Check xfreerdp is still running (connection failure shows up here)
        match xfreerdp.try_wait() {
            Ok(Some(status)) => {
                // Capture stderr for diagnostics
                let stderr_msg = if let Some(mut stderr) = xfreerdp.stderr.take() {
                    use tokio::io::AsyncReadExt;
                    let mut buf = Vec::new();
                    let _ = stderr.read_to_end(&mut buf).await;
                    String::from_utf8_lossy(&buf).to_string()
                } else {
                    String::new()
                };
                error!(?status, stderr = %stderr_msg, "xfreerdp3 exited prematurely");
                let user_msg = if stderr_msg.contains("LOGON_FAILURE") {
                    "RDP authentication failed — check username/password".to_string()
                } else if stderr_msg.contains("CONNECT_TRANSPORT_FAILED") || stderr_msg.contains("connect_rdp") {
                    "Could not reach RDP host — check host/port".to_string()
                } else {
                    format!("xfreerdp3 exited (code {}): {}", status, stderr_msg.lines().filter(|l| l.contains("ERROR")).collect::<Vec<_>>().join("; "))
                };
                send_msg(sink.clone(), ServerMessage::Error { message: user_msg }).await;
                let _ = xvfb.kill().await;
                return;
            }
            Ok(None) => { /* still running */ }
            Err(e) => {
                error!(err = %e, "failed to check xfreerdp3 status");
            }
        }

        // 3. Connect frame capture and input injector to the X display
        let capture_result = FrameCapture::connect(display_num).await;
        let input_result = InputInjector::connect(display_num).await;

        let mut capture = match capture_result {
            Ok(c) => c,
            Err(e) => {
                error!(err = %e, "failed to connect frame capture");
                send_msg(sink.clone(), ServerMessage::Error {
                    message: format!("Failed to connect to X display: {}", e),
                }).await;
                xfreerdp::kill_xfreerdp(&mut xfreerdp).await;
                let _ = xvfb.kill().await;
                return;
            }
        };

        let input = match input_result {
            Ok(i) => i,
            Err(e) => {
                error!(err = %e, "failed to connect input injector");
                send_msg(sink.clone(), ServerMessage::Error {
                    message: format!("Failed to connect input injector: {}", e),
                }).await;
                xfreerdp::kill_xfreerdp(&mut xfreerdp).await;
                let _ = xvfb.kill().await;
                return;
            }
        };

        // Notify client that we're connected
        send_msg(sink.clone(), ServerMessage::Connected).await;
        info!(display_num, "RDP session connected, entering proxy mode");

        let input = Arc::new(input);

        // 4. Spawn frame capture loop
        let frame_sink = sink.clone();
        let frame_shutdown = Arc::new(AtomicBool::new(false));
        let frame_shutdown_rx = frame_shutdown.clone();
        let capture_display = display_num;

        // Shared resize state: packs (width << 16 | height) into AtomicU32.
        // Value of 0 means no pending resize.
        let pending_resize = Arc::new(AtomicU32::new(0));
        let pending_resize_rx = pending_resize.clone();

        // Pause state: when the browser tab is inactive, we skip frame capture
        // to free CPU/bandwidth for the active RDP session.
        let paused = Arc::new(AtomicBool::new(false));
        let paused_rx = paused.clone();

        let capture_handle = tokio::task::spawn_blocking(move || {
            let rt = tokio::runtime::Handle::current();

            loop {
                // Check for shutdown
                if frame_shutdown_rx.load(Ordering::Relaxed) {
                    break;
                }

                // When paused (tab inactive), sleep longer and skip capture
                if paused_rx.load(Ordering::Relaxed) {
                    std::thread::sleep(std::time::Duration::from_millis(200));
                    continue;
                }

                // Check for pending resize
                let packed = pending_resize_rx.swap(0, Ordering::Relaxed);
                if packed != 0 {
                    let new_w = (packed >> 16) as u16;
                    let new_h = (packed & 0xFFFF) as u16;
                    if new_w != capture.width() || new_h != capture.height() {
                        info!(width = new_w, height = new_h, display = capture_display, "applying resize");
                        capture.set_dimensions(new_w, new_h);
                    }
                }

                match capture.capture_frame(JPEG_QUALITY) {
                    Ok(Some(jpeg_bytes)) => {
                        let sink = frame_sink.clone();
                        rt.block_on(async {
                            let mut s = sink.lock().await;
                            if s.send(Message::Binary(jpeg_bytes)).await.is_err() {
                                // WebSocket closed
                            }
                        });
                    }
                    Ok(None) => {
                        // Frame unchanged, skip
                    }
                    Err(e) => {
                        let err_str = e.to_string();
                        // Match errors occur during resize when dimensions are briefly
                        // out of sync with the actual screen size — just skip the frame.
                        if err_str.contains("Match") {
                            warn!(display = capture_display, "frame capture size mismatch (resize in progress), skipping");
                            std::thread::sleep(std::time::Duration::from_millis(100));
                            continue;
                        }
                        warn!(err = %e, display = capture_display, "frame capture error");
                        break;
                    }
                }

                std::thread::sleep(std::time::Duration::from_millis(FRAME_INTERVAL_MS));
            }
        });

        // 5. Spawn clipboard monitor (only if clipboard is enabled)
        let clipboard_handle = if clipboard {
            let clip_sink = sink.clone();
            let clip_shutdown = frame_shutdown.clone();
            let clip_display = display_num;

            Some(tokio::spawn(async move {
                let display_str = format!(":{}", clip_display);
                let mut prev_hash: u64 = 0;

                loop {
                    if clip_shutdown.load(Ordering::Relaxed) {
                        break;
                    }

                    tokio::time::sleep(std::time::Duration::from_millis(500)).await;

                    // Read the X clipboard via xsel
                    let output = match tokio::process::Command::new("xsel")
                        .env("DISPLAY", &display_str)
                        .args(["--clipboard", "--output"])
                        .output()
                        .await
                    {
                        Ok(o) if o.status.success() => o.stdout,
                        _ => continue,
                    };

                    // Hash to detect changes (avoid sending identical content)
                    let hash = xxhash_rust::xxh3::xxh3_64(&output);
                    if hash == prev_hash || output.is_empty() {
                        continue;
                    }
                    prev_hash = hash;

                    if let Ok(text) = String::from_utf8(output) {
                        debug!(len = text.len(), display = clip_display, "remote clipboard changed");
                        let mut s = clip_sink.lock().await;
                        let _ = s.send(Message::Text(
                            ServerMessage::ClipboardRead { text }.to_json()
                        )).await;
                    }
                }
            }))
        } else {
            None
        };

        // 6. Process incoming WebSocket messages (input events)
        let input_ref = input.clone();
        let ws_display = display_num;
        let resize_ref = pending_resize.clone();
        let paused_ref = paused.clone();

        while let Some(msg_result) = ws_stream.next().await {
            match msg_result {
                Ok(Message::Text(text)) => {
                    match serde_json::from_str::<ClientMessage>(&text) {
                        Ok(client_msg) => {
                            if let Err(e) = handle_input(&input_ref, ws_display, client_msg, &resize_ref, &paused_ref, clipboard).await {
                                warn!(err = %e, "input injection error");
                            }
                        }
                        Err(e) => {
                            warn!(err = %e, raw = %text, "failed to parse client message");
                        }
                    }
                }
                Ok(Message::Close(_)) => {
                    info!(display_num, "client sent close frame");
                    break;
                }
                Ok(Message::Ping(data)) => {
                    let mut s = sink.lock().await;
                    let _ = s.send(Message::Pong(data)).await;
                }
                Ok(_) => { /* ignore binary from client, pong, etc */ }
                Err(e) => {
                    warn!(err = %e, "WebSocket receive error");
                    break;
                }
            }
        }

        // 7. Cleanup
        info!(display_num, "session ending, cleaning up");

        // Signal capture + clipboard loops to stop
        frame_shutdown.store(true, Ordering::Relaxed);
        let _ = capture_handle.await;
        if let Some(handle) = clipboard_handle {
            handle.abort();
            let _ = handle.await;
        }

        // Send disconnected message
        {
            let mut s = sink.lock().await;
            let _ = s.send(Message::Text(ServerMessage::Disconnected.to_json())).await;
            let _ = s.close().await;
        }

        // Kill child processes
        xfreerdp::kill_xfreerdp(&mut xfreerdp).await;
        let _ = xvfb.kill().await;

        info!(display_num, "session cleanup complete");
    }
}

#[allow(non_snake_case)]
async fn handle_input(
    input: &InputInjector,
    display_num: u32,
    msg: ClientMessage,
    pending_resize: &AtomicU32,
    paused: &AtomicBool,
    clipboard_enabled: bool,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    match msg {
        ClientMessage::MouseMove { x, y } => input.mouse_move(x, y),
        ClientMessage::MouseDown { button, x, y } => input.mouse_down(button, x, y),
        ClientMessage::MouseUp { button, x, y } => input.mouse_up(button, x, y),
        ClientMessage::MouseScroll { delta, x, y } => input.mouse_scroll(delta, x, y),
        ClientMessage::KeyDown { keySym } => input.key_down(keySym),
        ClientMessage::KeyUp { keySym } => input.key_up(keySym),
        ClientMessage::ClipboardWrite { text } => {
            if clipboard_enabled {
                input.set_clipboard(display_num, &text)
            } else {
                Ok(())
            }
        }
        ClientMessage::Resize { width, height } => {
            // Clamp to reasonable bounds
            let w = width.clamp(320, 7680);
            let h = height.clamp(200, 4320);

            let display_str = format!(":{}", display_num);
            let mode_name = format!("{}x{}", w, h);

            info!(width = w, height = h, display = display_num, "resize requested");

            // Signal the capture loop to update dimensions FIRST, so it doesn't
            // try to capture at the old (larger) size after the screen shrinks.
            pending_resize.store(((w as u32) << 16) | (h as u32), Ordering::Relaxed);

            // Xvnc supports full RandR. Add a new mode (dummy timings work fine)
            // and switch to it. Errors from --newmode/--addmode are ignored since
            // the mode may already exist from a previous resize.
            let _ = tokio::process::Command::new("xrandr")
                .env("DISPLAY", &display_str)
                .args([
                    "--newmode", &mode_name,
                    "0",  // dummy clock
                    &w.to_string(), &w.to_string(), &w.to_string(), &w.to_string(),
                    &h.to_string(), &h.to_string(), &h.to_string(), &h.to_string(),
                ])
                .output()
                .await;

            let _ = tokio::process::Command::new("xrandr")
                .env("DISPLAY", &display_str)
                .args(["--addmode", "VNC-0", &mode_name])
                .output()
                .await;

            let resize_result = tokio::process::Command::new("xrandr")
                .env("DISPLAY", &display_str)
                .args(["--output", "VNC-0", "--mode", &mode_name])
                .output()
                .await?;

            if resize_result.status.success() {
                info!(width = w, height = h, display = display_num, "xrandr resize succeeded");

                // Resize the xfreerdp3 window to fill the new screen.
                // xfreerdp3 with /dynamic-resolution detects its window resize
                // and sends a Display Control Channel update to the RDP server.
                tokio::time::sleep(std::time::Duration::from_millis(100)).await;

                // Find the xfreerdp window and resize it
                let search_result = tokio::process::Command::new("xdotool")
                    .env("DISPLAY", &display_str)
                    .args(["search", "--onlyvisible", "--name", ""])
                    .output()
                    .await;

                if let Ok(output) = search_result {
                    let wids = String::from_utf8_lossy(&output.stdout);
                    for wid in wids.lines() {
                        let wid = wid.trim();
                        if wid.is_empty() { continue; }
                        let _ = tokio::process::Command::new("xdotool")
                            .env("DISPLAY", &display_str)
                            .args([
                                "windowmove", "--sync", wid, "0", "0",
                            ])
                            .output()
                            .await;
                        let _ = tokio::process::Command::new("xdotool")
                            .env("DISPLAY", &display_str)
                            .args([
                                "windowsize", "--sync", wid,
                                &w.to_string(), &h.to_string(),
                            ])
                            .output()
                            .await;
                    }
                }
            } else {
                let stderr = String::from_utf8_lossy(&resize_result.stderr);
                warn!(width = w, height = h, stderr = %stderr, "xrandr resize failed");
            }

            Ok(())
        }
        ClientMessage::Pause => {
            info!(display_num, "frame capture paused (tab inactive)");
            paused.store(true, Ordering::Relaxed);
            Ok(())
        }
        ClientMessage::Resume => {
            info!(display_num, "frame capture resumed (tab active)");
            paused.store(false, Ordering::Relaxed);
            Ok(())
        }
        ClientMessage::Connect { .. } => {
            // Connect is handled at session start, not here
            Ok(())
        }
    }
}
