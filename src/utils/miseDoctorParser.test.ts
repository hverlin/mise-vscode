// @ts-ignore
import { describe, expect, test } from "bun:test";
import { type MiseConfig, parseMiseConfig } from "./miseDoctorParser";

describe("mise-parser", () => {
	test("should parse dirs section correctly", () => {
		const input = `version: 2024.11.8
dirs:
  data: ~/.local/share/mise
  config: ~/.config/mise
  cache: ~/Library/Caches/mise
  state: ~/.local/state/mise
  shims: ~/.local/share/mise/shims

shell:
  /bin/zsh`;

		const expected: MiseConfig = {
			dirs: {
				data: "~/.local/share/mise",
				config: "~/.config/mise",
				cache: "~/Library/Caches/mise",
				state: "~/.local/state/mise",
				shims: "~/.local/share/mise/shims",
			},
		};

		const result = parseMiseConfig(input);
		expect(result).toEqual(expected);
	});

	test("should handle empty dirs section", () => {
		const input = `version: 2024.11.8
dirs:

shell:
  /bin/zsh`;

		const expected: MiseConfig = { dirs: { shims: "" } };
		const result = parseMiseConfig(input);
		expect(result).toEqual(expected);
	});

	test("should handle missing dirs section", () => {
		const input = `version: 2024.11.8
shell:
  /bin/zsh`;

		const expected: MiseConfig = { dirs: { shims: "" } };

		const result = parseMiseConfig(input);
		expect(result).toEqual(expected);
	});

	test("should handle different indentation levels", () => {
		const input = `version: 2024.11.8
dirs:
    data: ~/.local/share/mise
        config: ~/.config/mise
  cache: ~/Library/Caches/mise
 state: ~/.local/state/mise
   shims: ~/.local/share/mise/shims`;

		const expected: MiseConfig = {
			dirs: {
				data: "~/.local/share/mise",
				config: "~/.config/mise",
				cache: "~/Library/Caches/mise",
				state: "~/.local/state/mise",
				shims: "~/.local/share/mise/shims",
			},
		};

		const result = parseMiseConfig(input);
		expect(result).toEqual(expected);
	});

	test("should handle malformed lines in dirs section", () => {
		const input = `dirs:
  data: ~/.local/share/mise
  invalid line
  : missing key
  missing_value:
  config: ~/.config/mise`;

		const expected: MiseConfig = {
			dirs: {
				data: "~/.local/share/mise",
				config: "~/.config/mise",
				shims: "",
			},
		};

		const result = parseMiseConfig(input);
		expect(result).toEqual(expected);
	});

	test("should handle real-world mise output", () => {
		const input = `version: 2024.11.8 macos-arm64 (d5dde8f 2024-11-12)
activated: yes
shims_on_path: no

build_info:
  Target: aarch64-apple-darwin
  Features: DEFAULT, NATIVE_TLS, OPENSSL

dirs:
  data: ~/.local/share/mise
  config: ~/.config/mise
  cache: ~/Library/Caches/mise
  state: ~/.local/state/mise
  shims: ~/.local/share/mise/shims

config_files:
  ~/.config/mise/config.toml
  ~/Projects/mise-vscode/mise.toml`;

		const expected: MiseConfig = {
			dirs: {
				data: "~/.local/share/mise",
				config: "~/.config/mise",
				cache: "~/Library/Caches/mise",
				state: "~/.local/state/mise",
				shims: "~/.local/share/mise/shims",
			},
		};

		const result = parseMiseConfig(input);
		expect(result).toEqual(expected);
	});
});
