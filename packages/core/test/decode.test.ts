import { describe, expect, it } from "vitest";
import { ctcGreedyDecode, loadDictionary } from "../src/rec/decode.js";

describe("loadDictionary", () => {
	it("appends trailing space to text-loaded dict", () => {
		const dict = loadDictionary("a\nb\nc\n");
		expect(dict).toEqual(["a", "b", "c", " "]);
	});
	it("preserves array dict as-is", () => {
		const dict = loadDictionary(["a", "b"]);
		expect(dict).toEqual(["a", "b"]);
	});
});

describe("ctcGreedyDecode", () => {
	const dict = ["A", "B", "C"]; // C = dict.length + 1 = 4 (idx 0 is blank)
	const C = 4;

	function makeLogits(seq: number[]): Float32Array {
		const arr = new Float32Array(seq.length * C);
		for (let t = 0; t < seq.length; t++) {
			for (let c = 0; c < C; c++) arr[t * C + c] = c === seq[t] ? 5 : 0;
		}
		return arr;
	}

	it("decodes simple sequence with blanks and duplicates", () => {
		// blank, A, A, blank, B, C, C → "ABC"
		const logits = makeLogits([0, 1, 1, 0, 2, 3, 3]);
		const { text } = ctcGreedyDecode(logits, 7, C, dict);
		expect(text).toBe("ABC");
	});

	it("collapses consecutive duplicates", () => {
		// A, A, A → "A"
		const logits = makeLogits([1, 1, 1]);
		const { text } = ctcGreedyDecode(logits, 3, C, dict);
		expect(text).toBe("A");
	});

	it("blank-separated duplicates are not collapsed", () => {
		// A, blank, A → "AA"
		const logits = makeLogits([1, 0, 1]);
		const { text } = ctcGreedyDecode(logits, 3, C, dict);
		expect(text).toBe("AA");
	});

	it("returns confidence as average of selected logits", () => {
		const logits = makeLogits([1, 0, 2]);
		const { confidence } = ctcGreedyDecode(logits, 3, C, dict);
		expect(confidence).toBeCloseTo(5, 5);
	});
});
