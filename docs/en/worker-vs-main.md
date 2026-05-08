# Worker mode vs main-thread mode

## Quick decision tree

```
Building a real product ────► OcrEngineWorker
Demo / internal tool, OK with a few seconds of jank ────► OcrEngine
```

99% of scenarios should use the Worker version.

## Comparison

|  | OcrEngine | OcrEngineWorker |
|---|---|---|
| Bundle size | Same | Same (worker entry is a separate chunk, lazy-loaded) |
| Startup time | ~600ms | ~600–800ms (includes worker boot) |
| UI jank per recognize | **Yes — 1–2s freeze** | **No** |
| Per-recognize latency | 250–1500ms | About the same as main-thread (extra postMessage serialization) |
| Memory location | ort session in main process | ort session in worker process |
| Best for | Demos, playgrounds, inside Service Workers | **Production** |

## Why the main-thread version freezes the UI

ort wasm is CPU-heavy and saturates the JS main thread. While it runs:

- Mouse events don't fire
- Animations / CSS transitions stop
- Inputs become unresponsive
- The browser may show a "page unresponsive" prompt

Measured: M2 Mac running 13 lines of A4 ≈ 1.5s of freeze. Slower on a typical PC.

## How the worker keeps the UI smooth

The library runs the entire OcrEngine inside a Worker thread. The main thread only sends messages:

1. The `ImageData` buffer is sent zero-copy via Transferable
2. The worker performs `recognize`
3. The result is `postMessage`'d back

While the main thread waits for the worker, it's free to render and handle input.

## Code switch

Main-thread version:

```ts
import { OcrEngine } from "@ocr-web/core";

const engine = await OcrEngine.create({ ... });
const result = await engine.recognize(bitmap);
```

Worker version (only two extra lines):

```ts
import { OcrEngineWorker } from "@ocr-web/core";
import OcrWorker from "@ocr-web/core/worker?worker";  // ← this line

const engine = await OcrEngineWorker.create({
  worker: new OcrWorker(),                              // ← this line
  // ...everything else is identical
});
const result = await engine.recognize(bitmap);
```

API surfaces are identical. `OcrResult` is the same type.

## Notes for multi-page PDF

When extracting multiple pages, each page has 100–500ms of pdfjs render between OCR steps (pdfjs runs on the calling thread). That's another source of jank. For ultra-smooth behavior:

1. Run pdfjs in a worker (pdfjs has its own worker mode and uses it automatically, but the render step still runs on the caller).
2. Wrap the entire PdfOcr in a worker yourself.

v0.3 does not yet wrap PdfOcr in a worker. v0.4 may add this.

## Extra worker caveats

### `wasmPaths` must be an absolute URL

```ts
// main-thread version, relative path is fine
wasmPaths: "/ort/"

// worker version, full URL required
wasmPaths: `${location.origin}/ort/`
```

Reason: workers have their own `location`; relative paths resolve against the worker file's URL, not the page's.

### Can't reuse after `dispose()`

```ts
await engine.dispose();
await engine.recognize(bmp);  // ❌ throws "Worker terminated"
```

### Same-origin worker only

Trying to load the worker from a CDN (e.g. fetching `@ocr-web/core/worker` from jsDelivr) gets blocked by the cross-origin worker restriction. In that scenario you can only use the main-thread version.
