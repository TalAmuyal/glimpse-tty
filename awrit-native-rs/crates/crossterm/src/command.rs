use std::fmt;
use std::io::{self, Write};

use crate::terminal::{BeginSynchronizedUpdate, EndSynchronizedUpdate};

/// An interface for a command that performs an action on the terminal.
///
/// Crossterm provides a set of commands,
/// and there is no immediate reason to implement a command yourself.
/// In order to understand how to use and execute commands,
/// it is recommended that you take a look at [Command API](./index.html#command-api) chapter.
pub trait Command {
    /// Write the ANSI representation of this command to the given writer.
    ///
    /// This method does not need to be accessed manually, as it is used by the crossterm's [Command API](./index.html#command-api)
    fn write_ansi(&self, f: &mut impl fmt::Write) -> fmt::Result;
}

impl<T: Command + ?Sized> Command for &T {
    fn write_ansi(&self, f: &mut impl fmt::Write) -> fmt::Result {
        (**self).write_ansi(f)
    }
}

/// An interface for types that can queue commands for further execution.
pub trait QueueableCommand {
    /// Queues the given command for further execution.
    fn queue(&mut self, command: impl Command) -> io::Result<&mut Self>;
}

/// An interface for types that can directly execute commands.
pub trait ExecutableCommand {
    /// Executes the given command directly.
    fn execute(&mut self, command: impl Command) -> io::Result<&mut Self>;
}

impl<T: Write + ?Sized> QueueableCommand for T {
    /// Queues the given command for further execution.
    ///
    /// Queued commands will be executed in the following cases:
    ///
    /// * When `flush` is called manually on the given type implementing `io::Write`.
    /// * The terminal will `flush` automatically if the buffer is full.
    /// * Each line is flushed in case of `stdout`, because it is line buffered.
    ///
    /// # Arguments
    ///
    /// - [Command](./trait.Command.html)
    ///
    ///     The command that you want to queue for later execution.
    ///
    /// # Examples
    ///
    /// ```rust
    /// use std::io::{self, Write};
    /// use crossterm::{QueueableCommand, style::Print};
    ///
    ///  fn main() -> io::Result<()> {
    ///     let mut stdout = io::stdout();
    ///
    ///     // `Print` will executed executed when `flush` is called.
    ///     stdout
    ///         .queue(Print("foo 1\n".to_string()))?
    ///         .queue(Print("foo 2".to_string()))?;
    ///
    ///     // some other code (no execution happening here) ...
    ///
    ///     // when calling `flush` on `stdout`, all commands will be written to the stdout and therefore executed.
    ///     stdout.flush()?;
    ///
    ///     Ok(())
    ///
    ///     // ==== Output ====
    ///     // foo 1
    ///     // foo 2
    /// }
    /// ```
    ///
    /// Have a look over at the [Command API](./index.html#command-api) for more details.
    ///
    /// # Notes
    ///
    /// * In the case of UNIX, ANSI codes are written to the given 'writer'.
    fn queue(&mut self, command: impl Command) -> io::Result<&mut Self> {
        write_command_ansi(self, command)?;
        Ok(self)
    }
}

impl<T: Write + ?Sized> ExecutableCommand for T {
    /// Executes the given command directly.
    ///
    /// The given command its ANSI escape code will be written and flushed onto `Self`.
    ///
    /// # Arguments
    ///
    /// - [Command](./trait.Command.html)
    ///
    ///     The command that you want to execute directly.
    ///
    /// # Example
    ///
    /// ```rust
    /// use std::io;
    /// use crossterm::{ExecutableCommand, style::Print};
    ///
    /// fn main() -> io::Result<()> {
    ///      // will be executed directly
    ///       io::stdout()
    ///         .execute(Print("sum:\n".to_string()))?
    ///         .execute(Print(format!("1 + 1= {} ", 1 + 1)))?;
    ///
    ///       Ok(())
    ///
    ///      // ==== Output ====
    ///      // sum:
    ///      // 1 + 1 = 2
    /// }
    /// ```
    ///
    /// Have a look over at the [Command API](./index.html#command-api) for more details.
    ///
    /// # Notes
    ///
    /// * In the case of UNIX, ANSI codes are written to the given 'writer'.
    fn execute(&mut self, command: impl Command) -> io::Result<&mut Self> {
        self.queue(command)?;
        self.flush()?;
        Ok(self)
    }
}

