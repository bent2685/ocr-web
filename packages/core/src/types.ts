export type ImageInput =
	| HTMLCanvasElement
	| OffscreenCanvas
	| ImageData
	| ImageBitmap
	| Blob
	| string;

export type ModelSource = string | ArrayBuffer | Uint8Array;

export interface OcrEngineOptions {
	models: {
		detection: ModelSource;
		recognition: ModelSource;
		classification?: ModelSource;
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
	minBoxSize?: number;
}

export type Point = [number, number];
export type Quad = [Point, Point, Point, Point];

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

export interface InternalDetBox {
	box: Quad;
	score: number;
}
