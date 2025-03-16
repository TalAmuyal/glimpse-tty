import { console_ } from './console';

export const rawArgs = process.argv.slice(2);

const possibleOptions = {
  url: { short: 'u', description: 'Set the initial URL', string: true, arg: true },

  help: { short: 'h', description: 'Show help' },
  version: { short: 'v', description: 'Show version' },
  dev: { short: 'd', description: 'Run in development mode' },
  'no-paint': { short: 'n', description: 'Disable painting' },
  transparent: { short: 't', description: 'Make the window transparent' },
  'debug-paint': { short: 'p', description: 'Debug paint' },
  rebuild: { short: 'r', description: 'Rebuild the toolbar' },
} as const;

export type Option = keyof typeof possibleOptions;
type ShortOption = (typeof possibleOptions)[Option]['short'];

const shortOptions = Object.fromEntries(
  Object.entries(possibleOptions).map(([key, value]) => [value.short, key]),
) as {
  [K in ShortOption]: Option;
};

export function showHelp() {
  console_.log('Usage: awrit [options] [url]');
  console_.log('Options:');
  for (const [key, value] of Object.entries(possibleOptions)) {
    if ('arg' in value) {
      console_.log(`  [${key}]: ${value.description}`);
    } else {
      console_.log(`  -${value.short}, --${key}: ${value.description}`);
    }
  }
}

export const options: {
  [K in Option]?: (typeof possibleOptions)[K] extends { string: true } ? string : boolean;
} = {};

const supportedSchemes = ['http', 'https', 'file', 'data'];

for (const arg of rawArgs) {
  if (arg.startsWith('-')) {
    const [rawKey, value] = arg.slice(arg.startsWith('--') ? 2 : 1).split('=');

    if (!(rawKey in possibleOptions) && !(rawKey in shortOptions)) {
      continue;
    }

    const key = shortOptions[rawKey as ShortOption] ?? rawKey;
    options[key] = 'string' in possibleOptions[key] ? (value as any) : true;
  } else {
    options.url = arg;
  }

  if (
    typeof options.url === 'string' &&
    !supportedSchemes.some((scheme) => (options.url as string).startsWith(scheme))
  ) {
    options.url = `https://${options.url}`;
  }
}
