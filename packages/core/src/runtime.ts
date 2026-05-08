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

export async function createSession(
	model: ModelSource,
	runtime: "wasm" | "webgpu",
): Promise<ort.InferenceSession> {
	const opts: ort.InferenceSession.SessionOptions = {
		executionProviders: [runtime],
		graphOptimizationLevel: "all",
	};
	if (typeof model === "string") return ort.InferenceSession.create(model, opts);
	if (model instanceof Uint8Array) return ort.InferenceSession.create(model, opts);
	return ort.InferenceSession.create(new Uint8Array(model), opts);
}

export { ort };
