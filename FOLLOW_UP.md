# Follow-up items

Standing list of issues we know about and have intentionally deferred. Each entry is self-contained: the problem, why it was deferred, and concrete remediation options. Move an item to a PR (or delete it) when it's addressed.

## 1. `config.example.js` two-line opt-in trap

### Problem

Enabling an option in `config.example.js` (and therefore in the user's `~/.config/awrit/config.js`) requires uncommenting **two non-adjacent lines**:

1. The `const optionName = value;` declaration in the upper half of the file.
2. The matching shorthand property `optionName,` in the exported `config` object near the bottom.

If the user uncomments only the `const`, the option is bound to a local variable that nothing reads. The exported config object still lacks the property, so at runtime `config.optionName === undefined` and the validation in `loadConfig` (`src/index.ts`) silently does nothing. From the user's perspective: they edited the file, restarted awrit, and observed no effect for any value they tried.

This currently affects `deviceScaleFactor` (lines 116 and 121 of `config.example.js`) but the same shape applies to `homepage`, `userExtensions`, and `keybindings` — the trap is structural, not specific to one option.

### Why deferred

The fix is a stylistic cleanup, not a correctness bug. The validation in `loadConfig` is doing the right thing (rejecting unset values). The trap is a footgun in the example file, not a defect in code paths.

Touching only one option (e.g. inlining `deviceScaleFactor`) would leave the file mixed-style, which is worse than the current uniform-but-trappy state. The choice is between converting all options or leaving the pattern alone — both are reasonable, neither is urgent.

### Remediation options

- **Option A (preferred): convert all options to inline form in the exported `config` object.** Each option becomes a single commented line of the form `// optionName: defaultValue,` directly in the `config = { ... }` literal. Removes the trap entirely. Larger but uniform diff: every option in `config.example.js` is touched, and the existing const declarations and their JSDoc blocks need to be folded into inline comments above each property. Validation in `src/index.ts` does not change.
- **Option B: keep the const + shorthand pattern, add a usage note.** Add a single-line comment immediately above the first `const` declaration in `config.example.js`: `// To enable any commented option, uncomment BOTH the const declaration AND the matching property in the config object below.` Smallest possible diff; doesn't remove the trap, just labels it.
- **Option C (orthogonal, deeper fix): runtime warning for the divergent state.** In `loadConfig` (`src/index.ts`), detect when the user's `config.js` declares a top-level identifier that matches a known config field but does not export it. This requires either text-parsing the file or loading it twice with different shimming. Catches any future variant of the same trap, not just `deviceScaleFactor`. Strictly more work than A or B and can be combined with either.

A and C are not exclusive; B and C are not exclusive. A and B are alternatives.

### File pointers

- `config.example.js` — const declarations (top half, e.g. lines 4, 12, 62, 116) and the exported `config` object (lines 118–123).
- `src/index.ts` — `loadConfig` (line 36) and the `deviceScaleFactor` validation (lines 39–41).

## 2. Page viewport feels "zoomed out" on Retina

### Problem

On a Retina display, awrit's content `BrowserWindow` is sized at `terminal_device_pixels / devicePixelRatio` CSS pixels. For a typical full-screen terminal of roughly 274×90 cells (~4104×2520 device px on a 2× display), that yields a CSS-pixel viewport of about **2052 × 1240**.

Most desktop sites lay out for CSS-pixel viewports in the 1280–1500 range. Rendering them at 2052 CSS px wide means the page's content area is wider than the design assumed, and most layouts respond by either expanding white space or showing more content per row at smaller-feeling sizes. Users perceive this as "zoomed out": the same page in awrit displays text and UI noticeably smaller per unit area than the same page in a typical desktop browser at default zoom.

This is purely a viewport-width issue, not a DPR or layout bug:

- The IOSurface (and thus the rendered output to Kitty) is at full device pixels — verified empirically at 4104×2480 and via `IOSurfaceGetWidth/Height` logging from Rust (see `SCROLL_SMOOTHNESS_INVESTIGATION.md`, "Things future investigators should not relitigate").
- The CSS-px viewport that Chromium lays out into is what `screen.getPrimaryDisplay().scaleFactor` (= 2 on Retina) implies from the device-pixel terminal size.

### Why deferred

This does not affect scroll performance. Scroll smoothness is gated by paint-event delivery rate and per-paint cost (see `SCROLL_SMOOTHNESS_INVESTIGATION.md`), neither of which depends on the CSS-px viewport width. The IOSurface output size is the same regardless. The "zoomed out" feel is a UX preference, not a perf or correctness problem, so it sits outside the scroll work.

### Remediation

Add a `zoomFactor` config option, plumbed analogously to `deviceScaleFactor`:

1. Declare it in `config.example.js` with default `null` and a JSDoc explaining the effect (smaller value = more "zoomed out", larger value = pages render as if the viewport were narrower; e.g. `1.5` compresses an effective 2052 CSS-px viewport down to ~1368 CSS px, in the typical desktop-browser range).
2. Validate and store it in `loadConfig` (`src/index.ts`) — `typeof config.zoomFactor === 'number' && config.zoomFactor > 0`, mirroring the existing `deviceScaleFactor` check.
3. In `src/windows.ts`, after each `loadURL` / `loadFile`, call `webContents.setZoomFactor(value)` on the affected `BrowserWindow`. The natural extension point is `resetForFrameQuirk` (currently calls `setZoomFactor(1)` once after `did-frame-navigate`); change the hardcoded `1` to read the config value, defaulting to `1` when unset. Apply consistently to both content and toolbar windows.
4. Document the option in `CLAUDE.md`'s `config.js` section, alongside `deviceScaleFactor`.

Default to `null` / no override so existing behavior is preserved for users who don't set the option.

### File pointers

- `src/windows.ts` — `resetForFrameQuirk` at lines 65–69; existing `setZoomFactor(1)` call at line 67. `webPreferences.zoomFactor: 1` is set on both windows at lines 135 and 152 — leave those as the initial-load value; the post-navigate call is what takes effect.
- `src/layout.ts` — lines 277–278 compute the logical viewport from the device-pixel terminal size. Context only; do not change. The viewport size derives from this and the per-window `setZoomFactor`.
- `config.example.js` — add the option following the same pattern used for `deviceScaleFactor` (or whichever pattern survives item 1).
- `src/index.ts` — `loadConfig` for validation and storage; thread the value through to `windows.ts` via the same module-scope pattern as `deviceScaleFactor`.
- `CLAUDE.md` — `config.js` section.
