# Scroll smoothness investigation — lessons learned

This document captures what we learned during a long investigation into why scrolling in awrit feels janky, and why the obvious "skip the GPU→CPU readback" fix turned out not to help. It is intended for whoever picks this up next so they don't repeat our dead ends.

## Where we landed

The current code uses Electron 41's plain `offscreen: true` (no `useSharedTexture`), the `image.toBitmap()` readback path, the `--disable-gpu-vsync` Chromium switch, a warm-buffer shm optimization in Rust, and direct `a=T` transmit+place Kitty protocol. Together these achieve a sustained 60 fps during scroll with <2% spike rate on Apple Silicon at full native resolution.

Changes that survived from both investigation rounds:

- **Electron 37 → 41** upgrade. Several Electron releases between those two reworked offscreen rendering. The plain `offscreen: true` + `toBitmap` path always fired paints during scroll on both 37 and 41 — that path's behavior is essentially the same. What the upgrade *did* unlock: the `useSharedTexture` path now fires paints during scroll on 41 (it didn't on 37), making that experimental path testable. We don't currently use it, but if we revisit it, we won't have to fight Electron 37's bugs on top of everything else.
- **Rust 1.85 → 1.95** upgrade. Routine maintenance; not load-bearing for scroll.
- **`webContents.setFrameRate(60)`** explicit on both content and toolbar.
- **Chromium switches**: `--enable-smooth-scrolling`, `--enable-gpu-rasterization`, `--enable-zero-copy`, `--ignore-gpu-blocklist`, `--disable-gpu-vsync`. The first four are cheap and orthogonal; `--disable-gpu-vsync` is load-bearing (see second investigation below).
- **Input fan-out** in `src/inputHandler.ts`. Each terminal scroll click is fanned into 10 small `hasPreciseScrollingDeltas: true` (trackpad-style) wheel events spread over 120 ms. Marginal benefit but mimics high-resolution input.
- **Diagnostic instrumentation** in `src/paint.ts` behind the `-p` / `--debug-paint` flag. Logs `dt`, `rd` (Electron readback), `rw` (Rust shm lifecycle), `sw` (stdout to Kitty), and dimensions per paint. Includes summary statistics at exit. **Keep this.** It saved us from many speculative fixes and will be needed again next time.
- **`ShmGraphicBuffer` with `WarmBuffer`** — persistent anonymous mmap for BGRA-to-RGBA conversion, transient `mmap(MAP_SHARED) + memcpy` for shm writes. Eliminates per-frame page faults. Shm-name rotation and `ftruncate` EINVAL tolerance are retained for the `useSharedTexture` path if re-enabled.
- **Direct `a=T` transmit+place Kitty protocol** — replaces the animation protocol (loadFrame + compositeFrame). One protocol command per frame with `c=cols, r=rows` cell-area scaling.
- **`deviceScaleFactor` config + `--device-scale-factor` CLI flag** — multiplies `BrowserWindow.setContentSize` dimensions. Kitty upscales the smaller bitmap to fill the cell area. Quality/performance trade-off knob.
- **Dead-but-kept code**: `write_iosurface` Rust method, IOSurface FFI bindings, `build.rs` framework links, and the `useSharedTexture` paint-handler branch in `paint.ts`. These remain for the next attempt at shared-texture readback.

## Numbers we measured

### First investigation (Electron 37 and 41, before vsync/shm/protocol improvements)

On Electron 37, plain `offscreen: true`, scrolling a long markdown page:

| Metric | Value |
|---|---|
| Median `dt` (paint event interval) | ~16–18 ms (~60 fps) |
| `tb` (`toBitmap` cost) | 5–8 ms |
| `sw` (Kitty stdout writes) | 0.0–0.1 ms |
| `dt` spikes >40 ms | ~12–15% of frames, clustered at 45–65 ms |
| Frame size (one example) | 3450×2072 (~28 MB) — varies with terminal size |

