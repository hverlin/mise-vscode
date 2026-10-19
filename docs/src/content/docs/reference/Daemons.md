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
shows up when the folder has daemons. The daemons of the global pitchfork
config are listed under `Global`.

From each daemon, you can:

- start, stop or restart it. A mise daemon is started with
  `mise daemons start`, which installs its tools first and waits until it is
  ready.
- show its logs in a terminal (`pitchfork logs --tail`)
- open it in the browser, for an HTTP daemon
- go to where it is declared (click on it)

From the panel title bar, you can start or stop all the daemons of the project
(for mise, the [`default` group](https://mise.jdx.dev/daemons.html#groups) or
every daemon), open the pitchfork dashboard (`pitchfork tui`) in an editor
tab, and open the pitchfork [web UI](https://pitchfork.jdx.dev/guides/web-ui)
when the supervisor serves it.

The panel refreshes while it is visible. Listing the daemons never starts the
pitchfork supervisor: until it runs, the daemons show as `available`.

## Code lenses

Each daemon declared in a mise config or a pitchfork config gets a code lens
with its status, and actions to start, stop, restart it or show its logs.

## Start and stop daemons with the workspace

pitchfork starts the daemons declared with `auto = ["start"]` when a shell
enters their project, and stops the ones with `auto = ["stop"]` once the last
shell left (see
[Start and stop with your shell](https://mise.jdx.dev/daemons.html#automatic-start-and-stop)).

With `mise.autoStartStopDaemons`, VS Code does the same for each workspace
folder while it is open: the window joins the pitchfork session of the folder,
and leaves it when the folder is closed. pitchfork also ends the session once
VS Code exits. The mise daemons that start this way are registered with
pitchfork first, which installs their missing tools.

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
