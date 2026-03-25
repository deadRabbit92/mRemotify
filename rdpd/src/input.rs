use tracing::{debug, trace, warn};
use x11rb::connection::{Connection, RequestConnection};
use x11rb::protocol::xproto::{self, ConnectionExt};
use x11rb::protocol::xtest::ConnectionExt as XTestConnectionExt;
use x11rb::rust_connection::RustConnection;

/// Handles X11 input injection via the XTEST extension.
pub struct InputInjector {
    conn: RustConnection,
    root: u32,
    #[allow(dead_code)]
    screen_num: usize,
}

impl InputInjector {
    /// Connect to the X display for input injection.
    pub async fn connect(display_num: u32) -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        let display_str = format!(":{}", display_num);
        let mut last_err = String::new();

        for attempt in 0..30 {
            match RustConnection::connect(Some(&display_str)) {
                Ok((conn, screen_num)) => {
                    let screen = &conn.setup().roots[screen_num];
                    let root = screen.root;

                    // Verify XTEST extension is available
                    match conn.extension_information(x11rb::protocol::xtest::X11_EXTENSION_NAME) {
                        Ok(Some(_)) => {
                            debug!(display = %display_str, attempt, "input injector connected with XTEST");
                        }
                        _ => {
                            return Err("XTEST extension not available on X display".into());
                        }
                    }

                    return Ok(Self {
                        conn,
                        root,
                        screen_num,
                    });
                }
                Err(e) => {
                    last_err = e.to_string();
                    tokio::time::sleep(std::time::Duration::from_millis(200)).await;
                }
            }
        }

        Err(format!(
            "input injector: failed to connect to X display {} after 30 attempts: {}",
            display_str, last_err
        )
        .into())
    }

    /// Move the mouse pointer to (x, y).
    pub fn mouse_move(&self, x: i32, y: i32) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        self.conn.xtest_fake_input(
            xproto::MOTION_NOTIFY_EVENT,
            0, // detail (unused for motion)
            x11rb::CURRENT_TIME,
            self.root,
            x as i16,
            y as i16,
            0,
        )?;
        self.conn.flush()?;
        trace!(x, y, "mouse_move injected");
        Ok(())
    }

    /// Press a mouse button. Button mapping: 1=left, 2=middle, 3=right.
    pub fn mouse_down(&self, button: u8, x: i32, y: i32) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        // Move first, then press
        self.mouse_move(x, y)?;
        self.conn.xtest_fake_input(
            xproto::BUTTON_PRESS_EVENT,
            button,
            x11rb::CURRENT_TIME,
            self.root,
            0,
            0,
            0,
        )?;
        self.conn.flush()?;
        trace!(button, x, y, "mouse_down injected");
        Ok(())
    }

    /// Release a mouse button.
    pub fn mouse_up(&self, button: u8, x: i32, y: i32) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        self.mouse_move(x, y)?;
        self.conn.xtest_fake_input(
            xproto::BUTTON_RELEASE_EVENT,
            button,
            x11rb::CURRENT_TIME,
            self.root,
            0,
            0,
            0,
        )?;
        self.conn.flush()?;
        trace!(button, x, y, "mouse_up injected");
        Ok(())
    }

    /// Scroll the mouse wheel. In X11, button 4 = scroll up, button 5 = scroll down.
    pub fn mouse_scroll(&self, delta: i32, x: i32, y: i32) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        self.mouse_move(x, y)?;

        let (button, count) = if delta < 0 {
            (5u8, (-delta) as u32) // scroll down
        } else {
            (4u8, delta as u32) // scroll up
        };

        for _ in 0..count.min(10) {
            self.conn.xtest_fake_input(
                xproto::BUTTON_PRESS_EVENT,
                button,
                x11rb::CURRENT_TIME,
                self.root,
                0,
                0,
                0,
            )?;
            self.conn.xtest_fake_input(
                xproto::BUTTON_RELEASE_EVENT,
                button,
                x11rb::CURRENT_TIME,
                self.root,
                0,
                0,
                0,
            )?;
        }
        self.conn.flush()?;
        trace!(delta, button, count, x, y, "mouse_scroll injected");
        Ok(())
    }

    /// Convert an X11 KeySym to a keycode on this display, then inject a key press.
    pub fn key_down(&self, keysym: u32) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let keycode = self.keysym_to_keycode(keysym)?;
        self.conn.xtest_fake_input(
            xproto::KEY_PRESS_EVENT,
            keycode,
            x11rb::CURRENT_TIME,
            self.root,
            0,
            0,
            0,
        )?;
        self.conn.flush()?;
        trace!(keysym, keycode, "key_down injected");
        Ok(())
    }

    /// Inject a key release.
    pub fn key_up(&self, keysym: u32) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let keycode = self.keysym_to_keycode(keysym)?;
        self.conn.xtest_fake_input(
            xproto::KEY_RELEASE_EVENT,
            keycode,
            x11rb::CURRENT_TIME,
            self.root,
            0,
            0,
            0,
        )?;
        self.conn.flush()?;
        trace!(keysym, keycode, "key_up injected");
        Ok(())
    }

    /// Map a KeySym to a keycode on the current display.
    fn keysym_to_keycode(&self, keysym: u32) -> Result<u8, Box<dyn std::error::Error + Send + Sync>> {
        let setup = self.conn.setup();
        let min_keycode = setup.min_keycode;
        let max_keycode = setup.max_keycode;

        let mapping = self
            .conn
            .get_keyboard_mapping(min_keycode, max_keycode - min_keycode + 1)?
            .reply()?;

        let keysyms_per_keycode = mapping.keysyms_per_keycode as usize;

        for i in 0..=(max_keycode - min_keycode) as usize {
            for j in 0..keysyms_per_keycode {
                let idx = i * keysyms_per_keycode + j;
                if idx < mapping.keysyms.len() && mapping.keysyms[idx] == keysym {
                    return Ok(min_keycode + i as u8);
                }
            }
        }

        // If keysym not found in the current mapping, try to use xdotool as fallback
        warn!(keysym, "keysym not found in keyboard mapping");
        Err(format!("keysym 0x{:x} not found in keyboard mapping", keysym).into())
    }

    // TODO: clipboard monitoring — watch X11 CLIPBOARD selection changes via
    // XFixes SelectionNotify and forward to the browser as clipboardRead messages

    /// Set the X11 clipboard content (CLIPBOARD selection).
    /// Uses xsel which keeps the selection data in a background daemon,
    /// ensuring the clipboard content remains available for xfreerdp to read
    /// even after this function returns.
    pub fn set_clipboard(&self, display_num: u32, text: &str) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        use std::process::{Command, Stdio};
        use std::io::Write;

        let display = format!(":{}", display_num);

        // Clear existing clipboard first to force xfreerdp to re-read
        let _ = Command::new("xsel")
            .args(["--clipboard", "--clear"])
            .env("DISPLAY", &display)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();

        // xsel --clipboard --input keeps a background daemon that owns the
        // CLIPBOARD selection persistently, unlike xclip which exits and
        // loses ownership. This ensures xfreerdp can read the new content
        // when it detects the selection change.
        let mut child = Command::new("xsel")
            .args(["--clipboard", "--input"])
            .env("DISPLAY", &display)
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()?;

        if let Some(ref mut stdin) = child.stdin {
            stdin.write_all(text.as_bytes())?;
        }
        child.wait()?;

        debug!(len = text.len(), "clipboard set via xsel");
        Ok(())
    }
}
