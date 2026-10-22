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

To try the extension on one of the e2e test projects, pass its name (with completion):
```shell
mise run dev monorepo
```
The project is copied to `/tmp/mise-vs-code-tests` first (set `MISE_VSCODE_TEST_PROJECTS` to change it), then opened. Opened in place, a test project would also pick up the `mise.toml` of this repository, since mise reads the config files of every parent directory. To copy every test project at once, run `mise run test-projects`.

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
mise run lint-fix -a # to fix lint in non-updated files

mise run check # lint-fix + tests
mise run check-all # mise check + e2e tests
```

You can install the git hooks with
```sh
hk install --mise
```
https://hk.jdx.dev/mise_integration.html#hk-install-mise

## Screenshots
The screenshots of the README and of the docs are taken by `scripts/screenshots` (macOS). It builds the extension and opens it in VS Code on a demo project, in `/tmp/mise-vscode-screenshots`, with a home, mise folders and VS Code profile of its own, so nothing of your machine shows. The images are saved in place:
```shell
mise run screenshots # all of them
mise run screenshots hero tools-list # only some, with completion
node --run screenshots -- hero # the same without mise run
```
The first run downloads VS Code to `.vscode-test`. Every run downloads node and jq to the temp folder. The VS Code window opens on your screen while it runs: keep the mouse away from it, or its hovers end up in the images. Look at the images before committing them. To add a screenshot, add an entry to `shots` in `scripts/screenshots/shots.mjs`.

## Other commands
```shell
mise tasks # list all available tasks
```
