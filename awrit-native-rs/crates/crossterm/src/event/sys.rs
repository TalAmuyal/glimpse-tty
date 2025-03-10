#[cfg(all(unix, feature = "event-stream"))]
pub(crate) use unix::waker::Waker;

pub(crate) mod unix;
