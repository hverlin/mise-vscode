# mise-vscode 🛠️

[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/hverlin.mise-vscode)](https://marketplace.visualstudio.com/items?itemName=hverlin.mise-vscode)
[![Open VSX](https://img.shields.io/open-vsx/v/hverlin/mise-vscode)](https://open-vsx.org/extension/hverlin/mise-vscode)
[![Documentation](https://img.shields.io/badge/wiki-Documentation-blue)](https://hverlin.github.io/mise-vscode/)

VS Code extension for [mise](https://mise.jdx.dev/)

> [mise](https://mise.jdx.dev/) is a polyglot tool version manager, environment
> variables manager, and tasks runner.
>
> - Like asdf (or nvm or pyenv but for any language), it manages dev tools like
>   node, python, cmake, terraform, and hundreds more.
> - Like direnv, it manages environment variables for different project
>   directories.
> - Like make, it manages tasks used to build and test projects.

This VSCode extension provides an easy way to manage `mise`
[tasks](https://github.com/hverlin/mise-vscode/wiki/Tasks),
[tools](https://github.com/hverlin/mise-vscode/wiki/Tools), and
[environment variables](https://github.com/hverlin/mise-vscode/wiki/Environment-variables)
directly from your editor.

It can automatically
[configure other extensions](https://github.com/hverlin/mise-vscode/wiki/Supported-extensions)
to use tools provided by `mise` in your current project.

![mise-extension.png](screenshots/mise-extension.png)

## Installation

- [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=hverlin.mise-vscode)
- [Open VSX Registry](https://open-vsx.org/extension/hverlin/mise-vscode)

## ✨ Features

### Task Management

- 🔍 Automatic detection of [mise tasks](https://mise.jdx.dev/tasks/)
- ⚡ Run tasks directly from, `mise.toml` files, file tasks, the command palette
  or the activity bar (arguments are supported)
- 📝 View task definitions
- ➕ Create new toml & file tasks

### Tool Management

- 🧰 View all [mise tools](https://mise.jdx.dev/dev-tools/) (python, node, jq,
  etc.) in the sidebar
- 📍 Quick navigation to tool definitions
- 📱 Show tools which are not installed or active
- 📦 Install/Remove/Use tools directly from the sidebar
- 🔧 Configure your other VSCode extensions to use tools provided by `mise`
  ([list of supported extensions](https://hverlin.github.io/mise-vscode/reference/supported-extensions/))

### Environment Variables

- 🌍 View [mise environment variables](https://mise.jdx.dev/environments.html)
- 📍 Quick navigation to environment variable definitions
- 🔄 Automatically load environment variables from `mise.toml` files in VS Code

### Snippets

- 📝 Snippets to create tasks in `mise.toml` and task files

### Integration with VSCode tasks (`launch.json`)

This extension lets
[VSCode tasks](https://code.visualstudio.com/docs/editor/tasks) use `mise`
tasks. You can use `mise` tasks in your `launch.json` file.

See the
[VSCode task integration wiki page](https://hverlin.github.io/mise-vscode/tasks/#vscode-task-integration)
for more information.

## Documentation

https://hverlin.github.io/mise-vscode/tools/

- [Getting Started](https://hverlin.github.io/mise-vscode/getting-started/)
- [Tools](https://hverlin.github.io/mise-vscode/tools/)
- [Environment variables](https://hverlin.github.io/mise-vscode/environment-variables/)
- [Tasks](https://hverlin.github.io/mise-vscode/tasks/)
- [mise.toml language support](https://hverlin.github.io/mise-vscode/misetoml-language-support/)
- Reference
  - [Supported extensions](https://hverlin.github.io/mise-vscode/reference/supported-extensions/)
  - [Extension Settings](https://hverlin.github.io/mise-vscode/reference/settings/)

## Bug Reports / Feature Requests / Contributing

- Found a bug? Please
  [open an issue](https://github.com/hverlin/mise-vscode/issues)
- Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for more
  information.

Note that this extension is tested against the latest version of `mise`. If you
encounter an issue, make sure to update `mise` first with `mise self-update` or
using your package manager.

### Known Issues

- Workspaces with multiple folders are not yet supported. Only the first
  workspace folder is used.
- Windows is partially supported. Some features may not work as expected. Please
  report any issues you encounter.

## Ecosystem

- See [intellij-mise](https://github.com/134130/intellij-mise) if you are
  looking for a similar plugin for IntelliJ IDEA
- [Mise documentation](https://mise.jdx.dev/)

## License

This extension is licensed under the MIT License. See the [LICENSE](LICENSE)
file for details.
