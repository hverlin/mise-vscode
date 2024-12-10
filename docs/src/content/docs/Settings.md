---
title: Extension Settings
description: VSCode mise extension settings
---

You can configure the extension behavior through Visual Studio Code settings. To
access the settings:

1. Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`)
2. Type "Settings: Open Settings (UI)"
3. Search for "Mise"

You can also click on the mise extension indicator in the status bar to quickly
access the extension settings.

<img width="1414" alt="picture showing mise extension settings" src="https://github.com/user-attachments/assets/1572f0e8-98b2-4f05-a21f-de77ee020f73">

## `mise.enable`

- **Type:** `boolean`
- **Default:** `true`

Enable/disable mise extension.

---

## `mise.binPath`

- **Type:** `string` Path to the mise binary (automatically detected on
  startup).

See https://mise.jdx.dev/getting-started.html to install mise.

---

## `mise.profile`

- **Type:** `string` Mise profile to use. (https://mise.jdx.dev/profiles.html)

---

## `mise.configureExtensionsAutomatically`

- **Type:** `boolean`
- **Default:** `true`

Automatically configure extensions for the current workspace.
([list of supported extensions](https://github.com/hverlin/mise-vscode/wiki/Supported-extensions))

---

## `mise.configureExtensionsAutomaticallyIgnoreList`

- **Type:** `array` (array of `string`)
- **Default:** `[]`

List of extensions that should not be configured automatically.

**Available options:**

- `ms-python.python`
- `denoland.vscode-deno`
- `charliermarsh.ruff`
- `golang.go`
- `oven.bun-vscode`
- `oracle.oracle-java`
- `timonwong.shellcheck`
- `ms-vscode.js-debug`
- `vscode.php-language-features`
- `xdebug.php-debug`
- `julialang.language-julia`
- `pgourlain.erlang`
- `Dart-Code.dart-code`

---

## `mise.configureExtensionsUseShims`

- **Type:** `boolean`
- **Default:** `true`

Use shims when configuring extensions. When shims are not used, note that you
will have to configure environment variables manually.

---

## `mise.configureExtensionsUseSymLinks`

- **Type:** `boolean`
- **Default:** `false`

Create symlinks in your `.vscode` folder that links to the `mise` bin. This is
useful if you share the `.vscode/settings.json` file with others.

---

## `mise.enableCodeLens`

- **Type:** `boolean`
- **Default:** `true`

Show run/add tool code lens indicators in the editor.

---

## `mise.showToolVersionsDecorations`

- **Type:** `boolean`
- **Default:** `true`

Show tool versions in the editor. (requires reload)

---
