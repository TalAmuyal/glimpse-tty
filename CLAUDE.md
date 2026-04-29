# awrit

Chromium rendered into a Kitty-graphics-protocol terminal. See `README.md` for user-facing docs and `CONTRIBUTING.md` for the full contributor workflow (including the `mise` task table). This file captures things those docs don't.

## Main branch is `master`

PRs target `master`. The branch was previously named `electron`; if you have an old checkout, run `git fetch origin && git remote set-head origin -a`.

## Entry point

The user-facing runner is `./awrit` (or `mise start`). Do NOT run `bun start` / `bun run start` / `npm start`: the root `package.json` `start` script is intentionally a trap that echoes a redirect message and exits 1 (see commit `f8b88c7`). Do not "fix" it.

## The dual Bun setup

Two Bun installations coexist by design:

- **PATH Bun** (pinned by `mise.toml` to `1.3.13`) for contributors using mise.
- **Sandbox Bun** at `./.bun/` for end users who install via `curl .../get | bash` and don't have mise. `setup.sh` downloads the latest Bun into `./.bun/` when no Bun is on PATH.

Both `./awrit` and `setup.sh` check `command -v bun` first and fall back to the sandbox. If editing those shims, preserve the PATH-first-with-sandbox-fallback behavior. `mise clean` keeps `./.bun/` (so `./awrit` still works); `mise clean:all` wipes it.

## awrit-native-rs (napi-rs addon)

`awrit-native-rs/` compiles a Rust crate to a `.node` binary. Most contributors never need to touch it: `awrit-native-rs/scripts/download-binary.js` (run by `postinstall`) fetches prebuilt binaries from GitHub releases. Rust is only required when editing native code.

Non-obvious details:

- **CI uses yarn here; local dev uses bun.** `awrit-native-rs/yarn.lock` is what CI resolves against. `mise build:native` runs `bun run make` and doesn't respect the yarn lockfile. Resolution can diverge — CI green does not strictly guarantee local green.
- **No `[workspace]` block in `awrit-native-rs/Cargo.toml`.** `crates/crossterm` and `crates/bgra-to-rgba` are path deps, not workspace members. `cargo fmt --all` / `cargo clippy --all` only touch the root crate. The `mise lint:rust` and `mise format:rust` tasks use `-p awrit-native-rs -p bgra-to-rgba` to be explicit.
- **`crates/crossterm/` is a git-subtree vendoring** of https://github.com/crossterm-rs/crossterm. Do NOT reformat or lint it locally — local divergence will conflict with `mise bump:crossterm` pulls. It ships its own `rustfmt.toml` (4-space) that differs from the parent (2-space).
- **`crates/bgra-to-rgba/Cargo.toml` declares `edition = "2024"`**, which forces `rustc >= 1.85.0` for the whole tree. This is why mise pins Rust 1.85.0.

## Platform support

macOS (x64 + arm64) and Linux (x64 + arm64). No Windows. Authoritative list: `awrit-native-rs/package.json` under `napi.targets`.

Linux needs system libs for Electron: `libnss3`, `libgtk-3-0`, `libasound2`. mise does not install these. Missing them produces a cryptic "cannot open shared object file" at Electron launch.

macOS: `setup.sh` patches the Electron bundle's plist to set `LSUIElement=true` so the dock icon doesn't appear when awrit runs. If you `bun install` without running `setup.sh`, expect a dock icon.

## Testing

Tests are `*.test.ts` files scattered under `src/` and run with `bun:test`. There is no `test` script in any `package.json` — run `bun test` directly or `mise test`. There is no lint/typecheck/test job in CI; `.github/workflows/CI.yml` only runs on changes to `awrit-native-rs/`.

## Lockfile

The Bun lockfile is `bun.lock` (text JSON, Bun 1.1.30+ format), NOT `bun.lockb`.

## config.js

