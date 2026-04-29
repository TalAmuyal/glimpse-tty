import { getWindowSize, ShmGraphicBuffer } from 'awrit-native-rs';
import { app } from 'electron';
import type {
  BrowserWindow,
  Event as ElectronEvent,
  NativeImage,
  Rectangle,
  WebContentsPaintEventParams,
} from 'electron';
import { abort } from './abort';
import { options } from './args';
import { console_ } from './console';
import { features } from './features';
import type { LayoutNode } from './layout';
import {
  type DirectFrame,
  type PaintedImage,
  awaitStdoutDrain,
  paintImage,
  takeBytesWrittenSinceMark,
} from './tty/kittyGraphics';

type PaintedContent = {
  buffer?: ShmGraphicBuffer;
  size?: number;
  expectedWinSize?: {
    width: number;
    height: number;
  };
  destroy(): void;
};

type PaintEvent = ElectronEvent<WebContentsPaintEventParams>;

type PaintStats = {
  dt: number[];
  tb: number[];
  rd: number[];
  rw: number[];
  sw: number[];
  bw: number[];
};

const paintStatsByTag_ = new Map<string, PaintStats>();

function recordPaintStats(
  tag: string,
  dt: number,
  tb: number,
  rd: number,
  rw: number,
  sw: number,
  bw: number,
) {
  let stats = paintStatsByTag_.get(tag);
  if (!stats) {
    stats = { dt: [], tb: [], rd: [], rw: [], sw: [], bw: [] };
    paintStatsByTag_.set(tag, stats);
  }
  stats.dt.push(dt);
  stats.tb.push(tb);
  stats.rd.push(rd);
  stats.rw.push(rw);
  stats.sw.push(sw);
  stats.bw.push(bw);
}

function percentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) return 0;
  const idx = Math.min(sortedValues.length - 1, Math.floor((p / 100) * sortedValues.length));
  return sortedValues[idx];
}

function fmt1(n: number): string {
  return n.toFixed(1);
}

let summaryEmitted_ = false;

function emitPaintSummary() {
  if (summaryEmitted_) return;
  summaryEmitted_ = true;
  if (!options['debug-paint']) return;

  for (const [tag, stats] of paintStatsByTag_) {
    const count = stats.dt.length;
    if (count === 0) continue;

    const dtSorted = [...stats.dt].sort((a, b) => a - b);
    const tbSorted = [...stats.tb].sort((a, b) => a - b);
    const rdSorted = [...stats.rd].sort((a, b) => a - b);
    const rwSorted = [...stats.rw].sort((a, b) => a - b);
    const swSorted = [...stats.sw].sort((a, b) => a - b);

    const spikes = stats.dt.filter((v) => v > 40).length;
    const spikePct = (spikes / count) * 100;
    const bwTotalMb = stats.bw.reduce((acc, v) => acc + v, 0) / (1024 * 1024);

    console_.error(
      `paint:summary tag=${tag} count=${count} ` +
        `dt_p50=${fmt1(percentile(dtSorted, 50))} dt_p95=${fmt1(percentile(dtSorted, 95))} ` +
        `dt_p99=${fmt1(percentile(dtSorted, 99))} dt_max=${fmt1(dtSorted[dtSorted.length - 1])} ` +
        `dt_spikes_gt40=${spikes} dt_spikes_pct=${fmt1(spikePct)} ` +
        `tb_p50=${fmt1(percentile(tbSorted, 50))} tb_p95=${fmt1(percentile(tbSorted, 95))} ` +
        `tb_p99=${fmt1(percentile(tbSorted, 99))} ` +
        `rd_p50=${fmt1(percentile(rdSorted, 50))} rd_p95=${fmt1(percentile(rdSorted, 95))} ` +
        `rd_p99=${fmt1(percentile(rdSorted, 99))} ` +
        `rw_p50=${fmt1(percentile(rwSorted, 50))} rw_p95=${fmt1(percentile(rwSorted, 95))} ` +
        `rw_p99=${fmt1(percentile(rwSorted, 99))} ` +
        `sw_p50=${fmt1(percentile(swSorted, 50))} sw_p95=${fmt1(percentile(swSorted, 95))} ` +
        `sw_p99=${fmt1(percentile(swSorted, 99))} ` +
        `bw_total=${fmt1(bwTotalMb)}`,
    );
  }
}

