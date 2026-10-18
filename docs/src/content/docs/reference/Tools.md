---
title: Tools
description: Manage tools in VS Code with mise
sidebar:
    order: 302
---

## Tools versions

The extension will show the currently installed tool versions directly in the
editor

![tools-decoration.png](../../../assets/tools-decoration.png)

Hovering a tool in a config file shows its backend, its description, its
versions and the options set on it (`lazy`, `os`, `postinstall`, ...), and:

- a link to the website of the project, when the
  [registry](https://mise.jdx.dev/registry.html) has one
- the latest version, when the installed one is outdated, with a link to its
  release notes when the backend publishes them (e.g. GitHub releases, mise
  2026.8.15+)

## Tool explorer (activity bar)

The tool explorer in the activity bar allows you to quickly which tools are used
in the current project. You can also the list of global tools.

- Click on a tool to navigate to the file where it is defined
- Some additional options are available on right-click, like copying the
  bin/install path or removing the tool

![img.png](../../../assets/tools-activity-bar.png)

The `+` button of the explorer adds a tool to a config file with `mise use`.
Pick a tool from the registry, by its name or its description (`json` finds
`jq`), or type one as `backend:name` (e.g. `github:cli/cli`), with its version
if you want (`npm:prettier@3`). After `npm:`, `cargo:`, `gem:` or `dotnet:`, the
registry tools with that backend come first, then the npm, crates.io, RubyGems
or NuGet packages that match (mise 2026.9.13+).

A config file that does not parse is marked in the explorer. Its tools are the
ones from the last time the file parsed. See [While a config file is being edited](/mise-vscode/reference/misetoml-language-support/#while-a-config-file-is-being-edited).

### Lazy tools

Tools declared with `lazy = true` are installed by mise the first time one of
their commands runs. Until then, they are not reported as missing: the explorer
and the editor show them as `installs on first use` instead of not installed.
The extensions configured with the path of a tool (see
[supported extensions](/mise-vscode/reference/supported-extensions/)) only pick
it up once it is installed.

```toml
[tools]
ripgrep = { version = "14", lazy = true }
```

## Lockfile

[`mise.lock`](https://mise.jdx.dev/dev-tools/mise-lock.html) records the
versions that the tools of `mise.toml` resolved to. Code lenses on top of
`mise.lock` (and `mise.local.lock`) show:

- whether it has every tool of the config: `In sync`, or
  `2 tools out of sync · Update`, which runs `mise lock`. The tooltip lists the
  changes.
- `Bump 3 tools` when the requests allow newer versions (e.g. `node = "24"`):
  runs `mise lock --bump`, which updates the lockfile without installing
  anything. Finding them looks up the versions online.
- `Upgrade format v0 → v3` for a lockfile written in an older format: runs
  `mise lock --upgrade`. Everyone who reads the lockfile, CI included, then
  needs mise 2026.9.16 or newer.

Next to `[tools]` in `mise.toml`:

- `mise.lock out of date` when the lockfile does not match the tools of the
  file, e.g. after adding one by hand.
- `Create mise.lock` when there is no lockfile yet and
  [`lockfile = true`](https://mise.jdx.dev/configuration/settings.html#lockfile).
  With the setting unset, mise does not create lockfiles, and the extension does
  not suggest it either.

Nothing is shown with `lockfile = false`. Requires mise 2026.9.16+. The
lockfiles of an environment (`mise.test.lock`) and the global one are not
covered.

## Tools list

Use the list `List all tools` button to list all installed tools.

- You can filter the tools used in the current project using `active` only.
- From there, you can upgrade, uninstall or prune unused tools
- When a newer version is available, it links to its release notes, for the
  backends that publish them (mise 2026.8.15+)

![tools-list.png](../../../assets/tools-list.png)
