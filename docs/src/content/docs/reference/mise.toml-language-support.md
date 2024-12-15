---
title: mise.toml language support
description: mise.toml language support in VS Code
sidebar:
    order: 304
---

### Syntax Highlighting for TOML

[Even Better TOML](https://marketplace.visualstudio.com/items?itemName=tamasfe.even-better-toml)
is automatically installed as a dependency to handle syntax highlighting for
TOML files.

`mise-vscode` provides syntax highlighting for `tera` used for
[templating](https://mise.jdx.dev/templates.html) in `mise.toml` files

![mise-toml-language-support.png](../../../assets/mise-toml-language-support.png)

### Code completion

This extension will
[provide two JSON schemas](https://marketplace.visualstudio.com/items?itemName=tamasfe.even-better-toml#completion-and-validation-with-json-schema)
for code completion

- In `mise.*toml` files, it will use https://mise.jdx.dev/schema/mise.json
- In `task[s]?.toml` files, a partial schema with only code completion for tasks
  is provided

### Code lens features

This extension adds the following code lens features:

- Each task has a `run` and `watch` code lens that will run the task
- A `add tool` code lens that to automatically add a tool to a `mise.toml` file

### Code completion

- Code completion is provided for `depends = ["task_name"]`

### Code navigation

- Cmd/Ctrl+Click on an included file will open that file (example:
  `include = ["tasks.toml"`])
