//! This module provides platform related functions.

#[cfg(feature = "events")]
pub use self::unix::query_kitty_graphics_support;
#[cfg(unix)]
#[cfg(feature = "events")]
pub use self::unix::supports_keyboard_enhancement;
#[cfg(feature = "events")]
pub use self::unix::KittyGraphicsSupport;
#[cfg(unix)]
pub(crate) use self::unix::{
    disable_raw_mode, enable_raw_mode, is_raw_mode_enabled, size, window_size,
};

#[cfg(unix)]
pub mod file_descriptor;
#[cfg(unix)]
mod unix;
