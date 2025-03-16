import { ESC, OSC } from '../tty/escapeCodes';

function toKebabCase(str: string): string {
  return str
    .replace(/^(\d+)$/, 'c$1')
    .replace(/_color$/, '')
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/[\s_]+/g, '-')
    .toLowerCase();
}

const replacements: Record<string, string> = {
  foreground: 'kitty-fg',
  background: 'kitty-bg',
};

type Color = [name: string, color: string];
type QueryResponse = Array<Color> | undefined;
export function queryColors(): Promise<QueryResponse> {
  const { promise, resolve } = Promise.withResolvers<QueryResponse>();
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');

  let color_query = '';
  for (let i = 0; i <= 255; i++) {
    color_query += `;${i}=?`;
  }

  process.stdout.write(
    OSC`21;foreground=?;background=?;active_border_color=?;selection_background=?;selection_foreground=?;cursor=?;cursor_text=?${color_query}`,
  );

  const PREFIX = ESC`]21;`;
  const handler = (x: string) => {
    if (!x.startsWith(PREFIX)) return;

    const data = x
      .slice(PREFIX.length, x.length - 2)
      .split(';')
      .map((y) => y.split('='))
      .filter(([, color]) => color.startsWith('rgb:'))
      .map<Color>(([name_, color]) => [
        replacements[name_] ?? toKebabCase(name_),
        `#${color.slice(4).replace(/\//g, '')}`,
      ]);
    resolve(data);

    process.stdin.off('data', handler);
    process.stdin.pause();
    process.stdin.setRawMode(false);
  };
  process.stdin.on('data', handler);

  setTimeout(() => {
    process.stdin.off('data', handler);
    process.stdin.pause();
    process.stdin.setRawMode(false);
    resolve(undefined);
  }, 100);

  return promise;
}

export function colorsToTailwind(colors: Color[]) {
  return `@theme {
${colors.map(([name_, color]) => `  --color-${name_}: ${color};`).join('\n')}
}`;
}

// for running directly
if (require.main === module) {
  queryColors().then((x) => {
    if (x) console.log(colorsToTailwind(x));
  });
}
