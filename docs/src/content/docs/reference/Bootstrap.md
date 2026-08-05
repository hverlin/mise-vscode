---
title: Bootstrap
description: View mise bootstrap status in VS Code
sidebar:
  order: 306
---

[`mise bootstrap`](https://mise.jdx.dev/bootstrap.html) sets up a machine for
the current configuration in one command: OS packages, git repos, dotfiles,
shell activation, macOS defaults, launchd agents, systemd units, login shell,
and tools.

Note that `mise bootstrap` requires mise `2026.7.16` or later.

## Bootstrap panel

The `Bootstrap` panel in the activity bar shows the status of each configured
bootstrap section (packages, repos, dotfiles, shell activation, macOS defaults,
launchd agents, systemd units, and login shell). It is collapsed by default and
only shows sections that are configured.

Sections that are not yet in their desired state are expanded and marked with a
warning icon, along with the number of pending entries.

From the panel title bar, you can:

- open the bootstrap status webview
- show the bootstrap plan
- run `mise bootstrap` (with a confirmation prompt, or as a dry run)
- refresh the status

## Declarative resources

mise `2026.8.2` added declarative host provisioning, and those resources show up
as their own sections:

| Section    | Configured in                                       |
| ---------- | --------------------------------------------------- |
| `Secrets`  | `[bootstrap.secrets]`                               |
| `Accounts` | `[bootstrap.users]`, `[bootstrap.groups]` (Linux)   |
| `Files`    | `[bootstrap.files]`, `[bootstrap.directories]`      |
| `Services` | `[bootstrap.services]` (Linux)                      |
| `Firewall` | `[bootstrap.linux.firewall]` (Linux)                |
| `Compose`  | `[bootstrap.compose]`                               |

Instead of a state, these entries show the action mise would take to converge
them: `create`, `update`, `remove`, or `unchanged` when they are already in
their desired state. `unknown` means mise could not inspect the resource (a
Linux-only section on macOS, a missing secret, Docker not running) and is shown
as neutral rather than pending.

Selecting an entry jumps to its declaration.

Secrets are listed by name and by the environment variable they are read from.
Their values are never read by the extension.

## Bootstrap plan

`Mise: Show mise bootstrap plan` (or the diff icon in the `Bootstrap` panel)
runs [`mise bootstrap plan`](https://mise.jdx.dev/bootstrap.html), which prints
what the declarative resources would change without applying anything, followed
by a summary of the create/update/remove/unchanged counts.

This requires mise `2026.8.2` or later.

## Bootstrap status view

Use the `Mise: Show bootstrap status` command (or the list icon in the
`Bootstrap` panel) to open a table with all bootstrap entries and their state.
From there, you can filter for pending entries, show the plan, and run
`mise bootstrap` or a dry run.
