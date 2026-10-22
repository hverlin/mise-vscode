// The demo project the screenshots show, written under the temporary folder.
// Keep it neutral: no real project, path or name.

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

/** contents, by path relative to the temporary folder */
export const files = {
	"home/.config/mise/config.toml": '[tools]\njq = "1"\n',
	"home/my-project/mise.toml": miseToml,
	"home/my-project/.env": "API_URL=http://localhost:3000\n",
	"home/my-project/mise-tasks/release": `#!/usr/bin/env bash
#MISE description="Publish a new release"
#USAGE arg "<version>" help="Version to release"

npm version "$usage_version"
`,
	"home/my-project/package.json": `${JSON.stringify(
		{
			name: "my-project",
			private: true,
			scripts: { build: "tsc", test: "node --test" },
			dependencies: { express: "^5.1.0" },
		},
		null,
		2,
	)}\n`,
};

/** line number of the first line of mise.toml that starts with `text` */
export const lineOf = (text) => {
	const index = miseToml.split("\n").findIndex((line) => line.startsWith(text));
	if (index === -1) {
		throw new Error(`no line starts with ${text} in mise.toml`);
	}
	return index + 1;
};
