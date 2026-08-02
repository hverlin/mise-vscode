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
- run `mise bootstrap` (with a confirmation prompt, or as a dry run)
- refresh the status

## Bootstrap status view

Use the `Mise: Show bootstrap status` command (or the list icon in the
`Bootstrap` panel) to open a table with all bootstrap entries and their state.
From there, you can filter for pending entries and run `mise bootstrap` or a
dry run.
