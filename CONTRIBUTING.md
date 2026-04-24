<!-- omit in toc -->
# Contributing to Awrit

Thanks for taking time to contribute! `awrit` is a project I work on in my spare time, so I appreciate any help I get.

> [!NOTE]
> If you like the project, but don't have time to contribute bug reports or PRs, then there are a few things you can do to support it:
> - Star the project
> - Refer to this project in your project's README
> - Mention it to friends and colleagues
> - Answer other users posts in Discussions

<!-- omit in toc -->
## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Reporting Bugs](#reporting-bugs)
- [I Have a Question](#i-have-a-question)
  - [I Want To Contribute](#i-want-to-contribute)
  - [Suggesting Enhancements](#suggesting-enhancements)
  - [Your First Code Contribution](#your-first-code-contribution)
  - [Improving The Documentation](#improving-the-documentation)
- [Styleguides](#styleguides)
  - [Commit Messages](#commit-messages)
- [Join The Project Team](#join-the-project-team)


## Code of Conduct

This project and everyone participating in it is governed by the
[Awrit Code of Conduct](https://github.com/chase/awrit/blob/electron/CODE_OF_CONDUCT.md).
By participating, you are expected to uphold this code. Violations of the code of conduct may lead to issues and discussions being closed.

## Reporting Bugs

<!-- omit in toc -->
### Before Submitting a Bug Report

A good bug report shouldn't require any follow up questions for more information. Please describe the issue in detail in your report and if you suspect a root cause, provide that as well.

Before you file a bug report:

- Make sure that you are using the latest version, run `git pull` in the root of the repository and run `awrit` again to see if it still occurs.
- Determine if the bug is caused by using an unsupported terminal or version. Only recent versions of Kitty and Ghostty are supported.
- Check if other users have experienced (and perhaps solved) the same bug in [Issues](https://github.com/chase/awrit/issues?q=label%3Abug).
- Use GitHub CoPilot to see if there's a general solution that you can contribute.
- Finally, collect information about the bug:
  - OS, Platform and Version (Windows, Linux, macOS, x86, ARM)
  - Terminal and Version (`kitty -v`, `ghostty -v`)
  - Can you reliably reproduce the issue?

<!-- omit in toc -->
### How Do I Submit a Good Bug Report?

We use GitHub issues to track bugs and errors. If you run into an issue with the project:

- Open an [Issue](https://github.com/chase/awrit/issues/new). (Since we can't be sure at this point whether it is a bug or not, we ask you not to talk about a bug yet and not to label the issue.)
- Explain the behavior you would expect and the actual behavior.
- Please provide as much context as possible and describe the *reproduction steps* that someone else can follow to recreate the issue on their own. For good bug reports you should isolate the problem and create a reduced test case.
- Provide the information you collected in the previous section.

Once it's filed:

- The project team will label the issue accordingly.
- A team member will try to reproduce the issue with your provided steps. If there are no reproduction steps or no obvious way to reproduce the issue, the team will ask you for those steps and mark the issue as `needs-repro`. Bugs with the `needs-repro` tag will not be addressed until they are reproduced.
- If the team is able to reproduce the issue, the `needs-repro` tag will be removed, and the issue will be left to be [implemented by someone](#your-first-code-contribution).

## I Have a Question

Before you ask a question, it is best to search for existing [Issues](https://github.com/chase/awrit/issues) and [Discussions](https://github.com/chase/awrit/discussions) that might help you.
In case you have found a suitable issue or discussion and still need clarification, you can write your question there. It is also advisable to search the internet for answers first.

If you then still feel the need to ask a question and need clarification, we recommend the following:

- Create a [Q&A Discussion](https://github.com/chase/awrit/discussions/new?category=q-a).
- Provide any details that lead to your question, depending on what seems relevant.

## I Want To Contribute

> [!IMPORTANT]
> ### Legal Notice <!-- omit in toc -->
> When contributing to this project, you must agree that you have authored 100% of the content, that you have the necessary rights to the content and that the content you contribute may be provided under the project licence.

### Suggesting Features and Enhancements

This section guides you through submitting an enhancement suggestion for Awrit, **including completely new features and minor improvements to existing functionality**. Following these guidelines will help maintainers and the community to understand your suggestion and find related suggestions.

<!-- omit in toc -->
#### Before Submitting an Enhancement

- Make sure that you are using the latest version.
- Use GitHub CoPilot to see if the feature already exists.
- Perform a [search](https://github.com/chase/awrit/issues) to see if the enhancement has already been suggested. If it has, add a 👍 reaction to the issue so the team can better prioritize.
- Find out whether your idea fits with the scope and aims of the project. It's up to you to make a strong case to convince the project's developers of the merits of this feature. Keep in mind that we want features that will be useful to the majority of our users and not just a small subset. If you're just targeting a minority of users, consider forking the project and/or contributing a pull request.

<!-- omit in toc -->
#### How Do I Submit a Good Enhancement Suggestion?

Enhancement suggestions are tracked as [Issues](https://github.com/chase/awrit/issues).

- Use a **clear and descriptive title** for the issue to identify the suggestion.
- Provide a **step-by-step description of the suggested enhancement** in as many details as possible.
- **Describe the current behavior** and **explain which behavior you expected to see instead** and why. At this point you can also tell which alternatives do not work for you.
- You may want to **include screenshots or screen recordings** which help you demonstrate the steps or point out the part which the suggestion is related to. You can use [LICEcap](https://www.cockos.com/licecap/) to record GIFs on macOS and Windows, and the built-in [screen recorder in GNOME](https://help.gnome.org/users/gnome-help/stable/screen-shot-record.html.en) or [SimpleScreenRecorder](https://github.com/MaartenBaert/ssr) on Linux.
- **Explain why this enhancement would be useful** to most Awrit users. You may also want to point out the other projects that solved it better and which could serve as inspiration.

### Your First Code Contribution

We use [mise](https://mise.jdx.dev) to manage tool versions (Bun, Node, Rust) and provide a uniform set of development tasks. Install mise, then clone your fork — mise will install the pinned tool versions on demand the first time you run any task.

```bash
curl https://mise.run | sh
```

Common tasks, from the repo root:

| Command | What it does |
|---|---|
| `mise start [url]` | Run awrit from this checkout (forwards arguments to `./awrit`) |
| `mise test` | Run the Bun unit tests |
| `mise check` | Typecheck + Biome lint + cargo clippy |
| `mise format` | Format TypeScript/JSON with Biome |
| `mise format:rust` | Format Rust with `cargo fmt` |
| `mise build:native` | Rebuild the napi-rs native addon (only needed when editing `awrit-native-rs`) |
| `mise clean` | Remove build artifacts and dependency trees |

Run `mise tasks` to list every task.

On Linux, Electron needs system libraries such as `libnss3`, `libgtk-3-0`, and `libasound2`. Install them through your distro's package manager — mise doesn't handle system packages.

If you prefer not to use mise, the shims still work: install [Bun](https://bun.sh/) (and optionally [Rust](https://www.rust-lang.org/tools/install) for native-addon changes), then run `./awrit` — it bootstraps itself via `setup.sh`.

Then:

1. Make a fork of the repository
2. Clone your fork
3. Make your changes (run `mise check` before committing)
4. Write commit messages that make the intent clear to a reviewer
5. Push the commit to your fork
6. Open a pull request against `electron` with:
   - A description of what it contributes and why, or what bugs it fixes
   - Links to related discussions or issues
7. Wait for review
   - Resolve any conflicts with `electron`
   - Push requested changes to the same branch
   - Once approved and clean, it will be merged

<!-- omit in toc -->
## Attribution
This guide is based loosely on the [contributing.md](https://contributing.md/generator)!
