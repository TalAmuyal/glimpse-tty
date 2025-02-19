import type { Session as ElectronSession } from 'electron';
import { installExtension } from 'electron-chrome-web-store';

const CHROME_WEB_STORE_EXTENSIONS = [
  // uBlock Origin
  'cjpalhdlnbpafiamejdnhcphjbkeiagm',
];

export async function installExtensions(session: ElectronSession) {
  return Promise.allSettled(
    CHROME_WEB_STORE_EXTENSIONS.map((id) => installExtension(id, { session })),
  );
}
