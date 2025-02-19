import { app, BrowserWindow, session as ElectronSession } from 'electron';
import {
  shmUnlink,
  shmWrite,
  EscapeType,
  cleanupInput,
  listenForInput,
  setupInput,
} from 'awrit-native';
import type { InputEvent } from 'awrit-native';
import { randomBytes } from 'node:crypto';
import { paintInitialFrame, loadFrame, compositeFrame } from './tty/kittyGraphics';
import * as out from './tty/output';
import { handleInput } from './inputHandler';
import { focusedWindow, managedWindows, windowSize } from './windows';
import { ElectronChromeExtensions } from 'electron-chrome-extensions';
import path from 'node:path';
import { installExtensions } from './extensions';

const originalConsole = { ...console };
// Disable all console logging
console.log = console.error = console.warn = () => {};

const FRAME_NAME = '/frame-' + randomBytes(4).toString('hex');
const SPARE_FRAME_NAME = '/spare-frame-' + randomBytes(4).toString('hex');

const INITIAL_URL = process.argv[2] || 'https://github.com/chase/awrit';

let exiting = false;
let quitListening = () => {};

const DPI_SCALE = 1.25;

function scaleSize(size: { width: number; height: number }) {
  return {
    width: Math.floor(size.width / DPI_SCALE),
    height: Math.floor(size.height / DPI_SCALE),
  };
}

const cleanup = (signum = 1) => {
  exiting = true;
  quitListening();
  cleanupInput();
  out.cleanup();
  try {
    shmUnlink(FRAME_NAME);
  } catch {
    console.error('Could not free shared memory');
  }
  process.exit(signum);
};

function resizeHandler(size: { width: number; height: number }) {
  if (windowSize.width === size.width && windowSize.height === size.height) return;

  Object.assign(windowSize, size);
  const win = focusedWindow.current;
  if (!win) return;
  /* This doesn't work for some reason
  win.setContentSize(windowSize.width, windowSize.height, false);
  win.setSize(windowSize.width, windowSize.height, false);
  win.webContents.send('resize', windowSize);
  win.webContents.invalidate();
  */
}

function inputHandler(evt: InputEvent) {
  if (evt.type === EscapeType.Key && evt.code === 'c' && evt.modifiers.includes('ctrl')) {
    quitListening();
    cleanup(0);
  }

  if (evt.type === EscapeType.CSI && evt.data.startsWith('4') && evt.data.endsWith('t')) {
    const [height, width] = evt.data.slice(2, -1).split(';');
    resizeHandler({ width: Number.parseInt(width), height: Number.parseInt(height) });
  }

  if (evt.type === EscapeType.Mouse && evt.x && evt.y) {
    evt.x = Math.floor(evt.x / DPI_SCALE);
    evt.y = Math.floor(evt.y / DPI_SCALE);
  }
  handleInput(evt);
}

function setup() {
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
  process.on('SIGABRT', cleanup);
  process.on('SIGWINCH', () => {
    out.requestWindowSize();
  });

  out.setup();
  setupInput();
  quitListening = listenForInput(inputHandler);

  out.clearScreen();
  out.placeCursor({ x: 0, y: 0 });
  out.requestWindowSize();
}

setup();

async function createWindow() {
  const session = ElectronSession.fromPartition('persist:custom');
  const extensions = new ElectronChromeExtensions({
    session,
    license: 'GPL-3.0',
    modulePath: path.join(__dirname, '../node_modules/electron-chrome-extensions'),
  });

  const win = new BrowserWindow({
    ...scaleSize(windowSize),
    show: false,
    useContentSize: true,
    webPreferences: {
      offscreen: true,
      session,
      sandbox: true,
      contextIsolation: true,
    },
    paintWhenInitiallyHidden: true,
    transparent: true,
    backgroundColor: '#00000000',
  });
  extensions.addTab(win.webContents, win);
  await installExtensions(session);

  win.loadURL(INITIAL_URL);
  managedWindows.push(win);
  focusedWindow.current = win;

  let id: number | undefined;
  const doPaint = true;

  win.webContents.on('paint', (event, dirty, image) => {
    if (!doPaint) return;
    if (exiting) return;

    try {
      const buffer = image.getBitmap();
      shmWrite(id == null ? FRAME_NAME : SPARE_FRAME_NAME, buffer, true);

      const size = { width: image.getSize().width, height: image.getSize().height };

      if (id == null) {
        id = paintInitialFrame(FRAME_NAME, size);
      } else {
        loadFrame(id, 2, SPARE_FRAME_NAME, size);
        compositeFrame(id, 2, 1, size);
      }
    } catch (error) {
      console.error('Error painting HN window:', error);
    }
  });

  return win;
}

// Prevents high DPI scaling based on host display
app.commandLine.appendSwitch('force-device-scale-factor', DPI_SCALE.toString());
app.commandLine.appendSwitch('high-dpi-support', 'true');

// Disable Electron's stdout logging
app.commandLine.appendSwitch('log-level', '0');
app.commandLine.appendSwitch('disable-logging');
// Disable Chrome DevTools logging
app.commandLine.appendSwitch('silent-debugger-extension-api');

app.whenReady().then(createWindow);
