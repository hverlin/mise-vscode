# Contributing

Contributions are welcome! Please use the `discussions` tab before opening a PR.

## Running the extension locally
Install `mise` (if you don't have it already): https://mise.jdx.dev/getting-started.html

Install the dependencies:
```shell
mise install
```

Run the build and watch for changes:
```shell
mise run dev
```
This will open a new VS Code window with the extension running.

On code change:
- the extension code (in the `dist` folder) will be updated automatically.
- refresh the VS Code window to see the changes (`Developer: Reload Window`).

## Debugging
- With VSCode, use the `Run Extension` launch configuration
- With IntelliJ IDEA, use the `Debug extension` run configuration

## Tests
```shell
mise run test
```

## Lint 
```shell
mise run lint
mise run lint-fix # to fix lint issues
mise run check # lint-fix + tests
```

If you want to run the linter on every commit, you can create a pre-commit hook:
```shell
mise generate git-pre-commit --write --task=check
```

## Other commands
```shell
mise tasks # list all available tasks
```