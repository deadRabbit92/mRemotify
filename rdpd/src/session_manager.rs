use dashmap::DashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;
use tracing::{info, warn};

/// Tracks active sessions and allocates X display numbers.
///
/// Display numbers start at 10 and increment. Released numbers are NOT reused
/// to avoid races with lingering Xvfb processes. Since each number is a u32,
/// we can run ~4 billion sessions before wrapping — effectively unlimited.
pub struct SessionManager {
    /// Maps display_num → session metadata (currently just a marker).
    sessions: DashMap<u32, SessionInfo>,
    /// Next display number to allocate.
    next_display: AtomicU32,
}

pub struct SessionInfo {
    pub host: String,
    pub username: String,
}

impl SessionManager {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            sessions: DashMap::new(),
            next_display: AtomicU32::new(10),
        })
    }

    /// Allocate a new display number for a session.
    pub fn allocate_display(&self) -> u32 {
        let num = self.next_display.fetch_add(1, Ordering::Relaxed);
        info!(display_num = num, "allocated display number");
        num
    }

    /// Register a session as active.
    pub fn register(&self, display_num: u32, host: String, username: String) {
        self.sessions.insert(display_num, SessionInfo { host, username });
        info!(display_num, active = self.sessions.len(), "session registered");
    }

    /// Remove a session when it ends.
    pub fn unregister(&self, display_num: u32) {
        if self.sessions.remove(&display_num).is_some() {
            info!(display_num, active = self.sessions.len(), "session unregistered");
        } else {
            warn!(display_num, "attempted to unregister unknown session");
        }
    }

    /// Number of active sessions.
    pub fn active_count(&self) -> usize {
        self.sessions.len()
    }
}
