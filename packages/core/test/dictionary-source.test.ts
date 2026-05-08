import { describe, expect, it } from "vitest";
import { isFetchableSource } from "../src/engine.js";

describe("isFetchableSource — distinguishes URL/path from raw dictionary text", () => {
	it.each([
		["https://cdn.jsdelivr.net/.../dict.txt", true],
		["http://example.com/dict.txt", true],
		["file:///Users/foo/dict.txt", true],
		["file://C:/path/dict.txt", true],
		["blob:https://example.com/abc-123", true],
		["data:text/plain,hello", true],
		["chrome-extension://abc/dict.txt", true],
		["/absolute/path/dict.txt", true],
		["./relative/dict.txt", true],
		["../parent/dict.txt", true],
	])("recognizes %s as fetchable", (input, expected) => {
		expect(isFetchableSource(input)).toBe(expected);
	});

	it("treats raw multi-line dictionary text as non-fetchable", () => {
		const dict = "中\n文\n字\n典\n";
		expect(isFetchableSource(dict)).toBe(false);
	});

	it("treats single short text as non-fetchable", () => {
		expect(isFetchableSource("just a string")).toBe(false);
	});
});
