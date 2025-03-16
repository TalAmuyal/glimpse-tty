import electronPath from 'electron';
import { resolve, join } from 'node:path';
import { $, type ShellError, type Subprocess } from 'bun';
import { colorsToTailwind, queryColors } from './kittyColors';
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

if (
  !(await Bun.file(join(root, 'dist/toolbar/index.html')).exists()) ||
  process.argv.includes('--rebuild')
) {
  console.error('building toolbar');
  try {
    const colors = await queryColors();
    if (!colors) {
      console.error('Failed to query terminal colors');
    } else {
      await Bun.write(join(root, 'dist/kitty.css'), colorsToTailwind(colors));
    }
  } catch {
    console.error('Failed to query terminal colors');
  }

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

const args = [
  electronPath as unknown as string,
  join(root, 'dist/index.js'),
  '--high-dpi-support=1',
];

// Kitty respects the virtual scale size, while other terminals respect the physical scale size, which confuses things
const forcedDisplayScale = getDisplayScale();
if (forcedDisplayScale) {
  args.push(`--force-device-scale-factor=${forcedDisplayScale}`);
}
args.push(...process.argv.slice(2));

children.push([
  'electron',
  Bun.spawn(
    // electronPath is not the electron module, it's the path to the electron executable, despite what TS thinks
    args,
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
