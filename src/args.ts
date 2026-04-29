import { pathToFileURL } from 'url';
import { resolve } from 'path';
import { homedir } from 'os';

export const rawArgs = process.argv.slice(2);

const supportedSchemes = ['http', 'https', 'file', 'data'];

export function resolveUrl(arg: string): string {
  if (arg.startsWith('/')) {
    return pathToFileURL(arg).href;
  }
  if (arg.startsWith('./') || arg.startsWith('../')) {
    return pathToFileURL(resolve(process.cwd(), arg)).href;
  }
  if (arg.startsWith('~/')) {
    return pathToFileURL(resolve(homedir(), arg.slice(2))).href;
  }

  for (const scheme of supportedSchemes) {
    if (arg.startsWith(scheme + ':')) return arg;
  }

  return `https://${arg}`;
}

export const possibleOptions = {
  url: { short: 'u', description: 'Set the initial URL', string: true, arg: true },
  'device-scale-factor': {
    short: 's',
    description: 'BrowserWindow content-size multiplier; overrides config.deviceScaleFactor',
    string: true,
  },

  help: { short: 'h', description: 'Show help' },
  version: { short: 'v', description: 'Show version' },
  dev: { short: 'd', description: 'Run in development mode' },
  'no-paint': { short: 'n', description: 'Disable painting' },
  transparent: { short: 't', description: 'Make the window transparent' },
  'debug-paint': { short: 'p', description: 'Debug paint' },
} as const;

export type Option = keyof typeof possibleOptions;
type ShortOption = (typeof possibleOptions)[Option]['short'];

const shortOptions = Object.fromEntries(
  Object.entries(possibleOptions).map(([key, value]) => [value.short, key]),
) as {
  [K in ShortOption]: Option;
};

export const options: {
  [K in Option]?: (typeof possibleOptions)[K] extends { string: true } ? string : boolean;
} = {};

for (const arg of rawArgs) {
  if (arg.startsWith('-')) {
    const [rawKey, value] = arg.slice(arg.startsWith('--') ? 2 : 1).split('=');

    if (!(rawKey in possibleOptions) && !(rawKey in shortOptions)) {
      continue;
    }

    const key = shortOptions[rawKey as ShortOption] ?? rawKey;
    if (!('string' in possibleOptions[key])) {
      options[key] = true;
      continue;
    }
    if (value === undefined) continue;
    options[key] = key === 'url' ? resolveUrl(value) : (value as any);
  } else {
    options.url = resolveUrl(arg);
  }
}
