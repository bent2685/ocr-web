# Worker 模式 vs 主线程模式

## 简单决策树

```
你在写真实产品 ────► OcrEngineWorker
你在写 demo / 内部工具，不在乎卡几秒 ────► OcrEngine
```

99% 场景应该用 Worker 版本。

## 区别详表

|  | OcrEngine | OcrEngineWorker |
|---|---|---|
| 包大小 | 一样 | 一样（worker entry 是单独 chunk，按需加载） |
| 加载时间 | ~600ms | ~600-800ms（多了 worker 启动） |
| 每次识别 UI 卡顿 | **是，1-2s 全卡** | **否** |
| 每次识别耗时 | 250-1500ms | 跟主线程版差不多（多了 postMessage 序列化） |
| 内存占用 | ort session 在主进程 | ort session 在 worker 进程 |
| 适合 | demo、playground、SW 内部 | **生产** |

## 为什么主线程会卡

ort wasm 是 CPU 密集运算，会占满 JS 主线程。期间：

- 鼠标事件不响应
- 动画/CSS transition 全停
- 输入框打不出字
- 浏览器可能弹"页面无响应"

实测：M2 Mac 跑 13 行 A4 大概卡 1.5 秒。普通 PC 上更长。

## Worker 怎么做到不卡

库内部把整个 OcrEngine 跑在 Worker 线程。主线程只发消息：
1. 把 ImageData 的 buffer 用 Transferable 零拷贝送到 worker
2. worker 跑完 recognize
3. 把结果 postMessage 回来

主线程在等 worker 的时间里完全空闲，可以渲染、响应交互。

## 代码切换示例

主线程版：

```ts
import { OcrEngine } from "@ocr-web/core";

const engine = await OcrEngine.create({ ... });
const result = await engine.recognize(bitmap);
```

Worker 版（只多两行）：

```ts
import { OcrEngineWorker } from "@ocr-web/core";
import OcrWorker from "@ocr-web/core/worker?worker";  // ← 这行

const engine = await OcrEngineWorker.create({
  worker: new OcrWorker(),                              // ← 这行
  // ...其余完全一样
});
const result = await engine.recognize(bitmap);
```

API 形态完全相同。`OcrResult` 也是同一个类型。

## 多页 PDF 场景的特殊建议

PDF 提取多页时，每页 OCR 之间有 100-500ms 的 PDF 渲染（pdfjs 在主线程）。这是另一个卡顿来源。如果想彻底丝滑：

1. 把 pdfjs 也跑在 worker 里（pdfjs 自己有 worker 模式，会自动启用，但 render 阶段还是在调用方线程）
2. 把整个 PdfOcr 包一层 worker（自己写）

v0.3 还没把 PdfOcr 整体 worker 化。后续 v0.4 可能加。

## Worker 的额外注意

### `wasmPaths` 必须用绝对 URL

```ts
// 主线程版本，相对路径 OK
wasmPaths: "/ort/"

// Worker 版本，必须完整 URL
wasmPaths: `${location.origin}/ort/`
```

理由：Worker 自己有 location，相对路径会从 worker 文件位置算，不是页面位置。

### `dispose()` 后不能再用

```ts
await engine.dispose();
await engine.recognize(bmp);  // ❌ 抛 "Worker terminated"
```

### Same-origin Worker

如果你想用 CDN 加载 worker（比如把 `@ocr-web/core/worker` 直接从 jsDelivr fetch），会被浏览器跨域 worker 限制挡住。这种场景只能用主线程版本。
