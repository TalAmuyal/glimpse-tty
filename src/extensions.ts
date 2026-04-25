import { installExtension } from 'electron-chrome-web-store';
import { sessionPromise } from './session';
import { ElectronChromeExtensions } from 'electron-chrome-extensions';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { console_ } from './console';

interface ChromeWebStoreExtension {
  id: string;
  loadExtensionOptions?: Electron.LoadExtensionOptions;
}

const CHROME_WEB_STORE_EXTENSIONS: ChromeWebStoreExtension[] = [
  // uBlock Origin Lite
  { id: 'ddkjiahejlhfcafbddmgiahcphecmpfh' },
];

interface BundledExtension {
  name: string;
  loadExtensionOptions?: Electron.LoadExtensionOptions;
}

// Bundled extensions live under <repo>/default-extensions/<name>/ as source and
// are built by the runner into <repo>/dist/extensions/<name>/. Bun's bundler
// inlines __dirname as the original source location (<repo>/src/), so we
// reach the built extensions via '../dist/extensions/<name>/' — matching the
// pattern already used for '../dist/preload.js' in windows.ts.
const BUNDLED_EXTENSIONS: BundledExtension[] = [
  // Renders .md and .markdown URLs as HTML.
  { name: 'markdown', loadExtensionOptions: { allowFileAccess: true } },
];

export const extensionsPromise = sessionPromise.then((session) => {
  return new ElectronChromeExtensions({
    session,
    license: 'GPL-3.0',
    modulePath: path.join(__dirname, '../node_modules/electron-chrome-extensions'),
  });
});

export const installedExtensionsPromise = sessionPromise.then((session) =>
  Promise.allSettled(
    CHROME_WEB_STORE_EXTENSIONS.map(({ id, loadExtensionOptions }) =>
      installExtension(id, { session, loadExtensionOptions }),
    ),
  ),
);

export const bundledExtensionsPromise = (async () => {
  await extensionsPromise;
  const session = await sessionPromise;
  const results = await Promise.allSettled(
    BUNDLED_EXTENSIONS.map(({ name, loadExtensionOptions }) => {
      const extPath = path.resolve(__dirname, '../dist/extensions', name);
      if (!fs.existsSync(path.join(extPath, 'manifest.json'))) {
        return Promise.reject(
          new Error(`Bundled extension "${name}" missing at ${extPath} (was the runner build skipped?)`),
        );
      }
      return session.extensions.loadExtension(extPath, loadExtensionOptions);
    }),
  );
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === 'rejected') {
      console_.error(`Failed to load bundled extension "${BUNDLED_EXTENSIONS[i].name}":`, r.reason);
    }
  }
})();

function resolveExtensionPath(input: string, configPath: string): string {
  const expanded = input.startsWith('~/')
    ? path.join(os.homedir(), input.slice(2))
    : input;
  return path.isAbsolute(expanded)
    ? expanded
    : path.resolve(path.dirname(configPath), expanded);
}

export async function loadUserExtensions(paths: string[], configPath: string) {
  await extensionsPromise;
  const session = await sessionPromise;
  const results = await Promise.allSettled(
    paths.map((p) => session.extensions.loadExtension(resolveExtensionPath(p, configPath))),
  );
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === 'rejected') {
      console_.error(`Failed to load user extension "${paths[i]}":`, r.reason);
    }
  }
}
