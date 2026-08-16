// The Pkl extension is not published on the VS Code marketplace: Apple ships
// it as a `.vsix` on GitHub releases
// (https://pkl-lang.org/vscode/current/installation.html). The sdk-extensions
// e2e suite configures the real extension, so the file is fetched here and
// .vscode-test.js installs whatever `.vsix` it finds in the download folder.
import { existsSync } from "node:fs";
import { mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const VERSION = "0.23.0";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const vsixDir = path.join(root, ".vscode-test", "vsix");
const vsixPath = path.join(vsixDir, `pkl-vscode-${VERSION}.vsix`);

if (existsSync(vsixPath)) {
	console.log(`Pkl extension already downloaded: ${vsixPath}`);
	process.exit(0);
}

const url = `https://github.com/apple/pkl-vscode/releases/download/${VERSION}/pkl-vscode-${VERSION}.vsix`;
const response = await fetch(url);
if (!response.ok) {
	throw new Error(
		`Failed to download ${url}: ${response.status} ${response.statusText}`,
	);
}
const vsix = Buffer.from(await response.arrayBuffer());

await mkdir(vsixDir, { recursive: true });
// drop any other version, so exactly one vsix is installed
for (const entry of await readdir(vsixDir)) {
	if (entry.endsWith(".vsix")) {
		await rm(path.join(vsixDir, entry));
	}
}
// write then rename, so an interrupted run cannot leave a truncated vsix that
// later runs would skip re-downloading and fail to install
const downloadPath = `${vsixPath}.download`;
await writeFile(downloadPath, vsix);
await rename(downloadPath, vsixPath);
console.log(`Downloaded ${url} to ${vsixPath}`);