if (options['debug-paint']) {
  app.on('before-quit', emitPaintSummary);
  process.on('SIGINT', emitPaintSummary);
  process.on('exit', emitPaintSummary);
}

const weakPaintedContents_ = new WeakMap<BrowserWindow, PaintedContent>();

export function registerPaintedContent(
  directFrame: DirectFrame,
  w: BrowserWindow,
  layoutNode: LayoutNode,
): PaintedContent {
  const contents = w.webContents;
  const tag = layoutNode.tag ?? '?';
  let lastPaintTime = 0;

  if (!features.current) {
    console_.error('No features available');
    abort();
  }

  const result: PaintedContent = {
    destroy() {
      contents.off('paint', paint);
      this.buffer = undefined;
    },
  };

  async function paint(event: PaintEvent, _dirty: Rectangle, image: NativeImage) {
    const t0 = performance.now();
    const dt = lastPaintTime ? t0 - lastPaintTime : 0;
    lastPaintTime = t0;

    // With useSharedTexture, image.getSize() can be 0x0; codedSize is authoritative.
    const codedSize = event.texture?.textureInfo.codedSize;
    const imageSize =
      codedSize && codedSize.width > 0 && codedSize.height > 0 ? codedSize : image.getSize();

    if (imageSize.width === 0 || imageSize.height === 0) {
      event.texture?.release();
      if (options['debug-paint']) {
        console_.error(`paint:${tag} dt=${dt.toFixed(1)} (skipped: 0x0 frame)`);
      }
      return;
    }

    const imageBufferSize = imageSize.width * imageSize.height * 4;
    if (result.buffer == null || result.size == null || imageBufferSize > result.size) {
      if (options['debug-paint'] && result.buffer != null) {
        console_.error('replace buffer', result.buffer.nameBase64, result.size, imageBufferSize);
      }
      result.buffer = new ShmGraphicBuffer(imageBufferSize);
      result.size = imageBufferSize;
    }
    if (options['no-paint']) {
      event.texture?.release();
      if (options['debug-paint']) {
        console_.error(
          `paint:${tag} dt=${dt.toFixed(1)} (no-paint) sz=${imageSize.width}x${imageSize.height}`,
        );
      }
      return;
    }

    // Electron 39+ delivers macOS IOSurfaceRef under handle.ioSurface.
    const ioSurface = event.texture?.textureInfo.handle.ioSurface;
    let pathTaken: 'tex' | 'bmp' | 'fail' = 'bmp';

    const tb0 = performance.now();
    let rdMs = 0;
    let rwMs = 0;
    let texturePathOk = false;
    if (ioSurface) {
      try {
        result.buffer.writeIosurface(ioSurface);
        pathTaken = 'tex';
        texturePathOk = true;
      } catch (err) {
        if (options['debug-paint']) {
          console_.error('writeIosurface failed; falling back to toBitmap:', err);
        }
      }
    }
    if (!texturePathOk) {
      try {
        const buffer = image.toBitmap();
        const mid = performance.now();
        rdMs = mid - tb0;
        if (buffer.length === 0) {
          throw new Error('image.toBitmap() returned empty buffer (length 0)');
        }
        result.buffer.write(buffer, imageSize.width);
        rwMs = performance.now() - mid;
      } catch (err) {
        pathTaken = 'fail';
        if (options['debug-paint']) {
          console_.error('toBitmap fallback failed:', err);
        }
      }
    }
    event.texture?.release();
    const tb1 = performance.now();
    if (texturePathOk) {
      rwMs = tb1 - tb0;
    }

    takeBytesWrittenSinceMark();
    const sw0 = performance.now();
    if (pathTaken !== 'fail') {
      directFrame.transmitAndPlace(result.buffer, imageSize);
    }
    // Capture bytes before yielding for drain so a concurrent paint can't
    // overwrite the shared counter mid-await.
    const bytesWritten = takeBytesWrittenSinceMark();
    const drainPromise = awaitStdoutDrain();
    if (drainPromise) {
      await drainPromise;
    }
    const sw1 = performance.now();

    if (options['debug-paint']) {
      const tbMs = tb1 - tb0;
      const swMs = sw1 - sw0;
      recordPaintStats(tag, dt, tbMs, rdMs, rwMs, swMs, bytesWritten);
      const niSize = image.getSize();
      const cs = event.texture?.textureInfo.codedSize;
      const fmt = event.texture?.textureInfo.pixelFormat ?? 'n/a';
      const dl = layoutNode.deviceLayout;
      console_.error(
        `paint:${tag} src=${pathTaken} fmt=${fmt} dt=${dt.toFixed(1)} tb=${tbMs.toFixed(1)} rd=${rdMs.toFixed(1)} rw=${rwMs.toFixed(1)} sw=${swMs.toFixed(1)} bw=${bytesWritten} ` +
          `sz=${imageSize.width}x${imageSize.height} ni=${niSize.width}x${niSize.height} cs=${cs?.width ?? 0}x${cs?.height ?? 0} ` +
          `dl=${dl.width}x${dl.height}@${dl.x},${dl.y}`,
      );
    }
  }

  contents.on('paint', paint);

  weakPaintedContents_.set(w, result);
  return result;
}

