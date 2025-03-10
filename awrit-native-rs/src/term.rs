use crossterm::{
  event::{
    DisableBracketedPaste, DisableFocusChange, DisableMouseCapture, EnableBracketedPaste,
    EnableFocusChange, EnableMouseCapture, KeyboardEnhancementFlags, PopKeyboardEnhancementFlags,
    PushKeyboardEnhancementFlags,
  },
  execute, queue,
  terminal::{
    disable_raw_mode, enable_raw_mode, query_kitty_graphics_support, supports_keyboard_enhancement,
    window_size,
  },
};

#[napi(object)]
pub struct SupportedFeatures {
  pub keyboard: bool,
  pub images: bool,
  pub load_frame: bool,
  pub composite_frame: bool,
}

#[napi(object)]
pub struct WindowSize {
  pub cols: u16,
  pub rows: u16,
  pub width: u16,
  pub height: u16,
}

#[napi]
/// Enable features for the terminal that are necessary for Awrit
pub fn term_enable_features() -> napi::Result<SupportedFeatures> {
  enable_raw_mode().map_err(|e| napi::Error::from_reason(e.to_string()))?;

  let mut stdout = std::io::stdout();

  // TODO: check if this is actually needed? It could potentially block the event loop for 200ms
  let keyboard =
    supports_keyboard_enhancement().map_err(|e| napi::Error::from_reason(e.to_string()))?;

  let graphics =
    query_kitty_graphics_support().map_err(|e| napi::Error::from_reason(e.to_string()))?;

  if keyboard {
    queue!(
      stdout,
      PushKeyboardEnhancementFlags(
        KeyboardEnhancementFlags::DISAMBIGUATE_ESCAPE_CODES
          | KeyboardEnhancementFlags::REPORT_ALL_KEYS_AS_ESCAPE_CODES
          | KeyboardEnhancementFlags::REPORT_ALTERNATE_KEYS
          | KeyboardEnhancementFlags::REPORT_EVENT_TYPES
      )
    )?;
  }

  execute!(
    stdout,
    EnableBracketedPaste,
    EnableFocusChange,
    EnableMouseCapture,
  )?;

  Ok(SupportedFeatures {
    keyboard,
    images: graphics.images,
    load_frame: graphics.load_frame,
    composite_frame: graphics.composite_frame,
  })
}

#[napi]
/// Disable previously enabled features for the terminal that are necessary for Awrit
pub fn term_disable_features(features: SupportedFeatures) -> napi::Result<()> {
  let mut stdout = std::io::stdout();

  execute!(
    stdout,
    DisableBracketedPaste,
    DisableFocusChange,
    DisableMouseCapture
  )?;

  if features.keyboard {
    execute!(stdout, PopKeyboardEnhancementFlags)?;
  }

  disable_raw_mode().map_err(|e| napi::Error::from_reason(e.to_string()))
}

#[napi]
/// Get the current terminal window size
pub fn get_window_size() -> napi::Result<WindowSize> {
  let size = window_size().map_err(|e| napi::Error::from_reason(e.to_string()))?;

  Ok(WindowSize {
    cols: size.columns,
    rows: size.rows,
    width: size.width,
    height: size.height,
  })
}
