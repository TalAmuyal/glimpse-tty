import { EscapeType, KeyEvent, MouseEvent, MouseButton, type InputEvent } from 'awrit-native';
import { focusedWindow } from './windows';

function handleModifiers(modifiers: number): Array<'shift' | 'alt' | 'ctrl'> {
  const result: Array<'shift' | 'alt' | 'ctrl'> = [];
  if (modifiers & (1 << 2)) result.push('shift');
  if (modifiers & (1 << 3)) result.push('alt');
  if (modifiers & (1 << 4)) result.push('ctrl');
  return result;
}

function handleMouseButton(buttons: number) {
  if (buttons & MouseButton.Left) return 'left';
  if (buttons & MouseButton.Right) return 'right';
  if (buttons & MouseButton.Middle) return 'middle';
  return;
}

const SHIFT_MAP = {
  '0': ')',
  '1': '!',
  '2': '@',
  '3': '#',
  '4': '$',
  '5': '%',
  '6': '^',
  '7': '&',
  '8': '*',
  '9': '(',
  '-': '_',
  '=': '+',
  '[': '{',
  ']': '}',
  '\\': '|',
  ';': ':',
  "'": '"',
  ',': '<',
  '.': '>',
  '/': '?',
  '`': '~',
};

export function handleInput(evt: InputEvent) {
  if (evt.type !== EscapeType.Key && evt.type !== EscapeType.Mouse) return;

  const win = focusedWindow.current;
  if (!win) {
    return;
  }

  switch (evt.type) {
    case EscapeType.Key: {
      if (evt.event === KeyEvent.Unicode) {
        win.webContents.insertText(evt.code);
      } else if (evt.event === KeyEvent.Down && evt.code.length === 1) {
        const keyCode = evt.modifiers.includes('shift')
          ? SHIFT_MAP[evt.code as keyof typeof SHIFT_MAP] ?? evt.code.toUpperCase()
          : evt.code;
        win.webContents.sendInputEvent({
          type: 'rawKeyDown',
          keyCode,
          modifiers: evt.modifiers,
        });
        win.webContents.sendInputEvent({
          type: 'char',
          keyCode,
          modifiers: evt.modifiers,
        });
      } else {
        win.webContents.sendInputEvent({
          type: evt.event === KeyEvent.Up ? 'keyUp' : 'keyDown',
          keyCode: evt.code,
          modifiers: evt.modifiers,
        });
      }
      break;
    }

    case EscapeType.Mouse: {
      const eventTypeMap = {
        [MouseEvent.Down]: 'mouseDown',
        [MouseEvent.Up]: 'mouseUp',
        [MouseEvent.Move]: 'mouseMove',
      }[evt.event];

      if (!eventTypeMap) break;
      const button = handleMouseButton(evt.buttons);
      if (!button) break;

      win.webContents.sendInputEvent({
        type: eventTypeMap as 'mouseDown' | 'mouseUp' | 'mouseMove',
        x: evt.x || 0,
        y: evt.y || 0,
        button,
        modifiers: handleModifiers(evt.modfiers),
        clickCount: 1,
      });
      break;
    }
  }
}
