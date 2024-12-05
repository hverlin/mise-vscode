# Changelog

## [0.26.0](https://github.com/hverlin/mise-vscode/compare/v0.25.0...v0.26.0) (2024-12-05)


### Features

* Create separate views for tools, settings and tracked configurations ([3df5dfe](https://github.com/hverlin/mise-vscode/commit/3df5dfecf2579c1cdf192f768152e6ea51fe9d49))
* Show tool information ([70611b7](https://github.com/hverlin/mise-vscode/commit/70611b7c50e3a7f078d95f1480d9d6821ee99b3a))

## [0.25.0](https://github.com/hverlin/mise-vscode/compare/v0.24.1...v0.25.0) (2024-12-02)


### Features

* use `mise --env` instead of `mise --profile` ([cc0f9bb](https://github.com/hverlin/mise-vscode/commit/cc0f9bb64208e321d187ba5e38af2368305ef3bd))

## [0.24.1](https://github.com/hverlin/mise-vscode/compare/v0.24.0...v0.24.1) (2024-11-30)


### Bug Fixes

* use toml output for settings view ([335b038](https://github.com/hverlin/mise-vscode/commit/335b0382161888213aee5601a2ee81db7c5854a3))

## [0.24.0](https://github.com/hverlin/mise-vscode/compare/v0.23.0...v0.24.0) (2024-11-29)


### Features

* skip confirmation prompt for mise self-update ([a046e15](https://github.com/hverlin/mise-vscode/commit/a046e15c44239227737364e5aa38199ef104d9c1))


### Bug Fixes

* setting view broken after 2024.11.34 release ([80a49b3](https://github.com/hverlin/mise-vscode/commit/80a49b358484fc7dfe17fb3855a7c65a14a9c4b3))

## [0.23.0](https://github.com/hverlin/mise-vscode/compare/v0.22.1...v0.23.0) (2024-11-28)


### Features

* Add the option to automatically set/unset env variables in open terminals ([efd8f89](https://github.com/hverlin/mise-vscode/commit/efd8f89dcdd53117513afa5c23ce51a08b701a32))
* automatically update environment variables ([9bf0216](https://github.com/hverlin/mise-vscode/commit/9bf0216aa0b6bcaff6f819ef2a0535ee22de2690))

## [0.22.1](https://github.com/hverlin/mise-vscode/compare/v0.22.0...v0.22.1) (2024-11-28)


### Bug Fixes

* Do not specify version with mise upgrade ([95f0e4f](https://github.com/hverlin/mise-vscode/commit/95f0e4fa62ff1a5ab36a469f7187bc3d1c348621))

## [0.22.0](https://github.com/hverlin/mise-vscode/compare/v0.21.0...v0.22.0) (2024-11-27)


### Features

* Improve remove tool action by calling `use --rm` ([58b76c1](https://github.com/hverlin/mise-vscode/commit/58b76c1f3712989d3cb18d1e371583a77d503819))


### Bug Fixes

* make sure icons are loaded correctly ([4a5c006](https://github.com/hverlin/mise-vscode/commit/4a5c0069c60f4fde4e7f4e95a30f0a8391e97b3c))

## [0.21.0](https://github.com/hverlin/mise-vscode/compare/v0.20.0...v0.21.0) (2024-11-27)


### Features

* find env. variable definition from mise.toml files ([5234e19](https://github.com/hverlin/mise-vscode/commit/5234e190b89704f803aa516c36c3176f70385a73))

## [0.20.0](https://github.com/hverlin/mise-vscode/compare/v0.19.0...v0.20.0) (2024-11-27)


### Features

* add prune tools & upgrade tool actions ([cedfa77](https://github.com/hverlin/mise-vscode/commit/cedfa77541614cc57e8b52849f644ec6d0ce5976))


### Bug Fixes

* do not hide/show panel on refresh ([427425b](https://github.com/hverlin/mise-vscode/commit/427425b9c4f779467097b10e31c1c20270ec6b5f))
* fix remove tool command ([e466acf](https://github.com/hverlin/mise-vscode/commit/e466acf9f61425427b3daba70aec06327b7ba047))

## [0.19.0](https://github.com/hverlin/mise-vscode/compare/v0.18.0...v0.19.0) (2024-11-26)


### Features

* allow disabling mise new version check ([c276217](https://github.com/hverlin/mise-vscode/commit/c27621761bcbd2f5a328c1e6075133c57624d1b1))
* show track configuration files ([e068e52](https://github.com/hverlin/mise-vscode/commit/e068e52dfb6679f25141f3549ca926d1ca27f7ea))

## [0.18.0](https://github.com/hverlin/mise-vscode/compare/v0.17.2...v0.18.0) (2024-11-25)


### Features

* make code lens and tool versions optional ([4f1daa0](https://github.com/hverlin/mise-vscode/commit/4f1daa0eb794c71d3210278d236cfaf5ea7ca7e0))


### Bug Fixes

* show full setting description ([1938eb0](https://github.com/hverlin/mise-vscode/commit/1938eb0263c92e5f507bc2474bafb0e0e9e405a4))

## [0.17.2](https://github.com/hverlin/mise-vscode/compare/v0.17.1...v0.17.2) (2024-11-22)


### Bug Fixes

* Do not run self-update if command is not available ([292aceb](https://github.com/hverlin/mise-vscode/commit/292aceb57ccf572e5fe83b7dfffdbd317dc312d0))
* support python venv ([292aceb](https://github.com/hverlin/mise-vscode/commit/292aceb57ccf572e5fe83b7dfffdbd317dc312d0))

## [0.17.1](https://github.com/hverlin/mise-vscode/compare/v0.17.0...v0.17.1) (2024-11-21)


### Bug Fixes

* add vfox plugin for dart as well ([95a6951](https://github.com/hverlin/mise-vscode/commit/95a69516c7961a8d11fba931f3b5262951e946f6))

## [0.17.0](https://github.com/hverlin/mise-vscode/compare/v0.16.0...v0.17.0) (2024-11-21)


### Features

* add support for Dart-Code.dart-code ([4baa9d2](https://github.com/hverlin/mise-vscode/commit/4baa9d224ef8141d6a6474b82a20269f43ab7711))

## [0.16.0](https://github.com/hverlin/mise-vscode/compare/v0.15.0...v0.16.0) (2024-11-21)


### Features

* add support for pgourlain.erlang ([9379342](https://github.com/hverlin/mise-vscode/commit/9379342964930f6811dac37bc314ae6a061ac078))

## [0.15.0](https://github.com/hverlin/mise-vscode/compare/v0.14.0...v0.15.0) (2024-11-20)


### Features

* Add code completion for `wait_for` ([08a6f66](https://github.com/hverlin/mise-vscode/commit/08a6f66c3af7bdc54c5c5bb4977809b80cd7d203))
* Add support for php and julia ([e23bf9c](https://github.com/hverlin/mise-vscode/commit/e23bf9c63572cad6e6b9717026f8bc721d53639c))
* Check mise version on startup ([b02151c](https://github.com/hverlin/mise-vscode/commit/b02151c898cd596ad6fb11425ec099dd5b5dd424))
* show installed version inline in editor ([7395075](https://github.com/hverlin/mise-vscode/commit/73950751274b4f9341897204335123e5bfd6937e))

## [0.14.0](https://github.com/hverlin/mise-vscode/compare/v0.13.0...v0.14.0) (2024-11-19)


### Features

* improve notification message when configuring several tools ([0c10571](https://github.com/hverlin/mise-vscode/commit/0c10571cf89477ad8727005e25c134545bb14925))


### Bug Fixes

* fix code lens in mise.*.toml files ([5bbc678](https://github.com/hverlin/mise-vscode/commit/5bbc678c028483a53d5c1a8f4316fa9e6bd6fd4b))

## [0.13.0](https://github.com/hverlin/mise-vscode/compare/v0.12.0...v0.13.0) (2024-11-18)


### Features

* Add cmd/ctrl+click support for filenames in `includes = [...]` ([03c4509](https://github.com/hverlin/mise-vscode/commit/03c4509ba577f98b7acc453d29e23822c4957c43))
* Add icon in tool list. Suggest adding a task if no mise.toml file exists ([5fcb5f9](https://github.com/hverlin/mise-vscode/commit/5fcb5f9099a97941803c9bef0bae72052d24e4fd))
* Add mise settings view ([4f85e2a](https://github.com/hverlin/mise-vscode/commit/4f85e2aed907b11fc441ef90f38ae8df59f09282))

## [0.12.0](https://github.com/hverlin/mise-vscode/compare/v0.11.0...v0.12.0) (2024-11-17)


### Features

* Add ignore list to prevent some extensions to be automatically configured ([03647fb](https://github.com/hverlin/mise-vscode/commit/03647fb99cc40b5eaeeae2f69c6d81589ca6508a))
* add open file action ([02e05cb](https://github.com/hverlin/mise-vscode/commit/02e05cb73b087ddb4e308543dc455626b3b28471))
* Improve file watcher ([02e05cb](https://github.com/hverlin/mise-vscode/commit/02e05cb73b087ddb4e308543dc455626b3b28471))
* Show outdated tools in tools view. Allow removing tools ([07f2212](https://github.com/hverlin/mise-vscode/commit/07f2212675a9a2ee0c90b4b6fd7556dfff4b32f6))
* Support mise set command ([7fe8cd6](https://github.com/hverlin/mise-vscode/commit/7fe8cd66b15036beed8c1ef3ec2758b02e4edfc8))

## [0.11.0](https://github.com/hverlin/mise-vscode/compare/v0.10.0...v0.11.0) (2024-11-17)


### Features

* add autocompletion for depends ([6d0ecfa](https://github.com/hverlin/mise-vscode/commit/6d0ecfa44a0712df24ff66a5873dc1067be406f3))
* add automatic toml schemas validation ([602cc7c](https://github.com/hverlin/mise-vscode/commit/602cc7c0770d068d337019405e2b4c75d13a4a01))
* Use registry to list available tools to install ([4d483e0](https://github.com/hverlin/mise-vscode/commit/4d483e09efacbcde09e6a781cbc868862b84ac68))


### Bug Fixes

* Improve code-lens file task detection ([de7d40f](https://github.com/hverlin/mise-vscode/commit/de7d40fc3d1859f0e12cf899b9f102c65080a8d6))
* Improve code-lens task detection ([ce2348e](https://github.com/hverlin/mise-vscode/commit/ce2348eec461a293426786a5a3f57cb372d04039))

## [0.10.0](https://github.com/hverlin/mise-vscode/compare/v0.9.1...v0.10.0) (2024-11-16)


### Features

* Add view to list all tools ([b4433cb](https://github.com/hverlin/mise-vscode/commit/b4433cb1895f1d21a7f8c99c4c2e8a7585a6509c))

## [0.9.1](https://github.com/hverlin/mise-vscode/compare/v0.9.0...v0.9.1) (2024-11-16)


### Bug Fixes

* Fix path for symlinked tools in `.vscode` ([816a2a3](https://github.com/hverlin/mise-vscode/commit/816a2a3dd415d8da757526e046072a1634e0de14))

## [0.9.0](https://github.com/hverlin/mise-vscode/compare/v0.8.0...v0.9.0) (2024-11-16)


### Features

* Add an option to symlinks tools to `.vscode/mise-tools` ([b8dd1c7](https://github.com/hverlin/mise-vscode/commit/b8dd1c70def37cbd8bf58deee57017d789671cac))
* allow disabling mise extension for a workspace ([4ac18b6](https://github.com/hverlin/mise-vscode/commit/4ac18b6e2680b5a3e418045faf5bf1510a1e684a))

## [0.8.0](https://github.com/hverlin/mise-vscode/compare/v0.7.0...v0.8.0) (2024-11-14)


### Features

* Add a notification if some tools are not installed ([71d6d81](https://github.com/hverlin/mise-vscode/commit/71d6d8174a9c0fe1c2ddf72f8ee42eec3d29b6e4))
* Add a notification to install watchexec ([a737e9d](https://github.com/hverlin/mise-vscode/commit/a737e9de1bafa0956454dae39f6d1e500ac59872))

## [0.7.0](https://github.com/hverlin/mise-vscode/compare/v0.6.0...v0.7.0) (2024-11-14)


### Features

* Add support for ms-vscode.js-debug ([ae72c82](https://github.com/hverlin/mise-vscode/commit/ae72c8237fe22067f2c6a19ac898bf966897f80b))
* Add support for oracle.oracle-java ([f4f8ec5](https://github.com/hverlin/mise-vscode/commit/f4f8ec59d917b43f55835b2c5dc0d54f55b48c15))
* Add support for timonwong.shellcheck ([93ae149](https://github.com/hverlin/mise-vscode/commit/93ae1497cdaea0c83e0800a96b17bd2d3a8ee667))

## [0.6.0](https://github.com/hverlin/mise-vscode/compare/v0.5.1...v0.6.0) (2024-11-14)


### Features

* add mise command menu ([cb3908a](https://github.com/hverlin/mise-vscode/commit/cb3908a0289bcc347e33a48733c7d564ce0db89c))
* add welcome views if mise is not installed/configured ([1731150](https://github.com/hverlin/mise-vscode/commit/17311502959203b56eede9a064fc3e3eff696d08))
* improve integration with vscode tasks ([f2612d5](https://github.com/hverlin/mise-vscode/commit/f2612d55e48c1d66297aa8ba4cf079a596390d23))

## [0.5.1](https://github.com/hverlin/mise-vscode/compare/v0.5.0...v0.5.1) (2024-11-14)


### Bug Fixes

* auto-save before running a task ([8104fc2](https://github.com/hverlin/mise-vscode/commit/8104fc254f48c8f1cb37c46148073de95e867d4c))
* update description ([caf68aa](https://github.com/hverlin/mise-vscode/commit/caf68aa215a9b3099137f4eb66cd9bb6aa469fdc))

## [0.5.0](https://github.com/hverlin/mise-vscode/compare/v0.4.0...v0.5.0) (2024-11-13)


### Features

* Add code lens for file tasks ([ff9f267](https://github.com/hverlin/mise-vscode/commit/ff9f2679754ec68782f7bf1721db36b135a30d53))
* Add snippets ([68e186a](https://github.com/hverlin/mise-vscode/commit/68e186ae9cb23d71a65926bbd140777e48df4613))

## [0.4.0](https://github.com/hverlin/mise-vscode/compare/v0.3.1...v0.4.0) (2024-11-13)


### Features

* allow adding toml tasks ([1d5eef9](https://github.com/hverlin/mise-vscode/commit/1d5eef97740d6b7478cba1c9ecfe2f0264c457d6))
* allow copying an environment variable name or value ([105dfb0](https://github.com/hverlin/mise-vscode/commit/105dfb05c3ce625c53225668dab30bc2fa8d39bc))

## [0.3.1](https://github.com/hverlin/mise-vscode/compare/v0.3.0...v0.3.1) (2024-11-13)


### Bug Fixes

* fix paths to shims ([4b846a4](https://github.com/hverlin/mise-vscode/commit/4b846a47abf340fa2230427052f638fc8eccbfb6))

## [0.3.0](https://github.com/hverlin/mise-vscode/compare/v0.2.0...v0.3.0) (2024-11-13)


### Features

* automatically configure extensions on startup ([e898dba](https://github.com/hverlin/mise-vscode/commit/e898dba66fde1465f00cdd99d3fac3cf373c8d0c))
* prompt the user if they want to use shims ([af4d41e](https://github.com/hverlin/mise-vscode/commit/af4d41eafae307540570fc842b73ac2102d3b7ad))

## [0.2.0](https://github.com/hverlin/mise-vscode/compare/v0.1.3...v0.2.0) (2024-11-13)


### Features

* add option to configure Deno path automatically ([1c9e79b](https://github.com/hverlin/mise-vscode/commit/1c9e79b6a6491e5dfc23b52e6c1250578aeef744))
* Allow configuring additional extensions (bun, ruff, go) ([22bb692](https://github.com/hverlin/mise-vscode/commit/22bb692f13f2ff51a61536c8f58f7de3a083b938))


### Bug Fixes

* improve error message if mise path is not set ([4e5423f](https://github.com/hverlin/mise-vscode/commit/4e5423f5345faf8c113d66974f4f50e13e632c0a))

## [0.1.3](https://github.com/hverlin/mise-vscode/compare/v0.1.2...v0.1.3) (2024-11-13)


### Bug Fixes

* release fix ([d02b20c](https://github.com/hverlin/mise-vscode/commit/d02b20c01880c77ad392d38c4f41692a16860f09))

## [0.1.2](https://github.com/hverlin/mise-vscode/compare/v0.1.1...v0.1.2) (2024-11-13)


### Bug Fixes

* release fix ([25e998b](https://github.com/hverlin/mise-vscode/commit/25e998be43c3dee3744da5c580438931c0cf730a))

## [0.1.1](https://github.com/hverlin/mise-vscode/compare/v0.1.0...v0.1.1) (2024-11-13)


### Bug Fixes

* release fix ([50c5f62](https://github.com/hverlin/mise-vscode/commit/50c5f622a620089a14eff9e9bb703925702be4e6))

## [0.1.0](https://github.com/hverlin/mise-vscode/compare/v0.0.21...v0.1.0) (2024-11-13)


### Features

* Add CI tests ([4d0b8ce](https://github.com/hverlin/mise-vscode/commit/4d0b8ce557e99a2ef48d0d06b950957aaec794e2))
