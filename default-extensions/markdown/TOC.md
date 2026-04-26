# Table of contents — tuning guide

The markdown extension renders a floating right-side TOC for long documents. This file documents what controls its behavior and how to adjust it.

## What it is

A `<nav class="awrit-toc">` injected into `<body>` after the rendered article. It lists every `<h2>` and `<h3>` in the document as anchor links, position-fixed to the right edge of the viewport, and highlights the heading currently in view via `IntersectionObserver`.

## When it appears

The TOC is rendered only when **all** of these hold:

- The document contains at least `TOC_MIN_HEADINGS` matching headings.
- The viewport is wider than `TOC_MIN_VIEWPORT_WIDTH` pixels at render time.
- The viewport is *currently* wider than `TOC_MIN_VIEWPORT_WIDTH` pixels (CSS media query — handles resize from wide → narrow).

If the viewport is narrow at render time, the nav element is not built at all (no IntersectionObserver, no DOM nodes). On resize from narrow → wide it will not appear; reload the page.

## Tunable constants

All four live at the top of `content.ts`. Edit, save, then relaunch awrit (the runner rebuilds the extension on every launch).

| Constant | Default | Effect |
|---|---|---|
| `TOC_MIN_HEADINGS` | `3` | Below this, TOC is hidden — avoids clutter on short docs. |
| `TOC_MIN_VIEWPORT_WIDTH` | `1100` | Below this width (px), TOC is hidden via JS *and* the CSS media query. Both branches reference the same constant. |
| `TOC_HEADING_SELECTOR` | `'h2[id], h3[id]'` | CSS selector for which headings to include. To also list `h4`: `'h2[id], h3[id], h4[id]'`. To list only `h2`: `'h2[id]'`. |
| `TOC_ACTIVE_ZONE` | `'0px 0px -70% 0px'` | `IntersectionObserver` `rootMargin`. The top 30% of the viewport counts as "active". Lower the `-70%` (e.g. `-50%`) to highlight earlier as you scroll; raise it (e.g. `-85%`) to highlight later. |

## How to test changes

1. Make your edit in `default-extensions/markdown/content.ts`.
2. Relaunch on the test fixture:
   ```sh
   ./awrit "file://$(pwd)/markdown-test.md"
   ```
   The runner rebundles the extension on every launch, so there is no separate build step.
3. Resize the terminal window across the threshold to verify show/hide.
4. Scroll — the entry corresponding to the section currently in view should highlight.
5. Click an entry — should smooth-scroll to that section (`scroll-behavior: smooth` is enabled).

## Common adjustments

> [!TIP]
> **TOC never appears.** Lower `TOC_MIN_VIEWPORT_WIDTH`. A 13-inch laptop terminal at default zoom is often under 1100px effective CSS pixels.

> [!TIP]
> **TOC appears on tiny documents.** Raise `TOC_MIN_HEADINGS`.

> [!TIP]
> **Wrong section highlighted while scrolling.** Tweak `TOC_ACTIVE_ZONE`. Common alternatives:
> - Highlight earlier: `'0px 0px -50% 0px'`
> - Highlight later (closer to top): `'0px 0px -85% 0px'`
> - Highlight only when section is fully visible: `'-30% 0px -30% 0px'`

> [!TIP]
> **Sidebar overlaps content.** The fixed `width: 220px` and `right: 1rem` live in the CSS in `content.ts`. Adjust those, or raise `TOC_MIN_VIEWPORT_WIDTH` so the sidebar only shows on wider viewports where the article doesn't compete for space.

> [!TIP]
> **Want headings deeper than `h3`.** Update `TOC_HEADING_SELECTOR` *and* add a `.awrit-toc-h4 { padding-left: 2em }` rule to the CSS so the indentation reflects the new level.

## Known limitations

- The TOC is built once at render time. Headings added by other scripts post-render will not appear.
- Very long heading text wraps inside the sidebar; if the wrapped TOC exceeds `calc(100vh - 4rem)` it will scroll vertically inside the nav.
- Headings inside `<details>` are observed but the highlight may flash unexpectedly when the user toggles the disclosure.
- The CSS hide-on-narrow-viewport is reactive; the JS gate is not. Resizing from narrow → wide does not retroactively build a TOC. Reload to recover.

## Where the code lives

- Render-time gating + DOM build + observer setup: `buildToc()` in `default-extensions/markdown/content.ts`.
- Visual styles (position, indentation, active highlight, dark mode): the `STYLES` constant in the same file. Search for `.awrit-toc`.
