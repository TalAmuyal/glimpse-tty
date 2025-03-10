// this is all necessary due to a bug in Electron which applies the DPI twice for offscreen rendering
// and it needs to be set in the runner, so it's a constant for now
export function getDisplayScale() {
  // most modern macs have a DPI of 2, unless it's an external display, oh well
  if (process.platform === 'darwin') {
    return 2;
  }
  // I use fractional scaling at 125%, we'll see if people complain this is too small
  // If you're looking here and you use Wayland and know of a reliable way to get the DPI, please let me know
  return 1.25;
}
