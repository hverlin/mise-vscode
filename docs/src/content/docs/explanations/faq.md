---
title: FAQ
description: Frequently asked questions about vscode-mise
sidebar:
    order: 400
---

Here are some frequently asked questions about the `mise` extension for VS Code.

### Do I need this extension to use mise in VS Code?

Using this extension is not required to use mise in VS Code. You can use `shims` as explained in the [mise documentation](https://mise.jdx.dev/ide-integration.html). 

This extension is designed to work without having to activate [`shims`](https://mise.jdx.dev/dev-tools/shims.html#shims) and has a lot of additional features to make working with `mise` in VS Code easier.

### Do I need to update my default shell's profile script to use this extension?

You do not have to update your default shell's profile script to use this extension. This extension will automatically detect `mise`, even if not activated and configure other extensions to use tools provided by `mise`.

Mise environment variables will also be loaded to your current VS Code session.

### The extension updates my `.vscode/settings.json` file. Can I change this?

Yes, you can change this behavior. Read the [setting up the extension](/mise-vscode/tutorials/settinguptheextension/) section for more information. Note that you can also configure the extension to [create symlinks to tools](/mise-vscode/reference/settings/#miseconfigureextensionsusesymlinks) so that the settings points to a relative path in your project.

### The code-lens (run/watch) on top of each task is quite annoying. Can I turn it off?

Yes, you can turn off the code-lens on top of each task. You can do so by setting the [`mise.enableCodeLens`](/mise-vscode/reference/settings/#miseenablecodelens) setting to `false`.

Ideally, we should be able to use the editor gutter for this (like in IntelliJ) but this is [not possible currently](https://github.com/microsoft/vscode/issues/224134).