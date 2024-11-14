# mise-vscode 🛠️
[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/hverlin.mise-vscode)](https://marketplace.visualstudio.com/items?itemName=hverlin.mise-vscode)
[![Open VSX](https://img.shields.io/open-vsx/v/hverlin/mise-vscode)](https://open-vsx.org/extension/hverlin/mise-vscode)

VS Code extension for [mise](https://mise.jdx.dev/)

> [mise](https://mise.jdx.dev/) is a development environment setup tool that manages your project's tools, runtimes, environment variables, and tasks all in one place.

![mise-extension.png](screenshots/mise-extension.png)

## 📥 Installation
- [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=hverlin.mise-vscode)
- [Open VSX Registry](https://open-vsx.org/extension/hverlin/mise-vscode)

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
- 🔧 Configure extensions to use tools from `mise`

<details>
<summary>Supported extensions</summary>

List of extensions that can be configured to use tools from `mise`. 
Extensions are automatically configured to use `mise shims`. You can disable this feature in the settings.

If you want to configure it manually, search for `Mise: Configure extension sdk path...` in the command palette.

- [Deno](https://marketplace.visualstudio.com/items?itemName=denoland.vscode-deno)
- [Ruff](https://marketplace.visualstudio.com/items?itemName=charliermarsh.ruff)
- [Bun](https://marketplace.visualstudio.com/items?itemName=oven.bun-vscode)
- [Go](https://marketplace.visualstudio.com/items?itemName=golang.Go)
- [Python](https://marketplace.visualstudio.com/items?itemName=ms-python.python)

If you want to add one, you can open a PR that updates [src/utils/supportedExtensions.ts](https://github.com/hverlin/mise-vscode/blob/main/src/utils/supportedExtensions.ts)

</details>

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

<details>
<summary>Supported parameters for mise tasks</summary>

- `task`: The mise task to execute
- `watch`: Re-run the task when files change
- `profile`: The mise profile to use (optional, will use the default profile if not provided)
- `glob`: Glob pattern to watch for changes. Defaults to sources from the tasks
- `runArgs`: Arguments to pass to the task. Not used when watch is true
- `watchexecArgs`: Arguments to pass to watchexec. (example: --clear) | use watchexec --help for more information

</details>


## 🚀 Getting Started

1. Install the extension from [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=hverlin.mise-vscode#overview) or [Open VSX](https://open-vsx.org/extension/hverlin/mise-vscode)
2. Open a project with a `mise.toml` file
3. Access mise features through:
    - The sidebar icon `terminal` icon in the activity bar (usually on the left)
    - Command palette (`Ctrl/Cmd + Shift + P`). Search for `Run Mise Task` or `Open Tool definition` or `Open Mise Task definition`
    - The status bar at the bottom of the window

## 🐛 Bug Reports / Feature Requests / Contributing

- Found a bug? Please [open an issue](https://github.com/hverlin/mise-vscode/issues)
- Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for more information.

## 📄 License

This extension is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.
