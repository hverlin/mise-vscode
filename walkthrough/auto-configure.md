# Welcome to Mise VSCode! 👋

This extension brings Mise support directly into Visual Studio Code. 
- Syntax highlighting, autocompletion and go-to-definition for `mise.toml` files
- tools, tasks, and environment variables available directly from the sidebar
- Ability to autoconfigure other extensions to use tools from mise.

# Auto-Configure Extensions

One of the main features of this extension is the ability to **automatically configure other VSCode extensions** to use tools managed by mise.

When enabled, the extension will automatically update your `.vscode/settings.json` file to configure supported VSCode extensions.
See [the list of supported extensions](https://github.com/hverlin/mise-vscode/wiki/Supported-extensions).

To enable this feature, simply click this button:
**[Enable Auto-Configuration](command:mise.enableAutoConfiguration)**

You can always change this setting later in the [extension settings](command:mise.openExtensionSettings).
