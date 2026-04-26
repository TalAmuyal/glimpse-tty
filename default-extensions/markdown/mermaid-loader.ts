import mermaid from 'mermaid';

const prefersDark = matchMedia('(prefers-color-scheme: dark)').matches;
mermaid.initialize({
  startOnLoad: false,
  securityLevel: 'strict',
  theme: prefersDark ? 'dark' : 'default',
});

export async function renderMermaid(id: string, definition: string): Promise<string> {
  const { svg } = await mermaid.render(id, definition);
  return svg;
}
