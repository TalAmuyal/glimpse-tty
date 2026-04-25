import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/common';
import { marked } from 'marked';
import markedAlert from 'marked-alert';
import markedFootnote from 'marked-footnote';
import { gfmHeadingId } from 'marked-gfm-heading-id';

declare const chrome: { runtime: { getURL(path: string): string } };

interface MermaidLoader {
  renderMermaid(id: string, definition: string): Promise<string>;
}

const FRONT_MATTER = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;

// TOC tuning — see default-extensions/markdown/TOC.md for the rationale and
// guidance on adjusting these values.
const TOC_MIN_HEADINGS = 3;
const TOC_MIN_VIEWPORT_WIDTH = 1100;
const TOC_HEADING_SELECTOR = 'h2[id], h3[id]';
const TOC_ACTIVE_ZONE = '0px 0px -70% 0px';

const STYLES = `
html { scroll-behavior: smooth; }
.awrit-markdown {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
  font-size: 16px;
  line-height: 1.6;
  color: #24292f;
  max-width: 860px;
  margin: 2rem auto;
  padding: 0 1.5rem;
}
.awrit-markdown a.external::after {
  content: ' \\2197';
  font-size: 0.85em;
  opacity: 0.6;
}
.awrit-markdown h1, .awrit-markdown h2 {
  border-bottom: 1px solid #d0d7de;
  padding-bottom: 0.3em;
}
.awrit-markdown h1, .awrit-markdown h2, .awrit-markdown h3,
.awrit-markdown h4, .awrit-markdown h5, .awrit-markdown h6 {
  scroll-margin-top: 1rem;
}
.awrit-markdown h1 .anchor, .awrit-markdown h2 .anchor, .awrit-markdown h3 .anchor,
.awrit-markdown h4 .anchor, .awrit-markdown h5 .anchor, .awrit-markdown h6 .anchor {
  margin-left: 0.4em;
  opacity: 0;
  text-decoration: none;
  color: inherit;
  font-weight: 400;
}
.awrit-markdown h1:hover .anchor, .awrit-markdown h2:hover .anchor,
.awrit-markdown h3:hover .anchor, .awrit-markdown h4:hover .anchor,
.awrit-markdown h5:hover .anchor, .awrit-markdown h6:hover .anchor { opacity: 0.5; }
.awrit-markdown a { color: #0969da; }
.awrit-markdown code {
  background: #afb8c133;
  padding: 0.2em 0.4em;
  border-radius: 6px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.875em;
}
.awrit-markdown pre {
  position: relative;
  background: #f6f8fa;
  padding: 1em;
  border-radius: 6px;
  overflow: auto;
}
.awrit-markdown pre code {
  background: transparent;
  padding: 0;
  font-size: 0.875em;
}
.awrit-markdown pre .copy-button {
  position: absolute;
  top: 0.5rem;
  right: 0.5rem;
  padding: 4px 8px;
  background: #ffffffd9;
  border: 1px solid #d0d7de;
  border-radius: 4px;
  font: 12px/1 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  color: #24292f;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s;
}
.awrit-markdown pre:hover .copy-button { opacity: 1; }
.awrit-markdown pre .copy-button.copied { color: #1a7f37; border-color: #1a7f37; }
.awrit-markdown pre .lang-label {
  position: absolute;
  top: 0.5rem;
  right: 4.5rem;
  font: 10px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #6e7781;
  opacity: 0.6;
  pointer-events: none;
  user-select: none;
}

.awrit-markdown .markdown-alert {
  border-left: 4px solid;
  padding: 0.5em 1em;
  margin: 1em 0;
  background: transparent;
}
.awrit-markdown .markdown-alert > .markdown-alert-title {
  display: flex;
  align-items: center;
  gap: 0.4em;
  font-weight: 600;
  margin: 0 0 0.5em 0;
  text-transform: capitalize;
}
.awrit-markdown .markdown-alert-note { border-color: #0969da; }
.awrit-markdown .markdown-alert-note > .markdown-alert-title { color: #0969da; }
.awrit-markdown .markdown-alert-tip { border-color: #1a7f37; }
.awrit-markdown .markdown-alert-tip > .markdown-alert-title { color: #1a7f37; }
.awrit-markdown .markdown-alert-important { border-color: #8250df; }
.awrit-markdown .markdown-alert-important > .markdown-alert-title { color: #8250df; }
.awrit-markdown .markdown-alert-warning { border-color: #9a6700; }
.awrit-markdown .markdown-alert-warning > .markdown-alert-title { color: #9a6700; }
.awrit-markdown .markdown-alert-caution { border-color: #cf222e; }
.awrit-markdown .markdown-alert-caution > .markdown-alert-title { color: #cf222e; }

.awrit-markdown section.footnotes {
  margin-top: 2.5em;
  padding-top: 1em;
  border-top: 1px solid #d0d7de;
  font-size: 0.9em;
  color: #6a737d;
}
.awrit-markdown section.footnotes ol { padding-left: 1.5em; }
.awrit-markdown section.footnotes li { margin-bottom: 0.4em; }
.awrit-markdown blockquote {
  color: #6a737d;
  border-left: 4px solid #dfe2e5;
  padding: 0 1em;
  margin: 0;
}
.awrit-markdown table { border-collapse: collapse; margin: 1em 0; }
.awrit-markdown th, .awrit-markdown td {
  border: 1px solid #d0d7de;
  padding: 6px 13px;
}
.awrit-markdown img { max-width: 100%; }
.awrit-markdown hr {
  border: 0;
  border-top: 1px solid #d0d7de;
  margin: 1.5em 0;
}
.awrit-markdown ul.contains-task-list { padding-left: 1.2em; list-style: none; }
.awrit-markdown li.task-list-item { position: relative; padding-left: 1.4em; }
.awrit-markdown li.task-list-item input[type="checkbox"] {
  position: absolute;
  left: 0;
  top: 0.35em;
  margin: 0;
}
.awrit-mermaid { display: flex; justify-content: center; margin: 1em 0; }
.awrit-mermaid svg { max-width: 100%; height: auto; }

.awrit-toc {
  position: fixed;
  top: 2rem;
  right: 1rem;
  width: 220px;
  max-height: calc(100vh - 4rem);
  overflow-y: auto;
  font-size: 0.85em;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
}
.awrit-toc ul { list-style: none; padding: 0; margin: 0; }
.awrit-toc li.awrit-toc-h3 { padding-left: 1em; }
.awrit-toc a {
  display: block;
  padding: 0.2em 0 0.2em 0.75em;
  margin-left: -2px;
  border-left: 2px solid #d0d7de;
  color: #6e7781;
  text-decoration: none;
  line-height: 1.3;
  transition: color 0.1s, border-color 0.1s;
}
.awrit-toc a:hover { color: #0969da; }
.awrit-toc a.active {
  color: #24292f;
  border-left-color: #0969da;
  font-weight: 500;
}
@media (max-width: ${TOC_MIN_VIEWPORT_WIDTH - 1}px) {
  .awrit-toc { display: none; }
}

.awrit-markdown .hljs { color: #24292f; background: #f6f8fa; }
.awrit-markdown .hljs-keyword,
.awrit-markdown .hljs-meta,
.awrit-markdown .hljs-built_in { color: #cf222e; }
.awrit-markdown .hljs-string,
.awrit-markdown .hljs-attr { color: #0a3069; }
.awrit-markdown .hljs-comment,
.awrit-markdown .hljs-quote { color: #6e7781; font-style: italic; }
.awrit-markdown .hljs-number,
.awrit-markdown .hljs-literal { color: #0550ae; }
.awrit-markdown .hljs-function,
.awrit-markdown .hljs-title,
.awrit-markdown .hljs-section { color: #8250df; }
.awrit-markdown .hljs-variable,
.awrit-markdown .hljs-params { color: #24292f; }
.awrit-markdown .hljs-tag,
.awrit-markdown .hljs-name,
.awrit-markdown .hljs-selector-tag { color: #116329; }
.awrit-markdown .hljs-symbol,
.awrit-markdown .hljs-bullet,
.awrit-markdown .hljs-link { color: #cf222e; }
.awrit-markdown .hljs-deletion { color: #82071e; background: #ffebe9; }
.awrit-markdown .hljs-addition { color: #116329; background: #dafbe1; }

@media (prefers-color-scheme: dark) {
  body { background: #0d1117; }
  .awrit-markdown { color: #c9d1d9; }
  .awrit-markdown h1, .awrit-markdown h2 { border-bottom-color: #21262d; }
  .awrit-markdown a { color: #58a6ff; }
  .awrit-markdown code { background: #6e768166; }
  .awrit-markdown pre { background: #161b22; }
  .awrit-markdown pre .copy-button {
    background: #21262dd9;
    border-color: #30363d;
    color: #c9d1d9;
  }
  .awrit-markdown pre .copy-button.copied { color: #56d364; border-color: #56d364; }
  .awrit-markdown blockquote { color: #8b949e; border-left-color: #30363d; }
  .awrit-markdown th, .awrit-markdown td { border-color: #30363d; }
  .awrit-markdown hr { border-top-color: #30363d; }
  .awrit-markdown section.footnotes { color: #8b949e; border-top-color: #30363d; }
  .awrit-markdown .markdown-alert-note { border-color: #1f6feb; }
  .awrit-markdown .markdown-alert-note > .markdown-alert-title { color: #58a6ff; }
  .awrit-markdown .markdown-alert-tip { border-color: #238636; }
  .awrit-markdown .markdown-alert-tip > .markdown-alert-title { color: #56d364; }
  .awrit-markdown .markdown-alert-important { border-color: #8957e5; }
  .awrit-markdown .markdown-alert-important > .markdown-alert-title { color: #d2a8ff; }
  .awrit-markdown .markdown-alert-warning { border-color: #9e6a03; }
  .awrit-markdown .markdown-alert-warning > .markdown-alert-title { color: #d29922; }
  .awrit-markdown .markdown-alert-caution { border-color: #da3633; }
  .awrit-markdown .markdown-alert-caution > .markdown-alert-title { color: #ff7b72; }

  .awrit-toc a { border-left-color: #30363d; color: #8b949e; }
  .awrit-toc a:hover { color: #58a6ff; }
  .awrit-toc a.active { color: #c9d1d9; border-left-color: #58a6ff; }

  .awrit-markdown .hljs { color: #c9d1d9; background: #161b22; }
  .awrit-markdown .hljs-keyword,
  .awrit-markdown .hljs-meta,
  .awrit-markdown .hljs-built_in { color: #ff7b72; }
  .awrit-markdown .hljs-string,
  .awrit-markdown .hljs-attr { color: #a5d6ff; }
  .awrit-markdown .hljs-comment,
  .awrit-markdown .hljs-quote { color: #8b949e; }
  .awrit-markdown .hljs-number,
  .awrit-markdown .hljs-literal { color: #79c0ff; }
  .awrit-markdown .hljs-function,
  .awrit-markdown .hljs-title,
  .awrit-markdown .hljs-section { color: #d2a8ff; }
  .awrit-markdown .hljs-variable,
  .awrit-markdown .hljs-params { color: #c9d1d9; }
  .awrit-markdown .hljs-tag,
  .awrit-markdown .hljs-name,
  .awrit-markdown .hljs-selector-tag { color: #7ee787; }
  .awrit-markdown .hljs-deletion { color: #ffdcd7; background: #67060c; }
  .awrit-markdown .hljs-addition { color: #aff5b4; background: #033a16; }
}
`;

