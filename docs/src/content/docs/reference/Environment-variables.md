---
title: Environment variables
description: How to manage environment variables in VS Code with mise
sidebar:
  order: 303
---

## Environment variables list

Environment variables are listed in the activity bar. Click on an environment
variable to find where it's defined.

![env-list.png](../../../assets/env-1.png)

## Loading environment variables

`mise-vscode` will automatically load all the environment variables provided by
`mise env` in the current VS Code process. (similar to the `direnv` VS Code
extension.

The variables will be provided to any newly created terminals, even if `mise` is
not activated.

![env-terminal.png](../../../assets/env-terminal.png)

If the list of environment variables has changed, you might to reload the
terminal. In this case, a warning sign will be shown next to the terminal name.

![env-terminal-warning.png](../../../assets/env-terminal-warning.png)

You can choose to reload open terminals automatically in the
[settings](vscode://settings/mise.updateOpenTerminalsEnvAutomatically) (off by
default). If `mise` is activated in your terminal, it's better to keep this
option turned off.

![env-terminal-settings.png](../../../assets/env-terminal-settings.png)
