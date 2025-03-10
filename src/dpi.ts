// this is all necessary due to a bug in Electron which applies the DPI twice for offscreen rendering
// and it needs to be set in the runner, so it's a constant for now
export function getDisplayScale() {
  return 1.25;
}
