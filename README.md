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

## Running

``` bash
git clone https://github.com/chase/awrit.git
cd awrit
./awrit
```

### (Optional) Install

The following installs a link to `awrit` in `~/.local/bin`:

``` bash
PREFIX=~/.local/bin
DIR="$PWD"
(cd "$PREFIX" && ln -s "$DIR/awrit")
```

## Usage

```bash
./awrit [url]

# if url is not provided, it will go to the awrit homepage (this is temporary, promise)
# the URL protocol can be http:, https:, or data:
# if the URL protocol is not included, https: is used by default
```

For more options look at the help:

```bash
./awrit --help
```

## Configuration

`awrit` can be configured through `config.js` in the project root. Changes to it will update the config in any running `awrit`.

Currently it only supports custom keybindings and changing the homepage that displays when no URL is provided.

For more details on keybinding syntax and available actions, see the comments in `config.js`.
