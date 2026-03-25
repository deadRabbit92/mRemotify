use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Client → Daemon messages (JSON text frames)
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
#[allow(non_snake_case)]
pub enum ClientMessage {
    #[serde(rename = "connect")]
    Connect {
        host: String,
        port: u16,
        username: String,
        password: String,
        #[serde(default)]
        domain: String,
        #[serde(default = "default_width")]
        width: u16,
        #[serde(default = "default_height")]
        height: u16,
        /// RDP security mode: "tls", "nla", "rdp", or "any". Defaults to "tls".
        #[serde(default = "default_security")]
        security: String,
        /// Whether clipboard sharing is enabled. Defaults to true.
        #[serde(default = "default_clipboard")]
        clipboard: bool,
    },
    #[serde(rename = "mouseMove")]
    MouseMove { x: i32, y: i32 },
    #[serde(rename = "mouseDown")]
    MouseDown { button: u8, x: i32, y: i32 },
    #[serde(rename = "mouseUp")]
    MouseUp { button: u8, x: i32, y: i32 },
    #[serde(rename = "mouseScroll")]
    MouseScroll { delta: i32, x: i32, y: i32 },
    #[serde(rename = "keyDown")]
    KeyDown { keySym: u32 },
    #[serde(rename = "keyUp")]
    KeyUp { keySym: u32 },
    #[serde(rename = "clipboardWrite")]
    ClipboardWrite { text: String },
    #[serde(rename = "resize")]
    Resize { width: u16, height: u16 },
    /// Pause frame capture (tab is inactive / not visible).
    #[serde(rename = "pause")]
    Pause,
    /// Resume frame capture (tab became active again).
    #[serde(rename = "resume")]
    Resume,
}

fn default_width() -> u16 {
    1280
}
fn default_height() -> u16 {
    720
}
fn default_security() -> String {
    "nla".to_string()
}
fn default_clipboard() -> bool {
    true
}

// ---------------------------------------------------------------------------
// Daemon → Client messages (JSON text frames)
// Binary frames (JPEG) are sent directly, not through this enum.
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
#[serde(tag = "type")]
pub enum ServerMessage {
    #[serde(rename = "connected")]
    Connected,
    #[serde(rename = "error")]
    Error { message: String },
    #[serde(rename = "disconnected")]
    Disconnected,
    #[serde(rename = "clipboardRead")]
    ClipboardRead { text: String },
}

impl ServerMessage {
    pub fn to_json(&self) -> String {
        serde_json::to_string(self).expect("ServerMessage serialization cannot fail")
    }
}
