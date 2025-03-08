//! Making it a little more convenient and safe to query whether
//! something is a terminal teletype or not.
//! This module defines the IsTty trait and the is_tty method to
//! return true if the item represents a terminal.

#[cfg(unix)]
use std::os::unix::io::AsRawFd;

/// Adds the `is_tty` method to types that might represent a terminal
///
/// ```rust
/// use std::io::stdout;
/// use crossterm::tty::IsTty;
///
/// let is_tty: bool = stdout().is_tty();
/// ```
pub trait IsTty {
    /// Returns true when an instance is a terminal teletype, otherwise false.
    fn is_tty(&self) -> bool;
}

/// On UNIX, the `isatty()` function returns true if a file
/// descriptor is a terminal.
#[cfg(all(unix, feature = "libc"))]
impl<S: AsRawFd> IsTty for S {
    fn is_tty(&self) -> bool {
        let fd = self.as_raw_fd();
        unsafe { libc::isatty(fd) == 1 }
    }
}

#[cfg(all(unix, not(feature = "libc")))]
impl<S: AsRawFd> IsTty for S {
    fn is_tty(&self) -> bool {
        let fd = self.as_raw_fd();
        rustix::termios::isatty(unsafe { std::os::unix::io::BorrowedFd::borrow_raw(fd) })
    }
}
