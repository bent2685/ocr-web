# Troubleshooting

## Install phase

### `Cannot find module 'onnxruntime-web'`

`onnxruntime-web` is a peer dependency. Install it explicitly:

```bash
pnpm add onnxruntime-web
```

### `Module not found: @ocr-web/core/worker`

Make sure `@ocr-web/core` ≥ 0.2.0:
```bash
pnpm view @ocr-web/core version
```

Older versions (0.1.x) didn't expose the `/worker` entry. Upgrade:
```bash
pnpm up @ocr-web/core@latest
```

## Initialization phase

### `Failed to fetch ort-wasm-simd-threaded.wasm` (404)

The wasm files weren't copied to the `wasmPaths` location.

- Vite: check `viteStaticCopy` in `vite.config.ts` — `dest: "ort"` must match `wasmPaths: "/ort/"` in code
- Open the Network panel and inspect the wasm request URL — does it match?
- In Worker mode with a relative `wasmPaths` → switch to `${location.origin}/ort/`

### `Failed to fetch detection from ...` (CORS / network)

- Network: can you `curl` that URL locally?
- CORS: any "blocked by CORS" warning in the browser console?
  - Use `ppocrV5.detection` (jsDelivr CDN, CORS-enabled) and you're done
  - If self-hosting, ensure responses include `Access-Control-Allow-Origin: *`

### Hangs mid-load with no error

Worker startup failed silently. Usually:
- Webpack/Rspack didn't recognize `?worker` syntax → switch to `new Worker(new URL(...), { type: "module" })`
- CSP blocks the worker → check the `worker-src` directive

## Recognition phase

### Throws `Got invalid dimensions for input: x for the following indices index: 2 Got: ... Expected: ...`

Model and core versions don't match.
- v5 rec input height is 32 (v4 is 48)
- Pairing `@ocr-web/models-ppocrv5` with `@ocr-web/core` won't trip this

### Empty result / `lines.length === 0`

Most likely first:

1. **det found no boxes** → lower `detThreshold` to 0.2
2. **Image too small** → ensure width/height ≥ 32px before `recognize()`
3. **Pure white / pure black image** → nothing to recognize
4. **`maxSideLen` too small** → a huge image scaled to 32x32 is effectively blank

Debug: render the probability map (see the spike code or [Architecture](./architecture.md)).

### Accuracy worse than expected

See [Tuning guide](./tuning.md).

### Garbage characters in output

Usually a **dictionary/model mismatch**:
- v4 model + v5 dict → many off-by-one mappings
- v5 model + v4 dict (6623 chars) → output dim is wrong, should error on dimension mismatch

Verify:
```ts
const dict = await fetch(ppocrV5.dictionary).then(r => r.text());
console.log(dict.split("\n").filter(l => l).length);  // should be 18383
```

### Chinese commas become English commas / fullwidth becomes halfwidth

**This is a model property, not a bug.** PP-OCRv5's training data mixes CJK and Latin punctuation, so it tends toward the more common form. If your business needs the original fullwidth chars preserved, post-process:
```ts
const normalized = result.fullText.replace(/,/g, "，").replace(/\?/g, "？");
```

## Performance phase

### Each page takes seconds — slow

- Main-thread version → switch to Worker (no faster, but UI stays responsive)
- Many lines → batching is already on, can't go faster
- Real bottleneck: rec dominates. No short-term fix. The WebGPU backend will be 2–3x faster — wait for v0.4.

### Workers boot slowly

Each `OcrEngineWorker.create()` reloads ort and the models, ~600ms. **Don't create a new engine per recognize**; reuse one instance.

## PDF

### `Setting up fake worker failed: ...`

The pdfjs worker URL is unreachable. Check the Network panel for `pdf.worker.min.mjs`.

For projects with strict CSP, add `https://cdn.jsdelivr.net` to `worker-src`, or self-host the file and pass `workerSrc`.

### Large PDF is slow / hangs

- 50+ pages at once uses a lot of memory (one OffscreenCanvas per page)
- Process page-by-page instead: loop `recognize(pdf, [n])`

### PDF already has a text layer — OCR isn't needed

Right — don't use PdfOcr. Extract directly with pdfjs:
```ts
const page = await doc.getPage(n);
const txt = await page.getTextContent();
const text = txt.items.map(i => "str" in i ? i.str : "").join(" ");
```

For the full decision logic, see [Recipes — Smart PDF extraction](./recipes.md#smart-pdf-extraction-use-pdfjs-if-text-layer-exists-otherwise-ocr).

## Deployment phase

### wasm 404 on GitHub Pages

`base` is misconfigured in `vite.config.ts`. GH Pages serves under `/<repo>/`:
```ts
base: process.env.GITHUB_PAGES === "1" ? "/your-repo/" : "/",
```

And in code, build `wasmPaths` from `import.meta.env.BASE_URL`:
```ts
wasmPaths: `${location.origin}${import.meta.env.BASE_URL}ort/`,
```

### Bundle size is huge

26MB is the size of the ort wasm (unavoidable — that's the cost of ML inference). Optimization paths:
- Use `ort-wasm-simd-threaded.wasm` (13MB) instead of `.jsep.wasm` (26MB) if you don't need WebGPU
  - With vite-plugin-static-copy, filter by filename to only copy what you need
- The wasm on jsDelivr is browser-cached, downloaded once

### Electron / `file://` dictionary loads weirdly (≤ v0.2.0)

Up to v0.2.0, `fetchDictionary` only recognized `http://` `https://` `/` `./` `../` — **`file://` wasn't on the allowlist** — so it would treat the entire URL string as the dictionary content, producing garbage results.

- **Fix**: upgrade to `@ocr-web/core@0.2.1+` (uses `new URL()`, covers all protocols)
- **Workaround**: fetch + `text()` yourself and pass `string[]`:
  ```ts
  const dictText = await (await fetch(dictUrl)).text();
  const dict = dictText.split("\n").filter(Boolean);
  await OcrEngine.create({ ..., dictionary: dict });
  ```

## I read all the docs and it still doesn't work

File an issue: https://github.com/bent2685/ocr-web/issues

Include:
- Browser version
- Console error
- A repro PDF/image (if not sensitive)
- Versions of the `@ocr-web/*` packages (`pnpm list | grep ocr-web`)
