---
title: AI agents (MCP)
description: Give the AI agents of VS Code access to mise and pitchfork
sidebar:
  order: 309
---

The [Model Context Protocol](https://modelcontextprotocol.io/) (MCP) lets the
AI agents of VS Code, for example the agent mode of Copilot, call tools. mise
and pitchfork both ship an MCP server, and the extension can provide them to
VS Code, started in the current workspace folder, so there is no `mcp.json` to
write:

- [`mise mcp`](https://mise.jdx.dev/mcp.html): the project's tools, tasks,
  environment variables and config files, and tools to run its tasks and
  install tools.
- [`pitchfork mcp`](https://pitchfork.jdx.dev/guides/mcp): the status of the
  [daemons](/mise-vscode/reference/daemons/), and tools to start, stop and
  restart them and read their logs.

They are off by default. Turn them on in your user settings:

```json
{
  "mise.mcpServers": ["mise", "pitchfork"]
}
```

They then appear in the MCP servers of VS Code (`MCP: List Servers`), where
they can be started, stopped or turned off like any other server. Switching to
another workspace folder, or to another `mise.miseEnv`, updates them.

:::caution
The environment resource of `mise mcp` holds the real values of the project's
environment variables, secrets included, and its tools can run tasks and
install tools. Turn it on for projects and agents you trust; VS Code asks
before an agent runs a tool, depending on your settings.
:::

This requires VS Code 1.101 or later, and, for `pitchfork mcp`, pitchfork
2.25.0 or later. Only the user settings can set `mise.mcpServers`, not a
project's.
