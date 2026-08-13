const { defineConfig } = require("@vscode/test-cli");
const fs = require("node:fs");
const path = require("node:path");
const fixturesPath = path.join(__dirname, "src/e2e-tests/fixtures/");

// The multi-root suites write workspace-level settings, which land in the
// .code-workspace file itself. Those writes are part of what is under test and
// cannot always be cleaned reliably, so the suite runs against a throwaway
// gitignored copy of the committed workspace file, refreshed on every run.
const multiRootWorkspaceFile = path.join(
	fixturesPath,
	"multi-root-workspace",
	"multi-root.generated.code-workspace",
);
fs.copyFileSync(
	path.join(fixturesPath, "multi-root-workspace", "multi-root.code-workspace"),
	multiRootWorkspaceFile,
);

// MISE_CEILING_PATHS stops mise from traversing above the fixtures directory,
// so the workspaces under test never inherit this repository's own mise config.
// Ceiling paths are exclusive: configs at the workspace root are still loaded.
// MISE_LOCKED=0 overrides the CI-wide locked mode: the fixtures have no
// lockfile, and locked mode would refuse to resolve their tools.
module.exports = defineConfig([
	{
		label: "default",
		files: "src/e2e-tests/*.e2e.ts",
		workspaceFolder: path.join(fixturesPath, "task-execution-workspace"),
		env: {
			MISE_CEILING_PATHS: fixturesPath,
			MISE_LOCKED: "0",
		},
		installExtensions: ["tombi-toml.tombi"],
		mocha: {
			require: ["tsx/cjs"],
			timeout: 60_000,
		},
	},
	{
		label: "tool-versions",
		files: "src/e2e-tests/tool-versions/*.e2e.ts",
		workspaceFolder: path.join(fixturesPath, "tool-versions-workspace"),
		env: {
			MISE_CEILING_PATHS: fixturesPath,
			MISE_LOCKED: "0",
			// Pre-trust the fixture .tool-versions so tool resolution never
			// blocks on the trust dialog in CI.
			MISE_TRUSTED_CONFIG_PATHS: fixturesPath,
		},
		mocha: {
			require: ["tsx/cjs"],
			timeout: 60_000,
		},
	},
	{
		label: "bootstrap",
		files: "src/e2e-tests/bootstrap/*.e2e.ts",
		workspaceFolder: path.join(fixturesPath, "bootstrap-workspace"),
		env: {
			MISE_CEILING_PATHS: fixturesPath,
			MISE_LOCKED: "0",
			MISE_TRUSTED_CONFIG_PATHS: fixturesPath,
			// Keep the machine's real global config (tools, bootstrap sections)
			// out of the tests so results match between dev machines and CI.
			MISE_GLOBAL_CONFIG_FILE: path.join(
				fixturesPath,
				"bootstrap-workspace",
				"global-config.toml",
			),
		},
		mocha: {
			require: ["tsx/cjs"],
			timeout: 60_000,
		},
	},
	{
		label: "broken-config",
		files: "src/e2e-tests/broken-config/*.e2e.ts",
		workspaceFolder: path.join(fixturesPath, "broken-config-workspace"),
		env: {
			MISE_CEILING_PATHS: fixturesPath,
			MISE_LOCKED: "0",
			MISE_TRUSTED_CONFIG_PATHS: fixturesPath,
			MISE_GLOBAL_CONFIG_FILE: path.join(
				fixturesPath,
				"broken-config-workspace",
				"global-config.toml",
			),
		},
		mocha: {
			require: ["tsx/cjs"],
			timeout: 60_000,
		},
	},
	{
		label: "command-injection",
		files: "src/e2e-tests/command-injection/*.e2e.ts",
		workspaceFolder: path.join(fixturesPath, "command-injection-workspace"),
		env: {
			MISE_CEILING_PATHS: fixturesPath,
			MISE_LOCKED: "0",
			MISE_TRUSTED_CONFIG_PATHS: fixturesPath,
		},
		mocha: {
			require: ["tsx/cjs"],
			timeout: 60_000,
		},
	},
	{
		label: "projects",
		files: "src/e2e-tests/projects/*.e2e.ts",
		workspaceFolder: path.join(fixturesPath, "projects-workspace"),
		env: {
			MISE_CEILING_PATHS: fixturesPath,
			MISE_LOCKED: "0",
			MISE_TRUSTED_CONFIG_PATHS: fixturesPath,
			// Keep the machine's own tracked configs and global config out of the
			// projects view so results match between dev machines and CI.
			MISE_STATE_DIR: path.join(fixturesPath, "projects-workspace", ".state"),
			MISE_GLOBAL_CONFIG_FILE: path.join(
				fixturesPath,
				"projects-workspace",
				"global-config.toml",
			),
		},
		mocha: {
			require: ["tsx/cjs"],
			timeout: 60_000,
		},
	},
	{
		label: "custom-extensions",
		files: "src/e2e-tests/custom-extensions/*.e2e.ts",
		workspaceFolder: path.join(fixturesPath, "custom-extensions-workspace"),
		env: {
			MISE_CEILING_PATHS: fixturesPath,
			MISE_LOCKED: "0",
			MISE_TRUSTED_CONFIG_PATHS: fixturesPath,
			// Keep the machine's real global config out of the tests, and keep the
			// tools installed by the suite out of the machine's mise data dir.
			MISE_GLOBAL_CONFIG_FILE: path.join(
				fixturesPath,
				"custom-extensions-workspace",
				"global-config.toml",
			),
			MISE_DATA_DIR: path.join(
				fixturesPath,
				"custom-extensions-workspace",
				".mise-data",
			),
			MISE_CACHE_DIR: path.join(
				fixturesPath,
				"custom-extensions-workspace",
				".mise-cache",
			),
		},
		// foxundermoon.shell-format is the target extension under test: its
		// `shellformat.path` setting is window-scoped, so the extension is
		// allowed to write it to the workspace settings.
		installExtensions: ["foxundermoon.shell-format"],
		mocha: {
			require: ["tsx/cjs"],
			timeout: 120_000,
		},
	},
	{
		label: "task-cache",
		files: "src/e2e-tests/task-cache/*.e2e.ts",
		workspaceFolder: path.join(fixturesPath, "task-cache-workspace"),
		env: {
			MISE_CEILING_PATHS: fixturesPath,
			MISE_LOCKED: "0",
			MISE_TRUSTED_CONFIG_PATHS: fixturesPath,
			// keep the task artifact cache and the source freshness state of the
			// suite inside the fixture, out of the machine's own mise directories
			MISE_CACHE_DIR: path.join(
				fixturesPath,
				"task-cache-workspace",
				".mise-cache",
			),
			MISE_STATE_DIR: path.join(
				fixturesPath,
				"task-cache-workspace",
				".mise-state",
			),
		},
		mocha: {
			require: ["tsx/cjs"],
			timeout: 60_000,
		},
	},
	{
		label: "multi-root",
		files: "src/e2e-tests/multi-root/*.e2e.ts",
		// a `.code-workspace` file, so vscode opens a multi-root workspace whose
		// folders are subdirectories of the directory holding the file
		workspaceFolder: multiRootWorkspaceFile,
		env: {
			MISE_CEILING_PATHS: fixturesPath,
			MISE_LOCKED: "0",
			MISE_TRUSTED_CONFIG_PATHS: fixturesPath,
			MISE_GLOBAL_CONFIG_FILE: path.join(
				fixturesPath,
				"multi-root-workspace",
				"global-config.toml",
			),
			// the go toolchains the suite installs stay inside the fixture
			MISE_DATA_DIR: path.join(
				fixturesPath,
				"multi-root-workspace",
				".mise-data",
			),
			MISE_CACHE_DIR: path.join(
				fixturesPath,
				"multi-root-workspace",
				".mise-cache",
			),
		},
		// golang.go is the extension under test: mise writes `go.goroot` and
		// `go.alternateTools` for it. shell-format has a window-scoped setting
		// (`shellformat.path`), which folder-scoped configuration cannot hold.
		installExtensions: ["golang.go", "foxundermoon.shell-format"],
		mocha: {
			require: ["tsx/cjs"],
			// the go suite installs two toolchains
			timeout: 600_000,
		},
	},
	{
		label: "go",
		files: "src/e2e-tests/go/*.e2e.ts",
		workspaceFolder: path.join(fixturesPath, "go-workspace"),
		env: {
			MISE_CEILING_PATHS: fixturesPath,
			MISE_LOCKED: "0",
			MISE_TRUSTED_CONFIG_PATHS: fixturesPath,
			MISE_GLOBAL_CONFIG_FILE: path.join(
				fixturesPath,
				"go-workspace",
				"global-config.toml",
			),
			// shares the toolchain store of the multi-root fixture, so each go
			// version is downloaded once per CI run
			MISE_DATA_DIR: path.join(
				fixturesPath,
				"multi-root-workspace",
				".mise-data",
			),
			MISE_CACHE_DIR: path.join(
				fixturesPath,
				"multi-root-workspace",
				".mise-cache",
			),
			// keep the build cache in the fixture, and never let go swap in
			// another toolchain than the one mise resolves
			GOCACHE: path.join(fixturesPath, "go-workspace", ".gocache"),
			GOTOOLCHAIN: "local",
		},
		installExtensions: ["golang.go"],
		mocha: {
			require: ["tsx/cjs"],
			// installs a toolchain and compiles the go stdlib on a cold cache
			timeout: 600_000,
		},
	},
	{
		label: "monorepo",
		files: "src/e2e-tests/monorepo/*.e2e.ts",
		workspaceFolder: path.join(fixturesPath, "monorepo-workspace"),
		env: {
			MISE_CEILING_PATHS: fixturesPath,
			MISE_LOCKED: "0",
			// Pre-trust the fixture configs (including subproject configs) so the
			// extension never blocks on the trust dialog in CI.
			MISE_TRUSTED_CONFIG_PATHS: fixturesPath,
		},
		mocha: {
			require: ["tsx/cjs"],
			timeout: 60_000,
		},
	},
]);
