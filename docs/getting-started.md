# 快速开始

5 分钟在 Vite 项目里跑通 OCR。

## 1. 装包

```bash
pnpm add @ocr-web/core @ocr-web/models-ppocrv5 onnxruntime-web
# 如果还要 PDF：
pnpm add @ocr-web/pdf
```

`onnxruntime-web` 是 **peer dependency**，必须显式安装。

## 2. 配 Vite — 拷贝 wasm

`vite.config.ts`：

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

> Webpack/Next.js/其他打包工具的配置见 [安装与构建配置](./installation.md)。

## 3. 业务代码

### 最简：图片识别（主线程版，~10 行）

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

⚠️ 主线程版本会**冻结 UI** 1-2 秒。生产场景请用下面的 Worker 版本。

### 推荐：Worker 模式（UI 不卡）

```ts
import { OcrEngineWorker } from "@ocr-web/core";
import OcrWorker from "@ocr-web/core/worker?worker";  // Vite 语法
import { ppocrV5 } from "@ocr-web/models-ppocrv5";

const engine = await OcrEngineWorker.create({
  worker: new OcrWorker(),
  models: { detection: ppocrV5.detection, recognition: ppocrV5.recognition },
  dictionary: ppocrV5.dictionary,
  wasmPaths: `${location.origin}/ort/`,  // worker 里要绝对路径
  onProgress: ({ loaded, total, file }) => {
    console.log(`${file}: ${(loaded / total * 100).toFixed(0)}%`);
  },
});

const result = await engine.recognize(bitmap);
console.log(result.fullText, result.lines);
```

### PDF 提取

```ts
import { PdfOcr } from "@ocr-web/pdf";

const pdfOcr = new PdfOcr({ engine });

const text  = await pdfOcr.recognize(pdfFile, 3);          // 单页 → string
const all   = await pdfOcr.recognize(pdfFile);             // 全部 → object
const some  = await pdfOcr.recognize(pdfFile, [1, 3, 5]);  // 指定 → object

console.log(all[1].text);
console.log(all[2].text);
```

## 4. 输入类型

`recognize()` 接受这些图片输入：

```ts
type ImageInput =
  | HTMLCanvasElement
  | OffscreenCanvas
  | ImageData
  | ImageBitmap
  | Blob              // File 也可以（File extends Blob）
  | string;           // URL（需要 CORS 或同源）
```

`PdfOcr.recognize()` 接受这些 PDF 输入：

```ts
type PdfInput =
  | ArrayBuffer
  | Uint8Array
  | Blob              // File 也可以
  | string;           // URL
```

## 5. 结果数据结构

```ts
interface OcrResult {
  lines: OcrLine[];
  fullText: string;            // lines 按阅读序拼接，行间用 \n
  durationMs: number;
}

interface OcrLine {
  text: string;
  box: [Point, Point, Point, Point];  // TL, TR, BR, BL
  confidence: number;                  // 0..1
}

type Point = [number, number];
```

## 下一步

- 识别效果不理想 → [调参指南](./tuning.md)
- 报错 → [常见问题](./troubleshooting.md)
- React / Electron / Next.js / 批量处理 → [食谱](./recipes.md)
