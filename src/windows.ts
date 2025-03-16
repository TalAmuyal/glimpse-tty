import {
  BrowserWindow,
  type BrowserWindowConstructorOptions,
  type WebContents,
  ipcMain,
  screen,
} from 'electron';
import path from 'node:path';
import { registerPaintedContent, registerPaintedContentFallback } from './paint';
import { sessionPromise } from './session';
import { extensionsPromise, installedExtensionsPromise } from './extensions';
import { paintInitialFrame } from './tty/kittyGraphics';
import { ShmGraphicBuffer } from 'awrit-native-rs';
import { options } from './args';
import { console_ } from './console';
import { TOOLBAR_PORT } from './runner/ports';
import {
  layout,
  row,
  px,
  auto,
  calculateLayout,
  type LayoutContainer,
  type LayoutNode,
} from './layout';
import { getDisplayScale } from './dpi';
import { features } from './features';
import { OSC } from './tty/escapeCodes';
import { updateCursor } from './tty/cursor';

type WindowView = {
  toolbar: BrowserWindow;
  content: BrowserWindow;
  focusedContent: WebContents;
  layoutContainer: LayoutContainer;
  toolbarNode: LayoutNode;
  contentNode: LayoutNode;
};

export const focusedView: {
  current: WindowView | null;
  previous: WindowView | null;
} = {
  current: null,
  previous: null,
};

export const windowViews = new WeakMap<BrowserWindow, WindowView>();

const TOOLBAR_HEIGHT = 40;

/**
 * NOTE: the happens before load but after frame navigate
 * this is necessary because zoom can only be set when a URL is associated with the webContents
 *
 * This also prevents users from persisting zoom level which is bad, so we probably want
 * to store that somewhere if the user changes zoom and restore that number instead
 */
function resetForFrameQuirk(webContents: WebContents) {
  webContents.once('did-frame-navigate', () => {
    webContents.setZoomFactor(1);
  });
}

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
  // Create layout container with device pixel dimensions
  const layoutContainer = layout(
    size.width,
    size.height,
    getDisplayScale() ?? screen.getPrimaryDisplay().scaleFactor,
  );

  // Create layout nodes for toolbar and content
  const toolbarNode = row({ height: px(TOOLBAR_HEIGHT), tag: 'toolbar' });
  const contentNode = row({ height: auto(), tag: 'content' });

  const hasAnimation = features.current?.loadFrame && features.current.compositeFrame;

  // Calculate layout
  calculateLayout(layoutContainer, [toolbarNode, contentNode]);
  // process.emit('SIGINT');

  // this deals with the DPI scale rounding error causing the buffer to be too small
  const scaledSize = {
    width: size.width + 3,
    height: size.height + 3,
  };

  const transparentWindowSettings = {
    transparent: true,
    backgroundColor: '#00000000',
  };

  const sharedConstructorOptions: BrowserWindowConstructorOptions = {
    useContentSize: true,
    show: false,
    frame: false,
    paintWhenInitiallyHidden: true,
    hiddenInMissionControl: true,
    acceptFirstMouse: true,
    skipTaskbar: true,
    fullscreenable: false,
    resizable: false,
  };

  const toolbar = new BrowserWindow({
    ...sharedConstructorOptions,
    ...toolbarNode.computedLayout,

    webPreferences: {
      zoomFactor: 1,
      offscreen: true,
      nodeIntegration: false,
      contextIsolation: true,

      preload: path.resolve(__dirname, '../dist/preload.js'),
    },
  });

  const content = new BrowserWindow({
    ...sharedConstructorOptions,
    ...contentNode.computedLayout,

    ...(options.transparent ? transparentWindowSettings : {}),

    webPreferences: {
      zoomFactor: 1,
      session: await sessionPromise,

      sandbox: true,
      offscreen: true,
      nodeIntegration: false,
      contextIsolation: true,
      disableDialogs: true,
    },
  });

  // Register for painting using layout-computed positions
  if (hasAnimation) {
    const containerBuffer = new ShmGraphicBuffer(scaledSize.width * scaledSize.height * 4);
    containerBuffer.writeEmpty();
    const containerFrame = paintInitialFrame(containerBuffer, scaledSize);
    registerPaintedContent(containerFrame, toolbar, toolbarNode);
    registerPaintedContent(containerFrame, content, contentNode);
  } else {
    registerPaintedContentFallback(toolbar, toolbarNode);
    registerPaintedContentFallback(content, contentNode);
  }

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
      console_.error('toolbar failed to load', {
        errorCode,
        errorDescription,
      });
    });
    toolbar.webContents.loadURL(`http://localhost:${TOOLBAR_PORT}`);
    toolbar.webContents.openDevTools({
      mode: 'detach',
      title: 'Toolbar Dev Tools',
      activate: false,
    });
  } else {
    resetForFrameQuirk(toolbar.webContents);
    toolbar.webContents.loadFile('../dist/toolbar/index.html');
  }
  resetForFrameQuirk(content.webContents);
  content.webContents.loadURL(initialUrl);

  toolbar.webContents.on('cursor-changed', updateCursor);
  content.webContents.on('cursor-changed', updateCursor);

  const view: WindowView = {
    toolbar,
    content,
    focusedContent: content.webContents,
    layoutContainer,
    toolbarNode,
    contentNode,
  };

  // Add to managed windows
  managedViews.push(view);
  focusedView.current = view;

  // Set up IPC for toolbar interactions
  setupToolbarIPC(toolbar.webContents, content.webContents);

  return view;
}

function updateViewSizes(view: WindowView, width: number, height: number) {
  const { toolbar, content, layoutContainer, toolbarNode, contentNode } = view;

  // Recalculate layout with new dimensions in device pixels
  layoutContainer.logicalWidth = width / layoutContainer.devicePixelRatio;
  layoutContainer.logicalHeight = height / layoutContainer.devicePixelRatio;
  calculateLayout(layoutContainer, [toolbarNode, contentNode]);

  // Update window sizes based on layout
  toolbar.setContentSize(toolbarNode.computedLayout.width, toolbarNode.computedLayout.height);
  content.setContentSize(contentNode.computedLayout.width, contentNode.computedLayout.height);
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
