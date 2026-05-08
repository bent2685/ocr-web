# ocr-web

PP-OCRv5 浏览器/Electron 端推理库。基于 onnxruntime-web，无 native binding，无 sidecar。

> 状态：v0.1.0-dev — 核心管线已跑通，端到端可用。完整设计见 [`ocr-web-sdd.md`](./ocr-web-sdd.md)。

## 包

| 包 | 说明 |
|---|---|
| [`@ocr-web/core`](./packages/core) | 引擎主体（det + rec + CTC，Worker 支持，纯 JS 几何，~20KB ESM） |
| [`@ocr-web/models-ppocrv5`](./packages/models-ppocrv5) | PP-OCRv5 模型 URL（jsDelivr CDN，带 CORS） |
| [`@ocr-web/pdf`](./packages/pdf) | PDF 文本提取（pdfjs-dist 渲染 + OCR） |

## 快速开始

```bash
pnpm install
pnpm example       # 启动 examples/browser，浏览器打开 http://localhost:5181
pnpm test          # 运行单元测试
pnpm build         # 构建所有 packages
```

## 用法

```ts
import { OcrEngine } from "@ocr-web/core";
import { ppocrV5 } from "@ocr-web/models-ppocrv5";

const engine = await OcrEngine.create({
  models: {
    detection: ppocrV5.detection,
    recognition: ppocrV5.recognition,
  },
  dictionary: ppocrV5.dictionary,
  wasmPaths: "/ort/", // 你需要让 onnxruntime-web 的 wasm 文件可被加载到这里
});

const result = await engine.recognize(canvas); // 也支持 Blob / ImageBitmap / ImageData / URL
console.log(result.fullText);
console.log(result.lines); // [{ text, box, confidence }, ...]

await engine.dispose();
```

## 仓库结构

```
ocr-web/
├── packages/
│   ├── core/                # @ocr-web/core
│   └── models-ppocrv5/      # @ocr-web/models-ppocrv5
├── examples/
│   └── browser/             # 完整浏览器 demo
├── ocr-web-sdd.md           # 解决方案设计文档
└── README.md
```

## Phase 1 完成情况

- ✅ det/rec 全链路（cls 跳过，PP-OCRv5 未发布独立 cls 模型）
- ✅ 中英文混排、emoji、多语言字典（18384 字符）
- ✅ 单页 4-13 行 ~0.5-1.5s（M2 Mac, WASM 单线程）
- ✅ 核心包 19KB ESM（远低于 SDD 4MB 预算，不含 onnxruntime-web peer）
- ✅ 13 个单元测试覆盖几何 + CTC
- ✅ 工作 example
- ⏳ npm 发布（待完成回归测试）

## Live demo

https://bent2685.github.io/ocr-web/

## 完整文档

详见 [`docs/`](./docs/README.md) — 包括 [快速开始](./docs/getting-started.md)、[各打包工具配置](./docs/installation.md)、[完整 API](./docs/api-core.md)、[PDF 用法](./docs/api-pdf.md)、[Worker vs 主线程](./docs/worker-vs-main.md)、[调参指南](./docs/tuning.md)、[排错](./docs/troubleshooting.md)、[食谱](./docs/recipes.md)、[架构原理](./docs/architecture.md)。

## 版本进展

- **v0.1.0** — det/rec 全链路（主线程版本）
- **v0.2.0** — Web Worker（UI 不卡）+ rec 批处理 + 加载进度回调 + Live demo
- **v0.3.0**（当前）— `@ocr-web/pdf` PDF 文本提取
- **未来** — WebGPU / Node backend / PP-OCRv6 / PP-Structure

完整 roadmap 见 [SDD §7](./ocr-web-sdd.md#7-路线图roadmap)。

## License

MIT