marked.use(gfmHeadingId(), markedAlert(), markedFootnote());

let mermaidLoaderPromise: Promise<MermaidLoader> | null = null;
function loadMermaid(): Promise<MermaidLoader> {
  if (!mermaidLoaderPromise) {
    const url = chrome.runtime.getURL('mermaid-loader.js');
    mermaidLoaderPromise = import(url) as Promise<MermaidLoader>;
  }
  return mermaidLoaderPromise;
}

function findPlaintextPre(): HTMLPreElement | null {
  const body = document.body;
  if (!body || body.children.length !== 1) return null;
  const first = body.firstElementChild;
  return first instanceof HTMLPreElement ? first : null;
}

function addAnchorLinks(scope: HTMLElement): void {
  for (const heading of scope.querySelectorAll<HTMLHeadingElement>('h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]')) {
    const link = document.createElement('a');
    link.className = 'anchor';
    link.href = `#${heading.id}`;
    link.textContent = '#';
    link.setAttribute('aria-label', `Link to section: ${heading.textContent ?? ''}`);
    heading.appendChild(link);
  }
}

function buildToc(article: HTMLElement): void {
  if (window.innerWidth < TOC_MIN_VIEWPORT_WIDTH) return;
  const headings = Array.from(
    article.querySelectorAll<HTMLHeadingElement>(TOC_HEADING_SELECTOR),
  );
  if (headings.length < TOC_MIN_HEADINGS) return;

  const nav = document.createElement('nav');
  nav.className = 'awrit-toc';
  nav.setAttribute('aria-label', 'On this page');

  const ul = document.createElement('ul');
  const linkById = new Map<string, HTMLAnchorElement>();
  for (const h of headings) {
    const li = document.createElement('li');
    li.className = `awrit-toc-${h.tagName.toLowerCase()}`;
    const a = document.createElement('a');
    a.href = `#${h.id}`;
    a.textContent = (h.textContent ?? '').trim();
    li.appendChild(a);
    ul.appendChild(li);
    linkById.set(h.id, a);
  }
  nav.appendChild(ul);
  document.body.appendChild(nav);

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const link = linkById.get(entry.target.id);
        if (!link) continue;
        for (const a of nav.querySelectorAll('a.active')) a.classList.remove('active');
        link.classList.add('active');
      }
    },
    { rootMargin: TOC_ACTIVE_ZONE, threshold: 0 },
  );
  for (const h of headings) observer.observe(h);
}

