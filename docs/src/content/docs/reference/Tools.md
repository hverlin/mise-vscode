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

## Tool explorer (activity bar)

The tool explorer in the activity bar allows you to quickly which tools are used
in the current project. You can also the list of global tools.

- Click on a tool to navigate to the file where it is defined
- Some additional options are available on right-click, like copying the
  bin/install path or removing the tool

![img.png](../../../assets/tools-activity-bar.png)

A config file that does not parse is marked in the explorer. Its tools are the
ones from the last time the file parsed. See [While a config file is being edited](/mise-vscode/reference/misetoml-language-support/#while-a-config-file-is-being-edited).

### Lazy tools

Tools declared with `lazy = true` are installed by mise the first time one of
their commands runs. Until then, they are not reported as missing: the explorer
and the editor show them as `installs on first use` instead of not installed.

```toml
[tools]
ripgrep = { version = "14", lazy = true }
```

## Tools list

Use the list `List all tools` button to list all installed tools.

- You can filter the tools used in the current project using `active` only.
- From there, you can upgrade, uninstall or prune unused tools

![tools-list.png](../../../assets/tools-list.png)