The spikes — not the average — are what felt janky. Between spikes, scrolling was smooth.

On Electron 41, plain `offscreen: true`, pre-optimization: `tb_p50` of ~28–31 ms, `dt_p50` of ~37–40 ms (~25–27 fps), `dt_spikes_pct` of 20–58%.

### Second investigation (Electron 41, after all improvements)

On MacBook Pro with Apple Silicon, ProMotion 120 Hz display, trackpad scroll, full native resolution (~3438x2020, ~27.8 MB/frame BGRA):

| Metric | First investigation (Electron 41) | After all improvements |
|---|---|---|
| tb_p50 | ~28-31 ms | **7.5 ms** |
| rd_p50 (Electron readback) | (not measured separately) | **4.0 ms** |
| rw_p50 (Rust shm lifecycle) | (not measured separately) | **3.4 ms** |
| dt_p50 | ~37-40 ms (~25-27 fps) | **16.6 ms (~60 fps)** |
| dt_spikes_pct (>40 ms) | 20-58% | **1.7%** |
| sw_p99 | 0.1 ms | 0.1 ms |

The split of `tb` into `rd` (readback) and `rw` (Rust write) is essential context: see "Second investigation" below for why the first investigation's bottleneck attribution was wrong.

## What didn't work, and why

### 1. `--enable-smooth-scrolling` Chromium flag

No visible difference. This flag interpolates scroll position internally during animation, but with offscreen rendering the smoothness is gated by paint event delivery rate to our handler, which the flag doesn't change.

### 2. `setFrameRate(60)` and GPU flags alone

No visible difference, but they're not regressions. Electron offscreen defaults to 60 fps anyway.

### 3. Input fan-out (10 sub-events / 120 ms / `hasPreciseScrollingDeltas: true`)

No visible difference. The bottleneck wasn't input granularity; it was paint event delivery. Left in because it doesn't hurt and is closer to "what trackpads do."

### 4. `useSharedTexture: true` (the big one)

This was the architectural attempt. Theory: skip the 5–8 ms `image.toBitmap()` GPU→CPU readback by reading the IOSurface directly from native code. We built it. Three problems showed up:

**Problem A: `kIOSurfaceLockAvoidSync` is rejected by Chromium's GPU-only IOSurfaces.** Apple's docs literally say "this option is useful for testing only; production code should not use this option" and the kernel agrees — `IOSurfaceLock` returns `kern_return_t -536870196` (`0xE000208C`, in the `sub_iokit_iosurface` range). Without `AVOID_SYNC` the lock waits for the GPU to flush, which costs **20–26 ms** per frame — *worse* than the `toBitmap` we were trying to replace.

**Problem B: macOS POSIX shm has quirky rules.**
   - `ftruncate` to set the size works once. Subsequent `ftruncate` calls on the same shm region (even with the same size) return `EINVAL`. Our `truncate_tolerant` helper now swallows `EINVAL` because the shm is already at the right size.
   - The original toBitmap path's `shm_open(O_CREAT) + ftruncate + mmap + write + munmap` per write *worked* because Kitty unlinks the shm after reading (see C below), so each new `shm_open(O_CREAT)` actually creates a fresh shm — `ftruncate` always sees a 0-sized region and succeeds. This is fragile but historically functional.

**Problem C: Kitty's graphics protocol unlinks the shm after reading.** This is documented behavior. When paints fire faster than Kitty can process+unlink (which `useSharedTexture` does, because it bypasses `toBitmap`'s 5–8 ms cost and lets Chromium produce frames faster), there's a race: paint N+1 opens the still-existing name from paint N (Kitty hasn't unlinked yet), overwrites paint N's data, and then paint N+1's `loadFrame` arrives at Kitty *after* it's processed N → Kitty has already unlinked the name → EBADF (`No such file or directory`). 23% of frames failed this way during fast scroll. **The fix is to rotate the shm name on every transmission.** Each name is unique → no race possible. We implemented this and EBADF dropped to zero. We kept this rotation in the codebase.

