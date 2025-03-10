import { app, dialog } from 'electron';
import {
  termEnableFeatures,
  listenForInput,
  type TermEvent,
  type SupportedFeatures,
  termDisableFeatures,
  getWindowSize,
} from 'awrit-native-rs';
import * as out from './tty/output';
import { handleInput } from './inputHandler';
import { createWindowWithToolbar } from './windows';
import { console_ } from './console';
import { options, showHelp } from './args';
import { execSync } from 'node:child_process';

if (options.help) {
  showHelp();
  process.exit(0);
}

if (options.version) {
  const version = execSync('git rev-parse --short HEAD').toString().trim();
  console_.log('awrit', version);
  process.exit(0);
}

// Don't show a dialog box on uncaught errors
dialog.showErrorBox = (title, content) => {
  console_.error(title, content);
};

const INITIAL_URL = options.url || 'https://github.com/chase/awrit';

let exiting = false;
let quitListening = () => {};
let features: SupportedFeatures | undefined;

const cleanup = (signum = 1, reason?: string) => {
  exiting = true;
  quitListening();
  out.cleanup();
  if (features) {
    termDisableFeatures(features);
  }
  if (reason) {
    console_.log(reason);
  }
  process.exit(signum);
};

function inputHandler(evt: TermEvent) {
  if (
    evt.eventType === 'key' &&
    evt.keyEvent.code === 'c' &&
    evt.keyEvent.modifiers.includes('ctrl')
  ) {
    quitListening();
    cleanup(0);
  }

  // Graphics protocol events now come through graphics events
  if (evt.eventType === 'graphics') {
    console_.error('Graphics protocol: ', evt.graphics);
  }

  handleInput(evt);
}

function setup() {
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
  process.on('SIGABRT', cleanup);
  process.on('SIGWINCH', () => {
    // TODO: Handle resize
  });

  out.setup();
  features = termEnableFeatures();
  if (!features.keyboard) {
    cleanup(1, 'Extended keyboard support is required');
  }
  if (!features.images) {
    cleanup(1, 'Basic Kitty graphics protocol support is required');
  }
  // TODO: Add support for Ghostty by using image buffering
  if (!features.loadFrame || !features.compositeFrame) {
    cleanup(1, 'Kitty animation protocol support is required');
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

app.whenReady().then(() => {
  createWindowWithToolbar(getWindowSize(), INITIAL_URL);
});
