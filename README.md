# ocr-web

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![@ocr-web/core](https://img.shields.io/npm/v/@ocr-web/core.svg?label=%40ocr-web%2Fcore)](https://www.npmjs.com/package/@ocr-web/core)
[![@ocr-web/pdf](https://img.shields.io/npm/v/@ocr-web/pdf.svg?label=%40ocr-web%2Fpdf)](https://www.npmjs.com/package/@ocr-web/pdf)
[![@ocr-web/models-ppocrv5](https://img.shields.io/npm/v/@ocr-web/models-ppocrv5.svg?label=models-ppocrv5)](https://www.npmjs.com/package/@ocr-web/models-ppocrv5)

PP-OCRv5 inference for the browser and Electron. Pure JavaScript on top of [`onnxruntime-web`](https://github.com/microsoft/onnxruntime) — no native bindings, no sidecar, no server required.

> 🇨🇳 [中文 README](./README.zh-CN.md) · 📚 [Documentation](./docs/README.md) ([English](./docs/en/getting-started.md) / [中文](./docs/zh-CN/getting-started.md)) · 🔗 [Live demo](https://bent2685.github.io/ocr-web/)

## Features

- **PP-OCRv5 detection + recognition pipeline** — DBNet detection, CRNN recognition with CTC greedy decoding, multilingual dictionary (18,384 characters covering CJK, Latin, digits, common punctuation, and emoji).
- **Web Worker mode** — runs the full inference pipeline off the main thread; UI stays responsive during recognition.
- **Streaming model load progress** — byte-level `onProgress` callback for `detection` and `recognition` model fetches.
- **Recognition batching** — multiple text lines are padded and run as a single `[N, 3, 32, W]` rec batch.
- **Flexible image inputs** — `HTMLCanvasElement`, `OffscreenCanvas`, `ImageData`, `ImageBitmap`, `Blob` / `File`, or a URL string.
- **PDF text extraction** — `@ocr-web/pdf` renders each page with [`pdfjs-dist`](https://github.com/mozilla/pdf.js) and OCRs it; supports single-page, all-page, or selected-page extraction with per-page progress.
- **Tunable post-processing** — `detThreshold`, `detBoxThreshold`, `unclipRatio`, `maxSideLen`, `minBoxSize` are all exposed per `recognize()` call.
- **Model URLs as a separate package** — `@ocr-web/models-ppocrv5` ships only URL constants (jsDelivr CDN, CORS-enabled). You can also pass any `ArrayBuffer` / `Uint8Array` if you host or gate models yourself.
- **Small, tree-shakeable, ESM + CJS** — the core JS bundle is on the order of tens of KB; `onnxruntime-web` is a peer dependency.

## Packages

| Package | Description |
|---|---|
| [`@ocr-web/core`](./packages/core) | Inference engine — detection + recognition + CTC, main-thread (`OcrEngine`) and Worker (`OcrEngineWorker`) entry points |
| [`@ocr-web/models-ppocrv5`](./packages/models-ppocrv5) | PP-OCRv5 model URLs (detection, recognition, dictionary) hosted on jsDelivr |
| [`@ocr-web/pdf`](./packages/pdf) | PDF text extraction (pdfjs-dist render + OCR) |

## Installation

```bash
pnpm add @ocr-web/core @ocr-web/models-ppocrv5 onnxruntime-web
# Optional, for PDF extraction:
pnpm add @ocr-web/pdf
```

`onnxruntime-web` is a **peer dependency** and must be installed explicitly. Its `*.wasm` files must be served from a path you tell the engine about via `wasmPaths` (default `/`). See [Installation & build configuration](./docs/en/installation.md) for Vite, Webpack, Next.js, Electron, and CDN setups.

## Usage

### Main-thread engine (demos and one-off scripts)

```ts
import { OcrEngine } from "@ocr-web/core";
import { ppocrV5 } from "@ocr-web/models-ppocrv5";

const engine = await OcrEngine.create({
  models: {
    detection: ppocrV5.detection,
    recognition: ppocrV5.recognition,
  },
  dictionary: ppocrV5.dictionary,
  wasmPaths: "/ort/",
});

const result = await engine.recognize(canvas);
console.log(result.fullText);
console.log(result.lines); // [{ text, box, confidence }, ...]

await engine.dispose();
```

### Worker engine (recommended for production)

```ts
import { OcrEngineWorker } from "@ocr-web/core";
import OcrWorker from "@ocr-web/core/worker?worker"; // Vite syntax
import { ppocrV5 } from "@ocr-web/models-ppocrv5";

const engine = await OcrEngineWorker.create({
  worker: new OcrWorker(),
  models: {
    detection: ppocrV5.detection,
    recognition: ppocrV5.recognition,
  },
  dictionary: ppocrV5.dictionary,
  wasmPaths: `${location.origin}/ort/`,
  onProgress: ({ file, loaded, total }) => {
    console.log(`${file}: ${(loaded / total * 100).toFixed(0)}%`);
  },
});

const result = await engine.recognize(blob);
await engine.dispose();
```

### PDF extraction

```ts
import { PdfOcr } from "@ocr-web/pdf";

const pdfOcr = new PdfOcr({ engine });

const text = await pdfOcr.recognize(file, 1);          // single page → string
const all  = await pdfOcr.recognize(file);             // all pages → { [page]: { text, lines, durationMs } }
const some = await pdfOcr.recognize(file, [1, 3, 5]);  // selected pages
```

For framework integrations (React, Vue, Next.js, Electron) see [Recipes](./docs/en/recipes.md).

## Repository layout

```
ocr-web/
├── packages/
│   ├── core/                # @ocr-web/core
│   ├── models-ppocrv5/      # @ocr-web/models-ppocrv5
│   └── pdf/                 # @ocr-web/pdf
├── examples/
│   └── browser/             # full browser demo
├── docs/
│   ├── en/                  # English documentation
│   └── zh-CN/               # 中文文档
├── models/                  # PP-OCRv5 ONNX assets distributed via jsDelivr
├── README.md                # English README
└── README.zh-CN.md          # 中文 README
```

## Development

```bash
pnpm install
pnpm build          # build all packages
pnpm test           # run unit tests
pnpm example        # launch examples/browser at http://localhost:5181
pnpm lint           # biome check
pnpm format         # biome format --write
```

Requires Node.js >= 20 and pnpm 10. Source is TypeScript; bundling is done with [`tsup`](https://tsup.egoist.dev/), tests with [`vitest`](https://vitest.dev/), linting and formatting with [Biome](https://biomejs.dev/).

## Browser support

Modern Chromium, Firefox, and Safari with WebAssembly and `OffscreenCanvas` support. Multi-threaded WASM additionally requires `SharedArrayBuffer`, which in turn requires the page to be served with `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` headers; the engine falls back to single-threaded execution otherwise.

## Contributing

Issues and pull requests are welcome at [github.com/bent2685/ocr-web](https://github.com/bent2685/ocr-web). Please run `pnpm lint` and `pnpm test` before submitting a PR.

## Acknowledgements

This project would not exist without the work of many others:

- **[PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR)** by Baidu — the PP-OCRv5 detection and recognition models, the dictionary, and the original Python reference implementation that this library mirrors.
- **[ONNX Runtime Web](https://github.com/microsoft/onnxruntime)** by Microsoft — WebAssembly-based ONNX inference in the browser.
- **[PDF.js (`pdfjs-dist`)](https://github.com/mozilla/pdf.js)** by Mozilla — used by `@ocr-web/pdf` to rasterize PDF pages.
- **[jsDelivr](https://www.jsdelivr.com/)** — CORS-friendly CDN that serves the PP-OCRv5 ONNX assets and dictionary.
- The DBNet, CRNN, and CTC research communities, whose algorithms this library implements end-to-end.

## Feedback
- **Issues:** Feel free to post any issues or questions in this repository.
- **Friends & Links:** [LINUX DO](https://linux.do/) - A Chinese community for technology enthusiasts. This project is linked with and endorsed by LINUX DO.


## License

[MIT](./LICENSE) © ocr-web contributors.

The PP-OCRv5 models redistributed in this repository are released by Baidu under the [Apache License 2.0](https://github.com/PaddlePaddle/PaddleOCR/blob/main/LICENSE).
