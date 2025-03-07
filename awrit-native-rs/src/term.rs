use crossterm::{
  event::KeyboardEnhancementFlags,
  terminal::{disable_raw_mode, enable_raw_mode},
};
use std::io;

#[napi]
pub struct SupportedFeatures {
  pub keyboard: bool,
  pub images: bool,
  pub load_frame: bool,
  pub composite_frame: bool,
}

#[napi]
fn term_enable_features() -> io::Result<SupportedFeatures> {
  enable_raw_mode()?;
  let mut stdout = io::stdout();

  let keyboard = crossterm::terminal::supports_keyboard_enhancement()?;

  Ok(SupportedFeatures {
    keyboard,
    images,
    load_frame,
    composite_frame,
  })
}

#[napi]
fn term_disable_features() {
  disable_raw_mode()?;
}
