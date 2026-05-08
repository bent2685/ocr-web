# Architecture & internals

## Data flow

```
┌─ User input ─────────────────────────┐
│ HTMLCanvas / Blob / URL / ImageBitmap│
└─────────┬────────────────────────────┘
          │ normalizeInput
          ▼
   ┌─ NormalizedImage ─┐
   │ Uint8ClampedArray │ ← RGBA pixels
   │ width, height     │
   └─────────┬─────────┘
             │
             ▼
┌─ Detection ────────────────────────┐
│ resize to multiples of 32, max 960  │
│ normalize (mean/std)                │
│ → Tensor [1,3,H,W]                  │
│ ort.run(det.onnx)                   │
│ ← Tensor [1,1,H,W] sigmoid probs    │
│                                     │
│ binarize (threshold=0.3)            │
│ connected components, 8-adjacency   │
│ convex hull (Andrew monotone chain) │
│ minAreaRect (rotating calipers)     │
│ unclip (area*ratio/perimeter)       │
│ box-score filtering                 │
│ scale boxes back to original coords │
└─────────┬───────────────────────────┘
          │ InternalDetBox[]
          ▼
┌─ Recognition ──────────────────────┐
│ for each box:                       │
│   perspective warp → (W, height)    │
│   resize to height 32               │
│   normalize ((v/255-0.5)/0.5)       │
│ batch (groups of 8) padded to W     │
│ → Tensor [N,3,32,W]                 │
│ ort.run(rec.onnx)                   │
│ ← Tensor [N,T,18385] CTC logits     │
│ for each row:                       │
│   greedy decode (collapse + drop blank) │
│   dictionary lookup                 │
└─────────┬───────────────────────────┘
          │ OcrLine[]
          ▼
┌─ Sort & Output ────────────────────┐
│ by y (60% line-height tolerance), then x │
│ join("\n") → fullText              │
└─────────┬───────────────────────────┘
          ▼
       OcrResult
```

## Why not opencv-js

The SDD §6.1 listed opencv-js as a candidate, but we chose pure JS in the end.

Reasons:
1. **Size**: opencv-js is 4MB+ in full, 1MB+ even with tree-shaken sub-bundles — over the SDD §3.2 N-3 budget of 4MB gzipped.
2. **Loading**: opencv-js is an async wasm module; chaining its init with ort-web pushes first-paint to 2–3s.
3. **Control**: a pure JS implementation makes every step's behavior explicit — bugs are easy to reproduce.
4. **Sufficient**: the operator set DBNet post-processing needs is tiny (connected components, convex hull, minAreaRect, unclip) — under 200 lines hand-written.

The trade-off: our unclip uses a rectangle expansion (PaddleOCR uses Clipper to offset the actual polygon). Measured impact on OCR results is negligible.

## Why unclip is rectangle-based

PaddleOCR (Python):
```python
distance = poly.area * ratio / poly.length
expanded = pyclipper.Execute(distance)
new_box = minAreaRect(expanded)
```

Us:
```ts
const rect = minAreaRect(hull);
const distance = rect.area * ratio / rect.perimeter;
const expanded = { ...rect, w: rect.w + 2*d, h: rect.h + 2*d };
```

Difference:
- PaddleOCR offsets the original **polygon**, then fits a rectangle.
- We expand the rectangle directly.

Mathematically, for "near-rectangular" shapes (typical text boxes), the two approaches produce final rectangles that differ by < 5%. Negligible for OCR cropping.

A faithful reproduction would pull in the Clipper library (30KB+) and a polygon offset algorithm (200+ lines). Not worth the cost.

## CTC decoding

