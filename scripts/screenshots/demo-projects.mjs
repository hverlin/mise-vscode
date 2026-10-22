// The demo projects the screenshots and videos show, written in the home of
// the temporary folder. Keep them neutral: no real project, path or name.

export const miseToml = `[tools]
node = "24"
python = "3.13"

[env]
_.file = ".env"
NODE_ENV = "development"
PROJECT_NAME = "{{ config_root | basename }}"
BIN_PATH = "{{ config_root }}/node_modules/.bin"

[tasks.build]
description = "Build the app"
run = "npm run build"

[tasks.test]
description = "Run the tests"
depends = ["build"]
usage = 'arg "[file]" help="Test file to run"'
run = 'npm test -- \${usage_file:-}'

[tasks.lint]
description = "Lint the code"
run = "npx eslint ."

[tasks.ci]
description = "Lint, build and test"
depends = ["lint", "test"]

[tasks.deploy]
description = "Deploy the app"
depends = ["ci"]
run = "./scripts/deploy.sh {{ env.NODE_ENV }}"

[tasks.hello]
description = "A Node.js task"
run = '''
#!/usr/bin/env node
const name = process.env.PROJECT_NAME;
console.log(\`Hello from \${name}, Node.js \${process.version}\`);
'''

[tasks.stats]
description = "A Python task"
run = '''
#!/usr/bin/env python
import json, pathlib

pkg = json.loads(pathlib.Path("package.json").read_text())
print(f"{pkg['name']}: {len(pkg['dependencies'])} dependencies")
'''

[settings]
experimental = true
`;

/** files of the home, by path relative to it */
export const homeFiles = {
	".config/mise/config.toml": '[tools]\njq = "1"\n',
	// the prompt of the terminals: the one of macOS shows the user and host
	// names
	".zshrc": "PROMPT='%1~ %# '\n",
	// nor the startup files of macOS, which put the PATH of the machine first
	".zshenv": "unsetopt GLOBAL_RCS\n",
};

const lockedToml = (tools) => `[settings]
lockfile = true

[tools]
${tools.join("\n")}
`;

/**
 * the projects, in the home: their files, by path relative to the project,
 * how to set them up once written, with `mise` and `write` (a file), and to
 * tear them down once VS Code is closed
 */
export const projects = {
	"my-project": {
		files: {
			"mise.toml": miseToml,
			".env": "API_URL=http://localhost:3000\n",
			"mise-tasks/release": `#!/usr/bin/env bash
#MISE description="Publish a new release"
#USAGE arg "<version>" help="Version to release"

npm version "$usage_version"
`,
			"package.json": `${JSON.stringify(
				{
					name: "my-project",
					private: true,
					scripts: { build: "tsc", test: "node --test" },
					dependencies: { express: "^5.1.0" },
				},
				null,
				2,
			)}\n`,
		},
		// python is left missing on purpose, to show the missing tools, and jq
		// outdated, to show its update
		setup: (mise) => mise("install", "node", "jq@1.7.1"),
	},

	"web-app": {
		files: {
			"mise.toml": `[settings]
experimental = true

[tools]
node = "24"
pitchfork = "2.31.0"

[daemons.api]
run = "exec node server.js api 4517"
port = 4517
ready_port = 4517

[daemons.web]
run = "exec node server.js web 4518"
port = 4518
ready_port = 4518
depends = ["api"]
`,
			// on localhost only: macOS may ask to accept connections otherwise
			"server.js": `const http = require("node:http");

const [name, port] = process.argv.slice(2);
http
	.createServer((request, response) => {
		console.log(\`\${name}: \${request.method} \${request.url}\`);
		response.end(\`Hello from \${name}\\n\`);
	})
	.listen(Number(port), "127.0.0.1", () =>
		console.log(\`\${name} listening on http://localhost:\${port}\`),
	);
`,
		},
		setup: (mise) => mise("install"),
		// the daemons and the supervisor would outlive the folder
		teardown: (mise) => mise("x", "--", "pitchfork", "supervisor", "stop"),
	},

	"locked-app": {
		files: { "mise.toml": lockedToml(['node = "24"']) },
		setup(mise, write) {
			mise("install", "node", "jq@1.7.1");
			mise("lock");
			// added after the lock, which is then out of sync
			write("mise.toml", lockedToml(['node = "24"', 'jq = "1.7.1"']));
		},
	},

	monorepo: {
		files: {
			"mise.toml": `monorepo_root = true

[monorepo]
config_roots = ["packages/*"]

[settings]
experimental = true

[tools]
node = "24"

[tasks.build-all]
description = "Build every package"
depends = ["//packages/...:build"]
`,
			"packages/api/mise.toml": `[tasks.build]
description = "Build the API"
run = "echo 'Building the API'"

[tasks.dev]
description = "Start the API"
run = "echo 'Starting the API'"
`,
			"packages/web/mise.toml": `[tasks.build]
description = "Build the web app"
depends = ["//packages/api:build"]
run = "echo 'Building the web app'"

[tasks.dev]
description = "Start the web app"
run = "echo 'Starting the web app'"
`,
		},
		setup: (mise) => mise("install"),
	},
};

/** line number of the first line of mise.toml that starts with `text` */
export const lineOf = (text) => {
	const index = miseToml.split("\n").findIndex((line) => line.startsWith(text));
	if (index === -1) {
		throw new Error(`no line starts with ${text} in mise.toml`);
	}
	return index + 1;
};
