import { possibleOptions, options } from '../args';
import electronPath from 'electron';
import { resolve, join } from 'node:path';
import { openSync } from 'node:fs';
import { getDisplayScale } from '../dpi';
import { resolveVersion } from './version';
import { buildIndex, buildMarkdownExtension } from '../../scripts/build';

const { stdout } = process;

const RESET = '\x1b[0m';
const DIM_WHITE = '\x1b[0;2m';
const BOLD_GREEN = '\x1b[1;32m';
const BOLD_WHITE = '\x1b[1m';

export function showHelp() {
  stdout.write(RESET);
  stdout.write(`Usage: ${BOLD_GREEN}glimpse-tty${RESET} ${DIM_WHITE}[options] [url]${RESET}\n\n`);
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

const root = resolve(__dirname, '../../');

if (options.version) {
  const version = await resolveVersion(root);
  if (stdout.isTTY) {
    stdout.write(`${BOLD_GREEN}glimpse-tty${RESET} ${version}\n`);
  } else {
    stdout.write(version);
  }
  process.exit(0);
}

try {
  await buildIndex(root);
  await buildMarkdownExtension(root);
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
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

const logPath = `/tmp/glimpse-tty-${Date.now()}.log`;
const logFd = openSync(logPath, 'a');

const electronProcess = Bun.spawn(args, {
  stdio: ['inherit', 'inherit', logFd],
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
