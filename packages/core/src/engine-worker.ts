// Main-thread proxy that delegates recognize() to a Web Worker so the UI doesn't freeze.
// Constructs are decoupled from any specific bundler — caller passes a Worker instance,
// e.g. created via Vite's `import OcrWorker from "@ocr-web/core/worker?worker"`.

import { normalizeInput } from "./input.js";
import { type RpcRequest, isRpcMessage } from "./rpc.js";
import type {
	ImageInput,
	LoadProgress,
	OcrEngineOptions,
	OcrResult,
	RecognizeOptions,
} from "./types.js";

type Pending = {
	resolve: (value: unknown) => void;
	reject: (err: Error) => void;
};

export interface OcrEngineWorkerOptions extends Omit<OcrEngineOptions, "onProgress"> {
	worker: Worker;
	onProgress?: (p: LoadProgress) => void;
}

export class OcrEngineWorker {
	private nextId = 1;
	private readonly pending = new Map<number, Pending>();
	private onProgress: ((p: LoadProgress) => void) | undefined;

	private constructor(private readonly worker: Worker) {
		worker.addEventListener("message", (ev: MessageEvent) => this.handle(ev));
	}

	static async create(opts: OcrEngineWorkerOptions): Promise<OcrEngineWorker> {
		const inst = new OcrEngineWorker(opts.worker);
		inst.onProgress = opts.onProgress;
		const { worker: _w, onProgress: _p, ...payload } = opts;
		void _w;
		void _p;
		await inst.call("create", [payload]);
		return inst;
	}

	async recognize(input: ImageInput, opts?: RecognizeOptions): Promise<OcrResult> {
		const img = await normalizeInput(input);
		// transfer the underlying buffer to the worker (zero-copy)
		const buffer = img.data.buffer.slice(0) as ArrayBuffer;
		return (await this.call(
			"recognize",
			[{ data: buffer, width: img.width, height: img.height }, opts],
			[buffer],
		)) as OcrResult;
	}

	async dispose(): Promise<void> {
		try {
			await this.call("dispose", []);
		} finally {
			this.worker.terminate();
			for (const { reject } of this.pending.values()) reject(new Error("Worker terminated"));
			this.pending.clear();
		}
	}

	private call(method: string, args: unknown[], transfer: Transferable[] = []): Promise<unknown> {
		return new Promise((resolve, reject) => {
			const id = this.nextId++;
			this.pending.set(id, { resolve, reject });
			const req: RpcRequest = { __rpc: "req", id, method, args };
			this.worker.postMessage(req, transfer);
		});
	}

	private handle(ev: MessageEvent): void {
		const data = ev.data;
		if (!isRpcMessage(data)) return;
		if (data.__rpc === "evt") {
			if (data.channel === "progress" && this.onProgress) {
				this.onProgress(data.payload as LoadProgress);
			}
			return;
		}
		if (data.__rpc !== "res") return;
		const p = this.pending.get(data.id);
		if (!p) return;
		this.pending.delete(data.id);
		if (data.ok) p.resolve(data.value);
		else p.reject(Object.assign(new Error(data.error.message), { stack: data.error.stack }));
	}
}
