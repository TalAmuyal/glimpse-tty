/// Append a the first few characters of an ANSI escape code to the given string.
#[macro_export]
#[doc(hidden)]
macro_rules! csi {
    ($( $l:expr ),*) => { concat!("\x1B[", $( $l ),*) };
}

/// Queues one or more command(s) for further execution.
///
/// Queued commands must be flushed to the underlying device to be executed.
/// This generally happens in the following cases:
///
/// * When `flush` is called manually on the given type implementing `io::Write`.
/// * The terminal will `flush` automatically if the buffer is full.
/// * Each line is flushed in case of `stdout`, because it is line buffered.
///
/// # Arguments
///
/// - [std::io::Writer](std::io::Write)
///
///     ANSI escape codes are written on the given 'writer', after which they are flushed.
///
/// - [Command](./trait.Command.html)
///
///     One or more commands
///
/// # Examples
///
/// ```rust
/// use std::io::{Write, stdout};
/// use crossterm::{queue, style::Print};
///
/// let mut stdout = stdout();
///
/// // `Print` will executed executed when `flush` is called.
/// queue!(stdout, Print("foo".to_string()));
///
/// // some other code (no execution happening here) ...
///
/// // when calling `flush` on `stdout`, all commands will be written to the stdout and therefore executed.
/// stdout.flush();
///
/// // ==== Output ====
/// // foo
/// ```
///
/// Have a look over at the [Command API](./index.html#command-api) for more details.
#[macro_export]
macro_rules! queue {
    ($writer:expr $(, $command:expr)* $(,)?) => {{
        use ::std::io::Write;

        // This allows the macro to take both mut impl Write and &mut impl Write.
        Ok($writer.by_ref())
            $(.and_then(|writer| $crate::QueueableCommand::queue(writer, $command)))*
            .map(|_| ())
    }}
}

/// Executes one or more command(s).
///
/// # Arguments
///
/// - [std::io::Writer](std::io::Write)
///
///     ANSI escape codes are written on the given 'writer', after which they are flushed.
///
/// - [Command](./trait.Command.html)
///
///     One or more commands
///
/// # Examples
///
/// ```rust
/// use std::io::{Write, stdout};
/// use crossterm::{execute, style::Print};
///
/// // will be executed directly
/// execute!(stdout(), Print("sum:\n".to_string()));
///
/// // will be executed directly
/// execute!(stdout(), Print("1 + 1 = ".to_string()), Print((1+1).to_string()));
///
/// // ==== Output ====
/// // sum:
/// // 1 + 1 = 2
/// ```
///
/// Have a look over at the [Command API](./index.html#command-api) for more details.
#[macro_export]
macro_rules! execute {
    ($writer:expr $(, $command:expr)* $(,)? ) => {{
        use ::std::io::Write;

        // Queue each command, then flush
        $crate::queue!($writer $(, $command)*)
            .and_then(|()| {
                ::std::io::Write::flush($writer.by_ref())
            })
    }}
}

#[doc(hidden)]
#[macro_export]
macro_rules! impl_display {
    (for $($t:ty),+) => {
        $(impl ::std::fmt::Display for $t {
            fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
                $crate::command::execute_fmt(f, self)
            }
        })*
    }
}

#[doc(hidden)]
#[macro_export]
macro_rules! impl_from {
    ($from:path, $to:expr) => {
        impl From<$from> for ErrorKind {
            fn from(e: $from) -> Self {
                $to(e)
            }
        }
    };
}

#[cfg(test)]
mod tests {
    use std::io;
    use std::str;

    // Helper for execute tests to confirm flush
    #[derive(Default, Debug, Clone)]
    struct FakeWrite {
        buffer: String,
        flushed: bool,
    }

    impl io::Write for FakeWrite {
        fn write(&mut self, content: &[u8]) -> io::Result<usize> {
            let content = str::from_utf8(content)
                .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
            self.buffer.push_str(content);
            self.flushed = false;
            Ok(content.len())
        }

        fn flush(&mut self) -> io::Result<()> {
            self.flushed = true;
            Ok(())
        }
    }

    mod unix {
        use std::fmt;

        use super::FakeWrite;
        use crate::command::Command;

        pub struct FakeCommand;

        impl Command for FakeCommand {
            fn write_ansi(&self, f: &mut impl fmt::Write) -> fmt::Result {
                f.write_str("cmd")
            }
        }

        #[test]
        fn test_queue_one() {
            let mut result = FakeWrite::default();
            queue!(&mut result, FakeCommand).unwrap();
            assert_eq!(&result.buffer, "cmd");
            assert!(!result.flushed);
        }

        #[test]
        fn test_queue_many() {
            let mut result = FakeWrite::default();
            queue!(&mut result, FakeCommand, FakeCommand).unwrap();
            assert_eq!(&result.buffer, "cmdcmd");
            assert!(!result.flushed);
        }

        #[test]
        fn test_queue_trailing_comma() {
            let mut result = FakeWrite::default();
            queue!(&mut result, FakeCommand, FakeCommand,).unwrap();
            assert_eq!(&result.buffer, "cmdcmd");
            assert!(!result.flushed);
        }

        #[test]
        fn test_execute_one() {
            let mut result = FakeWrite::default();
            execute!(&mut result, FakeCommand).unwrap();
            assert_eq!(&result.buffer, "cmd");
            assert!(result.flushed);
        }

        #[test]
        fn test_execute_many() {
            let mut result = FakeWrite::default();
            execute!(&mut result, FakeCommand, FakeCommand).unwrap();
            assert_eq!(&result.buffer, "cmdcmd");
            assert!(result.flushed);
        }

        #[test]
        fn test_execute_trailing_comma() {
            let mut result = FakeWrite::default();
            execute!(&mut result, FakeCommand, FakeCommand,).unwrap();
            assert_eq!(&result.buffer, "cmdcmd");
            assert!(result.flushed);
        }
    }
}
