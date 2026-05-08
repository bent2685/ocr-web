// @ocr-web/core — public API surface
// 注意：当前为骨架，真实实现将在 Phase 1 填充。SDD §5.3 定义了完整接口形态。

export type ImageInput =
	| HTMLCanvasElement
	| OffscreenCanvas
	| ImageData
	| ImageBitmap
	| Blob
	| string;

export interface OcrEngineOptions {
	models: {
		detection: string | ArrayBuffer;
		recognition: string | ArrayBuffer;
		classification?: string | ArrayBuffer;
	};
	dictionary: string | string[];
	runtime?: "wasm" | "webgpu";
	wasmPaths?: string | Record<string, string>;
	numThreads?: number;
}

export interface RecognizeOptions {
	useClassification?: boolean;
	detThreshold?: number;
	detBoxThreshold?: number;
	maxSideLen?: number;
	unclipRatio?: number;
}

export type Quad = [
	[number, number],
	[number, number],
	[number, number],
	[number, number],
];

export interface OcrLine {
	text: string;
	box: Quad;
	confidence: number;
}

export interface OcrResult {
	lines: OcrLine[];
	fullText: string;
	durationMs: number;
}

export class OcrEngine {
	private constructor(_opts: OcrEngineOptions) {}

	static async create(opts: OcrEngineOptions): Promise<OcrEngine> {
		return new OcrEngine(opts);
	}

	async recognize(_input: ImageInput, _opts?: RecognizeOptions): Promise<OcrResult> {
		throw new Error("OcrEngine.recognize not implemented yet (Phase 1)");
	}

	async dispose(): Promise<void> {
		// no-op
	}
}
