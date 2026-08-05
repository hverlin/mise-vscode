import { describe, expect, it } from "bun:test";
import { formatTaskOutputs } from "./taskDisplay";

describe("formatTaskOutputs", () => {
	it("formats the files array emitted by mise", () => {
		expect(formatTaskOutputs(["dist/**", "coverage/**"])).toBe(
			"dist/**, coverage/**",
		);
	});

	it("formats auto-detected outputs", () => {
		expect(formatTaskOutputs({ auto: true })).toBe("Auto-detected");
	});
});