**Problem D (the killer): the IOSurface contains *unfinished* pixel data.** Even with all the above fixed, text rendered visibly blurry while the page was static. Same content via `image.toBitmap()` looked sharp. Our hypothesis (consistent with the symptom but not verified against Chromium source): Chromium's GPU compositor stores textures with **premultiplied alpha** and possibly in extended-sRGB / linear color space, optimized for further GPU compositing. `image.toBitmap()` does the unpremultiply + sRGB conversion + finalization that produces "the bitmap as Chromium would display it." `useSharedTexture` skips that finalization — we get raw GPU-pipeline output. For pixels with α<1 (text antialiasing edges, the only place this matters), the colors don't blend correctly against the page background. Subjectively this reads as "blur" because antialiasing halos render at wrong intensity. Could potentially be fixed by unpremultiplying + colorSpace conversion in our reader — both are O(N) over the image and would be cheap on the GPU side via a Metal compute shader, but expensive on CPU. We didn't try the fix; this is a hypothesis, not a confirmed root cause.

### 5. `--force-device-scale-factor=2`

We added this when we suspected the IOSurface was at logical (1×) scale. Verified via Rust-side logging that the IOSurface was already at full device pixels (3438×2020) without the flag, and the flag didn't change anything. Removed.

## Second investigation — corrected diagnosis and shipped improvements

The first investigation attributed the per-frame bottleneck to `image.toBitmap()` at 5-8 ms (Electron 37) / ~29 ms (Electron 41, larger frames). The second investigation split `tb` into `rd` (Electron readback) and `rw` (Rust BGRA-to-RGBA + shm lifecycle) and discovered the first investigation had conflated two distinct costs:

- **`rd_p50` (Electron `image.toBitmap()`) = 4.0-4.8 ms** — fast, only 25% of `tb`
- **`rw_p50` (Rust shm lifecycle) = 14.1 ms** — 75% of `tb`, dominated by per-frame `shm_open/ftruncate/mmap` page faults

The actual bottleneck was the Rust code, not Electron. Additionally, vsync stalls were inflating `toBitmap`'s apparent cost.

### Shipped improvements (27 fps to 60 fps)

