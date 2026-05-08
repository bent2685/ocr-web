# ocr-web

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![@ocr-web/core](https://img.shields.io/npm/v/@ocr-web/core.svg?label=%40ocr-web%2Fcore)](https://www.npmjs.com/package/@ocr-web/core)
[![@ocr-web/pdf](https://img.shields.io/npm/v/@ocr-web/pdf.svg?label=%40ocr-web%2Fpdf)](https://www.npmjs.com/package/@ocr-web/pdf)
[![@ocr-web/models-ppocrv5](https://img.shields.io/npm/v/@ocr-web/models-ppocrv5.svg?label=models-ppocrv5)](https://www.npmjs.com/package/@ocr-web/models-ppocrv5)

PP-OCRv5 在浏览器与 Electron 中的推理库。基于 [`onnxruntime-web`](https://github.com/microsoft/onnxruntime) 的纯 JavaScript 实现 —— 无 native binding、无 sidecar、无需后端服务。

> 🇬🇧 [English README](./README.md) · 📚 [文档](./docs/README.md)（[中文](./docs/zh-CN/getting-started.md) / [English](./docs/en/getting-started.md)）· 🔗 [在线 Demo](https://bent2685.github.io/ocr-web/)

## 功能

- **PP-OCRv5 检测 + 识别全流程** —— DBNet 文本检测、CRNN + CTC 贪心解码识别，多语言字典共 18,384 个字符（覆盖中日韩、拉丁字母、数字、常见标点与 emoji）。
- **Web Worker 模式** —— 完整推理流程跑在 Worker 线程，识别期间主线程 UI 不卡顿。
- **流式模型加载进度** —— 提供字节级 `onProgress` 回调，分别上报 detection / recognition 模型的下载进度。
- **识别批处理** —— 多行文本通过 padding 后合并为单个 `[N, 3, 32, W]` rec batch 一次推理。
- **多种图片输入** —— `HTMLCanvasElement`、`OffscreenCanvas`、`ImageData`、`ImageBitmap`、`Blob` / `File`、URL 字符串。
- **PDF 文本提取** —— `@ocr-web/pdf` 通过 [`pdfjs-dist`](https://github.com/mozilla/pdf.js) 渲染每页后调用 OCR，支持单页、全部页、指定页提取，并提供逐页进度回调。
- **后处理参数可调** —— `recognize()` 每次调用都可覆盖 `detThreshold`、`detBoxThreshold`、`unclipRatio`、`maxSideLen`、`minBoxSize`。
- **模型 URL 独立成包** —— `@ocr-web/models-ppocrv5` 仅包含 URL 常量（jsDelivr CDN，带 CORS）；如需鉴权或自托管，可直接传 `ArrayBuffer` / `Uint8Array`。
- **小体积、可 tree-shake、ESM + CJS 双产物** —— core 的 JS 产物在数十 KB 量级；`onnxruntime-web` 作为 peer dependency 由调用方安装。

## 包

| 包 | 说明 |
|---|---|
| [`@ocr-web/core`](./packages/core) | 推理引擎 —— det + rec + CTC，提供主线程 (`OcrEngine`) 与 Worker (`OcrEngineWorker`) 两种入口 |
| [`@ocr-web/models-ppocrv5`](./packages/models-ppocrv5) | PP-OCRv5 模型 URL（detection / recognition / 字典），通过 jsDelivr 分发 |
| [`@ocr-web/pdf`](./packages/pdf) | PDF 文本提取（pdfjs-dist 渲染 + OCR） |

## 安装

```bash
pnpm add @ocr-web/core @ocr-web/models-ppocrv5 onnxruntime-web
# 如需 PDF 提取：
pnpm add @ocr-web/pdf
```

`onnxruntime-web` 是 **peer dependency**，必须显式安装。其 `*.wasm` 文件需要通过 `wasmPaths`（默认 `/`）告知引擎可访问的位置。Vite、Webpack、Next.js、Electron、CDN 等场景的具体配置见 [安装与构建配置](./docs/zh-CN/installation.md)。

## 使用

### 主线程引擎（适合 demo 与一次性脚本）

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

### Worker 引擎（推荐用于生产）

```ts
import { OcrEngineWorker } from "@ocr-web/core";
import OcrWorker from "@ocr-web/core/worker?worker"; // Vite 语法
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

### PDF 提取

```ts
import { PdfOcr } from "@ocr-web/pdf";

const pdfOcr = new PdfOcr({ engine });

const text = await pdfOcr.recognize(file, 1);          // 单页 → string
const all  = await pdfOcr.recognize(file);             // 全部页 → { [page]: { text, lines, durationMs } }
const some = await pdfOcr.recognize(file, [1, 3, 5]);  // 指定页
```

React、Vue、Next.js、Electron 的接入示例见 [食谱](./docs/zh-CN/recipes.md)。

## 仓库结构

```
ocr-web/
├── packages/
│   ├── core/                # @ocr-web/core
│   ├── models-ppocrv5/      # @ocr-web/models-ppocrv5
│   └── pdf/                 # @ocr-web/pdf
├── examples/
│   └── browser/             # 完整浏览器 demo
├── docs/
│   ├── en/                  # English documentation
│   └── zh-CN/               # 中文文档
├── models/                  # PP-OCRv5 ONNX 资产，通过 jsDelivr 分发
├── README.md                # English README
└── README.zh-CN.md          # 中文 README
```

## 开发

```bash
pnpm install
pnpm build          # 构建所有 packages
pnpm test           # 运行单元测试
pnpm example        # 启动 examples/browser，访问 http://localhost:5181
pnpm lint           # biome check
pnpm format         # biome format --write
```

要求 Node.js ≥ 20，pnpm 10。源码使用 TypeScript，打包工具为 [`tsup`](https://tsup.egoist.dev/)，测试使用 [`vitest`](https://vitest.dev/)，lint 与格式化使用 [Biome](https://biomejs.dev/)。

## 浏览器支持

支持 WebAssembly 与 `OffscreenCanvas` 的现代 Chromium、Firefox、Safari。多线程 WASM 还需要 `SharedArrayBuffer`，即页面需提供 `Cross-Origin-Opener-Policy: same-origin` 与 `Cross-Origin-Embedder-Policy: require-corp` 响应头；条件不满足时引擎自动回退到单线程执行。

## 参与贡献

欢迎在 [github.com/bent2685/ocr-web](https://github.com/bent2685/ocr-web) 提 issue 与 PR。提交 PR 前请先运行 `pnpm lint` 与 `pnpm test`。

## 鸣谢

本项目离不开以下工作的支持：

- **[PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR)**（百度）—— PP-OCRv5 检测与识别模型、字典文件，以及本库参照实现的 Python 原版。
- **[ONNX Runtime Web](https://github.com/microsoft/onnxruntime)**（Microsoft）—— 浏览器中基于 WebAssembly 的 ONNX 推理。
- **[PDF.js (`pdfjs-dist`)](https://github.com/mozilla/pdf.js)**（Mozilla）—— `@ocr-web/pdf` 用于 PDF 页面光栅化。
- **[jsDelivr](https://www.jsdelivr.com/)** —— 提供带 CORS 头的免费 CDN，分发 PP-OCRv5 ONNX 资产与字典。
- DBNet、CRNN、CTC 相关研究工作 —— 本库端到端复现了上述算法。

## 反馈
- **issue：** 任何问题都可以在本仓库中发表issue。
- **友情链接：** [LINUX DO](https://linux.do/) - 一个面向技术爱好者的中文社区，本项目链接并认可 LINUX DO，欢迎佬友交流和反馈

## 协议

[MIT](./LICENSE) © ocr-web contributors.

仓库内重新分发的 PP-OCRv5 模型由百度以 [Apache License 2.0](https://github.com/PaddlePaddle/PaddleOCR/blob/main/LICENSE) 协议发布。
