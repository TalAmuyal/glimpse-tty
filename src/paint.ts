import type { BrowserWindow } from 'electron';
import { ShmGraphicBuffer } from 'awrit-native-rs';
import type { InitialFrame, AnimationFrame } from './tty/kittyGraphics';
import { console_ } from './console';
import { options } from './args';
import type { LayoutNode } from './layout';

type PaintedContent = {
  frame?: AnimationFrame;
  buffer?: ShmGraphicBuffer;
  size?: number;
  expectedWinSize?: {
    width: number;
    height: number;
  };
};

const weakPaintedContents_ = new WeakMap<BrowserWindow, PaintedContent>();

export function registerPaintedContent(
  containerFrame: InitialFrame,
  w: BrowserWindow,
  layoutNode: LayoutNode,
): PaintedContent {
  const contents = w.webContents;
  const result: PaintedContent = {};
  const frameNumber = 2 + containerFrame.paintedContent++;

  function cleanup() {
    weakPaintedContents_.delete(w);
  }

  w.on('resize', () => {
    // result.frame?.delete();
    // result.frame = containerFrame.loadFrame(2, compositeName, bounds);
    // console_.error('bounds-changed', id, bounds);
  });

  contents.on('paint', async (_event, _dirty, image) => {
    const imageSize = image.getSize();

    // calculate the DPI on the first paint attempt and resize
    if (dpi_scale.current == null) {
      const [width, height] = w.getContentSize();
      dpi_scale.current = imageSize.width / width;
      const newSize = scaleSize({
        width,
        height: height * 2,
      });
      w.setContentSize(newSize.width, newSize.height);
      result.expectedWinSize = {
        width,
        height: height * 2,
      };
      return;
    }
    if (result.expectedWinSize == null) {
      const [width, height] = w.getContentSize();
      const newSize = scaleSize({
        width,
        height,
      });
      w.setContentSize(newSize.width, newSize.height);
      result.expectedWinSize = {
        width,
        height,
      };
      return;
    }
    if (
      result.expectedWinSize == null ||
      imageSize.width > result.expectedWinSize.width ||
      imageSize.height > result.expectedWinSize.height
    ) {
      console_.error('unexpected size mismatch', result.expectedWinSize, imageSize);
      return;
    }

    const imageBufferSize = imageSize.width * imageSize.height * 4;
    if (result.buffer == null) {
      result.buffer = new ShmGraphicBuffer(imageBufferSize);
    }
    if (options['debug-paint']) {
      console_.error('paint', result.buffer.nameBase64, image.getSize());
    }
    if (options['no-paint']) {
      return;
    }

    if (result.size != null && imageBufferSize > result.size) {
      if (options['debug-paint']) {
        console_.error('replace buffer', result.buffer.nameBase64, result.size, imageBufferSize);
      }
      result.buffer = new ShmGraphicBuffer(imageBufferSize);
      result.size = imageBufferSize;
    }

    const buffer = image.getBitmap();
    result.buffer.write(buffer, imageSize.width);
    containerFrame
      .loadFrame(frameNumber, result.buffer, imageSize)
      .composite(layoutNode.computedLayout);
  });
  contents.on('render-process-gone', cleanup);
  contents.on('destroyed', cleanup);

  weakPaintedContents_.set(w, result);
  return result;
}
