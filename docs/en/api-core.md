# `@ocr-web/core` API reference

## Default exports

```ts
import { OcrEngine, OcrEngineWorker } from "@ocr-web/core";
import OcrWorker from "@ocr-web/core/worker?worker";  // Vite, etc.
```

## OcrEngine (main-thread version)

```ts
class OcrEngine {
  static create(opts: OcrEngineOptions): Promise<OcrEngine>;
  recognize(input: ImageInput, opts?: RecognizeOptions): Promise<OcrResult>;
  dispose(): Promise<void>;
}
```

### When to use the main-thread version

- Simple demos, playgrounds
- One-shot recognition before the page closes
- Inside a Service Worker (where you can't nest another Worker)

### When to use the Worker version

- Any scenario where users would notice UI jank (i.e. "almost every real scenario")
- The docs recommend the Worker version by default

## OcrEngineWorker (recommended)

```ts
class OcrEngineWorker {
  static create(opts: OcrEngineWorkerOptions): Promise<OcrEngineWorker>;
  recognize(input: ImageInput, opts?: RecognizeOptions): Promise<OcrResult>;
  dispose(): Promise<void>;
}

interface OcrEngineWorkerOptions extends OcrEngineOptions {
  worker: Worker;        // caller is responsible for creating it (per-bundler Worker syntax)
}
```

API is identical to the main-thread version; `recognize()` internally transfers image data to the worker.

## OcrEngineOptions

```ts
interface OcrEngineOptions {
  models: {
    detection: ModelSource;
    recognition: ModelSource;
    classification?: ModelSource;  // PP-OCRv5 doesn't ship one; the slot is reserved
  };
  dictionary: string | string[];
  runtime?: "wasm" | "webgpu";       // default "wasm"
  wasmPaths?: string | Record<string, string>;
  numThreads?: number;                // default 1
  onProgress?: (p: LoadProgress) => void;
}

type ModelSource = string | ArrayBuffer | Uint8Array;
type LoadProgress = { loaded: number; total: number; file: string };
```

### `models`

`detection` and `recognition` are required; leave `classification` empty (PP-OCRv5 has no cls model).

Each value can be:
- A **URL string** (most common — pass `ppocrV5.detection` directly)
- An **ArrayBuffer / Uint8Array** (fetch yourself; useful for auth-gated assets)

### `dictionary`

Must match the model. PP-OCRv5's dictionary is at `ppocrV5.dictionary`.

Can be:
- A URL string
- The full dictionary text
- An array of characters (in dictionary order)

### `runtime`

- `"wasm"` (default) — best compatibility, performance is fine. ~250–1500ms per page on M2.
- `"webgpu"` — faster, but requires WebGPU support. **The current `wasm` runtime already meets the SDD performance targets, and the WebGPU backend has occasional numerical-precision issues with PP-OCR models** — we suggest enabling it from 0.4+.

### `wasmPaths`

Tells onnxruntime-web where to fetch its wasm files. Common values:
- `/ort/` (same-origin, wasm copied into `public/ort/`)
- `https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/` (CDN)
- Inside a Worker you **must use a full URL** (with origin) — relative paths fail: `${location.origin}/ort/`

### `numThreads`

WASM thread count. Using >1 requires:
- The browser to support SharedArrayBuffer
- The page to send COOP/COEP headers:
  ```
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
  ```

GitHub Pages can't set those headers, so we default to 1 thread.

### `onProgress`

Byte-level model fetch progress callback:

```ts
onProgress: ({ loaded, total, file }) => {
  // file = "detection" | "recognition"
  // loaded, total = bytes
}
```

The dictionary is not reported (it's tens of KB).

## RecognizeOptions

```ts
interface RecognizeOptions {
  detThreshold?: number;     // default 0.3, sigmoid probability binarization threshold
  detBoxThreshold?: number;  // default 0.6, average-probability filter for boxes
  maxSideLen?: number;       // default 960, longest side of det input
  unclipRatio?: number;      // default 1.6, box expansion factor
  minBoxSize?: number;       // default 3, minimum box side length (px)
  useClassification?: boolean;
}
```

See [Tuning guide](./tuning.md) for advice.

## OcrResult

```ts
interface OcrResult {
  lines: OcrLine[];
  fullText: string;       // lines.text joined by \n in reading order
  durationMs: number;     // end-to-end time including preprocess + det + rec + postprocess
}

interface OcrLine {
  text: string;
  box: Quad;                  // 4 corners: TL, TR, BR, BL
  confidence: number;         // 0..1, mean of CTC max probabilities
}

type Point = [number, number];
type Quad  = [Point, Point, Point, Point];
```

### `lines` ordering

Reading order: top-to-bottom, then left-to-right, with a same-line tolerance of 60% of line height.

### `box` coordinates

In the original image's coordinate system (not det-internal scaled coords). `(0,0)` is top-left, axes grow down/right.

### `confidence`

Mean of the per-character max logits CTC kept. Note this is a **logit, not a probability** — values above 0 are generally trustworthy, but the absolute number isn't very meaningful. Comparing confidences (which line is more reliable) is meaningful; absolute thresholds may not generalize.

## Memory & lifecycle

```ts
const engine = await OcrEngine.create(opts);  // loads ort session, ~21MB memory
try {
  for (const img of images) {
    const result = await engine.recognize(img);
    // ...
  }
} finally {
  await engine.dispose();  // release session
}
```

After `dispose()` the instance is unusable. Re-OCR requires a new `create()`.

For the Worker version, `dispose()` terminates the worker and reclaims all of its memory.

## Errors

The library doesn't define custom error types — it throws plain `Error` instances. Common `message` strings:

- `"Failed to fetch detection from ..."` — model URL is 404 or has CORS issues
- `"OffscreenCanvas 2d context unavailable"` — browser doesn't support it
- `"Got invalid dimensions for input"` — model and library versions don't match (shouldn't happen in practice)
- `"Worker terminated"` — you called another method after `dispose()`

See [Troubleshooting](./troubleshooting.md).
