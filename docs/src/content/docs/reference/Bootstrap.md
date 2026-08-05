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

## Section code lens

Each `[bootstrap.*]` table gets a code lens on its header reporting how many of
its entries are not in their desired state, for example
`⚠ Bootstrap · 2/5 pending`. A section whose entries are all converged reads
`✓ Bootstrap · 5 ok`, and one mise could not inspect here (a Linux-only section
on macOS, Docker not running) reads `⊘ Bootstrap · not applicable here`.
Hovering lists the entries behind the count, and clicking opens the bootstrap
status view.

Counts cover only the entries of the file you are looking at. `mise bootstrap
status` merges every config file, so a workspace `mise.toml` does not report the
packages or files declared in your global config.

Reading the status inspects the machine, so it is only read for files that
declare a bootstrap section. Set `mise.enableBootstrapCodeLens` to `false` to
turn the lens off, or `mise.enableCodeLens` to turn off every code lens.

## Bootstrap plan

`Mise: Show mise bootstrap plan` (or the diff icon in the `Bootstrap` panel)
runs [`mise bootstrap plan`](https://mise.jdx.dev/bootstrap.html), which prints
what the declarative resources would change without applying anything, followed
by a summary of the create/update/remove/unchanged counts.

This requires mise `2026.8.2` or later.

A plan only covers the sections that have moved to mise's declarative resource
model. The others are still applied by `mise bootstrap`, they just never show up
in a plan, so a configuration made only of those plans nothing at all. mise
grows this coverage as more sections adopt the model, so
[the mise bootstrap docs](https://mise.jdx.dev/bootstrap.html) are the reference
for what a plan reports today.

## Bootstrap status view

Use the `Mise: Show bootstrap status` command (or the list icon in the
`Bootstrap` panel) to open a table with all bootstrap entries and their state.
From there, you can filter for pending entries, show the plan, and run
`mise bootstrap` or a dry run.
