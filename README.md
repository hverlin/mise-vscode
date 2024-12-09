# mise-vscode 🛠️
[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/hverlin.mise-vscode)](https://marketplace.visualstudio.com/items?itemName=hverlin.mise-vscode)
[![Open VSX](https://img.shields.io/open-vsx/v/hverlin/mise-vscode)](https://open-vsx.org/extension/hverlin/mise-vscode)

VS Code extension for [mise](https://mise.jdx.dev/)

> [mise](https://mise.jdx.dev/) is a polyglot tool version manager, environment variables manger, and tasks runner.
> - Like asdf (or nvm or pyenv but for any language), it manages dev tools like node, python, cmake, terraform, and hundreds more. 
> - Like direnv, it manages environment variables for different project directories.
> - Like make, it manages tasks used to build and test projects.

This VSCode extension makes it easier to manage `mise` [tasks](https://github.com/hverlin/mise-vscode/wiki/Tasks), [tools](https://github.com/hverlin/mise-vscode/wiki/Tools), and [environment variables](https://github.com/hverlin/mise-vscode/wiki/Environment-variables) directly from your editor.

![mise-extension.png](screenshots/mise-extension.png)

## Installation
- [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=hverlin.mise-vscode)
- [Open VSX Registry](https://open-vsx.org/extension/hverlin/mise-vscode)

### Requirements
- This extension is tested against the latest version of `mise`. To update, run `mise self-update`.
- For syntax highlighting, install [even-better-toml](https://marketplace.visualstudio.com/items?itemName=tamasfe.even-better-toml). See [wiki](https://github.com/hverlin/mise-vscode/wiki/mise.toml-language-support).

## ✨ Features

### Task Management
- 🔍 Automatic detection of [mise tasks](https://mise.jdx.dev/tasks/)
- ⚡ Run tasks directly from:
    - `mise.toml` files or file tasks
    - Command palette
    - Mise sidebar
- Arguments are supported!
- 📝 View task definitions 
- ➕ Create new file tasks 

### Tool Management
- 🧰 View all [mise tools](https://mise.jdx.dev/dev-tools/) (python, node, jq, etc.) in the sidebar
- 📍 Quick navigation to tool definitions
- 📱 Show tools which are not installed or active
- 📦 Install/Remove/Use tools directly from the sidebar
- 🔧 Configure extensions to use tools from `mise` ([list of supported extensions](https://github.com/hverlin/mise-vscode/wiki/Supported-extensions))

### Environment Variables
- 🌍 View [mise environment variables](https://mise.jdx.dev/environments.html)
- 📍 Quick navigation to environment variable definitions
- 🔄 Automatically load environment variables from `mise.toml` files in VS Code

### Snippets
- 📝 Snippets to create tasks in `mise.toml` and task files

### Integration with VSCode tasks (`launch.json`)
This extension lets [VSCode tasks](https://code.visualstudio.com/docs/editor/tasks) use `mise` tasks. You can use `mise` tasks in your `launch.json` file.

See the [VSCode task integration wiki page](https://github.com/hverlin/mise-vscode/wiki/Tasks#vscode-task-integration) for more information.

## Documentation

https://github.com/hverlin/mise-vscode/wiki

- [Getting Started](https://github.com/hverlin/mise-vscode/wiki/Getting-Started)
- [mise.toml language support](https://github.com/hverlin/mise-vscode/wiki/mise.toml-language-support)
- [Tasks](https://github.com/hverlin/mise-vscode/wiki/Tasks)
- [Tools](https://github.com/hverlin/mise-vscode/wiki/Tools)
- [Environment variables](https://github.com/hverlin/mise-vscode/wiki/Environment-variables)
- [Supported extensions](https://github.com/hverlin/mise-vscode/wiki/Supported-extensions)
- [Settings](https://github.com/hverlin/mise-vscode/wiki/Settings)

## Bug Reports / Feature Requests / Contributing

- Found a bug? Please [open an issue](https://github.com/hverlin/mise-vscode/issues)
- Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for more information.

### Known Issues
- Workspaces with multiple folders are not yet supported. Only the first workspace folder is used.
- This extension is not tested on Windows.

## Ecosystem

- See [intellij-mise](https://github.com/134130/intellij-mise) if you are looking for a similar plugin for IntelliJ IDEA
- [Mise documentation](https://mise.jdx.dev/)

## 📄 License

This extension is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.