The runtime user-config file lives at `${XDG_CONFIG_HOME:-$HOME/.config}/awrit/config.js`. It is seeded from `config.example.js` (repo root) on first install (by `docs/get`) and on first run (by `src/index.ts`); both seed steps are idempotent and never clobber an existing user config. The `userExtensions` array is read once during `app.whenReady()`; edits during runtime are not hot-reloaded. `userExtensions` paths starting with `~/` are home-expanded; relative paths resolve against the directory of `config.js` (i.e., `~/.config/awrit/`).

- `docs/get` and `src/index.ts` each compute `XDG_CONFIG_HOME` independently. If `XDG_CONFIG_HOME` is set during install but not at runtime (or vice-versa), the user can end up with two configs. We honor whatever env the caller uses; this is intentional, not a bug.
- `deviceScaleFactor` (experimental) multiplies the BrowserWindow content dimensions (constructor `width`/`height` and `setContentSize` calls) by `N` while leaving the layout cell coordinates and Kitty composite destination at native size. Smaller `N` shrinks the IOSurface proportionally (lower `tb` per paint) at the cost of blurrier text — Kitty upscales the smaller bitmap into the original cell area. Read once at startup; hot-reloaded edits don't take effect until awrit is restarted. Overridden by the `--device-scale-factor=N` CLI flag when provided.

## Bundle path resolution

`src/runner/index.ts` runs `Bun.build` with `root: src/` and `outdir: dist/`, producing `dist/index.js` from `src/index.ts`. Bun inlines `__dirname` per source module as the **original source location** (e.g. `<repo>/src/`), not the bundle output directory. Code that runs from `dist/index.js` but originates in `src/` will see `__dirname === '<repo>/src/'` at runtime.

To reach files under `dist/` from bundled code, write paths as `'../dist/<file>'` from `__dirname`. Examples:

- `src/windows.ts` references the preload as `'../dist/preload.js'`.
- `src/extensions.ts` resolves bundled extensions via `path.resolve(__dirname, '../dist/extensions', name)`.

To reach files under `node_modules/` (which sits at the repo root), `'../node_modules/...'` from `__dirname` works because `<repo>/src/../node_modules` and `<repo>/dist/../node_modules` both resolve to `<repo>/node_modules`.

## Default (bundled) extensions

`default-extensions/<name>/` holds source for extensions awrit ships by default (currently just `markdown`). The runner builds them into `dist/extensions/<name>/` with `Bun.build({ target: 'browser', minify: true })` and copies the manifest alongside. The build is hardcoded to the `markdown` extension — generalize when adding a second one.

Content scripts must use `format: 'iife'` because manifest V3 content_scripts are classic JS, not modules. Lazy-loaded modules use `format: 'esm'` because they're consumed via dynamic `import()`. The markdown extension demonstrates both: `content.ts` → IIFE (the always-loaded path), `mermaid-loader.ts` → ESM (only loaded when a `.md` page contains mermaid code blocks).

The lazy-load pattern: `manifest.json` lists the ESM module under `web_accessible_resources` for the relevant origins, and the content script does `import(chrome.runtime.getURL('mermaid-loader.js'))`. Mermaid alone is ~3MB minified — bundling it directly into `content.js` would inflate every `.md` page load. Use the same pattern for any future heavy optional dependency.

`src/extensions.ts` loads each extension at startup via `session.extensions.loadExtension(path, loadExtensionOptions)`. `loadExtensionOptions` is per-entry — for example, the markdown extension passes `allowFileAccess: true` so it can run on `file://` URLs. Without that flag, content scripts won't fire on local files even if the manifest's `matches` includes `file:///*`.

Match patterns in `manifest.json` are scoped to `.md` and `.markdown` paths (`file:///*.md`, `*://*/*.md`, etc.) so the bundle doesn't load on every page navigation. Any expansion of supported file types needs the matches array updated.

`markdown-test.md` at the repo root is a fixture that exercises every renderer feature (front matter, headings + anchors, all language code blocks, tables, lists, mermaid, sanitization). Run `./awrit "file://$(pwd)/markdown-test.md"` after touching the markdown extension.

## Git workflow

Typical flow: start from `git checkout --detach origin/master`, work, leave changes unstaged, and use the PR-submission skill to commit, push, and open the PR. Do NOT run `git add` / `git commit` / `git push` without explicit ask.
