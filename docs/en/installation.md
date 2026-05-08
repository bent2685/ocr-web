# Installation & build configuration

How to make the onnxruntime-web wasm files and the worker file load correctly across different bundlers.

## Universal requirements

Whatever bundler you use, **all three of these must be true**:

1. **The wasm files are fetchable** — onnxruntime-web's `*.wasm` files must live at some static path (default `/`, override via `wasmPaths`).
2. **The worker file can be instantiated** — the `@ocr-web/core/worker` entry must be recognized as a Worker by your bundler.
3. **Build target is esnext** — the library and its worker use top-level await.

## Vite

```ts
// vite.config.ts
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

Application code:

```ts
import OcrWorker from "@ocr-web/core/worker?worker";
const engine = await OcrEngineWorker.create({
  worker: new OcrWorker(),
  wasmPaths: "/ort/",
  // ...
});
```

## Webpack 5+ / Rspack

```js
// webpack.config.js
const CopyPlugin = require("copy-webpack-plugin");

module.exports = {
  // ...
  plugins: [
    new CopyPlugin({
      patterns: [
        { from: "node_modules/onnxruntime-web/dist", to: "ort", filter: f => /\.(wasm|mjs)$/.test(f) },
      ],
    }),
  ],
  experiments: { topLevelAwait: true, asyncWebAssembly: true },
};
```

Application code uses native ES Module Worker syntax:

```ts
const worker = new Worker(new URL("@ocr-web/core/worker", import.meta.url), { type: "module" });
const engine = await OcrEngineWorker.create({
  worker,
  wasmPaths: "/ort/",
  // ...
});
```

## Next.js

OCR has to run on the client (it uses wasm + canvas), so the component must use `"use client"`.

```tsx
// app/ocr-page.tsx
"use client";
import { useEffect, useState } from "react";
import { OcrEngineWorker } from "@ocr-web/core";
import { ppocrV5 } from "@ocr-web/models-ppocrv5";

export default function OcrPage() {
  const [engine, setEngine] = useState<OcrEngineWorker | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // dynamic import to avoid SSR
      const OcrWorker = (await import("@ocr-web/core/worker?worker")).default;
      const e = await OcrEngineWorker.create({
        worker: new OcrWorker(),
        models: { detection: ppocrV5.detection, recognition: ppocrV5.recognition },
        dictionary: ppocrV5.dictionary,
        wasmPaths: `${location.origin}/ort/`,
      });
      if (!cancelled) setEngine(e);
    })();
    return () => { cancelled = true; engine?.dispose(); };
  }, []);

  // ...
}
```

`next.config.js`:

```js
const CopyPlugin = require("copy-webpack-plugin");
module.exports = {
  webpack(config, { isServer }) {
    if (!isServer) {
      config.plugins.push(
        new CopyPlugin({
          patterns: [{ from: "node_modules/onnxruntime-web/dist/*.wasm", to: "static/ort/[name][ext]" }],
        }),
      );
    }
    return config;
  },
};
```

Note that `wasmPaths` becomes `/_next/static/ort/`.

## Electron renderer

Same as the browser, except a few caveats apply when using the `file://` protocol:

- **`wasmPaths` must be an absolute path or `file://` URL** — relative paths resolve incorrectly under `file://`.
- **SharedArrayBuffer is unavailable** — multi-threaded wasm cannot run, so you're stuck with a single thread.

```ts
const engine = await OcrEngineWorker.create({
  worker: new OcrWorker(),
  wasmPaths: `file://${__dirname}/ort/`,  // or a path inside your asar bundle
  numThreads: 1,
});
```

## CDN / no bundler (plain HTML)

```html
<script type="importmap">
{
  "imports": {
    "@ocr-web/core": "https://cdn.jsdelivr.net/npm/@ocr-web/core/dist/index.js",
    "@ocr-web/models-ppocrv5": "https://cdn.jsdelivr.net/npm/@ocr-web/models-ppocrv5/dist/index.js",
    "onnxruntime-web": "https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/ort.mjs"
  }
}
</script>
<script type="module">
import { OcrEngine } from "@ocr-web/core";
import { ppocrV5 } from "@ocr-web/models-ppocrv5";

const engine = await OcrEngine.create({
  models: { detection: ppocrV5.detection, recognition: ppocrV5.recognition },
  dictionary: ppocrV5.dictionary,
  wasmPaths: "https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/",
});
</script>
```

In CDN mode you can only use the main-thread version (cross-origin workers are blocked).

## SvelteKit / Nuxt / Astro

Same as Vite (they all use Vite under the hood) — copy the Vite config. Mark the component as client-only.

## How to verify it's wired up

Open DevTools → Network. You should see these requests return 200:

- `/ort/ort-wasm-simd-threaded.wasm` (~13MB)
- `/ort/ort-wasm-simd-threaded.mjs` (small)
- The model files (from `cdn.jsdelivr.net` if using jsDelivr)

If you see 404s, revisit the relevant section above and check `wasmPaths`.
