# `@ocr-web/core` API 参考

## 默认导出

```ts
import { OcrEngine, OcrEngineWorker } from "@ocr-web/core";
import OcrWorker from "@ocr-web/core/worker?worker";  // Vite 等
```

## OcrEngine（主线程版本）

```ts
class OcrEngine {
  static create(opts: OcrEngineOptions): Promise<OcrEngine>;
  recognize(input: ImageInput, opts?: RecognizeOptions): Promise<OcrResult>;
  dispose(): Promise<void>;
}
```

### 何时用主线程版本

- 简单 demo、playground
- 一次性识别后页面就关
- Service Worker 内（不能再嵌套 Worker）

### 何时用 Worker 版本

- 任何用户能感知 UI 卡顿的场景（即"几乎所有真实场景"）
- 文档里建议默认用 Worker 版本

## OcrEngineWorker（推荐）

```ts
class OcrEngineWorker {
  static create(opts: OcrEngineWorkerOptions): Promise<OcrEngineWorker>;
  recognize(input: ImageInput, opts?: RecognizeOptions): Promise<OcrResult>;
  dispose(): Promise<void>;
}

interface OcrEngineWorkerOptions extends OcrEngineOptions {
  worker: Worker;        // 调用方负责创建（按各自打包工具的 Worker 语法）
}
```

API 跟主线程版本完全一致，只是 `recognize()` 内部把图片数据 transferable 到 worker 里跑。

## OcrEngineOptions

```ts
interface OcrEngineOptions {
  models: {
    detection: ModelSource;
    recognition: ModelSource;
    classification?: ModelSource;  // PP-OCRv5 没有发布；接口保留
  };
  dictionary: string | string[];
  runtime?: "wasm" | "webgpu";       // 默认 "wasm"
  wasmPaths?: string | Record<string, string>;
  numThreads?: number;                // 默认 1
  onProgress?: (p: LoadProgress) => void;
}

type ModelSource = string | ArrayBuffer | Uint8Array;
type LoadProgress = { loaded: number; total: number; file: string };
```

### `models`

`detection` 和 `recognition` 是必须，`classification` 留空就好（PP-OCRv5 没有 cls 模型）。

值可以是：
- **URL 字符串**（最常见，直接传 `ppocrV5.detection`）
- **ArrayBuffer / Uint8Array**（自己 fetch 下来后传，适合需要鉴权的场景）

### `dictionary`

跟模型对应。PP-OCRv5 的字典见 `ppocrV5.dictionary`。

可以是：
- URL 字符串
- 完整字典文本
- 字符数组（按字典顺序）

### `runtime`

- `"wasm"`（默认）— 兼容性最好，性能足够。M2 上单页 250-1500ms。
- `"webgpu"` — 更快，但要求浏览器支持 WebGPU。**当前版本 `wasm` 已能满足 SDD 性能目标，且 WebGPU 后端在 PP-OCR 模型上偶尔有数值精度问题**，建议 0.4+ 启用。

### `wasmPaths`

告诉 onnxruntime-web 去哪 fetch wasm 文件。常见值：
- `/ort/`（同源，wasm 拷贝到 `public/ort/`）
- `https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/`（CDN）
- 在 Worker 里**必须用完整 URL**（含 origin），相对路径会失败：`${location.origin}/ort/`

### `numThreads`

WASM 多线程数。要用 >1 必须满足：
- 浏览器支持 SharedArrayBuffer
- 页面有 COOP/COEP 头：
  ```
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
  ```

GitHub Pages 不能设这两个头，所以默认就 1 线程。

### `onProgress`

模型 fetch 进度回调，按字节流：

```ts
onProgress: ({ loaded, total, file }) => {
  // file = "detection" | "recognition"
  // loaded, total = bytes
}
```

dictionary 不计入进度（小，几十 KB）。

## RecognizeOptions

```ts
interface RecognizeOptions {
  detThreshold?: number;     // 默认 0.3，sigmoid 概率二值化阈值
  detBoxThreshold?: number;  // 默认 0.6，框平均概率过滤
  maxSideLen?: number;       // 默认 960，det 输入最长边
  unclipRatio?: number;      // 默认 1.6，框扩张系数
  minBoxSize?: number;       // 默认 3，最小框边长（像素）
  useClassification?: boolean;
}
```

调参建议见 [调参指南](./tuning.md)。

## OcrResult

```ts
interface OcrResult {
  lines: OcrLine[];
  fullText: string;       // 按阅读序排列的 lines.text 用 \n 拼接
  durationMs: number;     // 端到端耗时，含 preprocess + det + rec + postprocess
}

interface OcrLine {
  text: string;
  box: Quad;                  // 4 个角点：TL, TR, BR, BL
  confidence: number;         // 0..1，CTC 平均最大概率
}

type Point = [number, number];
type Quad  = [Point, Point, Point, Point];
```

### `lines` 排序

按阅读顺序（top-to-bottom, then left-to-right），用行高的 60% 作为同行容差。

### `box` 坐标系

跟原图一致（不是 det 内部缩放过的坐标）。`(0,0)` 在左上，往右下增长。

### `confidence`

CTC 解码每个被采纳字符的最大 logit 平均值。注意这是 **logit 不是概率**——大于 0 一般认为可信，但绝对值意义不大。比较置信度（哪行更可信）有意义，绝对值阈值不一定适用。

## 内存与生命周期

```ts
const engine = await OcrEngine.create(opts);  // 加载 ort session ~21MB 内存
try {
  for (const img of images) {
    const result = await engine.recognize(img);
    // ...
  }
} finally {
  await engine.dispose();  // 释放 session
}
```

`dispose()` 后实例不可再用。要重新 OCR 必须再 `create`。

Worker 版本 `dispose()` 会终止 worker 进程，回收所有内存。

## 错误

库没有自定义错误类型，抛 `Error` 实例。常见错误的 `message`：

- `"Failed to fetch detection from ..."` — 模型 URL 404 或 CORS 问题
- `"OffscreenCanvas 2d context unavailable"` — 浏览器不支持
- `"Got invalid dimensions for input"` — 模型与库版本不匹配（理论上不该发生）
- `"Worker terminated"` — 你 `dispose()` 中途调了别的方法

排查见 [troubleshooting](./troubleshooting.md)。
