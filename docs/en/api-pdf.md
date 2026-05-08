# `@ocr-web/pdf` API reference

PDF text extraction. Renders each page to an image with [pdfjs-dist](https://github.com/mozilla/pdf.js), then feeds it to `@ocr-web/core`.

## Import

```ts
import { PdfOcr } from "@ocr-web/pdf";
```

## PdfOcr

```ts
class PdfOcr {
  constructor(opts: PdfOcrOptions);

  // Single page → returns a string directly
  recognize(pdf: PdfInput, page: number): Promise<string>;
  // All / multiple pages → object keyed by page number
  recognize(pdf: PdfInput, pages?: "all" | number[]): Promise<PdfRecognizeResult>;

  pageCount(pdf: PdfInput): Promise<number>;
}
```

### PdfOcrOptions

```ts
interface PdfOcrOptions {
  engine: OcrEngine | OcrEngineWorker;     // an already-created engine
  scale?: number;                           // default 2 (2x render resolution)
  workerSrc?: string;                       // pdfjs worker URL, defaults to jsDelivr CDN
  recognize?: RecognizeOptions;             // forwarded to engine.recognize
  onPageProgress?: (current: number, total: number, page: number) => void;
}
```

#### `engine`

Reusing the same `engine` is critical — don't create a new engine per PDF; loading the session is expensive.

#### `scale`

PDFs are vector; `scale` controls the rasterization target resolution. Default 2 means 2x (a 72 DPI PDF renders at the equivalent of 144 DPI).

| scale | Visual quality | Memory | Speed | Use for |
|---|---|---|---|---|
| 1 | Blurry | 1x | 1x | Quick previews; the model struggles |
| 2 | Sharp | 4x | 2-3x | **Default — most use cases** |
| 3 | Crisp | 9x | 5x | Small fonts / scanned text |
| 4 | Oversampled | 16x | 10x | Edge cases; usually no gain |

#### `workerSrc`

pdfjs needs its own worker (`pdf.worker.min.mjs`). By default it's loaded from jsDelivr (auto-matched to the pdfjs-dist version).

For offline / strict CSP: host the file yourself and pass the full URL.

#### `onPageProgress`

Fires per completed page when processing multiple pages. `current` is 1-based.

```ts
onPageProgress: (cur, total, page) => {
  console.log(`processing page ${page}: ${cur}/${total}`);
}
```

### `recognize` overloads in detail

#### Single page

```ts
const text: string = await pdfOcr.recognize(file, 3);  // page 3
```

Returns the page's `fullText` (all lines joined by `\n`).

#### All pages

```ts
const result = await pdfOcr.recognize(file);
// equivalent to await pdfOcr.recognize(file, "all")
// result = { 1: { text, lines, durationMs }, 2: {...}, ... }
```

#### Selected pages

```ts
const result = await pdfOcr.recognize(file, [1, 3, 5]);
// result = { 1: {...}, 3: {...}, 5: {...} }
```

Page numbers are sorted before processing. Duplicates are deduplicated to the extent JS object key uniqueness does (a repeated page produces a single result).

### PdfRecognizeResult

```ts
type PdfRecognizeResult = Record<number, PdfPageRecognizeResult>;

interface PdfPageRecognizeResult {
  text: string;          // fullText for the page
  lines: OcrLine[];      // every line on the page
  durationMs: number;    // page processing time (excludes PDF loading)
}
```

The keys are numbers (not strings), but TS-compiled access works either way: `result[1]` and `result["1"]` both work.

### `pageCount`

```ts
const n: number = await pdfOcr.pageCount(file);
```

No OCR is performed — just opens the PDF, reads the page count, and disposes immediately. Useful for "which pages can I pick" UIs.

## PdfInput

```ts
type PdfInput =
  | ArrayBuffer
  | Uint8Array
  | Blob       // File extends Blob, so input.files[0] works
  | string;    // URL (subject to CORS)
```

## Performance expectations

M2 Mac, WASM single-threaded, scale=2:

| PDF type | Per-page time |
|---|---|
| A4 vector PDF (5–15 lines of printed text) | ~1–2s |
| A4 scan (30–50 lines, handwritten or printed) | ~3–5s |
| Two-column paper | ~3–4s |
| Poster / cover (sparse, large text) | <1s |

A 10-page vector PDF takes ~10–20s end-to-end.

## What it won't do

- ❌ **Won't use the PDF's embedded text layer**. PdfOcr is a pure image-OCR path designed for scans. If your PDF already has a text layer, extracting via `pdfjs-dist` is faster and more accurate.
  - **How to check**: try [pdfjs `getTextContent()`](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib.PDFPageProxy.html). If it returns non-empty text, use it; otherwise fall back to OCR.
- ❌ **Won't recognize table structure**. Cells get OCR'd row-by-row, but column relationships are lost. PP-Structure is on the roadmap for Phase 4.
- ❌ **Won't recover formatting** (bold/italic/font size/color).

## Full example

```ts
import { OcrEngineWorker } from "@ocr-web/core";
import OcrWorker from "@ocr-web/core/worker?worker";
import { ppocrV5 } from "@ocr-web/models-ppocrv5";
import { PdfOcr } from "@ocr-web/pdf";

const engine = await OcrEngineWorker.create({
  worker: new OcrWorker(),
  models: { detection: ppocrV5.detection, recognition: ppocrV5.recognition },
  dictionary: ppocrV5.dictionary,
  wasmPaths: `${location.origin}/ort/`,
});

const pdfOcr = new PdfOcr({
  engine,
  scale: 2,
  onPageProgress: (cur, total, page) => {
    document.getElementById("status")!.textContent = `${cur}/${total} (page ${page})`;
  },
});

document.getElementById("file")!.addEventListener("change", async (e) => {
  const file = (e.target as HTMLInputElement).files![0];
  const result = await pdfOcr.recognize(file);  // all pages
  for (const page of Object.keys(result).map(Number)) {
    console.log(`Page ${page}:`, result[page].text);
  }
});

// release when done
await engine.dispose();
```
