import type { TermEvent } from 'awrit-native-rs';
import { focusedView } from './windows';

const WHEEL_DELTA = 100;

const mouseEventTypes = ['mouseDown', 'mouseUp', 'mouseMove'] as const;

function isSimpleMouseEvent(kind: unknown): kind is (typeof mouseEventTypes)[number] {
  return mouseEventTypes.includes(kind as (typeof mouseEventTypes)[number]);
}

export function handleInput(evt: TermEvent) {
  const view = focusedView.current;
  if (!view) {
    return;
  }

  switch (evt.eventType) {
    case 'key': {
      const webContents = view.focusedContent;
      const { code: keyCode, modifiers, down, isCharEvent } = evt.keyEvent;

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
      const DPI_SCALE = view.layoutContainer.devicePixelRatio;
      const { kind, button, x, y, modifiers } = evt.mouseEvent;
      const rawX = x ?? 0;
      const rawY = y ?? 0;

      // Determine which region we're in based on layout
      const { toolbarNode } = view;
      const isInToolbar = rawY <= toolbarNode.computedLayout.height;

      // Calculate position relative to the target component
      const adjustedX = Math.floor(rawX / DPI_SCALE);
      // TODO: why is this 4 pixels off?
      const adjustedY =
        Math.floor((rawY - (isInToolbar ? 0 : toolbarNode.computedLayout.height)) / DPI_SCALE) - 4;

      const focusedContent = isInToolbar ? view.toolbar.webContents : view.content.webContents;

      if (kind === 'scrollUp' || kind === 'scrollDown') {
        view.content.webContents.sendInputEvent({
          type: 'mouseWheel',
          wheelTicksY: kind === 'scrollUp' ? 1 : -1,
          wheelTicksX: 0,
          deltaX: 0,
          deltaY: kind === 'scrollUp' ? WHEEL_DELTA : -WHEEL_DELTA,
          modifiers,
          x: adjustedX,
          y: adjustedY,
          accelerationRatioY: 0.5,
          hasPreciseScrollingDeltas: false,
          canScroll: true,
        });
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

      focusedContent.sendInputEvent({
        type: kind,
        x: adjustedX,
        y: adjustedY,
        button: electronButton,
        modifiers,
        clickCount: kind === 'mouseDown' ? 1 : 0,
      });

      if (kind === 'mouseDown' && button === 'left') {
        if (focusedContent !== view.focusedContent) {
          if (focusedContent === view.content.webContents) {
            view.content.blurWebView();
            view.content.focusOnWebView();
          } else {
            view.toolbar.blurWebView();
            view.toolbar.focusOnWebView();
          }
          view.focusedContent = focusedContent;
        }
      }
      break;
    }
  }
}
