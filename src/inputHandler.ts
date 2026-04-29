import type { KeyEvent as KeyEventOriginal, TermEvent } from 'awrit-native-rs';
import { handleEvent as handleKeyBinding } from './keybindings';
import { focusedView } from './windows';

const WHEEL_DELTA = 100;
// Each terminal scroll arrives as one discrete event. Sending it as a single
// `deltaY: 100, hasPreciseScrollingDeltas: false` wheel makes Chromium treat
// it like a wheel click — even with `--enable-smooth-scrolling`, the captured
// animation often looks stepped through awrit's offscreen→Kitty path.
//
// Instead we fan it out into a sequence of small `hasPreciseScrollingDeltas:
// true` events spread over SCROLL_DURATION_MS, mimicking trackpad input.
// Chromium handles those with continuous high-resolution scrolling, which
// produces a steadier stream of paint events for awrit to forward.
const SCROLL_STEPS = 10;
const SCROLL_DURATION_MS = 120;

const mouseEventTypes = ['mouseDown', 'mouseUp', 'mouseMove'] as const;
// this is a fix for Electron going back and forth on what's supported for modifiers, despite being case insensitive;
type KeyEventModifiers = Lowercase<KeyEventOriginal['modifiers'][number]>[];
type KeyEvent = Omit<KeyEventOriginal, 'modifiers'> & {
  modifiers: KeyEventModifiers;
};

function isSimpleMouseEvent(kind: unknown): kind is (typeof mouseEventTypes)[number] {
  return mouseEventTypes.includes(kind as (typeof mouseEventTypes)[number]);
}

export function handleInput(evt: TermEvent) {
  const view = focusedView.current;
  if (!view) {
    handleKeyBinding(evt);
    return;
  }

  switch (evt.eventType) {
    case 'key': {
      // First check if this is a keybinding
      if (handleKeyBinding(evt, view)) {
        return;
      }

      const webContents = view.focusedContent;
      const { code: keyCode, modifiers, down, isCharEvent } = evt.keyEvent as KeyEvent;

      if (isCharEvent && down) {
        webContents.sendInputEvent({
          type: 'rawKeyDown',
          keyCode,
          modifiers,
        });
        webContents.sendInputEvent({
          type: 'char',
          keyCode,
          modifiers,
        });
      } else {
        webContents.sendInputEvent({
          type: down ? 'keyDown' : 'keyUp',
          keyCode,
          modifiers,
        });
      }
      break;
    }

    case 'mouse': {
      const { kind, button, x, y, modifiers } = evt.mouseEvent;
      if (
        (kind === 'mouseUp' || kind === 'mouseDown') &&
        button &&
        ['fourth', 'fifth'].includes(button ?? '')
      ) {
        handleKeyBinding(evt, view);
        return;
      }

      const DPI_SCALE = view.layoutContainer.devicePixelRatio;
      const rawX = x ?? 0;
      const rawY = y ?? 0;

      const adjustedX = Math.floor(rawX / DPI_SCALE);
      const adjustedY = Math.floor(rawY / DPI_SCALE);

      const webContents = view.focusedContent;

      if (kind === 'scrollUp' || kind === 'scrollDown') {
        const direction = kind === 'scrollUp' ? 1 : -1;
        const stepDelta = (direction * WHEEL_DELTA) / SCROLL_STEPS;
        const stepInterval = SCROLL_DURATION_MS / SCROLL_STEPS;
        for (let i = 0; i < SCROLL_STEPS; i++) {
          setTimeout(() => {
            if (webContents.isDestroyed()) return;
            webContents.sendInputEvent({
              type: 'mouseWheel',
              wheelTicksX: 0,
              wheelTicksY: 0,
              deltaX: 0,
              deltaY: stepDelta,
              modifiers,
              x: adjustedX,
              y: adjustedY,
              accelerationRatioY: 0.5,
              hasPreciseScrollingDeltas: true,
              canScroll: true,
            });
          }, i * stepInterval);
        }
        break;
      }

      if (!isSimpleMouseEvent(kind)) {
        break;
      }
      if (!button && kind !== 'mouseMove') {
        break;
      }

      const electronButton =
        button === 'fourth' || button === 'fifth' || button == null ? undefined : button;

      webContents.sendInputEvent({
        type: kind,
        x: adjustedX,
        y: adjustedY,
        button: electronButton,
        modifiers,
        clickCount: kind === 'mouseDown' ? 1 : 0,
      });

      break;
    }
  }
}