function highlightCodeBlocks(scope: HTMLElement): HTMLElement[] {
  const mermaidBlocks: HTMLElement[] = [];
  for (const code of scope.querySelectorAll<HTMLElement>('pre > code')) {
    if (code.classList.contains('language-mermaid')) {
      mermaidBlocks.push(code);
      continue;
    }
    hljs.highlightElement(code);
  }
  return mermaidBlocks;
}

function addLanguageLabels(scope: HTMLElement): void {
  for (const pre of scope.querySelectorAll<HTMLPreElement>('pre')) {
    const code = pre.querySelector(':scope > code');
    if (!code) continue;
    let lang: string | null = null;
    for (const cls of Array.from(code.classList)) {
      if (cls.startsWith('language-')) {
        lang = cls.slice('language-'.length);
        break;
      }
    }
    if (!lang || lang === 'mermaid') continue;
    const label = document.createElement('span');
    label.className = 'lang-label';
    label.textContent = lang;
    pre.appendChild(label);
  }
}

function markExternalLinks(scope: HTMLElement): void {
  const ownHost = location.hostname;
  for (const a of scope.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    const href = a.getAttribute('href') ?? '';
    if (!/^https?:\/\//i.test(href)) continue;
    let url: URL;
    try {
      url = new URL(href);
    } catch {
      continue;
    }
    if (url.hostname && url.hostname !== ownHost) {
      a.classList.add('external');
      a.setAttribute('rel', 'noopener noreferrer');
    }
  }
}

function lazifyImages(scope: HTMLElement): void {
  for (const img of scope.querySelectorAll<HTMLImageElement>('img')) {
    img.loading = 'lazy';
    img.decoding = 'async';
  }
}

function addCopyButtons(scope: HTMLElement): void {
  for (const pre of scope.querySelectorAll<HTMLPreElement>('pre')) {
    if (pre.querySelector(':scope > .copy-button')) continue;
    const code = pre.querySelector(':scope > code');
    if (!code) continue;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'copy-button';
    button.textContent = 'Copy';
    button.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(code.textContent ?? '');
        button.textContent = 'Copied';
        button.classList.add('copied');
        window.setTimeout(() => {
          button.textContent = 'Copy';
          button.classList.remove('copied');
        }, 1500);
      } catch (err) {
        console.error('Copy failed:', err);
      }
    });
    pre.appendChild(button);
  }
}

