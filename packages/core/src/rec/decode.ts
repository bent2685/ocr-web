// CTC greedy decoder (PaddleOCR convention: blank = idx 0, dict chars at idx 1..C-1)

export interface DecodeResult {
	text: string;
	confidence: number;
}

export function loadDictionary(source: string | string[]): string[] {
	if (Array.isArray(source)) return source.slice();
	const lines = source.split("\n").filter((line) => line.length > 0);
	// PaddleOCR convention: append a single space char at end
	return [...lines, " "];
}

export function ctcGreedyDecode(
	logits: Float32Array,
	T: number,
	C: number,
	dict: readonly string[],
): DecodeResult {
	const out: string[] = [];
	const probs: number[] = [];
	let prev = -1;
	for (let t = 0; t < T; t++) {
		let maxIdx = 0;
		let maxVal = logits[t * C]!;
		for (let c = 1; c < C; c++) {
			const v = logits[t * C + c]!;
			if (v > maxVal) {
				maxVal = v;
				maxIdx = c;
			}
		}
		if (maxIdx !== 0 && maxIdx !== prev) {
			const ch = dict[maxIdx - 1];
			if (ch !== undefined) {
				out.push(ch);
				probs.push(maxVal);
			}
		}
		prev = maxIdx;
	}
	const conf = probs.length ? probs.reduce((a, b) => a + b, 0) / probs.length : 0;
	return { text: out.join(""), confidence: conf };
}
