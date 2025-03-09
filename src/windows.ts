import {
  BrowserWindow,
  type BrowserWindowConstructorOptions,
  type Size,
  type WebContents,
  ipcMain,
} from 'electron';
import path from 'node:path';
import { registerPaintedContent } from './paint';
import { sessionPromise } from './session';
import { extensionsPromise, installedExtensionsPromise } from './extensions';
import { type InitialFrame, paintInitialFrame } from './tty/kittyGraphics';
import { ShmGraphicBuffer } from 'awrit-native-rs';
import { scaleSize } from './dpi';
import { options } from './args';
import { console_ } from './console';
import { TOOLBAR_PORT } from './runner/ports';

export const windowSize: {
  width: number;
  height: number;
} = {
  width: 0,
  height: 0,
};

type WindowView = {
  baseSize: Size;
  toolbar: BrowserWindow;
  content: BrowserWindow;
  containerFrame: InitialFrame;
  focusedContent: WebContents;
};

export const focusedView: {
  current: WindowView | null;
  previous: WindowView | null;
} = {
  current: null,
  previous: null,
};

export const windowViews = new WeakMap<BrowserWindow, WindowView>();

export const TOOLBAR_HEIGHT = 42;

export const managedViews: WindowView[] = [];

/**
 * Creates a new window with a toolbar and main content area
 * @param size Window size
 * @param initialUrl URL to load in the main content area
 * @returns The created window
 */
export async function createWindowWithToolbar(
  size: { width: number; height: number },
  initialUrl = 'https://github.com/chase/awrit',
): Promise<WindowView> {
  // this deals with the DPI scale rounding error causing the buffer to be too small
  const scaledSize = {
    width: size.width + 3,
    height: size.height + 3,
  };
  const containerBuffer = new ShmGraphicBuffer(scaledSize.width * scaledSize.height * 4);
  containerBuffer.writeEmpty();
  const containerFrame = paintInitialFrame(containerBuffer, scaledSize);

  const transparentWindowSettings = {
    transparent: true,
    backgroundColor: '#00000000',
  };

  // You're probably thinking "why not just use the content view?"
  // It's broken: https://github.com/electron/electron/issues/45864
  // And that makes me sad: https://github.com/electron/electron/issues/22174#issuecomment-1183050589

  const sharedConstructorOptions: BrowserWindowConstructorOptions = {
    useContentSize: true,
    show: false,
    frame: false,
    paintWhenInitiallyHidden: true,
  };

  const toolbar = new BrowserWindow(
    scaleSize({
      ...sharedConstructorOptions,
      width: size.width,
      height: TOOLBAR_HEIGHT,

      webPreferences: {
        offscreen: true,
        nodeIntegration: false,
        contextIsolation: true,

        preload: path.resolve(__dirname, '../dist/preload.js'),
      },
    }),
  );

  const content = new BrowserWindow(
    scaleSize({
      ...sharedConstructorOptions,
      width: size.width,
      height: size.height - TOOLBAR_HEIGHT,

      ...(options.transparent ? transparentWindowSettings : {}),

      webPreferences: {
        session: await sessionPromise,

        sandbox: true,
        offscreen: true,
        nodeIntegration: false,
        contextIsolation: true,
        disableDialogs: true,
      },
    }),
  );

  // Handle window resize events
  // baseWin.on('resize', () => {
  //   const [width, height] = baseWin.getSize();
  // updateViewSizes(baseWin, width, height);
  // });

  // Register for painting
  registerPaintedContent(containerFrame, toolbar, { x: 0, y: 0 });
  registerPaintedContent(containerFrame, content, { x: 0, y: TOOLBAR_HEIGHT + 1 });

  // Add to extensions
  extensionsPromise.then((extensions) => {
    extensions.addTab(content.webContents, content);
  });
  await installedExtensionsPromise;

  if (options.dev) {
    toolbar.webContents.once('did-finish-load', () => {
      console_.error('toolbar loaded');
    });
    toolbar.webContents.once('did-fail-load', (event, errorCode, errorDescription) => {
      console_.error('toolbar failed to load', { errorCode, errorDescription });
    });
    toolbar.webContents.loadURL(`http://localhost:${TOOLBAR_PORT}`);
    toolbar.webContents.openDevTools({
      mode: 'detach',
      title: 'Toolbar Dev Tools',
      activate: false,
    });
  } else {
    toolbar.webContents.loadFile('../dist/toolbar/index.html');
  }
  content.webContents.loadURL(initialUrl);

  const view: WindowView = {
    baseSize: size,
    toolbar,
    content,
    containerFrame,
    focusedContent: content.webContents,
  };

  // Add to managed windows
  managedViews.push(view);
  focusedView.current = view;

  // Set up IPC for toolbar interactions
  setupToolbarIPC(toolbar.webContents, content.webContents);

  return view;
}

function updateViewSizes(view: WindowView, width: number, height: number) {
  const { toolbar, content } = view;

  toolbar.setContentSize(width, TOOLBAR_HEIGHT);
  content.setContentSize(width, height - TOOLBAR_HEIGHT);
}

function setupToolbarIPC(
  toolbarContents: Electron.WebContents,
  contentContents: Electron.WebContents,
) {
  ipcMain.on('toolbar:navigate-back', () => {
    if (contentContents.navigationHistory.canGoBack()) {
      contentContents.navigationHistory.goBack();
    }
  });

  ipcMain.on('toolbar:navigate-forward', () => {
    if (contentContents.navigationHistory.canGoForward()) {
      contentContents.navigationHistory.goForward();
    }
  });

  ipcMain.on('toolbar:navigate-refresh', () => {
    contentContents.reload();
  });

  ipcMain.on('toolbar:navigate-to', (_event, url: string) => {
    contentContents.loadURL(url);
  });

  contentContents.on('did-start-loading', () => {
    toolbarContents.send('content:loading-started');
  });

  contentContents.on('did-stop-loading', () => {
    toolbarContents.send('content:loading-stopped');
  });

  contentContents.on('did-navigate', (_event, url) => {
    toolbarContents.send('content:url-changed', url);
  });

  contentContents.on('did-navigate-in-page', (_event, url, isMainFrame) => {
    if (isMainFrame) {
      toolbarContents.send('content:url-changed', url);
    }
  });

  contentContents.on('did-navigate', () => {
    const navigationState = {
      canGoBack: contentContents.navigationHistory.canGoBack(),
      canGoForward: contentContents.navigationHistory.canGoForward(),
    };
    toolbarContents.send('content:navigation-state-changed', navigationState);
  });
}
