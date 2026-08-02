import { describe, expect, it } from "bun:test";
import { escapeMarkdown, markdownCodeSpan } from "./markdown";

describe("markdownCodeSpan", () => {
	it("shows a path as written, without escape characters", () => {
		expect(markdownCodeSpan("/Users/me/projects/demo/bin/mise")).toBe(
			"`/Users/me/projects/demo/bin/mise`",
		);
	});

	it("keeps a value holding backticks from closing the span", () => {
		expect(markdownCodeSpan("a`b")).toBe("``a`b``");
		expect(markdownCodeSpan("a``b")).toBe("```a``b```");
	});

	it("pads a value that starts or ends with a backtick", () => {
		expect(markdownCodeSpan("`x")).toBe("`` `x ``");
		expect(markdownCodeSpan("x`")).toBe("`` x` ``");
	});

	it("cannot be broken out of by a command link", () => {
		const span = markdownCodeSpan("x`](command:evil) [`y");
		// the fence outgrows every backtick run in the value
		expect(span.startsWith("``")).toBe(true);
		expect(span.endsWith("``")).toBe(true);
		expect(span).toBe("``x`](command:evil) [`y``");
	});

	it("collapses line breaks", () => {
		expect(markdownCodeSpan("a\n\nb")).toBe("`a b`");
	});
});

describe("escapeMarkdown", () => {
	it("neutralizes a command link injected through a value", () => {
		const injected = 'x](command:workbench.action.terminal.new "run") [';

		const escaped = escapeMarkdown(injected);

		expect(escaped).not.toContain("](command:");
		expect(escaped).toBe(
			'x\\]\\(command\\:workbench\\.action\\.terminal\\.new \\"run\\"\\) \\[',
		);
	});

	it("neutralizes theme icons, they are enabled on the tooltip", () => {
		expect(escapeMarkdown("$(gear)")).toBe("\\$\\(gear\\)");
	});

	it("collapses line breaks so a value cannot start a markdown block", () => {
		expect(escapeMarkdown("a\n\nb")).toBe("a b");
		expect(escapeMarkdown("a\r\n  b")).toBe("a b");
	});

	it("leaves plain paths readable once rendered", () => {
		// every backslash is dropped by the renderer, so this shows as the path
		expect(escapeMarkdown("~/.local/bin/mise").replace(/\\/g, "")).toBe(
			"~/.local/bin/mise",
		);
	});
});
