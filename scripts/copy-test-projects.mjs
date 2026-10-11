// Copies the e2e fixture projects to /tmp/mise-vs-code-tests, to try the
// extension on them by hand. Opened in place, a fixture also picks up the
// mise.toml of this repository, since mise reads the config files of every
// parent directory.
//
// Usage: node scripts/copy-test-projects.mjs [--list] [--print-paths] [fixture...]
// Without fixtures, every fixture is copied. Set MISE_VSCODE_TEST_PROJECTS to
// copy them somewhere else.
//   --list         print the fixture names, for completion, and copy nothing
//   --print-paths  print only what to open in vscode for each copied fixture
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import {
	cp,
	lstat,
	mkdir,
	readdir,
	readlink,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixturesDir = path.join("src", "e2e-tests", "fixtures");
const destination =
	process.env.MISE_VSCODE_TEST_PROJECTS ?? "/tmp/mise-vs-code-tests";

// marks the folder as created by this script, so that a later run may replace
// its content without risking to delete anything else
const marker = path.join(destination, ".mise-vscode-test-projects");

const fixtures = (
	await readdir(path.join(root, fixturesDir), { withFileTypes: true })
)
	.filter((entry) => entry.isDirectory())
	.map((entry) => entry.name);

const projectNames = fixtures.map((name) => name.replace(/-workspace$/, ""));

const args = process.argv.slice(2);
const printPaths = args.includes("--print-paths");

if (args.includes("--list")) {
	console.log(projectNames.join("\n"));
	process.exit(0);
}

/** `monorepo` and `monorepo-workspace` both name the monorepo-workspace fixture */
const toFixture = (name) =>
	fixtures.includes(name) ? name : `${name}-workspace`;

const names = args.filter((arg) => !arg.startsWith("--"));
const unknown = names.filter((name) => !fixtures.includes(toFixture(name)));
if (unknown.length) {
	console.error(`Unknown test projects: ${unknown.join(", ")}`);
	console.error(`Available: ${projectNames.join(", ")}`);
	process.exit(1);
}
const selected = names.length ? names.map(toFixture) : fixtures;

if (existsSync(destination) && !existsSync(marker)) {
	console.error(
		`${destination} exists and was not created by this script, not touching it`,
	);
	process.exit(1);
}
await mkdir(destination, { recursive: true });
await writeFile(marker, "");

// the files git knows about only: the e2e tests install tools into some
// fixtures (gigabytes), and generate files for each run
const files = execFileSync(
	"git",
	[
		"ls-files",
		"--cached",
		"--others",
		"--exclude-standard",
		"-z",
		"--",
		fixturesDir,
	],
	{ cwd: root, encoding: "utf8" },
)
	.split("\0")
	.filter(Boolean);

for (const fixture of selected) {
	const target = path.join(destination, fixture);
	await rm(target, { recursive: true, force: true });

	const fixtureRoot = path.join(root, fixturesDir, fixture);
	const prefix = path.join(fixturesDir, fixture) + path.sep;
	for (const file of files.filter((file) => file.startsWith(prefix))) {
		const source = path.join(root, file);
		const copy = path.join(target, file.slice(prefix.length));
		await mkdir(path.dirname(copy), { recursive: true });

		const stats = await lstat(source).catch(() => undefined);
		// tracked, but deleted in the working tree
		if (!stats) {
			continue;
		}

		if (stats.isSymbolicLink()) {
			// a link into the fixture points into the copy instead
			const link = await readlink(source);
			await symlink(
				link.startsWith(fixtureRoot + path.sep)
					? path.join(target, path.relative(fixtureRoot, link))
					: link,
				copy,
			);
			continue;
		}

		// keeps the executable bit of file tasks
		await cp(source, copy);
	}
}

/** the folder, or the `.code-workspace` file of a multi-root fixture */
const pathToOpen = async (fixture) => {
	const target = path.join(destination, fixture);
	const workspaceFile = (await readdir(target)).find((name) =>
		name.endsWith(".code-workspace"),
	);
	return workspaceFile ? path.join(target, workspaceFile) : target;
};

if (printPaths) {
	for (const fixture of selected) {
		console.log(await pathToOpen(fixture));
	}
	process.exit(0);
}

console.log(`Copied ${selected.length} test projects to ${destination}:\n`);
for (const fixture of selected) {
	console.log(`  mise dev ${fixture.replace(/-workspace$/, "")}`);
}
console.log(
	"\nThe copies are not trusted by mise yet: the extension trusts them when it opens them, unless mise.automaticallyTrustMiseConfigFiles is off. Your global mise config still applies.",
);
