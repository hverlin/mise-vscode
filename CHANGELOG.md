# Changelog

## [0.53.0](https://github.com/hverlin/mise-vscode/compare/v0.52.0...v0.53.0) (2025-07-31)


### Features

* Add mise.configureExtensionsAutomaticallyIncludeList setting ([4bc3544](https://github.com/hverlin/mise-vscode/commit/4bc35443c3a3ce6baa8e03504815628057a8e784))


### Bug Fixes

* Fix doc for mise.configureExtensionsAutomaticallyIncludeList setting ([1545dbf](https://github.com/hverlin/mise-vscode/commit/1545dbf51c614ae4f0f6b6c123526030fb44b5c8))

## [0.52.0](https://github.com/hverlin/mise-vscode/compare/v0.51.1...v0.52.0) (2025-07-21)


### Features

* get mise config use `--json` option" ([#118](https://github.com/hverlin/mise-vscode/issues/118)) ([fb4932c](https://github.com/hverlin/mise-vscode/commit/fb4932c468801a0c45f5aecb01cb7d843500459e))
* use mise dr --json to check if mise can self update ([d804507](https://github.com/hverlin/mise-vscode/commit/d804507c3b80b4ac38a5eda2a7893839a93d4aa6))


### Bug Fixes

* ensure tools list is resized correctly when closing terminal ([b40c6cb](https://github.com/hverlin/mise-vscode/commit/b40c6cbbf6050f1de65c2626471ccb43d105c9fd))

## [0.51.1](https://github.com/hverlin/mise-vscode/compare/v0.51.0...v0.51.1) (2025-07-21)


### Bug Fixes

* ziglang extension does not support shims or symlinks ([#131](https://github.com/hverlin/mise-vscode/issues/131)) ([4e0de85](https://github.com/hverlin/mise-vscode/commit/4e0de858b6464b08073fa8f560440f9a19b3676e))

## [0.51.0](https://github.com/hverlin/mise-vscode/compare/v0.50.1...v0.51.0) (2025-07-21)


### Features

* Update open repository action to handle the new backends supported by mise (github, gitlab, http) ([27b166f](https://github.com/hverlin/mise-vscode/commit/27b166f66bcae6575a0e12bfbb1ffaeac4e8d522))

## [0.50.1](https://github.com/hverlin/mise-vscode/compare/v0.50.0...v0.50.1) (2025-07-05)


### Bug Fixes

* Hide update button if `self-update` is not available ([#129](https://github.com/hverlin/mise-vscode/issues/129)) ([af320fe](https://github.com/hverlin/mise-vscode/commit/af320fe3f1144a87de5c25ff0f72cfc396fe3621))

## [0.50.0](https://github.com/hverlin/mise-vscode/compare/v0.49.2...v0.50.0) (2025-05-19)


### Features

* add support for extension 'signageos.signageos-vscode-sops' ([#123](https://github.com/hverlin/mise-vscode/issues/123)) ([0c29a35](https://github.com/hverlin/mise-vscode/commit/0c29a350654a5e438af21844a2120213175a6463))

## [0.49.2](https://github.com/hverlin/mise-vscode/compare/v0.49.1...v0.49.2) (2025-04-24)


### Bug Fixes

* Revert "get mise config use `--json` option" ([#118](https://github.com/hverlin/mise-vscode/issues/118)) ([e7112c8](https://github.com/hverlin/mise-vscode/commit/e7112c8d2379899c13f8929fc0de50f79bafaa6d))

## [0.49.1](https://github.com/hverlin/mise-vscode/compare/v0.49.0...v0.49.1) (2025-04-18)


### Bug Fixes

* improve error message when failing to parse mise configuration ([902162a](https://github.com/hverlin/mise-vscode/commit/902162a9117c22631030c37a1dfe0ba72278d2a9))

## [0.49.0](https://github.com/hverlin/mise-vscode/compare/v0.48.0...v0.49.0) (2025-03-31)


### Features

* add support for Java in Gradle extension ([#114](https://github.com/hverlin/mise-vscode/issues/114)) ([a289576](https://github.com/hverlin/mise-vscode/commit/a289576b2170f9e254705bb816bd9be33716705d))

## [0.48.0](https://github.com/hverlin/mise-vscode/compare/v0.47.9...v0.48.0) (2025-03-30)


### Features

* bump version ([5ab2866](https://github.com/hverlin/mise-vscode/commit/5ab2866f70de40dd56d7aee8ecdbed3ac409cce4))
* Update min_mise_version to v2025.1.5 ([cc277be](https://github.com/hverlin/mise-vscode/commit/cc277bec5911f66f0fcdd73d5b543913a3d6cc14))

## [0.47.9](https://github.com/hverlin/mise-vscode/compare/v0.47.8...v0.47.9) (2025-03-09)


### Bug Fixes

* ruff path type error ([5febcbb](https://github.com/hverlin/mise-vscode/commit/5febcbb9b69cedc45a82c1a0ae0a26c223a0e5d1))

## [0.47.8](https://github.com/hverlin/mise-vscode/compare/v0.47.7...v0.47.8) (2025-03-08)


### Bug Fixes

* **mise:** getSetting use cache ([d0d630b](https://github.com/hverlin/mise-vscode/commit/d0d630b64bfa6e1baae5379521c045e773851251))
* **task:** replace $(pwd) with {{cwd}} ([34c2f2d](https://github.com/hverlin/mise-vscode/commit/34c2f2de99ddf725a7f0d345c658b8f26c4160c6))
* **test:** fix test on windows ([dd89b7b](https://github.com/hverlin/mise-vscode/commit/dd89b7b5808e4e34cd5af4a703d6c44bf9b5c5a5))

## [0.47.7](https://github.com/hverlin/mise-vscode/compare/v0.47.6...v0.47.7) (2025-02-26)


### Bug Fixes

* Use correct paths when configuring some of the supported extensions on Windows ([db66e31](https://github.com/hverlin/mise-vscode/commit/db66e312be0a8c8c636c690eb80dfea8607e99cf))

## [0.47.6](https://github.com/hverlin/mise-vscode/compare/v0.47.5...v0.47.6) (2025-02-20)


### Bug Fixes

* Handle empty output for mise outdated ([fd62c2d](https://github.com/hverlin/mise-vscode/commit/fd62c2d2c3b3f60a84056fd5ad16bb4d408e895f))

## [0.47.5](https://github.com/hverlin/mise-vscode/compare/v0.47.4...v0.47.5) (2025-02-13)


### Bug Fixes

* Do not show an error message if the user does not select a task to run ([86c9787](https://github.com/hverlin/mise-vscode/commit/86c9787f4b828b05aef91d79d636e7f98d09a7bc))

## [0.47.4](https://github.com/hverlin/mise-vscode/compare/v0.47.3...v0.47.4) (2025-01-26)


### Bug Fixes

* useSymLinks does not work with deno ([38f05fe](https://github.com/hverlin/mise-vscode/commit/38f05fe3b74dce1789a171a3330b9c8ecd9f9507))

## [0.47.3](https://github.com/hverlin/mise-vscode/compare/v0.47.2...v0.47.3) (2025-01-26)


### Bug Fixes

* ensure we are on the correct file before displaying gutter icons in the active editor ([3e7b086](https://github.com/hverlin/mise-vscode/commit/3e7b086ca88c2fc4c491323eb9cccb729b3a2144))

## [0.47.2](https://github.com/hverlin/mise-vscode/compare/v0.47.1...v0.47.2) (2025-01-25)


### Bug Fixes

* do not use shims for python.defaultInterpreterPath ([16ef641](https://github.com/hverlin/mise-vscode/commit/16ef6413557ce13fc226b4896439f7dd98123cd2))

## [0.47.1](https://github.com/hverlin/mise-vscode/compare/v0.47.0...v0.47.1) (2025-01-19)


### Bug Fixes

* file watcher should also watch for env sources ([89a443e](https://github.com/hverlin/mise-vscode/commit/89a443ec1ab3b0eaaa1c69a96e1c975e49e7058b))
* update inline tool regex ([13413e9](https://github.com/hverlin/mise-vscode/commit/13413e9e44de30eee17a99e0cebbe1e95c1bbdbd))

## [0.47.0](https://github.com/hverlin/mise-vscode/compare/v0.46.2...v0.47.0) (2025-01-18)


### Features

* Add additional to skip auto-updating mise bin path ([84ed5b7](https://github.com/hverlin/mise-vscode/commit/84ed5b7b5ab8353a345c00326b03c07e58c0f66b))
* Add support for showing mise PATH/doctor ([44350d8](https://github.com/hverlin/mise-vscode/commit/44350d858c11d566ca1360241a090636897a1b56))
* Show run command if no description in task tree ([722f958](https://github.com/hverlin/mise-vscode/commit/722f9584c0e82412f1af852cb56801312ac9e735))

## [0.46.2](https://github.com/hverlin/mise-vscode/compare/v0.46.1...v0.46.2) (2025-01-16)


### Bug Fixes

* Do not show undefined if an env value is missing from mise env json output ([a6e3be2](https://github.com/hverlin/mise-vscode/commit/a6e3be25100ff41e6443e24f1fd1cd7acf258379))

## [0.46.1](https://github.com/hverlin/mise-vscode/compare/v0.46.0...v0.46.1) (2025-01-16)


### Bug Fixes

* Remove environment values commands from command palette ([d13945a](https://github.com/hverlin/mise-vscode/commit/d13945a63ff4c7834ef3f3574048a0fdceb3157c))

## [0.46.0](https://github.com/hverlin/mise-vscode/compare/v0.45.3...v0.46.0) (2025-01-16)


### Features

* Add ability to show/hide environment variables ([3ac7141](https://github.com/hverlin/mise-vscode/commit/3ac71413bc75594f5d1014af4a2acb758a4a6d81))

## [0.45.3](https://github.com/hverlin/mise-vscode/compare/v0.45.2...v0.45.3) (2025-01-16)


### Bug Fixes

* check if `mise` is valid binary when on PATH ([b008a9c](https://github.com/hverlin/mise-vscode/commit/b008a9c1a825a6923cebc3017df0a293c4b89b2d))

## [0.45.2](https://github.com/hverlin/mise-vscode/compare/v0.45.1...v0.45.2) (2025-01-16)


### Bug Fixes

* check for `where.exe mise` first ([7db6449](https://github.com/hverlin/mise-vscode/commit/7db6449d2be5dcc5d4ec044d8bbf7ca692347d57))

## [0.45.1](https://github.com/hverlin/mise-vscode/compare/v0.45.0...v0.45.1) (2025-01-15)


### Bug Fixes

* set mise.binPath to `mise` by default ([c382d5a](https://github.com/hverlin/mise-vscode/commit/c382d5a3d4a1b961d23a701079a045bf245da237))

## [0.45.0](https://github.com/hverlin/mise-vscode/compare/v0.44.0...v0.45.0) (2025-01-14)


### Features

* Use a status bar item instead of a notification for missing tools ([e92824e](https://github.com/hverlin/mise-vscode/commit/e92824e78ece2ec156f5391874903515605c0c10))


### Bug Fixes

* ensure top menu actions always show a file picker ([c9ef8ab](https://github.com/hverlin/mise-vscode/commit/c9ef8abe38161f894d1eb87b13bdb91b430addac))

## [0.44.0](https://github.com/hverlin/mise-vscode/compare/v0.43.0...v0.44.0) (2025-01-12)


### Features

* Add task hover provider ([caf058c](https://github.com/hverlin/mise-vscode/commit/caf058cecbab4704d9edab42c520cb519fa3ecf8))

## [0.43.0](https://github.com/hverlin/mise-vscode/compare/v0.42.1...v0.43.0) (2025-01-12)


### Features

* Add task reference provider ([ecac3e4](https://github.com/hverlin/mise-vscode/commit/ecac3e4c4811d842ad667cf3b665dd979b6c14c8))
* implement "go to definition" for task ([2e23343](https://github.com/hverlin/mise-vscode/commit/2e23343ca201adb92a09e9a6749894f8c3971cfd))
* show additional information in task tree tooltip ([8860af0](https://github.com/hverlin/mise-vscode/commit/8860af0f8097f724d0d5a0c6d1bfe9f4d3a7b906))

## [0.42.1](https://github.com/hverlin/mise-vscode/compare/v0.42.0...v0.42.1) (2025-01-09)


### Bug Fixes

* add support additional backends on tool hover ([27c0be5](https://github.com/hverlin/mise-vscode/commit/27c0be5b58d3e9e57c6470b3f39e9bd0a2756f05))
* use tool command ([8ba2207](https://github.com/hverlin/mise-vscode/commit/8ba220785955f694f1722e71396feb11ee49ef97))

## [0.42.0](https://github.com/hverlin/mise-vscode/compare/v0.41.0...v0.42.0) (2025-01-09)


### Features

* Add task dependency viewer ([f2e3d28](https://github.com/hverlin/mise-vscode/commit/f2e3d2830043f99176b1d6589b1bbc57fc0ecae0))

## [0.41.0](https://github.com/hverlin/mise-vscode/compare/v0.40.1...v0.41.0) (2025-01-06)


### Features

* Add tool hover provider to quickly navigate to the tool backend ([0da6ea6](https://github.com/hverlin/mise-vscode/commit/0da6ea658452331c37d45ed54fa75fbd50109acb))


### Bug Fixes

* Add command to open tool repository ([0e63fdc](https://github.com/hverlin/mise-vscode/commit/0e63fdc72c0b3dc0438fa21990634b094b00e188))

## [0.40.1](https://github.com/hverlin/mise-vscode/compare/v0.40.0...v0.40.1) (2024-12-31)


### Bug Fixes

* Improve snippets ([8832e76](https://github.com/hverlin/mise-vscode/commit/8832e76f373e4f0abad26379b228d03f122e5b3a))

## [0.40.0](https://github.com/hverlin/mise-vscode/compare/v0.39.0...v0.40.0) (2024-12-31)


### Features

* Add additional snippets ([3dda6ce](https://github.com/hverlin/mise-vscode/commit/3dda6ce6a2a6bb702296eda9ebe19013d6ffeb4a))

## [0.39.0](https://github.com/hverlin/mise-vscode/compare/v0.38.0...v0.39.0) (2024-12-28)


### Features

* multi-root workspaces: add ability to select folder to use with mise ([f18adb3](https://github.com/hverlin/mise-vscode/commit/f18adb348c09d17492f383137ec2dbe3121c4a01))

## [0.38.0](https://github.com/hverlin/mise-vscode/compare/v0.37.0...v0.38.0) (2024-12-28)


### Features

* Improve status bar tooltip ([2181d17](https://github.com/hverlin/mise-vscode/commit/2181d17f677f9a940a21e198880c0a686c862243))

## [0.37.0](https://github.com/hverlin/mise-vscode/compare/v0.36.0...v0.37.0) (2024-12-28)


### Features

* Add code-lens action to view all mise settings ([62248f1](https://github.com/hverlin/mise-vscode/commit/62248f1feab22a65068824118f78b43ef410ffb6))
* Improve settings editor ([968da8d](https://github.com/hverlin/mise-vscode/commit/968da8dcb174c9ff5536a38b433c4c16324f5531))
* preserve webview state ([1a69efb](https://github.com/hverlin/mise-vscode/commit/1a69efbb16115795dfaf07e6228beb5c1836a247))
* show all settings in settings view if none are modified ([2c284de](https://github.com/hverlin/mise-vscode/commit/2c284decd363bce8e110d866039d2320bb9bf9ff))
* show source in settings view ([e89d529](https://github.com/hverlin/mise-vscode/commit/e89d5292b166d849ab3b1b401f3fd65cd7008453))

## [0.36.0](https://github.com/hverlin/mise-vscode/compare/v0.35.0...v0.36.0) (2024-12-25)


### Features

* Add an icon for outdated tools in the editor gutter ([e1d761d](https://github.com/hverlin/mise-vscode/commit/e1d761d97b2394c46399fec58654a368ddd4f554))

## [0.35.0](https://github.com/hverlin/mise-vscode/compare/v0.34.4...v0.35.0) (2024-12-23)


### Features

* Add autocompletion for tool names and versions ([e742e6f](https://github.com/hverlin/mise-vscode/commit/e742e6faf6824a5f713491790f57a29e80c81345))
* Add mise fmt ([5e9be2e](https://github.com/hverlin/mise-vscode/commit/5e9be2e4b624875e8e6fba185a53fdb176399465))
* Open env variables defined in other files than toml files ([9c2f2ac](https://github.com/hverlin/mise-vscode/commit/9c2f2ace24713bae63281699501156457608015e))

## [0.34.4](https://github.com/hverlin/mise-vscode/compare/v0.34.3...v0.34.4) (2024-12-20)


### Bug Fixes

* Improve error handling. Improve file watcher. ([a9a3ae2](https://github.com/hverlin/mise-vscode/commit/a9a3ae2b5a39bfac48cde5cb98ca0bbedf2f64a3))

## [0.34.3](https://github.com/hverlin/mise-vscode/compare/v0.34.2...v0.34.3) (2024-12-20)


### Bug Fixes

* fix mise use action ([cdc5899](https://github.com/hverlin/mise-vscode/commit/cdc5899a6163a79477e8c5b30cd350f7d4c1631c))

## [0.34.2](https://github.com/hverlin/mise-vscode/compare/v0.34.1...v0.34.2) (2024-12-19)


### Bug Fixes

* rm -&gt; uninstall ([4c95bf1](https://github.com/hverlin/mise-vscode/commit/4c95bf1b42c4d29c5bf76ca8ca5eb2e90b37b1e4))

## [0.34.1](https://github.com/hverlin/mise-vscode/compare/v0.34.0...v0.34.1) (2024-12-18)


### Bug Fixes

* fix expandPath on windows ([8199a18](https://github.com/hverlin/mise-vscode/commit/8199a1893a5d9376ffc9d42b88b4604cd37f3ea4))

## [0.34.0](https://github.com/hverlin/mise-vscode/compare/v0.33.2...v0.34.0) (2024-12-16)


### Features

* check for additional install paths on windows ([45bd1dc](https://github.com/hverlin/mise-vscode/commit/45bd1dc74d1767a1a7e2f2a303ba8d3d0f64dd5f))


### Bug Fixes

* remove duplicated paths on windows when creating a task ([fb4acb9](https://github.com/hverlin/mise-vscode/commit/fb4acb9b1c39b08dd98e53616f12e16c28d2f900))

## [0.33.2](https://github.com/hverlin/mise-vscode/compare/v0.33.1...v0.33.2) (2024-12-15)


### Bug Fixes

* improve path handling on windows ([52e346c](https://github.com/hverlin/mise-vscode/commit/52e346c8f4b3e1ba50e8b35783ca03412f2910ae))
* remove resource scope for settings ([a7d42ab](https://github.com/hverlin/mise-vscode/commit/a7d42abb0c96795c0fb91b22e09c92bbb572b9de))

## [0.33.1](https://github.com/hverlin/mise-vscode/compare/v0.33.0...v0.33.1) (2024-12-14)


### Bug Fixes

* automatically trust mise configuration files when opening a trusted vscode workspace ([591f485](https://github.com/hverlin/mise-vscode/commit/591f485d285118b94a64ac3d91e15604ea0b44bd))
* fix copy bin paths command when there are multiple bins ([4ef1e36](https://github.com/hverlin/mise-vscode/commit/4ef1e36d5e9f207b6c9e103561dc3c329e869deb))

## [0.33.0](https://github.com/hverlin/mise-vscode/compare/v0.32.0...v0.33.0) (2024-12-13)


### Features

* Add syntax highlighting for uv python scripts ([9563fcc](https://github.com/hverlin/mise-vscode/commit/9563fcc4188ed16c998f36740962ae0e7e180c77))

## [0.32.0](https://github.com/hverlin/mise-vscode/compare/v0.31.2...v0.32.0) (2024-12-13)


### Features

* Add syntax highlighting for JS, python, ruby and shell if shebang is present ([4ccd287](https://github.com/hverlin/mise-vscode/commit/4ccd28782d50bc045ff5e29c2ffedd74ef1db5ae))

## [0.31.2](https://github.com/hverlin/mise-vscode/compare/v0.31.1...v0.31.2) (2024-12-13)


### Bug Fixes

* log error if activation fails ([286dd0f](https://github.com/hverlin/mise-vscode/commit/286dd0fcdb62404c335edc686b0a7bc311ec048a))

## [0.31.1](https://github.com/hverlin/mise-vscode/compare/v0.31.0...v0.31.1) (2024-12-11)


### Bug Fixes

* Fix for mise trust with latest release ([a1d6714](https://github.com/hverlin/mise-vscode/commit/a1d671451f0936ee5a1d6d7b3709e8a11d7e8af8))

## [0.31.0](https://github.com/hverlin/mise-vscode/compare/v0.30.0...v0.31.0) (2024-12-11)


### Features

* improve tera autocompletion ([6c4f572](https://github.com/hverlin/mise-vscode/commit/6c4f5720e261175d614ae23ba2cd0a4b0482ccad))
* show task description in sidebar ([afc7e8b](https://github.com/hverlin/mise-vscode/commit/afc7e8b47e747cc9b6b3ea8a7a70190f1410f726))

## [0.30.0](https://github.com/hverlin/mise-vscode/compare/v0.29.1...v0.30.0) (2024-12-09)


### Features

* automatically locate mise binary if installed with scoop ([0878839](https://github.com/hverlin/mise-vscode/commit/0878839a45dc091bb2e00781e37b36f61e9784db))

## [0.29.1](https://github.com/hverlin/mise-vscode/compare/v0.29.0...v0.29.1) (2024-12-09)


### Bug Fixes

* improve windows support ([d3b6e62](https://github.com/hverlin/mise-vscode/commit/d3b6e6295aa081b13825fac202b93a7af5d7a30d))

## [0.29.0](https://github.com/hverlin/mise-vscode/compare/v0.28.1...v0.29.0) (2024-12-09)


### Features

* Add flutter support ([4d91437](https://github.com/hverlin/mise-vscode/commit/4d91437a2dc8943cd94c9d3025b35aece70b8ff6))


### Bug Fixes

* Add experimental support for auto-completion in mise templates ([e31762e](https://github.com/hverlin/mise-vscode/commit/e31762e9f17283c8a6e27155d48bf537d1def998))

## [0.28.1](https://github.com/hverlin/mise-vscode/compare/v0.28.0...v0.28.1) (2024-12-07)


### Bug Fixes

* Only show code-lens in files detected by `mise` in current project ([6d05d56](https://github.com/hverlin/mise-vscode/commit/6d05d560da35b2ef3eb021d2c65ec64a827294d7))

## [0.28.0](https://github.com/hverlin/mise-vscode/compare/v0.27.0...v0.28.0) (2024-12-07)


### Features

* Add zig support ([f036579](https://github.com/hverlin/mise-vscode/commit/f036579a92cbe4c30d5be7567f3331f556275f38))


### Bug Fixes

* Remove some mise version update warnings ([952e730](https://github.com/hverlin/mise-vscode/commit/952e7309117046d47eddc877e9c35efc85a1b064))

## [0.27.0](https://github.com/hverlin/mise-vscode/compare/v0.26.0...v0.27.0) (2024-12-07)


### Features

* Add syntax highlighting for tera template ([9ba6852](https://github.com/hverlin/mise-vscode/commit/9ba68524464bf4de05e050735005ad70d113d809))
* Indicate that the extension depends on tamasfe.even-better-toml ([c67f70e](https://github.com/hverlin/mise-vscode/commit/c67f70e3eae6984536b422b50d3ce2234a5595ae))

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
