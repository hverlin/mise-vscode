# mise-vscode 🛠️
[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/hverlin.mise-vscode)](https://marketplace.visualstudio.com/items?itemName=hverlin.mise-vscode)
[![Open VSX](https://img.shields.io/open-vsx/v/hverlin/mise-vscode)](https://open-vsx.org/extension/hverlin/mise-vscode)

VS Code extension for [mise](https://mise.jdx.dev/)

> [mise](https://mise.jdx.dev/) is a development environment setup tool that manages your project's tools, runtimes, environment variables, and tasks all in one place.

## 📥 Installation
- [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=hverlin.mise-vscode)
- [Open VSX Registry](https://open-vsx.org/extension/hverlin/mise-vscode)

## ✨ Features

### Task Management
- 🔍 Automatic detection of `mise` tasks
- ⚡ Run tasks directly from:
    - `mise.toml` files
    - Command palette
    - Mise sidebar

### Tool Management
- 🧰 View all [mise tools](https://mise.jdx.dev/dev-tools/) (python, node, jq, etc.) in the sidebar
- 📍 Quick navigation to tool definitions
- 📱 Show tools which are not installed or active

### Environment Variables
- 🌍 View [mise environment variables](https://mise.jdx.dev/environments.html)

## 🚀 Getting Started

1. Install the extension from [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=hverlin.mise-vscode#overview) or [Open VSX](https://open-vsx.org/extension/hverlin/mise-vscode)
2. Open a project with a `mise.toml` file
3. Access mise features through:
    - The sidebar icon `terminal` icon in the activity bar (usually on the left)
    - Command palette (`Ctrl/Cmd + Shift + P`). Search for `Run Mise Task` or `Open Tool definition` or `Open Mise Task definition`
    - The status bar at the bottom of the window

## 🐛 Bug Reports / Feature Requests / Contributing

- Found a bug? Please [open an issue](https://github.com/hverlin/mise-vscode/issues) with:
- Contributions are welcome! Please use the `discussions` tab before opening a PR.

## Roadmap

- [ ] Automatically setup SDKs based on mise tools
- [ ] Improve mise task integration
- [ ] Suggest to install missing tools
- [ ] UI to install tools
- ...

## 📄 License

This extension is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.