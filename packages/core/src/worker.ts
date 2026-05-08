// Worker entry point. Imported via `import url from "@ocr-web/core/worker?url"` (Vite)
// or referenced via `new Worker(new URL("@ocr-web/core/worker", import.meta.url))` (Webpack 5+).
// Runs an OcrEngine inside the worker, exposing recognize / dispose over RPC.

import { OcrEngine } from "./engine.js";
import {
	type RpcEvent,
	type RpcRequest,
	type RpcResponseErr,
	type RpcResponseOk,
	isRpcMessage,
} from "./rpc.js";
import type { OcrEngineOptions, RecognizeOptions } from "./types.js";

let engine: OcrEngine | null = null;

interface SerializedImage {
	data: ArrayBufferLike;
	width: number;
	height: number;
}

function send(msg: RpcResponseOk | RpcResponseErr | RpcEvent, transfer?: Transferable[]): void {
	(self as unknown as { postMessage: (m: unknown, t?: Transferable[]) => void }).postMessage(
		msg,
		transfer ?? [],
	);
}

self.addEventListener("message", async (ev: MessageEvent) => {
	const data = ev.data;
	if (!isRpcMessage(data) || data.__rpc !== "req") return;
	const req = data as RpcRequest;
	try {
		const result = await dispatch(req.method, req.args);
		send({ __rpc: "res", id: req.id, ok: true, value: result });
	} catch (err) {
		const e = err as Error;
		send({
			__rpc: "res",
			id: req.id,
			ok: false,
			error: { message: e.message, stack: e.stack },
		});
	}
});

async function dispatch(method: string, args: unknown[]): Promise<unknown> {
	switch (method) {
		case "create": {
			const opts = args[0] as OcrEngineOptions;
			engine = await OcrEngine.create({
				...opts,
				onProgress: (p) => send({ __rpc: "evt", channel: "progress", payload: p }),
			});
			return true;
		}
		case "recognize": {
			if (!engine) throw new Error("Worker engine not initialized");
			const img = args[0] as SerializedImage;
			const opts = args[1] as RecognizeOptions | undefined;
			const arr = new Uint8ClampedArray(img.data) as Uint8ClampedArray<ArrayBuffer>;
			const imageData = new ImageData(arr, img.width, img.height);
			return engine.recognize(imageData, opts);
		}
		case "dispose": {
			if (engine) await engine.dispose();
			engine = null;
			return true;
		}
		default:
			throw new Error(`Unknown method: ${method}`);
	}
}