async function renderMermaidBlocks(blocks: HTMLElement[]): Promise<void> {
  if (blocks.length === 0) return;
  const { renderMermaid } = await loadMermaid();
  for (let i = 0; i < blocks.length; i++) {
    const code = blocks[i];
    const pre = code.parentElement;
    if (!(pre instanceof HTMLPreElement)) continue;
    const definition = code.textContent ?? '';
    const id = `awrit-mermaid-${Date.now()}-${i}`;
    try {
      const svg = await renderMermaid(id, definition);
      const wrapper = document.createElement('div');
      wrapper.className = 'awrit-mermaid';
      wrapper.innerHTML = svg;
      pre.replaceWith(wrapper);
    } catch (err) {
      const errorBox = document.createElement('div');
      errorBox.className = 'awrit-mermaid-error';
      errorBox.style.cssText = 'color: #cf222e; padding: 1em; border: 1px solid #cf222e; border-radius: 6px;';
      errorBox.textContent = `Mermaid render error: ${err instanceof Error ? err.message : String(err)}`;
      pre.replaceWith(errorBox);
    }
  }
}

async function render(): Promise<void> {
  const pre = findPlaintextPre();
  if (!pre) return;

  const source = pre.innerText.replace(FRONT_MATTER, '');
  const html = await marked.parse(source);
  const safe = DOMPurify.sanitize(html);

  document.body.innerHTML = '';
  const article = document.createElement('article');
  article.className = 'awrit-markdown';
  article.innerHTML = safe;
  document.body.appendChild(article);

  const style = document.createElement('style');
  style.textContent = STYLES;
  document.head.appendChild(style);

  const filename = location.pathname.split('/').filter(Boolean).pop();
  if (filename) document.title = filename;

  // TOC must run before addAnchorLinks; otherwise heading.textContent
  // includes the trailing '#' from the anchor link we append.
  buildToc(article);
  addAnchorLinks(article);
  const mermaidBlocks = highlightCodeBlocks(article);
  addLanguageLabels(article);
  addCopyButtons(article);
  markExternalLinks(article);
  lazifyImages(article);
  await renderMermaidBlocks(mermaidBlocks);
}

render();
