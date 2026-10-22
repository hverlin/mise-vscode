---
title: Daemons
description: Start, stop and follow mise and pitchfork daemons in VS Code
sidebar:
  order: 307
---

A daemon is a process that keeps running between commands, such as a database
or a development server. [pitchfork](https://pitchfork.jdx.dev/) supervises
them, and they can be declared in two places:

- the `[daemons]` of a mise config, managed with
  [`mise daemons`](https://mise.jdx.dev/daemons.html). This is experimental: it
  requires `experimental = true` and mise `2026.9.12` or later.
- a `pitchfork.toml` (or `pitchfork.local.toml`, `.config/pitchfork.toml`),
  and the global pitchfork config (`~/.config/pitchfork/config.toml`).

The extension requires pitchfork `2.25.0` or later, the version mise requires.
It uses the pitchfork of the project's tools, or the one on the `PATH`
(`mise use -g pitchfork` installs one).

## Daemons panel

The `Daemons` panel in the activity bar lists the daemons of the current
workspace folder, with their status and, while they run, their port. It only
shows up when there are daemons. The daemons of the global pitchfork config
are listed under `Global`, in every workspace.

<video controls src="/mise-vscode/videos/daemons.mp4"></video>

From each daemon, you can:

- start, stop or restart it. A mise daemon is started with
  `mise daemons start`, which installs its tools first and waits until it is
  ready.
- show its logs in a terminal (`pitchfork logs --tail`)
- open it in the browser, for an HTTP daemon
- go to where it is declared (click on it)

The groups of the project, mise's
[`[daemon_groups]`](https://mise.jdx.dev/daemons.html#groups) and pitchfork's
`[groups]`, are listed under `Groups`, each with its daemons and how many of
them run. As `mise daemons start --group` does, a mise group of a child project
also covers the group of the same name in its parent projects. A group can be started, stopped or restarted at once
(`mise daemons start --group <name>`, `pitchfork start --group <name>`).

A [preset](https://mise.jdx.dev/daemons/presets.html), such as PostgreSQL,
shows where it keeps its data. From its context menu, `Reveal Daemon Data`
opens that directory, and `Reset Daemon Data...` gives it fresh data, as the
[mise docs](https://mise.jdx.dev/daemons/data.html#reset-a-database) describe:
after a confirmation, it stops the daemon, deletes its data directory and
starts it again. A directory holding your home directory, a workspace folder
or the project is never deleted.

While the pitchfork supervisor runs, a daemon can be disabled from its context
menu (`pitchfork disable`): pitchfork no longer starts it, by hand, with a group
or a session, nor restarts it when it exits, until it is enabled again. A
daemon that runs keeps running. A
[oneshot](https://pitchfork.jdx.dev/guides/oneshot-tasks) daemon, which runs to
completion, shows `completed` with a check mark once it succeeded, and a
[cron](https://pitchfork.jdx.dev/guides/scheduling) daemon shows its schedule,
and when it runs next while the supervisor is up. It only runs on schedule
while the supervisor runs and knows its project.

The [shared servers](https://mise.jdx.dev/daemons/sharing.html#shared-server-providers)
of your global mise config (`[daemon_providers]`) are listed under
`Shared servers`, where they can be started, stopped or restarted
(`mise daemons providers start <name>`); stopping or restarting one asks first,
as every checkout that uses it loses its database meanwhile. Their data is never
reset from here. mise does not support shared servers on Windows.

From the panel title bar, you can start or stop all the daemons of the project
(for mise, the [`default` group](https://mise.jdx.dev/daemons.html#groups) or
every daemon), open the pitchfork dashboard (`pitchfork tui`) in an editor
tab, and open the pitchfork [web UI](https://pitchfork.jdx.dev/guides/web-ui)
when the supervisor serves it.

The panel refreshes while it is visible. Only starting a daemon starts the
pitchfork supervisor: listing, stopping or leaving a session never does. Until
it runs, the daemons show as `available`.

## Failures and the status bar

When a running daemon of the project fails, for example a development server
that exits with an error, a notification says so, with buttons to show its logs
or restart it. The status bar shows how many daemons of the project run, and
how many failed since the window opened; click it to open the Daemons panel.

In a focused window, the daemons are checked every 5 seconds while the panel
is visible, every 15 seconds while it is hidden and a daemon runs, and every
minute while none runs but the pitchfork supervisor does, to notice a daemon
started from a terminal. Turn the notifications off with
`mise.notifyDaemonFailures`, and the status bar item with
`mise.showDaemonsInStatusBar`.

## Code lenses

Each daemon declared in a mise config or a pitchfork config gets a code lens
with its status, and actions to start, stop, restart it or show its logs.

## Editing daemons

In a mise config, the names of daemons are completed in the `daemons` of a
task, the `depends` of a daemon and the members of a group, with hover and
go to definition (see
[mise.toml language support](/mise-vscode/reference/misetoml-language-support/#autocompletion-for-daemons)).

Type `mise-daemon` to get snippets for the different kinds of daemons:
`mise-daemon` (a command, with a readiness check on its port),
`mise-daemon-preset` (a [service preset](https://mise.jdx.dev/daemons/presets.html)
such as PostgreSQL), `mise-daemon-task` (a mise task), `mise-daemon-auto` (a
daemon that starts and stops with the shell or the workspace) and
`mise-daemon-groups`.

## Start and stop daemons with the workspace

pitchfork starts the daemons declared with `auto = ["start"]` when a shell
enters their project, and stops the ones with `auto = ["stop"]` once the last
shell left (see
[Start and stop with your shell](https://mise.jdx.dev/daemons.html#automatic-start-and-stop)).

With `mise.autoStartStopDaemons`, VS Code does the same for the projects of
the workspace folders: the window joins the pitchfork session of each project
(the directory of its config, which can be above the folder), and leaves it
when the folder is closed. pitchfork also ends the session once VS Code exits.
The mise daemons that start this way are registered with pitchfork first,
which installs their missing tools.

```toml
# mise.toml
[settings]
experimental = true

[daemons.postgres]
preset = "postgres"
version = "18"
auto = ["start", "stop"]
```

The setting is off by default, and only your user settings can turn it on.
