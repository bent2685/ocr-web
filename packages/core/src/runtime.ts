import * as ort from "onnxruntime-web";
import type { ModelSource, OcrEngineOptions } from "./types.js";

let configured = false;

export function configureOrt(opts: Pick<OcrEngineOptions, "wasmPaths" | "numThreads">): void {
	if (configured) return;
	if (opts.wasmPaths !== undefined) {
		(ort.env.wasm as { wasmPaths: string | Record<string, string> }).wasmPaths = opts.wasmPaths;
	}
	ort.env.wasm.numThreads = opts.numThreads ?? 1;
	ort.env.logLevel = "warning";
	configured = true;
}

export type ProgressCallback = (loaded: number, total: number, name: string) => void;

async function fetchWithProgress(
	url: string,
	name: string,
	onProgress?: ProgressCallback,
): Promise<Uint8Array> {
	const res = await fetch(url);
	if (!res.ok) throw new Error(`Failed to fetch ${name} from ${url} (${res.status})`);
	const total = Number(res.headers.get("content-length") ?? 0);
	if (!onProgress || !res.body || total === 0) {
		return new Uint8Array(await res.arrayBuffer());
	}
	const reader = res.body.getReader();
	const chunks: Uint8Array[] = [];
	let loaded = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		if (value) {
			chunks.push(value);
			loaded += value.length;
			onProgress(loaded, total, name);
		}
	}
	const out = new Uint8Array(loaded);
	let offset = 0;
	for (const c of chunks) {
		out.set(c, offset);
		offset += c.length;
	}
	return out;
}

export async function createSession(
	model: ModelSource,
	runtime: "wasm" | "webgpu",
	name: string,
	onProgress?: ProgressCallback,
): Promise<ort.InferenceSession> {
	const opts: ort.InferenceSession.SessionOptions = {
		executionProviders: [runtime],
		graphOptimizationLevel: "all",
	};
	if (typeof model === "string") {
		const bytes = await fetchWithProgress(model, name, onProgress);
		return ort.InferenceSession.create(bytes, opts);
	}
	if (model instanceof Uint8Array) return ort.InferenceSession.create(model, opts);
	return ort.InferenceSession.create(new Uint8Array(model), opts);
}

export { ort };
