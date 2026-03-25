use image::codecs::jpeg::JpegEncoder;
use image::ExtendedColorType;
use std::io::Cursor;
use tracing::{debug, trace};
use x11rb::connection::Connection;
use x11rb::protocol::xproto::{self, ConnectionExt, ImageFormat};
use x11rb::rust_connection::RustConnection;
use xxhash_rust::xxh3::xxh3_64;

/// Connects to the X11 display and provides framebuffer capture.
pub struct FrameCapture {
    conn: RustConnection,
    root: u32,
    width: u16,
    height: u16,
    prev_hash: u64,
}

impl FrameCapture {
    /// Connect to the X display specified by `display_num` (e.g. 10 → ":10").
    /// Retries a few times since Xvfb may take a moment to start.
    pub async fn connect(display_num: u32) -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        let display_str = format!(":{}", display_num);
        let mut last_err = String::new();

        for attempt in 0..30 {
            match RustConnection::connect(Some(&display_str)) {
                Ok((conn, screen_num)) => {
                    let screen = &conn.setup().roots[screen_num];
                    let root = screen.root;
                    let width = screen.width_in_pixels;
                    let height = screen.height_in_pixels;
                    debug!(
                        display = %display_str,
                        width,
                        height,
                        attempt,
                        "connected to X11 display"
                    );
                    return Ok(Self {
                        conn,
                        root,
                        width,
                        height,
                        prev_hash: 0,
                    });
                }
                Err(e) => {
                    last_err = e.to_string();
                    trace!(attempt, err = %last_err, "X11 connect attempt failed, retrying...");
                    tokio::time::sleep(std::time::Duration::from_millis(200)).await;
                }
            }
        }

        Err(format!(
            "failed to connect to X display {} after 30 attempts: {}",
            display_str, last_err
        )
        .into())
    }

    /// Capture the full framebuffer. Returns Some(jpeg_bytes) if the frame
    /// changed since last capture, None if unchanged.
    ///
    /// TODO: implement dirty region tracking — capture only changed tiles and
    /// send them with (x, y, w, h) metadata to reduce bandwidth.
    pub fn capture_frame(&mut self, quality: u8) -> Result<Option<Vec<u8>>, Box<dyn std::error::Error + Send + Sync>> {
        let reply = self
            .conn
            .get_image(
                ImageFormat::Z_PIXMAP,
                self.root,
                0,
                0,
                self.width,
                self.height,
                u32::MAX,
            )?
            .reply()?;

        let pixels = &reply.data;

        // Fast hash comparison to skip unchanged frames
        let hash = xxh3_64(pixels);
        if hash == self.prev_hash {
            return Ok(None);
        }
        self.prev_hash = hash;

        // X11 ZPixmap gives us BGRA (or BGRx) — convert to RGB for JPEG
        let pixel_count = (self.width as usize) * (self.height as usize);
        let mut rgb = Vec::with_capacity(pixel_count * 3);
        for i in 0..pixel_count {
            let base = i * 4;
            if base + 2 < pixels.len() {
                rgb.push(pixels[base + 2]); // R
                rgb.push(pixels[base + 1]); // G
                rgb.push(pixels[base]);     // B
            }
        }

        // Encode as JPEG
        let mut jpeg_buf = Cursor::new(Vec::with_capacity(256 * 1024));
        let mut encoder = JpegEncoder::new_with_quality(&mut jpeg_buf, quality);
        encoder.encode(&rgb, self.width as u32, self.height as u32, ExtendedColorType::Rgb8)?;

        let jpeg_bytes = jpeg_buf.into_inner();
        trace!(
            size = jpeg_bytes.len(),
            width = self.width,
            height = self.height,
            "frame captured and encoded"
        );

        Ok(Some(jpeg_bytes))
    }

    pub fn width(&self) -> u16 {
        self.width
    }

    pub fn height(&self) -> u16 {
        self.height
    }

    /// Update the capture dimensions (e.g. after xrandr resize).
    pub fn set_dimensions(&mut self, width: u16, height: u16) {
        self.width = width;
        self.height = height;
        // Reset hash to force next capture to be sent
        self.prev_hash = 0;
    }
}
