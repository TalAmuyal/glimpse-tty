# awrit

Chromium rendered into a Kitty-graphics-protocol terminal. See `README.md` for user-facing docs and `CONTRIBUTING.md` for the full contributor workflow (including the `mise` task table). This file captures things those docs don't.

## Main branch is `electron`

PRs target `electron`, not `main`. The repo has no `main`.

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

`config.js` at the repo root is a runtime user-config file, not a build artifact. `src/runner/index.ts` marks it external in the bundler. Do not let it get swept up by clean tasks or gitignored.

## Git workflow

Typical flow: start from `git checkout --detach origin/electron`, work, leave changes unstaged, and use the PR-submission skill to commit, push, and open the PR. Do NOT run `git add` / `git commit` / `git push` without explicit ask.
