import { app, dialog, ipcMain } from 'electron';
import {
  termEnableFeatures,
  listenForInput,
  type TermEvent,
  termDisableFeatures,
  getWindowSize,
} from 'awrit-native-rs';
import * as out from './tty/output';
import { handleInput } from './inputHandler';
import { createWindowWithToolbar } from './windows';
import { loadUserExtensions } from './extensions';
import { console_ } from './console';
import { options } from './args';
import { features } from './features';
import { clearPlacements } from './tty/kittyGraphics';
import { loadKeyBindings, type KeyBindingAction } from './keybindings';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

interface UserConfig {
  homepage?: string;
  userExtensions?: string[];
  deviceScaleFactor?: number | null;
  keybindings?: Record<string, KeyBindingAction> & {
    mac?: Record<string, KeyBindingAction>;
    linux?: Record<string, KeyBindingAction>;
  };
}

let homepage = 'https://github.com/TalAmuyal/awrit';
let userExtensions: string[] = [];
let deviceScaleFactor: number | null = null;

const MAX_DEVICE_SCALE_FACTOR = 2;

// Values above MAX_DEVICE_SCALE_FACTOR ask Chromium for a bitmap that scales
// quadratically in memory; >=10 reliably stalls the renderer.
function validateDeviceScaleFactor(value: number, source: string): number | null {
  if (Number.isFinite(value) && value > 0 && value <= MAX_DEVICE_SCALE_FACTOR) {
    return value;
  }
  console_.error(
    `Invalid ${source}=${value}; expected a number in (0, ${MAX_DEVICE_SCALE_FACTOR}]. Falling back to native rendering.`,
  );
  return null;
}

function loadConfig(config: UserConfig) {
  if (config.homepage) homepage = config.homepage;
  if (config.userExtensions) userExtensions = config.userExtensions;
  if (typeof config.deviceScaleFactor === 'number') {
    deviceScaleFactor = validateDeviceScaleFactor(
      config.deviceScaleFactor,
      'config.deviceScaleFactor',
    );
  }
  if (config.keybindings) {
    if (process.platform === 'darwin') {
      Object.assign(config.keybindings, config.keybindings.mac);
      config.keybindings.linux = undefined;
    } else {
      Object.assign(config.keybindings, config.keybindings.linux);
      config.keybindings.mac = undefined;
    }
    loadKeyBindings({ keybindings: config.keybindings });
  }
}

const xdgConfigHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
const CONFIG_PATH_RESOLVED = path.join(xdgConfigHome, 'awrit', 'config.js');

if (!fs.existsSync(CONFIG_PATH_RESOLVED)) {
  const templatePath = path.resolve(__dirname, '../config.example.js');
  fs.mkdirSync(path.dirname(CONFIG_PATH_RESOLVED), { recursive: true });
  fs.copyFileSync(templatePath, CONFIG_PATH_RESOLVED);
}

loadConfig(require(CONFIG_PATH_RESOLVED));

fs.watchFile(CONFIG_PATH_RESOLVED, { interval: 200 }, (curr, prev) => {
  if (curr.mtime <= prev.mtime) return;
  const oldConfig = require(CONFIG_PATH_RESOLVED);
  require.cache[CONFIG_PATH_RESOLVED] = undefined;

  try {
    const newConfig = require(CONFIG_PATH_RESOLVED);
    loadConfig(newConfig);
  } catch (e) {
    console_.error('Error loading config:', e);
    // Restore old config if new one fails
    try {
      loadConfig(oldConfig);
    } catch (e) {
      console_.error('Error restoring old config:', e);
    }
  }
});

// Don't show a dialog box on uncaught errors
dialog.showErrorBox = (title, content) => {
  console_.error(title, content);
};

const INITIAL_URL = options.url || homepage;

let exiting = false;
let quitListening = () => {};

const cleanup = (signum = 1, reason?: string) => {
  exiting = true;
  quitListening();
  clearPlacements();
  out.cleanup();
  if (features.current) {
    termDisableFeatures(features.current);
  }
  if (reason) {
    console_.log(reason);
  }
  process.exit(signum);
};

function inputHandler(evt: TermEvent) {
  if (
    evt.eventType === 'key' &&
    evt.keyEvent.code === 'd' &&
    evt.keyEvent.modifiers.includes('ctrl')
  ) {
    cleanup(0);
  }

  // Graphics protocol events now come through graphics events
  if (options['debug-paint'] && evt.eventType === 'graphics') {
    console_.error('Graphics protocol: ', evt.graphics);
  }

  handleInput(evt);
}

function setup() {
  const cleanup_ = () => cleanup();
  process.on('SIGINT', () => cleanup(0));
  process.on('SIGTERM', cleanup_);
  process.on('SIGABRT', cleanup_);

  out.setup();
  features.current = termEnableFeatures();
  const { keyboard, images } = features.current;
  if (!keyboard) {
    cleanup(1, 'Extended keyboard support is required');
  }
  if (!images) {
    cleanup(1, 'Basic Kitty graphics protocol support is required');
  }

  quitListening = listenForInput(inputHandler, 200);

  out.clearScreen();
  out.placeCursor({ x: 0, y: 0 });
}

setup();

// Disable Electron's stdout logging
app.commandLine.appendSwitch('log-level', '0');
app.commandLine.appendSwitch('disable-logging');
// Disable Chrome DevTools logging
app.commandLine.appendSwitch('silent-debugger-extension-api');

// Prevent sysctlbyname crash: https://github.com/electron/electron/issues/45653#issuecomment-2663510200
app.commandLine.appendSwitch('disable-features', 'UseBrowserCalculatedOrigin');

// Animate mouse-wheel and keyboard scrolls instead of stepping discretely.
// `scroll-behavior: smooth` only affects programmatic scrolls; this switch
// covers the input-driven path at the compositor level.
app.commandLine.appendSwitch('enable-smooth-scrolling');

// Offscreen rendering performance: enable GPU rasterization and lift the
// GPU blocklist so Chromium's compositor can hardware-accelerate. Without
// these, scroll animations capture at well below 60 fps and look stepped
// even though `enable-smooth-scrolling` is animating internally.
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('disable-gpu-vsync');

// CLI flag wins over config so users can override per-invocation without touching config.js.
function resolveDeviceScaleFactor(): number | null {
  const cliValue = options['device-scale-factor'];
  if (typeof cliValue === 'string') {
    const parsed = Number(cliValue);
    return validateDeviceScaleFactor(parsed, '--device-scale-factor');
  }
  return deviceScaleFactor;
}

const resolvedDeviceScaleFactor = resolveDeviceScaleFactor();

app.whenReady().then(async () => {
  await loadUserExtensions(userExtensions, CONFIG_PATH_RESOLVED);
  const window = await createWindowWithToolbar(
    getWindowSize(),
    INITIAL_URL,
    resolvedDeviceScaleFactor,
  );

  ipcMain.handle('findInPage', (_, text: string, opts) => {
    window.content.webContents.findInPage(text, opts);
  });

  ipcMain.handle('stopFindInPage', () => {
    window.content.webContents.stopFindInPage('clearSelection');
    window.toolbar?.blurWebView();
    window.content.focusOnWebView();
    window.focusedContent = window.content.webContents;
  });
});
