# mise-vscode 🛠️
[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/hverlin.mise-vscode)](https://marketplace.visualstudio.com/items?itemName=hverlin.mise-vscode)
[![Open VSX](https://img.shields.io/open-vsx/v/hverlin/mise-vscode)](https://open-vsx.org/extension/hverlin/mise-vscode)

VS Code extension for [mise](https://mise.jdx.dev/)

> [mise](https://mise.jdx.dev/) is a development environment setup tool that manages your project's tools, runtimes, environment variables, and tasks all in one place.

![mise-extension.png](screenshots/mise-extension.png)

## 📥 Installation
- [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=hverlin.mise-vscode)
- [Open VSX Registry](https://open-vsx.org/extension/hverlin/mise-vscode)

This extension is tested against the latest version of `mise`. To update, run
```shell
mise self-update
```

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

### Snippets
- 📝 Snippets to create tasks in `mise.toml` and task files

### Integration with VSCode tasks (`launch.json`)
This extension lets [VSCode tasks](https://code.visualstudio.com/docs/editor/tasks) use `mise` tasks. You can use `mise` tasks in your `launch.json` file.

Example `launch.json` file:
```json
{
    "version": "2.0.0",
    "tasks": [
        {
            "type": "mise",
            "task": "build-my-app",
            "label": "Build my app",
            "watch": true
        }
    ]
}
```

See the [VSCode task integration wiki page](https://github.com/hverlin/mise-vscode/wiki/VSCode-task-integration) for more information.

## 🚀 Getting Started

See [Getting Started](https://github.com/hverlin/mise-vscode/wiki/Getting-Started)

## Documentation

https://github.com/hverlin/mise-vscode/wiki

## 🐛 Bug Reports / Feature Requests / Contributing

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
