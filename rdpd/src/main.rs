mod capture;
mod input;
mod protocol;
mod session;
mod session_manager;
mod xfreerdp;

use crate::protocol::{ClientMessage, ServerMessage};
use crate::session::Session;
use crate::session_manager::SessionManager;

use futures_util::StreamExt;
use std::env;
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::net::TcpListener;
use tokio_tungstenite::accept_async;
use tokio_tungstenite::tungstenite::Message;
use tracing::{error, info, warn};

#[tokio::main]
async fn main() {
    // Initialize tracing
    let log_level = env::var("RDPD_LOG_LEVEL").unwrap_or_else(|_| "info".to_string());
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_new(&log_level)
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    let listen_addr = env::var("RDPD_LISTEN").unwrap_or_else(|_| "0.0.0.0:7777".to_string());
    let addr: SocketAddr = listen_addr
        .parse()
        .expect("RDPD_LISTEN must be a valid socket address");

    let manager = SessionManager::new();

    let listener = TcpListener::bind(&addr)
        .await
        .expect("failed to bind TCP listener");

    info!(addr = %addr, "rdpd listening for WebSocket connections");

    loop {
        let (stream, peer) = match listener.accept().await {
            Ok(v) => v,
            Err(e) => {
                error!(err = %e, "TCP accept error");
                continue;
            }
        };

        let manager = manager.clone();

        tokio::spawn(async move {
            info!(peer = %peer, "new TCP connection");

            let ws = match accept_async(stream).await {
                Ok(ws) => ws,
                Err(e) => {
                    warn!(peer = %peer, err = %e, "WebSocket handshake failed");
                    return;
                }
            };

            handle_connection(ws, peer, manager).await;
        });
    }
}

async fn handle_connection(
    mut ws: tokio_tungstenite::WebSocketStream<tokio::net::TcpStream>,
    peer: SocketAddr,
    manager: Arc<SessionManager>,
) {
    // The first message must be a "connect" JSON message
    let connect_msg = match ws.next().await {
        Some(Ok(Message::Text(text))) => match serde_json::from_str::<ClientMessage>(&text) {
            Ok(ClientMessage::Connect {
                host,
                port,
                username,
                password,
                domain,
                width,
                height,
                security,
                clipboard,
            }) => {
                info!(
                    peer = %peer,
                    host = %host,
                    port,
                    username = %username,
                    width,
                    height,
                    security = %security,
                    clipboard,
                    "connect request received"
                );
                (host, port, username, password, domain, width, height, security, clipboard)
            }
            Ok(_) => {
                warn!(peer = %peer, "first message must be a connect request");
                let msg = ServerMessage::Error {
                    message: "First message must be a connect request".to_string(),
                };
                let _ = futures_util::SinkExt::send(
                    &mut ws,
                    Message::Text(msg.to_json()),
                ).await;
                return;
            }
            Err(e) => {
                warn!(peer = %peer, err = %e, "invalid connect message");
                let msg = ServerMessage::Error {
                    message: format!("Invalid connect message: {}", e),
                };
                let _ = futures_util::SinkExt::send(
                    &mut ws,
                    Message::Text(msg.to_json()),
                ).await;
                return;
            }
        },
        Some(Ok(Message::Close(_))) | None => {
            info!(peer = %peer, "client disconnected before sending connect");
            return;
        }
        Some(Ok(_)) => {
            warn!(peer = %peer, "expected text message with connect request");
            return;
        }
        Some(Err(e)) => {
            warn!(peer = %peer, err = %e, "WebSocket error before connect");
            return;
        }
    };

    let (host, port, username, password, domain, width, height, security, clipboard) = connect_msg;

    // Allocate a display number and register the session
    let display_num = manager.allocate_display();
    manager.register(display_num, host.clone(), username.clone());

    // Run the session — this blocks until the session ends
    Session::run(display_num, ws, host, port, username, password, domain, width, height, security, clipboard).await;

    // Cleanup
    manager.unregister(display_num);
    info!(peer = %peer, display_num, "session ended");
}
