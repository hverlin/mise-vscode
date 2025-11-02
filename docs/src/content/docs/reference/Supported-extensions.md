---
title: Supported extensions
description: Supported extensions that can be automatically configured to use tools from `mise`
sidebar:
  order: 304
---

List of extensions that can be automatically configured to use tools from
`mise`.

- By default, Mise VSCode will not modify your `.vscode/settings.json` file. If you want to enable the automatic configuration of extensions, see the [set-up guide](/mise-vscode/tutorials/settinguptheextension/).
- If you want to configure one extension manually, search for `Mise: Configure extension sdk path...` in the command palette.
- When automatic configuration is enabled, the extensions are configured to use `mise shims`.
  You can [update this feature in the settings](/mise-vscode/reference/settings/#miseconfigureextensionsuseshims).
- If you want to share your `.vscode/settings.json` file with others, you can
  enable [`configureExtensionsUseSymLinks`](/mise-vscode/reference/settings/#miseconfigureextensionsusesymlinks). This will create a folder in your
  `.vscode` directory with a symlink to the tools installed by `mise`.

| Extension                                                                                                    | Settings                                                                                                       | Comment                                                                                                                                                   |
|--------------------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------|
| [Python](https://marketplace.visualstudio.com/items?itemName=ms-python.python)                               | `python.defaultInterpreterPath`                                                                                | You will still need to select the interpreter. See [this discussion](https://github.com/hverlin/mise-vscode/discussions/71)                               |
| [Go](https://marketplace.visualstudio.com/items?itemName=golang.Go)                                          | `go.goroot`, `go.alternateTools`                                                                               |                                                                                                                                                           |
| [Java](https://marketplace.visualstudio.com/items?itemName=oracle.oracle-java)                               | `jdk.jdkhome`                                                                                                  |                                                                                                                                                           |
| [Shellcheck](https://marketplace.visualstudio.com/items?itemName=timonwong.shellcheck)                       | `shellcheck.executablePath`                                                                                    |                                                                                                                                                           |
| [NodeJS](https://marketplace.visualstudio.com/items?itemName=ms-vscode.js-debug)                             | `debug.javascript.defaultRuntimeExecutable.pwa-node`                                                           |                                                                                                                                                           |
| [Deno](https://marketplace.visualstudio.com/items?itemName=denoland.vscode-deno)                             | `deno.path`                                                                                                    |                                                                                                                                                           |
| [Bun](https://marketplace.visualstudio.com/items?itemName=oven.bun-vscode)                                   | `bun.runtime`                                                                                                  |                                                                                                                                                           |
| [Ruff](https://marketplace.visualstudio.com/items?itemName=charliermarsh.ruff)                               | `ruff.path`                                                                                                    |                                                                                                                                                           |
| [php](https://marketplace.visualstudio.com/items?itemName=xdebug.php-debug), php built-in                    | `php.validate.executablePath`, `php.debug.executablePath`                                                      | Does not work with symlinks                                                                                                                               |
| [julia](https://marketplace.visualstudio.com/items?itemName=julialang.language-julia)                        | `julia.executablePath`                                                                                         | Does not work with shims                                                                                                                                  |
| [erlang](https://marketplace.visualstudio.com/items?itemName=pgourlain.erlang)                               | `erlang.erlangPath`                                                                                            | Does not work with shims                                                                                                                                  |
| [dart](https://marketplace.visualstudio.com/items?itemName=Dart-Code.dart-code)                              | `dart.sdkPath`                                                                                                 | Does not work with shims or symlinks                                                                                                                      |
| [flutter](https://marketplace.visualstudio.com/items?itemName=dart-code.flutter)                             | `dart.flutterSdkPath`                                                                                          | Does not work with shims or symlinks                                                                                                                      |
| [zig](https://marketplace.visualstudio.com/items?itemName=ziglang.vscode-zig)                                | `zig.path`, `zig.zls.path` (install [zls](https://mise.jdx.dev/lang/zig.html#zig-language-server) with `mise`) | Does not work with shims or symlinks                                                                                                                      |
| [sops](https://marketplace.visualstudio.com/items?itemName=signageos.signageos-vscode-sops)                  | `sops.binPath`                                                                                                 |                                                                                                                                                           |
| [ginkgo test explorer](https://marketplace.visualstudio.com/items?itemName=joselitofilho.ginkgotestexplorer) | `ginkgotestexplorer.ginkgoPath`                                                                                |                                                                                                                                                           |
| [buf](https://marketplace.visualstudio.com/items?itemName=bufbuild.vscode-buf)                               | `buf.commandLine.path`                                                                                         |                                                                                                                                                           |
| [biome](https://marketplace.visualstudio.com/items?itemName=biomejs.biome-vscode)                            | `biome.lsp.bin`                                                                                                | Not enabled by default. Update `"mise.configureExtensionsAutomaticallyIgnoreList"` to `[]` to enable it. Use it only if you don't install biome with npm. |

Extensions which have built-in support for `mise`:

- [Ruby, with ruby-lsp](https://shopify.github.io/ruby-lsp/#version-manager-integrations)
- [Elixir](https://marketplace.visualstudio.com/items?itemName=JakeBecker.elixir-ls)
  will look for `mise` and install the lsp server automatically

Extensions that are not supported:
- [Rust](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer) does not offer to update the cargo path automatically. See [this discussion](https://github.com/hverlin/mise-vscode/discussions/70) for workarounds. 

If you would like to add one, you can open a PR that updates
[src/utils/supportedExtensions.ts](https://github.com/hverlin/mise-vscode/blob/main/src/utils/supportedExtensions.ts)
