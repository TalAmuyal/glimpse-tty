export function abort() {
  // cheap trick to trigger the cleanup function from anywhere
  process.emit('SIGINT');
}
