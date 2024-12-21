---
title: FAQ
description: Frequently asked questions about vscode-mise
sidebar:
    order: 400
---

### Do I need this extension to use mise in VSCode?

Using this extension is not required to use mise in VSCode. You can use `shims` as explained in the [mise documentation](https://mise.jdx.dev/ide-integration.html). 

This extension is designed to work without having to activate `shims` and has a lot of additional features to make working with `mise` in VSCode easier.

### Do I need to update my default shell's profile script to use this extension?

You do not have to update your default shell's profile script to use this extension. This extension will automatically detect `mise`, even if not activated and configure other extensions to use tools provided by `mise`.

Mise environment variables will also be loaded to your current VSCode session.

