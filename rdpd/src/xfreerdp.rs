use std::process::Stdio;
use tokio::process::{Child, Command};
use tracing::{info, warn};

/// Spawn an xfreerdp3 process targeting the given X display.
///
/// Returns the child process handle. The caller is responsible for killing it
/// on session teardown.
pub async fn spawn_xfreerdp(
    display_num: u32,
    host: &str,
    port: u16,
    username: &str,
    password: &str,
    domain: &str,
    width: u16,
    height: u16,
    security: &str,
    clipboard: bool,
) -> std::io::Result<Child> {
    let display_str = format!(":{}", display_num);
    let geometry = format!("{}x{}", width, height);

    let mut cmd = Command::new("xfreerdp3");
    cmd.env("DISPLAY", &display_str);

    // Connection target
    cmd.arg(format!("/v:{}:{}", host, port));
    cmd.arg(format!("/u:{}", username));
    cmd.arg(format!("/p:{}", password));
    if !domain.is_empty() {
        cmd.arg(format!("/d:{}", domain));
    }

    // Display settings
    cmd.arg(format!("/size:{}", geometry));
    cmd.arg("/bpp:32");
    cmd.arg("/gfx");

    // Security mode — "tls", "nla", "rdp", or "any"
    cmd.arg(format!("/sec:{}", security));
    // Accept all certificates for lab/internal use
    cmd.arg("/cert:ignore");

    // Dynamic resolution — allows us to resize via xrandr
    cmd.arg("/dynamic-resolution");

    // Disable features we don't need
    cmd.arg("-decorations");
    cmd.arg("-wallpaper");
    cmd.arg("-aero");
    cmd.arg("-themes");
    cmd.arg("-sound");
    cmd.arg("-microphone");

    // Clipboard redirection
    if clipboard {
        cmd.arg("+clipboard");
    } else {
        cmd.arg("-clipboard");
    }

    // TODO: audio forwarding — could use /sound:sys:pulse with a per-session PulseAudio sink

    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    info!(
        display_str = %display_str,
        host = %host,
        port = %port,
        username = %username,
        geometry = %geometry,
        "spawning xfreerdp3"
    );

    let child = cmd.spawn()?;
    info!(pid = child.id().unwrap_or(0), "xfreerdp3 process started");

    Ok(child)
}

/// Kill an xfreerdp3 child process gracefully, falling back to SIGKILL.
pub async fn kill_xfreerdp(child: &mut Child) {
    if let Some(pid) = child.id() {
        info!(pid, "terminating xfreerdp3");
        // Try SIGTERM first
        unsafe {
            libc::kill(pid as i32, libc::SIGTERM);
        }
        // Give it a moment to exit
        match tokio::time::timeout(std::time::Duration::from_secs(3), child.wait()).await {
            Ok(Ok(status)) => {
                info!(pid, ?status, "xfreerdp3 exited after SIGTERM");
            }
            _ => {
                warn!(pid, "xfreerdp3 did not exit after SIGTERM, sending SIGKILL");
                let _ = child.kill().await;
            }
        }
    }
}
