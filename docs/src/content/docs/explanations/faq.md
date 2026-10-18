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

### Does the extension trust my mise config files automatically?

Yes, in a [trusted VS Code workspace](https://code.visualstudio.com/docs/editing/workspaces/workspace-trust), the extension runs [`mise trust`](https://mise.jdx.dev/cli/trust.html) on startup and when a config file changes. In an untrusted workspace, it does so once you trust the workspace. You can turn this off by setting [`mise.automaticallyTrustMiseConfigFiles`](/mise-vscode/reference/settings/#miseautomaticallytrustmiseconfigfiles) to `false`. Note that mise also trusts a config file itself when you run one of its tasks or install its tools, outside paranoid mode.

The extension does not trust a config file that you told mise to ignore (`mise trust --ignore`). A code lens at the top of the file lets you trust it.

In [paranoid mode](https://mise.jdx.dev/paranoid.html), mise requires a config file to be trusted again after every change, so the extension does not trust it automatically. The status bar shows `Mise (not trusted)` and a code lens at the top of the file lets you review and trust it.

Paranoid mode can also be turned on for some of its categories only, e.g. `paranoid = ["env_files"]` (mise 2026.10.14+). With the `env_files` category, the env files mise loads (`env._.file`, `env._.source` and the `env_file` setting) need their own trust, and an edit untrusts them again. The status bar shows `Mise (not trusted)` for them too, and lets you review and trust them. With `env_files` but not `config`, the extension still trusts the config files of the workspace, and only them.

To trust the files you save in VS Code automatically, config files and env files alike, set [`mise.trustOwnEditsInParanoidMode`](/mise-vscode/reference/settings/#misetrustowneditsinparanoidmode) to `true`, or, with the `config` category, click `Trust my own edits` at the top of the config file. Only a file that was trusted before the save is trusted again: changes made outside VS Code (e.g. `git pull`) still have to be trusted from the status bar or the code lens. For an env file, this is checked when you start editing it, by reading the env with mise: an env file that sets no variable, or the one of a monorepo project, has to be trusted again by you.

### The code-lens (run/watch) on top of each task is quite annoying. Can I turn it off?

Yes, you can turn off the code-lens on top of each task. You can do so by setting the [`mise.enableCodeLens`](/mise-vscode/reference/settings/#miseenablecodelens) setting to `false`.

Ideally, we should be able to use the editor gutter for this (like in IntelliJ) but this is [not possible currently](https://github.com/microsoft/vscode/issues/224134).