import {
  BrowserWindow,
  type WebContents,
  screen,
} from 'electron';
import { registerPaintedContent, registerPaintedContentFallback } from './paint';
import { sessionPromise } from './session';
import { bundledExtensionsPromise, extensionsPromise, installedExtensionsPromise } from './extensions';
import { createDirectFrame } from './tty/kittyGraphics';
import { getWindowSize } from 'glimpse-tty-native-rs';
import { options } from './args';
import {
  layout,
  row,
  auto,
  calculateLayout,
  type LayoutContainer,
  type LayoutNode,
} from './layout';
import { getDisplayScale } from './dpi';
import { features } from './features';
import { updateCursor } from './tty/cursor';
import { debounce } from './debounce';

type Actions = {
  back: () => void;
  forward: () => void;
  refresh: () => void;
};

export type WindowView = {
  content: BrowserWindow;
  focusedContent: WebContents;
  layoutContainer: LayoutContainer;
  contentNode: LayoutNode;
} & Actions;

export const focusedView: {
  current: WindowView | null;
} = {
  current: null,
};

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

const managedViews: WindowView[] = [];

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
 * Creates a new window with a content area
 * @param size Window size
 * @param initialUrl URL to load in the content area
 * @param deviceScaleFactor BrowserWindow content-size multiplier; null = no scaling
 * @returns The created window
 */
export async function createWindow(
  size: { width: number; height: number },
  initialUrl: string,
  deviceScaleFactor: number | null,
): Promise<WindowView> {
  // Create layout container with device pixel dimensions
  const layoutContainer = layout(
    size.width,
    size.height,
    getDisplayScale() ?? screen.getPrimaryDisplay().scaleFactor,
  );

  const contentNode = row({ height: auto(), tag: 'content' });

  calculateLayout(layoutContainer, [contentNode]);

  const content = new BrowserWindow({
    useContentSize: true,
    show: false,
    frame: false,
    paintWhenInitiallyHidden: true,
    hiddenInMissionControl: true,
    acceptFirstMouse: true,
    skipTaskbar: true,
    fullscreenable: false,
    resizable: false,
    ...contentNode.computedLayout,
    ...scaleContentSize(contentNode.computedLayout, deviceScaleFactor),

    ...(options.transparent ? { transparent: true, backgroundColor: '#00000000' } : {}),

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

  const destructors: Array<() => void> = [];

  function registerPaints(cellArea: { cols: number; rows: number }) {
    if (features.current?.images) {
      const contentFrame = createDirectFrame(cellArea);
      destructors.push(
        contentFrame.free,
        registerPaintedContent(contentFrame, content, contentNode).destroy,
      );
    } else {
      destructors.push(registerPaintedContentFallback(content, contentNode).destroy);
    }
  }

  const initialTermSize = getWindowSize();
  registerPaints({ cols: initialTermSize.cols, rows: initialTermSize.rows });

  // Add to extensions
  extensionsPromise.then((extensions) => {
    extensions.addTab(content.webContents, content);
  });
  await Promise.all([installedExtensionsPromise, bundledExtensionsPromise]);

  resetForFrameQuirk(content.webContents);
  content.webContents.loadURL(initialUrl);

  content.webContents.on('cursor-changed', updateCursor);

  const view: WindowView = {
    content,
    focusedContent: content.webContents,
    layoutContainer,
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

  process.on(
    'SIGWINCH',
    debounce(100, () => {
      for (const destructor of destructors) {
        destructor();
      }
      destructors.length = 0;

      const size = getWindowSize();
      updateViewSizes(view, size, deviceScaleFactor);
      registerPaints({ cols: size.cols, rows: size.rows });
    }),
  );

  return view;
}

function updateViewSizes(
  view: WindowView,
  { width, height }: Size,
  deviceScaleFactor: number | null,
) {
  const { content, contentNode } = view;
  view.layoutContainer = layout(
    width,
    height,
    getDisplayScale() ?? screen.getPrimaryDisplay().scaleFactor,
  );

  calculateLayout(view.layoutContainer, [contentNode]);

  const scaled = scaleContentSize(contentNode.computedLayout, deviceScaleFactor);
  content.setContentSize(scaled.width, scaled.height);
}
