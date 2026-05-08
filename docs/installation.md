# 安装与构建配置

各种打包工具下，怎么让 onnxruntime-web 的 wasm 文件、worker 文件能被正确加载。

## 通用要求

无论哪种打包工具，**必须满足以下三点**：

1. **wasm 文件可以被 fetch**：onnxruntime-web 自带的 `*.wasm` 必须在某个静态路径下（默认 `/`，可以通过 `wasmPaths` 改）
2. **worker 文件能被实例化**：`@ocr-web/core/worker` 入口要被打包工具识别为 Worker
3. **构建 target 是 esnext**：库和 worker 用了顶层 await

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

业务代码：

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

业务代码用原生 ES Module Worker 语法：

```ts
const worker = new Worker(new URL("@ocr-web/core/worker", import.meta.url), { type: "module" });
const engine = await OcrEngineWorker.create({
  worker,
  wasmPaths: "/ort/",
  // ...
});
```

## Next.js

OCR 必须在客户端跑（用了 wasm + canvas），所以组件要用 `"use client"`。

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

`next.config.js`：

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

注意 wasmPaths 要改成 `/_next/static/ort/`。

## Electron renderer

跟浏览器一样，但用 file:// 协议时有几个注意点：

- **wasmPaths 必须用绝对 path 或 file://** — 相对路径在 file:// 下解析会乱
- **不能开 SharedArrayBuffer** — 多线程 wasm 跑不了，只能单线程

```ts
const engine = await OcrEngineWorker.create({
  worker: new OcrWorker(),
  wasmPaths: `file://${__dirname}/ort/`,  // 或者打成 asar 后的路径
  numThreads: 1,
});
```

## CDN / 不打包（HTML 直接用）

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

CDN 模式只能用主线程版（worker 跨域受限）。

## SvelteKit / Nuxt / Astro

跟 Vite 一样（它们底层都是 Vite），照抄 Vite 配置。注意把组件标记为 client-only。

## 检查是否配对了

打开浏览器 DevTools Network 面板，应该能看到这些请求都是 200：

- `/ort/ort-wasm-simd-threaded.wasm`（约 13MB）
- `/ort/ort-wasm-simd-threaded.mjs`（小）
- 模型文件（如果用 jsDelivr，从 cdn.jsdelivr.net）

如果有 404，回到对应章节检查 wasmPaths。