function coordsFromPx(cellToPx: number, px: number) {
  return {
    cell: Math.ceil(px / cellToPx),
    px: Math.ceil(px % cellToPx),
  };
}

export function registerPaintedContentFallback(
  w: BrowserWindow,
  layoutNode: LayoutNode,
): PaintedContent {
  const contents = w.webContents;
  const termSize = getWindowSize();
  const cellToPxX = termSize.width / termSize.cols;
  const cellToPxY = termSize.height / termSize.rows;
  const tag = layoutNode.tag ?? '?';
  let lastPaintTime = 0;
  let paintedImage: PaintedImage | undefined;

  const result: PaintedContent = {
    destroy() {
      contents.off('paint', paint);
      this.buffer = undefined;
      paintedImage?.free();
      paintedImage = undefined;
    },
  };

  async function paint(_: any, _dirty: Rectangle, image: NativeImage) {
    const t0 = performance.now();
    const dt = lastPaintTime ? t0 - lastPaintTime : 0;
    lastPaintTime = t0;

    const imageSize = image.getSize();
    const imageBufferSize = imageSize.width * imageSize.height * 4;

    const position = {
      x: coordsFromPx(cellToPxX, layoutNode.deviceLayout.x),
      y: coordsFromPx(cellToPxY, layoutNode.deviceLayout.y),
    };

    if (options['no-paint']) {
      return;
    }

    let tbMs = 0;
    let rdMs = 0;
    let rwMs = 0;
    let swMs = 0;
    let bytesWritten = 0;

    let replace = true;
    if (result.buffer == null || (result.size != null && imageBufferSize > result.size)) {
      replace = false;
      const buffer = new ShmGraphicBuffer(imageBufferSize);
      paintedImage?.free();
      const tb0 = performance.now();
      const bitmap = image.toBitmap();
      const mid = performance.now();
      rdMs = mid - tb0;
      buffer.write(bitmap, imageSize.width);
      rwMs = performance.now() - mid;
      tbMs = rdMs + rwMs;
      takeBytesWrittenSinceMark();
      const sw0 = performance.now();
      paintedImage = paintImage(buffer, imageSize, position);
      bytesWritten = takeBytesWrittenSinceMark();
      const drainPromise = awaitStdoutDrain();
      if (drainPromise) {
        await drainPromise;
      }
      swMs = performance.now() - sw0;

      result.buffer = buffer;
      result.size = imageBufferSize;
    }

    if (replace && paintedImage) {
      const tb0 = performance.now();
      const bitmap = image.toBitmap();
      const mid = performance.now();
      rdMs = mid - tb0;
      paintedImage.replace(bitmap);
      rwMs = performance.now() - mid;
      tbMs = rdMs + rwMs;
      takeBytesWrittenSinceMark();
      const sw0 = performance.now();
      bytesWritten = takeBytesWrittenSinceMark();
      const drainPromise = awaitStdoutDrain();
      if (drainPromise) {
        await drainPromise;
      }
      swMs = performance.now() - sw0;
    }

    if (options['debug-paint']) {
      recordPaintStats(tag, dt, tbMs, rdMs, rwMs, swMs, bytesWritten);
      console_.error(
        `paint:${tag}(fallback) dt=${dt.toFixed(1)} tb=${tbMs.toFixed(1)} rd=${rdMs.toFixed(1)} rw=${rwMs.toFixed(1)} sw=${swMs.toFixed(1)} bw=${bytesWritten} sz=${imageSize.width}x${imageSize.height}`,
      );
    }
  }
  contents.on('paint', paint);

  weakPaintedContents_.set(w, result);
  return result;
}
