# Actual Web Rendering in Terminal

Or just `awrit`.

[awrit-demo.webm](https://github.com/user-attachments/assets/5da3fffc-d781-4b00-9fe3-19ce18d01a7e)

Yep, actual Chromium being rendered in your favorite terminal that supports the [Kitty terminal graphics protocol](https://sw.kovidgoyal.net/kitty/graphics-protocol/).

**`awrit` works best in [Kitty v0.31 or newer](https://github.com/kovidgoyal/kitty/releases)**

## Why?

- Display documentation from [DevDocs](https://devdocs.io)
- Watch the changes from [Vite](https://vitejs.dev) come to life
- Tiled layout without a tiling window manager using [Kitty's layouts](https://sw.kovidgoyal.net/kitty/layouts/)
- Add fancy UI using web technologies, so NeoVim can pretend it is Emacs instead of the other way around

## Install

``` bash
curl -fsS https://talamuyal.github.io/awrit/get | bash
```

By default, this will download to `~/.local/share/awrit` (honors `$XDG_DATA_HOME`) and, without touching your shell config, link `awrit` into the first writable directory on your `$PATH` from this list: `~/.local/bin`, `~/bin`, `/usr/local/bin`, `/opt/homebrew/bin`. If none of those are on your `$PATH`, it installs to `~/.local/bin` and prints instructions for adding it to your shell config.

You can configure `awrit` by editing `~/.config/awrit/config.js` (or `$XDG_CONFIG_HOME/awrit/config.js` if set). See [Configuration](#configuration) for more information.

#### (Optional) Change Download Location or Install Prefix

``` bash
curl -fsS https://talamuyal.github.io/awrit/get | DOWNLOAD_TO=~/somewhere-completely-different bash
```

``` bash
curl -fsS https://talamuyal.github.io/awrit/get | INSTALL_TO=~/.not-local bash
```

Setting `INSTALL_TO` skips `$PATH` auto-discovery; the install will use `$INSTALL_TO/bin` directly without modifying your shell config, so make sure that directory is on your `$PATH`.

## Usage

```bash
awrit [url-or-path]

# if url is not provided, it will go to the awrit homepage (this is temporary, promise)
# the URL protocol can be http:, https:, file:, or data:
# if the URL protocol is not included, https: is used by default
# file paths (absolute, relative, or ~/...) are auto-detected and opened as file:// URLs
```

Examples:

```bash
awrit https://example.com
awrit example.com            # https:// is added automatically
awrit /tmp/page.html         # opened as file:///tmp/page.html
awrit ./README.md            # relative path resolved to absolute file:// URL
awrit ~/notes/doc.html       # ~ expanded to home directory
```

For more options look at the help:

```bash
awrit --help
```

## Configuration

`awrit` can be configured through `~/.config/awrit/config.js` (or `$XDG_CONFIG_HOME/awrit/config.js`). It is seeded from `config.example.js` on first install. Changes to it will update the config in any running `awrit`.

Currently it supports custom keybindings, the homepage that displays when no URL is provided, and loading local unpacked Chrome extensions via `userExtensions`.

For more details on keybinding syntax, available actions, and the `userExtensions` array, see the comments in your `config.js` (or in [`config.example.js`](/config.example.js) in the repo).

## Contributing

See [Contributing to Awrit](/CONTRIBUTING.md#contributing-to-awrit).

## Development

Contributors are encouraged to install [mise](https://mise.jdx.dev) — it pins the Bun, Node, and Rust versions this repo expects and exposes tasks like `mise start`, `mise test`, and `mise check`. See [Your First Code Contribution](/CONTRIBUTING.md#your-first-code-contribution) for the full workflow. If you prefer not to use mise, `./awrit` still bootstraps itself.

Read [Your First Code Contribution](/CONTRIBUTING.md#your-first-code-contribution) for more information on making a PR.
