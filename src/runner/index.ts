import electronPath from 'electron';
import { resolve, join } from 'node:path';
import { $, type ShellError, type Subprocess } from 'bun';
import { getKittyColorsAsCSS } from './kittyColors';
import { server } from './devServer';
import { getDisplayScale } from '../dpi';

const root = resolve(__dirname, '../../');

await $`mkdir -p dist`.nothrow().quiet();

{
  const { success } = await Bun.build({
    entrypoints: [join(root, 'src/index.ts'), join(root, 'src/preload.js')],
    outdir: join(root, 'dist'),
    root: join(root, 'src'),
    target: 'node',
    format: 'cjs',
    sourcemap: 'inline',
    external: ['electron'],
  });

  if (!success) {
    console.error('Failed to build');
    process.exit(1);
  }
}
try {
  const css = getKittyColorsAsCSS(true);
  await Bun.write(join(root, 'dist/kitty.css'), css);
} catch {
  console.error('Failed to get kitty colors');
}

if (!(await Bun.file(join(root, 'dist/toolbar/index.html')).exists())) {
  console.error('building toolbar');
  try {
    await $`bun ${join(root, 'node_modules/vite/bin/vite.js')} build`
      .cwd(join(root, 'src/runner'))
      .quiet();
  } catch (e) {
    const e_ = e as unknown as ShellError;
    console.error(e_.stderr.toString());
  }
}

const children: [string, Subprocess][] = [];
const isDev = process.argv.includes('--dev') || process.argv.includes('-d');

if (isDev) {
  await server.listen();
}

children.push([
  'electron',
  Bun.spawn(
    // electronPath is not the electron module, it's the path to the electron executable, despite what TS thinks
    [
      electronPath as unknown as string,
      join(root, 'dist/index.js'),
      '--high-dpi-support=1',
      `--force-device-scale-factor=${getDisplayScale()}`,
      ...process.argv.slice(2),
    ],
    {
      stdio: ['inherit', 'inherit', 'inherit'],
      serialization: 'json',
      ipc(message, subprocess) {
        // TODO: do cool stuff with IPC between bun and the electron process
      },
      windowsHide: true,
      onExit() {
        destroyAllSubprocesses();
      },
    },
  ),
]);

function destroySubprocess(name: string, child: Subprocess) {
  if (child.killed) return;
  console.error('destroying', name);
  child.kill();
}

function destroyAllSubprocesses() {
  for (const [name, child] of children) {
    destroySubprocess(name, child);
  }
  if (isDev) {
    console.error('stopping dev server');
    server.close();
  }
  process.exit(0);
}

process.on('SIGINT', destroyAllSubprocesses);
process.on('SIGTERM', destroyAllSubprocesses);
