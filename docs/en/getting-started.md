# Getting started

Get OCR running in a Vite project in 5 minutes.

## 1. Install

```bash
pnpm add @ocr-web/core @ocr-web/models-ppocrv5 onnxruntime-web
# If you also need PDF:
pnpm add @ocr-web/pdf
```

`onnxruntime-web` is a **peer dependency** — it must be installed explicitly.

## 2. Configure Vite — copy wasm files

`vite.config.ts`:

```ts
import { defineConfig } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";

export default defineConfig({
  plugins: [
    viteStaticCopy({
      targets: [
        { src: "node_modules/onnxruntime-web/dist/*.wasm", dest: "ort" },
        { src: "node_modules/onnxruntime-web/dist/*.mjs", dest: "ort" },
      ],
    }),
  ],
  optimizeDeps: { exclude: ["onnxruntime-web"] },
  build: { target: "esnext" },
});
```

> Webpack / Next.js / other bundler setups: see [Installation & build config](./installation.md).

## 3. Application code

### Minimal: image recognition (main-thread, ~10 lines)

```ts
import { OcrEngine } from "@ocr-web/core";
import { ppocrV5 } from "@ocr-web/models-ppocrv5";

const engine = await OcrEngine.create({
  models: { detection: ppocrV5.detection, recognition: ppocrV5.recognition },
  dictionary: ppocrV5.dictionary,
  wasmPaths: "/ort/",
});

const file = (document.querySelector("input") as HTMLInputElement).files![0];
const bitmap = await createImageBitmap(file);
const result = await engine.recognize(bitmap);
console.log(result.fullText);
```

⚠️ The main-thread version **freezes the UI** for 1–2 seconds. Use the Worker version below in production.

### Recommended: Worker mode (UI stays responsive)

```ts
import { OcrEngineWorker } from "@ocr-web/core";
import OcrWorker from "@ocr-web/core/worker?worker";  // Vite syntax
import { ppocrV5 } from "@ocr-web/models-ppocrv5";

const engine = await OcrEngineWorker.create({
  worker: new OcrWorker(),
  models: { detection: ppocrV5.detection, recognition: ppocrV5.recognition },
  dictionary: ppocrV5.dictionary,
  wasmPaths: `${location.origin}/ort/`,  // absolute URL required inside a worker
  onProgress: ({ loaded, total, file }) => {
    console.log(`${file}: ${(loaded / total * 100).toFixed(0)}%`);
  },
});

const result = await engine.recognize(bitmap);
console.log(result.fullText, result.lines);
```

### PDF extraction

```ts
import { PdfOcr } from "@ocr-web/pdf";

const pdfOcr = new PdfOcr({ engine });

const text  = await pdfOcr.recognize(pdfFile, 3);          // single page → string
const all   = await pdfOcr.recognize(pdfFile);             // all pages → object
const some  = await pdfOcr.recognize(pdfFile, [1, 3, 5]);  // selected pages → object

console.log(all[1].text);
console.log(all[2].text);
```

## 4. Input types

`recognize()` accepts these image inputs:

```ts
type ImageInput =
  | HTMLCanvasElement
  | OffscreenCanvas
  | ImageData
  | ImageBitmap
  | Blob              // File works too (File extends Blob)
  | string;           // URL (must be CORS-enabled or same-origin)
```

`PdfOcr.recognize()` accepts these PDF inputs:

```ts
type PdfInput =
  | ArrayBuffer
  | Uint8Array
  | Blob              // File works too
  | string;           // URL
```

## 5. Result shape

```ts
interface OcrResult {
  lines: OcrLine[];
  fullText: string;            // lines joined in reading order with \n
  durationMs: number;
}

interface OcrLine {
  text: string;
  box: [Point, Point, Point, Point];  // TL, TR, BR, BL
  confidence: number;                  // 0..1
}

type Point = [number, number];
```

## Next

- Recognition quality not good enough → [Tuning guide](./tuning.md)
- Errors → [Troubleshooting](./troubleshooting.md)
- React / Electron / Next.js / batch processing → [Recipes](./recipes.md)
