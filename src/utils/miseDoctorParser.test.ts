// @ts-ignore
import { describe, expect, test } from "bun:test";
import { type MiseConfig, parseMiseConfig } from "./miseDoctorParser";

describe("mise doctor parser", () => {
	test("should parse dirs section correctly", () => {
		const input = `version: 2024.11.8
dirs:
  data: /dev/home/.local/share/mise
  config: /dev/home/.config/mise
  cache: /dev/home/Library/Caches/mise
  state: /dev/home/.local/state/mise
  shims: /dev/home/.local/share/mise/shims

shell:
  /bin/zsh`;

		const expected: MiseConfig = {
			dirs: {
				data: "/dev/home/.local/share/mise",
				config: "/dev/home/.config/mise",
				cache: "/dev/home/Library/Caches/mise",
				state: "/dev/home/.local/state/mise",
				shims: "/dev/home/.local/share/mise/shims",
			},
		};

		const result = parseMiseConfig(input);
		expect(result.dirs).toEqual(expected.dirs);
	});

	test("should handle empty dirs section", () => {
		const input = `version: 2024.11.8
dirs:

shell:
  /bin/zsh`;

		const expected: MiseConfig = { dirs: { shims: "" } };
		const result = parseMiseConfig(input);
		expect(result.dirs).toEqual(expected.dirs);
	});

	test("should handle missing dirs section", () => {
		const input = `version: 2024.11.8
shell:
  /bin/zsh`;

		const expected: MiseConfig = { dirs: { shims: "" } };

		const result = parseMiseConfig(input);
		expect(result.dirs).toEqual(expected.dirs);
	});

	test("should handle different indentation levels", () => {
		const input = `version: 2024.11.8
dirs:
    data: /dev/home/.local/share/mise
        config: /dev/home/.config/mise
  cache: /dev/home/Library/Caches/mise
 state: /dev/home/.local/state/mise
   shims: /dev/home/.local/share/mise/shims`;

		const expected: MiseConfig = {
			dirs: {
				data: "/dev/home/.local/share/mise",
				config: "/dev/home/.config/mise",
				cache: "/dev/home/Library/Caches/mise",
				state: "/dev/home/.local/state/mise",
				shims: "/dev/home/.local/share/mise/shims",
			},
		};

		const result = parseMiseConfig(input);
		expect(result.dirs).toEqual(expected.dirs);
	});

	test("should handle malformed lines in dirs section", () => {
		const input = `dirs:
  data: /dev/home/.local/share/mise
  invalid line
  : missing key
  missing_value:
  config: /dev/home/.config/mise`;

		const expected: MiseConfig = {
			dirs: {
				data: "/dev/home/.local/share/mise",
				config: "/dev/home/.config/mise",
				shims: "",
			},
		};

		const result = parseMiseConfig(input);
		expect(result.dirs).toEqual(expected.dirs);
	});

	test("should handle real-world mise output", () => {
		const input = `version: 2024.11.8 macos-arm64 (d5dde8f 2024-11-12)
activated: yes
shims_on_path: no

build_info:
  Target: aarch64-apple-darwin
  Features: DEFAULT, NATIVE_TLS, OPENSSL

dirs:
  data: /dev/home/.local/share/mise
  config: /dev/home/.config/mise
  cache: /dev/home/Library/Caches/mise
  state: /dev/home/.local/state/mise
  shims: /dev/home/.local/share/mise/shims

config_files:
  /dev/home/.config/mise/config.toml
  /dev/home/Projects/mise-vscode/mise.toml`;

		const expected: MiseConfig = {
			dirs: {
				data: "/dev/home/.local/share/mise",
				config: "/dev/home/.config/mise",
				cache: "/dev/home/Library/Caches/mise",
				state: "/dev/home/.local/state/mise",
				shims: "/dev/home/.local/share/mise/shims",
			},
		};

		const result = parseMiseConfig(input);
		expect(result.dirs).toEqual(expected.dirs);
	});

	test("should parse mise version correctly", () => {
		const input = `
  [ruby]
  default_packages_file = "~/.default-gems"
  ruby_build_repo = "https://github.com/rbenv/ruby-build.git"
  ruby_install = false
  ruby_install_repo = "https://github.com/postmodern/ruby-install.git"

  [status]
  missing_tools = "if_other_versions_installed"
  show_env = false
  show_tools = false
No warnings found
1 problem found:

1. new mise version 2024.11.19 available, currently on 2024.11.18
`;

		const expected: MiseConfig = {
			dirs: { shims: "" },
			problems: {
				newMiseVersionAvailable: {
					currentVersion: "2024.11.18",
					latestVersion: "2024.11.19",
				},
			},
		};

		const result = parseMiseConfig(input);
		expect(result.problems).toEqual(expected.problems);
	});
});