/// An interface for types that support synchronized updates.
pub trait SynchronizedUpdate {
    /// Performs a set of actions against the given type.
    fn sync_update<T>(&mut self, operations: impl FnOnce(&mut Self) -> T) -> io::Result<T>;
}

impl<W: std::io::Write + ?Sized> SynchronizedUpdate for W {
    /// Performs a set of actions within a synchronous update.
    ///
    /// Updates will be suspended in the terminal, the function will be executed against self,
    /// updates will be resumed, and a flush will be performed.
    ///
    /// # Arguments
    ///
    /// - Function
    ///
    ///     A function that performs the operations that must execute in a synchronized update.
    ///
    /// # Examples
    ///
    /// ```rust
    /// use std::io;
    /// use crossterm::{ExecutableCommand, SynchronizedUpdate, style::Print};
    ///
    /// fn main() -> io::Result<()> {
    ///     let mut stdout = io::stdout();
    ///
    ///     stdout.sync_update(|stdout| {
    ///         stdout.execute(Print("foo 1\n".to_string()))?;
    ///         stdout.execute(Print("foo 2".to_string()))?;
    ///         // The effects of the print command will not be present in the terminal
    ///         // buffer, but not visible in the terminal.
    ///         std::io::Result::Ok(())
    ///     })?;
    ///
    ///     // The effects of the commands will be visible.
    ///
    ///     Ok(())
    ///
    ///     // ==== Output ====
    ///     // foo 1
    ///     // foo 2
    /// }
    /// ```
    ///
    /// # Notes
    ///
    /// This command is performed only using ANSI codes, and will do nothing on terminals that do not support ANSI
    /// codes, or this specific extension.
    ///
    /// When rendering the screen of the terminal, the Emulator usually iterates through each visible grid cell and
    /// renders its current state. With applications updating the screen a at higher frequency this can cause tearing.
    ///
    /// This mode attempts to mitigate that.
    ///
    /// When the synchronization mode is enabled following render calls will keep rendering the last rendered state.
    /// The terminal Emulator keeps processing incoming text and sequences. When the synchronized update mode is disabled
    /// again the renderer may fetch the latest screen buffer state again, effectively avoiding the tearing effect
    /// by unintentionally rendering in the middle a of an application screen update.
    ///
    fn sync_update<T>(&mut self, operations: impl FnOnce(&mut Self) -> T) -> io::Result<T> {
        self.queue(BeginSynchronizedUpdate)?;
        let result = operations(self);
        self.execute(EndSynchronizedUpdate)?;
        Ok(result)
    }
}
/// Writes the ANSI representation of a command to the given writer.
fn write_command_ansi<C: Command>(
    io: &mut (impl io::Write + ?Sized),
    command: C,
) -> io::Result<()> {
    struct Adapter<T> {
        inner: T,
        res: io::Result<()>,
    }

    impl<T: Write> fmt::Write for Adapter<T> {
        fn write_str(&mut self, s: &str) -> fmt::Result {
            self.inner.write_all(s.as_bytes()).map_err(|e| {
                self.res = Err(e);
                fmt::Error
            })
        }
    }

    let mut adapter = Adapter {
        inner: io,
        res: Ok(()),
    };

    command
        .write_ansi(&mut adapter)
        .map_err(|fmt::Error| match adapter.res {
            Ok(()) => panic!(
                "<{}>::write_ansi incorrectly errored",
                std::any::type_name::<C>()
            ),
            Err(e) => e,
        })
}

/// Executes the ANSI representation of a command, using the given `fmt::Write`.
pub(crate) fn execute_fmt(f: &mut impl fmt::Write, command: impl Command) -> fmt::Result {
    command.write_ansi(f)
}