PP-OCRv5 rec outputs `[N, T, C]`, with C = 18385:
- idx 0 = blank (CTC's special token)
- idx 1..18384 = dictionary characters (`ppocrv5_dict.txt` + a trailing space)

Greedy decode steps:
1. Take argmax (largest-logit idx) at each timestep t.
2. Collapse consecutive duplicates (CTC assumption): `A A blank A` → `A A`.
3. Drop blanks: `A A` stays `A A`; `A blank A` decodes to `AA`.

Pseudocode:
```
out = []
prev = -1
for idx in argmax_per_t:
    if idx != 0 and idx != prev:
        out.append(dict[idx - 1])
    prev = idx
```

Why not beam search: greedy is already good enough (90%+ char accuracy); beam search costs 5–10x compute for < 2% improvement. Not worth it.

## Dictionary loading convention

`ppocrv5_dict.txt` has 18383 lines, one character per line. PaddleOCR's loader **appends a trailing space**:

```
chars = file.split("\n").filter(non_empty) + [" "]
// chars.length == 18384
// CTC C = chars.length + 1 = 18385  ✓
```

Without the trailing space, every space character in the output gets misaligned.

## Perspective warp (rec crop)

det produces 4 corner points — possibly an arbitrarily rotated rectangle. rec expects upright `[N, 3, 32, W]` horizontal text.

Steps:
1. Solve an 8x8 linear system for the 3x3 homography H (src → dst).
2. Compute H⁻¹.
3. For each destination pixel (x, y), backwards-map via H⁻¹ and bilinear-sample the source.

Gauss-Jordan elimination solves the system (in `crop.ts`); bilinear sampling is in the same file. About 100 lines.

## Worker communication

When the main thread calls `OcrEngineWorker.recognize()`:
1. `normalizeInput(input)` → `{data, w, h}` (done on the main thread to keep the worker free of DOM types).
2. Transfer `data.buffer` zero-copy to the worker.
3. The worker reconstructs `new ImageData(data, w, h)`.
4. Worker runs `OcrEngine.recognize` and returns `OcrResult`.
5. RPC `id` correlates the response back to the originating Promise.

The RPC protocol is hand-written (~50 lines, `rpc.ts`). We didn't use comlink — its dependency footprint was too heavy; a custom impl is leaner.

## Size budget (v0.3)

| Item | gzipped |
|---|---|
| @ocr-web/core | ~6KB |
| @ocr-web/core/worker | ~110KB (includes all ort binding code) |
| @ocr-web/pdf | ~1KB (pdfjs is separate) |
| @ocr-web/models-ppocrv5 | < 1KB (just URL constants) |
| onnxruntime-web wasm | ~13MB unzipped — **the dominant cost** |
| pdfjs-dist | ~300KB |
| PP-OCRv5 models (fetched on demand at runtime) | det 4.6MB + rec 16MB + dict 72KB |

First paint: ~14MB (wasm + js). Models are pulled on demand; the first OCR adds ~21MB.

## Model hosting

GitHub Release downloads 302-redirect to `release-assets.githubusercontent.com`, **which doesn't return CORS headers** → direct browser fetches are blocked.

Solution: also commit the models to git under `/models/`, distributed via jsDelivr CDN:
```
https://cdn.jsdelivr.net/gh/bent2685/ocr-web@v0.1.1/models/...
```
- jsDelivr returns `Access-Control-Allow-Origin: *`
- Git tags lock the version, so changes to main don't break consumers
- File-level caching (CDN caches a tag's files permanently)

## Things v0.x won't do

- ❌ WebGPU backend (occasional precision issues; waiting for ort 1.26+)
- ❌ Node backend (the goal is browser; adding Node would require ort-node and `wasmPaths` switching)
- ❌ React Native backend (would need onnxruntime-react-native)
- ❌ cls model (PP-OCRv5 didn't ship one; users can BYO v2 cls)
- ❌ PP-Structure (tables / formulas)

## Module dependency graph

```
core/
├── index.ts ─── exports
├── engine.ts ── OcrEngine (main thread)
├── engine-worker.ts ── OcrEngineWorker
├── worker.ts ── worker entry, runs in the worker
├── rpc.ts ──── postMessage protocol
├── input.ts ── ImageInput → NormalizedImage
├── runtime.ts ── ort config + fetch progress
├── geometry.ts ── convex hull / minAreaRect / unclip
├── types.ts ── shared types
├── det/
│   ├── preprocess.ts
│   ├── postprocess.ts ── connected components + geometry + scoring
│   └── module.ts ──── DetectionModule
└── rec/
    ├── crop.ts ──── perspective warp
    ├── preprocess.ts
    ├── decode.ts ── CTC greedy
    └── module.ts ── RecognitionModule (with batching)

pdf/
└── pdf-ocr.ts ── PdfOcr, pdfjs render → engine.recognize
```
