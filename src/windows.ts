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
import { bundledExtensionsPromise, extensionsPromise, installedExtensionsPromise } from './extensions';
import { createDirectFrame } from './tty/kittyGraphics';
import { getWindowSize } from 'awrit-native-rs';
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
import { updateCursor } from './tty/cursor';
import { debounce } from './debounce';

export type Actions = {
  back: () => void;
  forward: () => void;
  refresh: () => void;
};

export type WindowView = {
  toolbar?: BrowserWindow;
  content: BrowserWindow;
  focusedContent: WebContents;
  layoutContainer: LayoutContainer;
  toolbarNode?: LayoutNode;
  contentNode: LayoutNode;
} & Actions;

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

type Size = { width: number; height: number };
// this deals with the DPI scale rounding error causing the buffer to be too small
function padSize(size: Size): Size {
  return {
    width: size.width + 3,
    height: size.height + 3,
  };
}

export const managedViews: WindowView[] = [];

// Shrinks (or rescales) the BrowserWindow content dimensions while leaving the
// terminal-cell composite destination at native size. Kitty upscales the smaller
// IOSurface back to the original cell area, trading crispness for fewer pixels
// per paint. See `deviceScaleFactor` in config.example.js.
function scaleContentSize(
  layoutSize: { width: number; height: number },
  deviceScaleFactor: number | null,
): { width: number; height: number } {
  if (deviceScaleFactor === null) {
    return { width: layoutSize.width, height: layoutSize.height };
  }
  return {
    width: Math.max(1, Math.round(layoutSize.width * deviceScaleFactor)),
    height: Math.max(1, Math.round(layoutSize.height * deviceScaleFactor)),
  };
}

/**
 * Creates a new window with a toolbar and main content area
 * @param size Window size
 * @param initialUrl URL to load in the main content area
 * @param deviceScaleFactor BrowserWindow content-size multiplier; null = no scaling
 * @returns The created window
 */
export async function createWindowWithToolbar(
  size: { width: number; height: number },
  initialUrl: string,
  deviceScaleFactor: number | null,
): Promise<WindowView> {
  console_.error('size', size);
  // Create layout container with device pixel dimensions
  const layoutContainer = layout(
    size.width,
    size.height,
    getDisplayScale() ?? screen.getPrimaryDisplay().scaleFactor,
  );

  const showToolbar = !options['no-toolbar'];

  // Create layout nodes for toolbar and content
  const toolbarNode = showToolbar
    ? row({ height: px(TOOLBAR_HEIGHT), tag: 'toolbar' })
    : undefined;
  const contentNode = row({ height: auto(), tag: 'content' });

  // Calculate layout
  calculateLayout(layoutContainer, toolbarNode ? [toolbarNode, contentNode] : [contentNode]);

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

  const toolbar = toolbarNode
    ? new BrowserWindow({
        ...sharedConstructorOptions,
        ...toolbarNode.computedLayout,
        ...scaleContentSize(toolbarNode.computedLayout, deviceScaleFactor),

        webPreferences: {
          zoomFactor: 1,
          offscreen: true,
          nodeIntegration: false,
          contextIsolation: true,

          preload: path.resolve(__dirname, '../dist/preload.js'),
        },
      })
    : undefined;

  const content = new BrowserWindow({
    ...sharedConstructorOptions,
    ...contentNode.computedLayout,
    ...scaleContentSize(contentNode.computedLayout, deviceScaleFactor),

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
  // Pin offscreen capture to 60 fps. Default is also 60, but being explicit
  // ensures scroll-animation frames are captured at full rate.
  content.webContents.setFrameRate(60);
  toolbar?.webContents.setFrameRate(60);

  const destructors: Array<() => void> = [];

  function registerPaints(_size: Size, cellArea: { cols: number; rows: number }) {
    if (features.current?.images) {
      const contentFrame = createDirectFrame(cellArea);
      destructors.push(
        contentFrame.free,
        registerPaintedContent(contentFrame, content, contentNode).destroy,
      );
      if (toolbar && toolbarNode) {
        const toolbarFrame = createDirectFrame(cellArea);
        destructors.push(
          toolbarFrame.free,
          registerPaintedContent(toolbarFrame, toolbar, toolbarNode).destroy,
        );
      }
    } else {
      destructors.push(registerPaintedContentFallback(content, contentNode).destroy);
      if (toolbar && toolbarNode) {
        destructors.push(registerPaintedContentFallback(toolbar, toolbarNode).destroy);
      }
    }
  }

  const initialTermSize = getWindowSize();
  registerPaints(padSize(size), { cols: initialTermSize.cols, rows: initialTermSize.rows });

  // Add to extensions
  extensionsPromise.then((extensions) => {
    extensions.addTab(content.webContents, content);
  });
  await Promise.all([installedExtensionsPromise, bundledExtensionsPromise]);

  if (toolbar) {
    if (options.dev) {
      toolbar.webContents.once('did-finish-load', () => {
        console_.error('toolbar loaded');
      });
      toolbar.webContents.once('did-fail-load', (_event, errorCode, errorDescription) => {
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
    toolbar.webContents.on('cursor-changed', updateCursor);
  }
  resetForFrameQuirk(content.webContents);
  content.webContents.loadURL(initialUrl);

  content.webContents.on('cursor-changed', updateCursor);

  const view: WindowView = {
    toolbar,
    content,
    focusedContent: content.webContents,
    layoutContainer,
    toolbarNode,
    contentNode,
    back: () => {
      content.webContents.goBack();
    },
    forward: () => {
      content.webContents.goForward();
    },
    refresh: () => {
      content.webContents.reload();
    },
  };

  // Add to managed windows
  managedViews.push(view);
  focusedView.current = view;

  // Set up IPC for toolbar interactions
  if (toolbar) {
    setupToolbarIPC(toolbar.webContents, content.webContents);
  }

  process.on(
    'SIGWINCH',
    debounce(100, () => {
      for (const destructor of destructors) {
        destructor();
      }
      destructors.length = 0;

      const size = getWindowSize();
      console_.error('resize', size);
      updateViewSizes(view, size, deviceScaleFactor);
      registerPaints(padSize(size), { cols: size.cols, rows: size.rows });
    }),
  );

  return view;
}

function updateViewSizes(
  view: WindowView,
  { width, height }: Size,
  deviceScaleFactor: number | null,
) {
  const { toolbar, content, toolbarNode, contentNode } = view;
  view.layoutContainer = layout(
    width,
    height,
    getDisplayScale() ?? screen.getPrimaryDisplay().scaleFactor,
  );

  calculateLayout(view.layoutContainer, toolbarNode ? [toolbarNode, contentNode] : [contentNode]);

  // Update window sizes based on layout
  if (toolbar && toolbarNode) {
    const scaled = scaleContentSize(toolbarNode.computedLayout, deviceScaleFactor);
    toolbar.setContentSize(scaled.width, scaled.height);
  }
  const scaled = scaleContentSize(contentNode.computedLayout, deviceScaleFactor);
  content.setContentSize(scaled.width, scaled.height);
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
