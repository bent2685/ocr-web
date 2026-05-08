import { DetectionModule } from "./det/module.js";
import { quadCenter } from "./geometry.js";
import { normalizeInput } from "./input.js";
import { loadDictionary } from "./rec/decode.js";
import { RecognitionModule } from "./rec/module.js";
import { configureOrt, createSession, type ort } from "./runtime.js";
import type {
	ImageInput,
	OcrEngineOptions,
	OcrLine,
	OcrResult,
	RecognizeOptions,
} from "./types.js";

const DEFAULT_RECOGNIZE_OPTS: Required<RecognizeOptions> = {
	useClassification: false,
	detThreshold: 0.3,
	detBoxThreshold: 0.6,
	maxSideLen: 960,
	unclipRatio: 1.6,
	minBoxSize: 3,
};

async function fetchDictionary(source: string | string[]): Promise<readonly string[]> {
	if (Array.isArray(source)) return loadDictionary(source);
	if (
		source.startsWith("http://") ||
		source.startsWith("https://") ||
		source.startsWith("/") ||
		source.startsWith("./") ||
		source.startsWith("../")
	) {
		const res = await fetch(source);
		if (!res.ok) throw new Error(`Failed to fetch dictionary ${source} (${res.status})`);
		return loadDictionary(await res.text());
	}
	return loadDictionary(source);
}

export class OcrEngine {
	private constructor(
		private readonly det: DetectionModule,
		private readonly rec: RecognitionModule,
		private readonly sessions: ort.InferenceSession[],
	) {}

	static async create(opts: OcrEngineOptions): Promise<OcrEngine> {
		configureOrt({ wasmPaths: opts.wasmPaths, numThreads: opts.numThreads });
		const runtime = opts.runtime ?? "wasm";
		const [detSession, recSession, dict] = await Promise.all([
			createSession(opts.models.detection, runtime),
			createSession(opts.models.recognition, runtime),
			fetchDictionary(opts.dictionary),
		]);
		return new OcrEngine(new DetectionModule(detSession), new RecognitionModule(recSession, dict), [
			detSession,
			recSession,
		]);
	}

	async recognize(input: ImageInput, opts: RecognizeOptions = {}): Promise<OcrResult> {
		const start = performance.now();
		const merged: Required<RecognizeOptions> = { ...DEFAULT_RECOGNIZE_OPTS, ...opts };
		const img = await normalizeInput(input);
		const detBoxes = await this.det.detect(img, merged);
		const lines = await this.rec.recognizeBoxes(img, detBoxes);
		const sorted = sortLines(lines);
		return {
			lines: sorted,
			fullText: sorted.map((l) => l.text).join("\n"),
			durationMs: performance.now() - start,
		};
	}

	async dispose(): Promise<void> {
		await Promise.all(this.sessions.map((s) => s.release().catch(() => undefined)));
	}
}

// sort by reading order: rows first (y), then columns (x); cluster by line height
function sortLines(lines: OcrLine[]): OcrLine[] {
	if (lines.length === 0) return lines;
	const items = lines.map((l) => ({ line: l, center: quadCenter(l.box) }));
	const heights = items.map(({ line }) => {
		const h1 = Math.hypot(line.box[3][0] - line.box[0][0], line.box[3][1] - line.box[0][1]);
		const h2 = Math.hypot(line.box[2][0] - line.box[1][0], line.box[2][1] - line.box[1][1]);
		return Math.max(h1, h2);
	});
	const medianH = heights.slice().sort((a, b) => a - b)[Math.floor(heights.length / 2)] ?? 20;
	const tol = medianH * 0.6;
	items.sort((a, b) => {
		if (Math.abs(a.center[1] - b.center[1]) < tol) return a.center[0] - b.center[0];
		return a.center[1] - b.center[1];
	});
	return items.map(({ line }) => line);
}
