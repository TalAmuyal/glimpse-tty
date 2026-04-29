import { possibleOptions, options } from '../args';
import { $ } from 'bun';
import electronPath from 'electron';
import { copyFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { getDisplayScale } from '../dpi';

const { stdout } = process;

const RESET = '\x1b[0m';
const DIM_WHITE = '\x1b[0;2m';
const BOLD_GREEN = '\x1b[1;32m';
const BOLD_WHITE = '\x1b[1m';

export function showHelp() {
  stdout.write(RESET);
  stdout.write(`Usage: ${BOLD_GREEN}awrit${RESET} ${DIM_WHITE}[options] [url]${RESET}\n\n`);
  stdout.write('Options:\n');
  for (const [key, value] of Object.entries(possibleOptions)) {
    if ('arg' in value) {
      stdout.write(`  ${DIM_WHITE}[${key}]${RESET}: ${value.description}\n`);
    } else {
      stdout.write(
        `  ${BOLD_WHITE}-${value.short}${RESET}, ${BOLD_WHITE}--${key}${RESET}: ${value.description}\n`,
      );
    }
  }
}

if (options.help) {
  showHelp();
  process.exit(0);
}

if (options.version) {
  const version = (await $`git rev-parse --short HEAD`.quiet()).text().trim();
  if (stdout.isTTY) {
    stdout.write(`${BOLD_GREEN}awrit${RESET} ${version}\n`);
  } else {
    stdout.write(version);
  }
  process.exit(0);
}

const root = resolve(__dirname, '../../');
await $`mkdir -p ${root}/dist`.nothrow().quiet();

{
  const { success } = await Bun.build({
    entrypoints: [join(root, 'src/index.ts')],
    outdir: join(root, 'dist'),
    root: join(root, 'src'),
    target: 'node',
    format: 'cjs',
    sourcemap: 'inline',
    external: ['electron', 'awrit-native-rs', '*.node'],
  });

  if (!success) {
    console.error('Failed to build');
    process.exit(1);
  }
}

// Bundle the markdown extension into dist/extensions/markdown/.
// content.ts is a classic-script content_scripts entry (IIFE).
// mermaid-loader.ts is dynamically imported from content.ts via
// chrome.runtime.getURL + import(), so it must be ESM.
{
  const srcDir = join(root, 'default-extensions/markdown');
  const outDir = join(root, 'dist/extensions/markdown');
  await $`mkdir -p ${outDir}`.quiet();

  const entrypoints: Array<{ file: string; format: 'iife' | 'esm' }> = [
    { file: 'content.ts', format: 'iife' },
    { file: 'mermaid-loader.ts', format: 'esm' },
  ];

  for (const { file, format } of entrypoints) {
    // Minify both bundles: content.js loads on every .md page (parse time),
    // mermaid-loader.js is ~3MB even minified (every byte counts when it does load).
    // Skip sourcemaps — they bloat the bundles ~6x and aren't worth the cost
    // for production payload. Rebuild without --minify to debug.
    const { success } = await Bun.build({
      entrypoints: [join(srcDir, file)],
      outdir: outDir,
      target: 'browser',
      format,
      minify: true,
    });
    if (!success) {
      console.error(`Failed to build markdown extension: ${file}`);
      process.exit(1);
    }
  }

  copyFileSync(join(srcDir, 'manifest.json'), join(outDir, 'manifest.json'));
}

const args = [
  // electronPath is not the electron module, it's the path to the electron executable, despite what TS thinks
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

const electronProcess = Bun.spawn(args, {
  stdio: ['inherit', 'inherit', 'inherit'],
  serialization: 'json',
  ipc(message, subprocess) {
    // TODO: do cool stuff with IPC between bun and the electron process
  },
  windowsHide: true,
  onExit() {
    process.exit(0);
  },
});

function cleanup() {
  if (!electronProcess.killed) {
    electronProcess.kill();
  }
  process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