**1. `--disable-gpu-vsync` Chromium switch.** Eliminated vsync-aligned stalls. `tb_p50` dropped from 28.6 to 18.8 ms (the vsync fence was inflating toBitmap's apparent cost). `dt_spikes_pct` dropped from 26.2% to 4.6%. This was explicitly listed as "never tested" in the first investigation's recommendations.

**2. shm warm-buffer optimization.** Replaced per-frame `shm_open -> ftruncate -> mmap -> BGRA-to-RGBA(cold pages) -> munmap` with persistent warm anonymous mmap for BGRA-to-RGBA output, then `shm_open -> ftruncate -> mmap(MAP_SHARED) -> memcpy(warm->shm) -> munmap`. Eliminated ~2,500 zero-fill page faults per frame. `rw_p50` dropped from 14.1 to 3.4 ms (4.1x improvement). Implementation: `WarmBuffer` in `awrit-native-rs/src/lib.rs`.

**3. Direct transmit+place Kitty protocol.** Replaced the animation protocol (`paintInitialFrame` + `loadFrame` + `compositeFrame`) with a single `a=T` (transmit+place) per frame. Includes `c=cols, r=rows` for cell-area scaling. Simpler code, one protocol command per frame instead of two, zero performance regression. Enables the `deviceScaleFactor` option for quality/perf trade-off. Implementation: `createDirectFrame()` in `src/tty/kittyGraphics.ts`.

**4. `deviceScaleFactor` config + `--device-scale-factor` CLI flag.** Multiplies `BrowserWindow.setContentSize` dimensions. Kitty upscales the smaller bitmap to fill the cell area via `c=/r=` placement. Works via the direct transmit+place protocol. `--force-device-scale-factor` (Chromium switch) was confirmed as a no-op for Electron 41 OSR — the BrowserWindow content size is the only lever.

**5. Split `tb` instrumentation.** `rd` (readback) and `rw` (Rust write) logged separately per paint and in the summary. Essential for diagnosing where per-frame cost lives.

### What was tried and did not work or was reverted

**1. `--force-device-scale-factor=N`.** Confirmed as no-op for Electron 41 OSR. IOSurface dimensions are driven by `BrowserWindow.setContentSize`, not the Chromium DPR switch. Tested with values 0.1, 1, 2, 10 — IOSurface size unchanged in all cases. The first investigation's test at `=2` (no effect) was correct.

**2. Kitty animation `c=/r=` cell-area scaling.** Added `c=cols, r=rows` to `paintInitialFrame`'s initial transmit, hoping it would persist across animation frame replacements. It does NOT — Kitty's cell-area scaling is a placement-time property that does not carry through `a=f` frame data. The fix was switching away from animation entirely (see shipped improvement #3).

**3. `setFrameRate(120)`.** Tested on ProMotion display. Pipeline saturates at ~60 fps regardless — `tb_p50=7.5 ms` is below the 8.3 ms budget at median, but `tb_p95=8.7 ms` exceeds it. Tail latency was worse (spikes 1.7% to 2.3%) with no median fps gain. Reverted to 60.

**4. `write()` syscall to POSIX shm fd.** macOS returns `ENXIO` — `write()` is not supported on shm fds. Had to fall back to `mmap(MAP_SHARED) + memcpy`.

**5. `BorrowedFd::borrow_raw(-1)` for anonymous mmap.** Panics in Rust 1.77+. Fixed by using `mmap_anonymous()` from the nix crate.

## Things future investigators should not relitigate

- **The IOSurface IS at device pixels** on Retina (verified via `IOSurfaceGetWidth/Height` logging from Rust). Don't go looking for missing-scale-factor bugs.
- **Kitty IS the reason `EBADF` errors happen** under `useSharedTexture` (or any high-rate paint path). It's documented to unlink after reading. Use shm-name rotation, not "keep mapping alive."
- **`kIOSurfaceLockAvoidSync` does not work** on Chromium's textures. Don't try again. If you want to skip the GPU sync cost, the path is Metal-based readback, not the lock flag.
- **`useSharedTexture` produced "no paints during scroll" on Electron 37.** This was an Electron-side issue (likely texture pool exhaustion combined with our slow `IOSurfaceLock` consumption), and Electron 41 fixed it for free — paints now fire normally during scroll under `useSharedTexture`. The plain `offscreen: true` toBitmap path always fired paints during scroll on both Electron 37 and 41; that path was just spiky.
- **`--disable-gpu-vsync` is load-bearing.** Removing it re-introduces vsync-aligned stalls that inflate `toBitmap`'s apparent cost and spike rate. The first investigation attributed the bottleneck to `toBitmap`; the vsync fence was the real culprit for a large fraction of the measured cost.
- **`--force-device-scale-factor=N` is a no-op for Electron 41 OSR.** Tested exhaustively with values 0.1, 1, 2, 10 — IOSurface dimensions are driven solely by `BrowserWindow.setContentSize`. To change rendered resolution, adjust the content size (via `deviceScaleFactor` config or `--device-scale-factor` CLI flag).
- **Kitty animation `c=/r=` cell-area scaling does not persist across frame replacements.** The `c=cols, r=rows` parameters are placement-time properties. Sending them on `a=t` (initial transmit) and omitting them on `a=f` (frame data) produces unscaled frames. The direct `a=T` transmit+place protocol avoids this by sending `c=/r=` on every frame.
- **macOS `write()` on POSIX shm fds returns `ENXIO`.** Only `mmap(MAP_SHARED) + memcpy` works for writing to shm on macOS. Do not attempt the `write()` syscall path.
- **`BorrowedFd::borrow_raw(-1)` panics in Rust 1.77+.** Use `mmap_anonymous()` from the nix crate for anonymous mappings instead of passing fd=-1.

## If you're going to try again, here's where you'd start

The pipeline sustains 60 fps at full native resolution with 1.7% spike rate. The remaining opportunities are reaching 120 fps for ProMotion displays and reducing per-frame overhead further.

Prior recommendations and their status:
1. ~~Metal-based texture readback~~ — still valid for reaching 120 fps, but no longer needed for 60 fps.
2. ~~Wait for Electron 42+~~ — still valid for the `deviceScaleFactor` OSR option.
3. ~~Investigate spike pattern / `--disable-gpu-vsync`~~ — DONE. Shipped. Massive improvement (spikes from 26.2% to 4.6% from vsync alone).
4. ~~Don't enable `useSharedTexture` without unpremultiply~~ — still valid.

New recommendations:

1. **`useSharedTexture` + unpremultiply alpha in NEON loop.** Would eliminate the 4 ms `rd` cost. Gets `tb` down to ~3-4 ms, enabling comfortable 120 fps for ProMotion native refresh. The blurry-text problem (Problem D from the first investigation) needs to be solved — add unpremultiply to the BGRA-to-RGBA NEON shuffle. The stride mismatch hypothesis (from the second investigation's devil's advocate analysis) should also be tested: verify that the IOSurface row stride matches the expected `width * 4` before assuming the pixel data is contiguous.
2. **Dirty rectangles.** The paint event's `_dirty` parameter is completely ignored. During scroll, if Chromium provides meaningful sub-frame dirty rects (needs verification), processing only the changed strip could reduce per-frame work further. Chromium marks the full viewport dirty during scroll — this may change with different scroll behavior or non-scroll interactions (e.g. cursor blink, hover effects).
3. **Eliminate BGRA-to-RGBA if possible.** If Kitty accepts BGRA natively (or a future Kitty version adds support), the conversion can be skipped entirely, saving ~2 ms from `rw`.
4. **shm double-buffering.** The current warm buffer uses a transient `mmap(MAP_SHARED)` + memcpy per frame. Pre-allocating 2-3 named shm segments and rotating them (coordinating with Kitty's unlink-after-read behavior) could eliminate the remaining per-frame mmap/munmap.
5. **Metal-based texture readback** (carried from first investigation). Use `objc2-metal` to wrap the IOSurface as an `MTLTexture`, blit to a `storageModeShared` `MTLBuffer`, read from CPU. Still has the premultiplied-alpha + colorSpace problem from Problem D. Combine with recommendation #1 (unpremultiply).

## Methodology lessons

- **Three rounds of speculative fixes** (Chromium flags, `setFrameRate`, input fan-out) didn't move the needle. **Instrument first, then act.** The per-paint `dt`/`tb`/`sw` log told us in one run what no amount of speculation would have: `tb` was the dominant cost, `sw` was free, and the spikes were Chromium-side.
- **Validation experiments save hours.** Before committing to ~200 lines of Rust IOSurface FFI, the `--no-paint -p` test confirmed that removing the `toBitmap` cost did smooth out the spikes (the diagnosis was right). If we hadn't done that, we'd have built the IOSurface path and *then* discovered problem D.
- **Documentation lags reality.** The `OffscreenSharedTexture` API page we fetched online showed `handle.ioSurface`, but the Electron 37 TypeScript types had `sharedTextureHandle` flat on `TextureInfo` (no `handle` substructure). The structured `handle` form arrived in Electron 39 ("behavior changed"). Always cross-check against the actual SDK types in `node_modules/electron/electron.d.ts`.
- **"Experimental" labels in vendor docs mean what they say.** `useSharedTexture` is marked experimental in Electron, and we hit two distinct experimental-quality issues (Apple's `AVOID_SYNC` rejection, and the premultiplied-alpha pipeline). When the vendor flags it, plan for it to be more work than the happy path suggests.

## Footguns we hit (and want others not to)

- **`napi-rs`'s `make:debug` script does not run `fix-types.js`.** This silently breaks the discriminated-union `TermEvent` type, and existing JS code that narrows on `eventType === 'mouse'` then accesses `evt.mouseEvent` starts failing typecheck. We added `fix-types.js` to the `make:debug` script in `awrit-native-rs/package.json`. If you re-flatten that for any reason, expect this to bite again.
- **macOS BSD `sed -i ''`** does not expand `\n` in replacement strings. The existing `setup.sh` plist patch for `LSUIElement` would have inserted literal `\n` text into the plist if it ran on a re-installed Electron. We worked around with Python during the upgrade. If you hit dock-icon issues after re-install, this is why.
- **`args.ts` prefixes bare paths with `https://`.** Running `./awrit "$(pwd)/README.md"` (note: no `file://`) makes `args.ts` see `/Users/.../README.md` and prefix it: `https:///Users/.../README.md`. Chromium then normalizes that to `https://users/.../README.md` (collapses triple-slash, lowercases the host) and tries DNS resolution → `ERR_NAME_NOT_RESOLVED`. Always include the `file://` prefix for local files. Future improvement: detect absolute paths in `args.ts` and auto-prepend `file://`.
- **The dual-lockfile setup** (`awrit-native-rs/yarn.lock` for CI, project root `bun.lock` for local) makes dev-dep bumps in the addon brittle. Bumping `@napi-rs/cli` requires both lockfiles to stay in sync, and we don't have yarn locally. Consider consolidating.
- **`process.argv.slice(2)` in `args.ts`** receives Electron's pre-fixed args (`--high-dpi-support=1`, plus any `--force-device-scale-factor=N`, plus user args). The parser silently ignores unknown switches, which is fine, but be aware when adding arg-handling logic.
- **macOS POSIX shm does not support `write()`.** The `write()` syscall on a shm fd returns `ENXIO` on macOS. The only write path is `mmap(MAP_SHARED)` + `memcpy`. This is not documented in the man page; it surfaces as an unexpected errno.
- **Per-frame `mmap` of fresh pages triggers ~2,500 zero-fill page faults** on a ~28 MB frame. The kernel must zero every page before handing it to userspace. This dominated the Rust-side cost at 14.1 ms per frame before the warm-buffer optimization. If you add any new per-frame allocation of large buffers, watch for the same pattern.
- **`BorrowedFd::borrow_raw(-1)` panics in Rust 1.77+** due to validity checks on the fd value. Anonymous mmap (fd=-1) must use `mmap_anonymous()` from the nix crate instead.
- **Kitty animation frame replacement (`a=f`) does not inherit placement parameters.** Cell-area scaling (`c=/r=`), position, and other placement-time properties set on the initial `a=t` transmit are NOT carried through to replacement frames. Each frame rendered via `a=f` appears at the image's native pixel dimensions unless the placement is re-issued. The direct `a=T` (transmit+place) protocol avoids this entirely by specifying placement on every frame.

## File-level pointers

For someone returning to this:

- `src/paint.ts` — paint handler with the `useSharedTexture` branch (currently dormant, falls through to `toBitmap`). `rd`/`rw` split instrumentation: `rd` measures Electron `image.toBitmap()` readback, `rw` measures the Rust shm lifecycle (BGRA-to-RGBA + shm write). The `--no-paint` short-circuit path is unchanged. The IOSurface texture branch is still present but dormant (gated by `offscreen: true` in `windows.ts`).
- `src/tty/kittyGraphics.ts` — uses direct `a=T` transmit+place (NOT the animation protocol). `createDirectFrame()` is the entry point. `c=cols, r=rows` cell-area scaling on every transmit. The animation functions (`loadFrame`, `compositeFrame`) are removed.
- `src/windows.ts` — `webPreferences.offscreen` is the toggle. Currently `true`; flip to `{ useSharedTexture: true }` to re-enable the shared-texture path. `scaleContentSize()` applies `deviceScaleFactor`. `cellArea` is plumbed into paint registration for `c=/r=` scaling.
- `src/inputHandler.ts` — scroll fan-out lives at lines around the `scrollUp`/`scrollDown` branch. `SCROLL_STEPS=10`, `SCROLL_DURATION_MS=120` are the tunables.
- `src/index.ts` — the Chromium switch list (smooth scrolling, GPU rasterization, `--disable-gpu-vsync`, etc.). `deviceScaleFactor` config loading + `resolveDeviceScaleFactor` (CLI flag > config > null).
- `awrit-native-rs/src/lib.rs` — `WarmBuffer` for persistent anonymous mmap. `copy_to_shm_fd()` for transient shm write via `mmap(MAP_SHARED) + memcpy`. Write flow: `bgra_to_rgba(src, warm_buf) -> shm_open -> ftruncate -> mmap(MAP_SHARED) -> memcpy(warm->shm) -> munmap`. `ShmGraphicBuffer` with name rotation, `truncate_tolerant`, IOSurface FFI module (`iosurface_ffi`), `write_iosurface` (currently uncalled from JS but compiled and ready).
- `awrit-native-rs/build.rs` — links `IOSurface` and `CoreFoundation` frameworks on macOS. Keep these even though `write_iosurface` is dormant; removing requires also removing the FFI module.

## How to resume

Repro setup:

```sh
./awrit -p "file://$(pwd)/markdown-test.md"
```

`markdown-test.md` at the repo root is a long-enough fixture to scroll meaningfully. The `-p` flag enables paint-event logging.

Output goes to `awrit_error.txt` at the repo root (the `./awrit` shim redirects stderr there). Read with:

```sh
grep "^paint:content" awrit_error.txt | tail -200
```

Each line: `paint:<tag> src=<tex|bmp|fail> fmt=<bgra|rgba|n/a> dt=<ms> rd=<ms> rw=<ms> sw=<ms> sz=WxH ni=WxH cs=WxH dl=WxH@x,y`. Where:
- `dt` — gap from previous paint of this content (low = high paint rate)
- `rd` — Electron readback cost (`image.toBitmap()` or `writeIosurface`)
- `rw` — Rust shm lifecycle cost (BGRA-to-RGBA conversion + shm open/write/close)
- `sw` — stdout writes for Kitty protocol command (single `a=T` transmit+place)
- `sz` — image size we feed Kitty
- `ni` — `image.getSize()`
- `cs` — `textureInfo.codedSize` (only present with `useSharedTexture`)
- `dl` — destination rect we tell Kitty to place into

Summary statistics (p50, p95, p99, spikes) are printed at exit for `dt`, `rd`, `rw`, `sw`, and `tb` (= `rd` + `rw`).

To rebuild the Rust addon after touching `awrit-native-rs/src/`:

```sh
mise build:native:debug   # runs napi build + fix-types.js
cp awrit-native-rs/awrit-native-rs.darwin-arm64.node \
   node_modules/awrit-native-rs/awrit-native-rs.darwin-arm64.node
cp awrit-native-rs/index.d.ts node_modules/awrit-native-rs/index.d.ts
```

(The copy step is needed because `bun install`'s local-path linking isn't a true symlink in this setup.)

To re-enable the `useSharedTexture` path: change `offscreen: true` → `offscreen: { useSharedTexture: true }` in `src/windows.ts`. Everything else (the IOSurface FFI, `write_iosurface`, the texture branch in `paint.ts`) is already there and ready.

## When in doubt

Re-run with `-p`, scroll, read the log. The instrumentation is the most valuable thing this investigation produced. Trust the numbers.
