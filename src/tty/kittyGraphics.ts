import { GFX } from './escapeCodes';
import type { Size } from './graphics';
import { options } from '../args';
import type { ShmGraphicBuffer } from 'awrit-native-rs';
import { placeCursor } from './output';
const { stdout } = process;

let imageId_ = 1;

type ImageId = number & {};
function imageId(): ImageId {
  return imageId_++;
}

const quiet = options['debug-paint'] ? '' : ',q=2';

let bytesWrittenSinceMark_ = 0;

function gfxWrite(payload: string) {
  bytesWrittenSinceMark_ += Buffer.byteLength(payload);
  stdout.write(payload);
}

export function takeBytesWrittenSinceMark(): number {
  const value = bytesWrittenSinceMark_;
  bytesWrittenSinceMark_ = 0;
  return value;
}

// `process.stdout` over a TTY can return `false` from `write` and set
// `writableNeedDrain` when the kernel pty buffer is full. Awaiting the
// `drain` event is the only way to surface that backpressure in `sw`;
// otherwise `sw` only measures the synchronous queueing time, which is
// near-zero, and we miss the real cost of pushing ~28 MB/frame at 60 fps.
export function awaitStdoutDrain(): Promise<void> | undefined {
  if (!stdout.writableNeedDrain) {
    return undefined;
  }
  return new Promise<void>((resolve) => stdout.once('drain', () => resolve()));
}

function sv_size_(size: Size) {
  return `,s=${size.width},v=${size.height}`;
}

function shmRgba_(nameBase64: string, size: Size, control: string) {
  // f=32 rgba 32-bit
  // t=s SHM name
  gfxWrite(GFX`f=32,t=s${sv_size_(size)},${control};${nameBase64}`);
}

function paintBitmap(name: string, size: Size, control?: string) {
  // a=T transfer & display
  // C=1 don't move cursor
  shmRgba_(name, size, `a=T${quiet},C=1${control == null ? '' : ',' + control}`);
}

export interface CellArea {
  cols: number;
  rows: number;
}

export interface DirectFrame {
  readonly id: ImageId;
  transmitAndPlace: (buffer: ShmGraphicBuffer, size: Size) => void;
  free: () => void;
}

export function createDirectFrame(cellArea: CellArea): DirectFrame {
  const id = imageId();

  return {
    id,
    transmitAndPlace: (buffer: ShmGraphicBuffer, size: Size) => {
      paintBitmap(buffer.nameBase64, size, `i=${id},c=${cellArea.cols},r=${cellArea.rows}`);
    },
    free: () => freeImage(id),
  };
}

export function clearPlacements() {
  gfxWrite(GFX`a=d,d=A`);
}

function freeImage(id: ImageId) {
  // a=d,d=I delete image
  gfxWrite(GFX`a=d,d=I,i=${id}`);
}

// Ghostty and probably most other terminals only support a very small
// subset of the graphics protocol, so this just supports an initial paint,
// and then replacing under the same buffer before releasing
export interface PaintedImage {
  readonly id: ImageId;
  readonly size: Size;
  buffer: ShmGraphicBuffer;
  free: () => void;
  replace: (buffer: Buffer) => void;
}

export function paintImage(
  buffer: ShmGraphicBuffer,
  size: Size,
  position: { x: { cell: number; px: number }; y: { cell: number; px: number } },
): PaintedImage {
  const id = imageId();
  placeCursor({ x: position.x.cell, y: position.y.cell });
  const control = `i=${id},X=${position.x.px},Y=${position.y.px}`;
  paintBitmap(buffer.nameBase64, size, control);

  return {
    id,
    size,
    buffer,
    free: () => freeImage(id),
    replace: (buffer_) => {
      buffer.write(buffer_, size.width);
      placeCursor({ x: position.x.cell, y: position.y.cell });
      paintBitmap(buffer.nameBase64, size, control);
    },
  };
}
