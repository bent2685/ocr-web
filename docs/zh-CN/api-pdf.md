# `@ocr-web/pdf` API 参考

PDF 文本提取。把每页用 [pdfjs-dist](https://github.com/mozilla/pdf.js) 渲染成图片，再喂给 `@ocr-web/core`。

## 导入

```ts
import { PdfOcr } from "@ocr-web/pdf";
```

## PdfOcr

```ts
class PdfOcr {
  constructor(opts: PdfOcrOptions);

  // 单页 → 直接返回字符串
  recognize(pdf: PdfInput, page: number): Promise<string>;
  // 全部 / 多页 → 按页号 keyed 的对象
  recognize(pdf: PdfInput, pages?: "all" | number[]): Promise<PdfRecognizeResult>;

  pageCount(pdf: PdfInput): Promise<number>;
}
```

### PdfOcrOptions

```ts
interface PdfOcrOptions {
  engine: OcrEngine | OcrEngineWorker;     // 已经创建好的引擎
  scale?: number;                           // 默认 2 (2x 渲染分辨率)
  workerSrc?: string;                       // pdfjs worker URL，默认 jsDelivr CDN
  recognize?: RecognizeOptions;             // 透传给 engine.recognize
  onPageProgress?: (current: number, total: number, page: number) => void;
}
```

#### `engine`

复用同一个 `engine` 是关键 — 不要为每个 PDF 创建新引擎，session 加载很贵。

#### `scale`

PDF 是矢量，`scale` 控制 rasterize 的目标分辨率。默认 2 表示 2 倍（72 DPI 的 PDF 会被渲染到 144 DPI 等效）。

| scale | 视觉质量 | 内存 | 速度 | 适合 |
|---|---|---|---|---|
| 1 | 模糊 | 1x | 1x | 快速预览，模型很难识别 |
| 2 | 清晰 | 4x | 2-3x | **默认，绝大多数场景** |
| 3 | 锐利 | 9x | 5x | 小字号/扫描件文本 |
| 4 | 过采样 | 16x | 10x | 极端情况，通常无收益 |

#### `workerSrc`

pdfjs 需要自己的 worker（`pdf.worker.min.mjs`）。默认从 jsDelivr 加载（自动选与 pdfjs-dist 版本匹配的）。

如需离线/CSP 严格：自己 host 这个文件，传完整 URL。

#### `onPageProgress`

多页时按完成的页触发。`current` 从 1 开始。

```ts
onPageProgress: (cur, total, page) => {
  console.log(`处理 page ${page}: ${cur}/${total}`);
}
```

### `recognize` 重载详解

#### 单页

```ts
const text: string = await pdfOcr.recognize(file, 3);  // 第 3 页
```

返回的是该页 OCR 后的 `fullText`（所有行用 `\n` 拼接）。

#### 全部页

```ts
const result = await pdfOcr.recognize(file);
// 等价于 await pdfOcr.recognize(file, "all")
// result = { 1: { text, lines, durationMs }, 2: {...}, ... }
```

#### 指定页

```ts
const result = await pdfOcr.recognize(file, [1, 3, 5]);
// result = { 1: {...}, 3: {...}, 5: {...} }
```

页号会自动排序后处理。重复页会被去重的程度取决于 JS 对象 key 唯一性（重复同一页只输出一次结果）。

### PdfRecognizeResult

```ts
type PdfRecognizeResult = Record<number, PdfPageRecognizeResult>;

interface PdfPageRecognizeResult {
  text: string;          // 该页 fullText
  lines: OcrLine[];      // 该页所有行
  durationMs: number;    // 该页处理耗时（不含 PDF 加载）
}
```

注意 key 是 number（不是 string），TS 编译后实际访问跟 string 一致：`result[1]` 和 `result["1"]` 都行。

### `pageCount`

```ts
const n: number = await pdfOcr.pageCount(file);
```

不做 OCR，仅打开 PDF 拿页数后立刻销毁。适合做"我能选哪些页"的 UI。

## PdfInput

```ts
type PdfInput =
  | ArrayBuffer
  | Uint8Array
  | Blob       // File extends Blob，所以 input.files[0] 直接传
  | string;    // URL（受 CORS 限制）
```

## 性能预期

M2 Mac, WASM 单线程, scale=2：

| PDF 类型 | 单页耗时 |
|---|---|
| A4 矢量 PDF（5-15 行印刷文字） | ~1-2s |
| A4 扫描件（30-50 行手写或印刷） | ~3-5s |
| 双栏论文 | ~3-4s |
| 海报/封面（少量大字） | <1s |

10 页矢量 PDF 全跑完约 10-20s。

## 不会做的事

- ❌ **不会用 PDF 内嵌的文本层**。PdfOcr 是纯图片 OCR 路径，对扫描件友好。如果你的 PDF 已经有文字层，用 `pdfjs-dist` 自己提取更快更准。
  - **判断**：用 [pdfjs `getTextContent()`](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib.PDFPageProxy.html) 试一下，返回非空就直接用，空再 fallback OCR。
- ❌ **不识别表格结构**。表格里的文字会被一行一行识别，但行列关系丢失。Phase 4 才会做 PP-Structure。
- ❌ **不还原版式**（粗体/斜体/字号/字色）。

## 完整示例

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
  const result = await pdfOcr.recognize(file);  // 全部页
  for (const page of Object.keys(result).map(Number)) {
    console.log(`Page ${page}:`, result[page].text);
  }
});

// 完了释放
await engine.dispose();
```
