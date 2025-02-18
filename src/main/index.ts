import { app, BrowserWindow } from 'electron';
import {
  shmUnlink,
  shmWrite,
  EscapeType,
  cleanupInput,
  listenForInput,
  setupInput,
} from 'awrit-native';
import type { InputEvent } from 'awrit-native';
import {
  paintInitialFrame,
  loadFrame,
  compositeFrame,
  clearPlacements,
  freeImage,
} from './tty/kittyGraphics';
import * as out from './tty/output';
import { randomBytes } from 'node:crypto';

let currentTermSize = { width: 0, height: 0 };
const SHM_NAME = '/hn-frame-' + randomBytes(4).toString('hex');

const INITIAL_URL = 'https://news.ycombinator.com';

let exiting = false;
let quitListening = () => {};

const cleanup = (signum = 1) => {
  exiting = true;
  quitListening();
  cleanupInput();
  out.cleanup();
  try {
    // shmUnlink(SHM_NAME);
  } catch {
    console.error('Could not free shared memory');
  }
  process.exit(signum);
};

function resizeHandler(size: { width: number; height: number }) {
  currentTermSize = size;
}

function inputHandler(evt: InputEvent) {
  if (evt.type === EscapeType.Key && evt.code === 'ctrl+c') {
    quitListening();
    cleanup(0);
  }

  if (evt.type === EscapeType.CSI && evt.data.startsWith('4') && evt.data.endsWith('t')) {
    const [width, height] = evt.data.slice(2, -1).split(';');
    resizeHandler({ width: Number.parseInt(width), height: Number.parseInt(height) });
  }
}

function setup() {
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
  process.on('SIGABRT', cleanup);

  setupInput();
  quitListening = listenForInput(inputHandler);

  out.clearScreen();
  out.placeCursor({ x: 0, y: 0 });
  out.requestWindowSize();
}

setup();

async function createWindow() {
  const win = new BrowserWindow({
    ...currentTermSize,
    show: false, // Create offscreen window
    webPreferences: {
      offscreen: true,
    },
  });

  await win.loadURL(INITIAL_URL);

  // Capture window contents and paint to terminal
  win.webContents.on('paint', (event, dirty, image) => {
    if (exiting) return;

    try {
      const buffer = image.getBitmap();
      shmWrite(SHM_NAME, buffer, true);

      const size = { width: image.getSize().width, height: image.getSize().height };
      const id = paintInitialFrame(SHM_NAME, size);
    } catch (error) {
      console.error('Error painting HN window:', error);
    }
  });

  return win;
}

app.whenReady().then(() => {
  const window = createWindow();

  app.on('window-all-closed', () => {
    app.quit();
  });
});
