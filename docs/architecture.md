# 架构与原理

## 数据流

```
┌─ 用户输入 ────────────────────────┐
│ HTMLCanvas / Blob / URL / ImageBitmap │
└─────────┬─────────────────────────┘
          │ normalizeInput
          ▼
   ┌─ NormalizedImage ─┐
   │ Uint8ClampedArray │ ← RGBA 像素
   │ width, height     │
   └─────────┬─────────┘
             │
             ▼
┌─ Detection ────────────────────────┐
│ resize 到 32 倍数, max 960          │
│ normalize (mean/std)                │
│ → Tensor [1,3,H,W]                  │
│ ort.run(det.onnx)                   │
│ ← Tensor [1,1,H,W] sigmoid 概率    │
│                                     │
│ 二值化 (threshold=0.3)              │
│ 连通域 BFS 8-邻接                   │
│ 凸包 (Andrew monotone chain)        │
│ minAreaRect (rotating calipers)     │
│ unclip (area*ratio/perimeter)       │
│ box score 过滤                      │
│ 缩放回原图坐标                      │
└─────────┬───────────────────────────┘
          │ InternalDetBox[]
          ▼
┌─ Recognition ──────────────────────┐
│ for each box:                       │
│   perspective warp 到 (W, height)   │
│   resize 到 32 高度                 │
│   normalize ((v/255-0.5)/0.5)       │
│ batch (8 个一组) pad 到同宽         │
│ → Tensor [N,3,32,W]                 │
│ ort.run(rec.onnx)                   │
│ ← Tensor [N,T,18385] CTC logits    │
│ for each row:                       │
│   greedy decode (去重 + 去 blank)   │
│   字典查表                          │
└─────────┬───────────────────────────┘
          │ OcrLine[]
          ▼
┌─ Sort & Output ────────────────────┐
│ 按 y (行高 60% 容差) 然后 x        │
│ join("\n") → fullText              │
└─────────┬───────────────────────────┘
          ▼
       OcrResult
```

## 为什么不用 opencv-js

SDD §6.1 列了 opencv-js 作为参考路线，但实际选择了纯 JS。

理由：
1. **体积**：opencv-js 全量 4MB+，按需子包也 1MB+；超过 SDD §3.2 N-3 的 4MB gzip 预算
2. **加载**：opencv-js 是异步 wasm 模块，与 ort-web 的初始化串联会让首屏拖到 2-3s
3. **可控性**：纯 JS 实现可以精确知道每一步行为，bug 易复现
4. **够用**：DBNet 后处理需要的算子集合非常小（连通域、凸包、minAreaRect、unclip），手写 < 200 行

代价：unclip 用矩形扩张近似（PaddleOCR 用 Clipper offset 真实多边形），实测误差对 OCR 结果影响极小。

## 为什么 unclip 用矩形扩张

PaddleOCR Python 里：
```python
distance = poly.area * ratio / poly.length
expanded = pyclipper.Execute(distance)
new_box = minAreaRect(expanded)
```

我们：
```ts
const rect = minAreaRect(hull);
const distance = rect.area * ratio / rect.perimeter;
const expanded = { ...rect, w: rect.w + 2*d, h: rect.h + 2*d };
```

差别：
- PaddleOCR 在原始**多边形**上做 offset，然后再求矩形
- 我们直接在矩形上扩张

数学上看，对于"近似矩形"（典型文本框），两种方式产出的最终矩形差别 < 5%。对 OCR 切词影响可忽略。

完全严格复现需要引入 Clipper 库（30KB+）和多边形 offset 算法（200+ 行），ROI 太低。

## CTC 解码

PP-OCRv5 rec 输出 `[N, T, C]`，C = 18385：
- idx 0 = blank（CTC 特殊 token）
- idx 1..18384 = 字典字符（`ppocrv5_dict.txt` + 末尾空格）

Greedy decode 步骤：
1. 对每个时间步 t，取 argmax（最大 logit 的 idx）
2. 折叠连续重复（CTC 假设）：`A A blank A` → `A A`
3. 去掉 blank：`A A` 保留为 `A A`，`A blank A` 解码为 `AA`

伪代码：
```
out = []
prev = -1
for idx in argmax_per_t:
    if idx != 0 and idx != prev:
        out.append(dict[idx - 1])
    prev = idx
```

为什么不用 beam search：greedy 已经够好（90%+ 字符正确），beam search 多 5-10x 计算换 < 2% 提升，不划算。

## 字典加载约定

`ppocrv5_dict.txt` 18383 行，每行一个字符。PaddleOCR 加载时会**追加一个空格**到末尾：

```
chars = file.split("\n").filter(non_empty) + [" "]
// chars.length == 18384
// CTC C = chars.length + 1 = 18385  ✓
```

不追加空格的话，识别结果里所有空格会被错位映射。

## perspective warp（rec crop）

det 给出的是 4 个角点，可能是任意旋转的矩形。rec 模型期待 `[N, 3, 32, W]` 直立横排输入。

步骤：
1. 解 8x8 线性方程组，求 3x3 单应矩阵 H（src → dst）
2. 求 H 的逆 H⁻¹
3. 对每个目标像素 (x, y)，用 H⁻¹ 反映射回源图，bilinear 采样

Gauss-Jordan 消元解线性方程组（在 `crop.ts`），bilinear 在同一文件里。约 100 行。

## Worker 通信

主线程 `OcrEngineWorker.recognize()` 调用：
1. `normalizeInput(input)` → `{data, w, h}`（在主线程做，避免 worker 处理 DOM 类型）
2. 把 `data.buffer` 用 Transferable 发到 worker（零拷贝）
3. worker 接收后 `new ImageData(data, w, h)` 重建
4. worker 内部 OcrEngine.recognize → 返回 `OcrResult`
5. 通过 RPC `id` 关联返回到对应 Promise

RPC 协议自己写的，约 50 行（`rpc.ts`）。没用 comlink 因为依赖太重，自己实现更轻。

## 体积预算（v0.3）

| 项 | gzip 后 |
|---|---|
| @ocr-web/core | ~6KB |
| @ocr-web/core/worker | ~110KB（含 ort 全部 binding 代码） |
| @ocr-web/pdf | ~1KB（pdfjs 单独算） |
| @ocr-web/models-ppocrv5 | < 1KB（只是 URL 常量） |
| onnxruntime-web wasm | ~13MB（unzipped）— **主要大头** |
| pdfjs-dist | ~300KB |
| PP-OCRv5 模型（运行时按需 fetch） | det 4.6MB + rec 16MB + dict 72KB |

总首屏：~14MB（wasm + js）。模型按需拉取，首次 OCR 时再花 ~21MB。

## 模型托管

GitHub Release 下载会 302 跳到 `release-assets.githubusercontent.com`，**该域名不返回 CORS 头** → 浏览器直接 fetch 会被拦。

解决：模型同时 commit 到 git 树 `/models/` 目录，通过 jsDelivr CDN 分发：
```
https://cdn.jsdelivr.net/gh/bent2685/ocr-web@v0.1.1/models/...
```
- jsDelivr 返回 `Access-Control-Allow-Origin: *`
- 用 git tag 锁版本，避免 main 改动破坏使用方
- 文件级缓存（CDN 永久缓存某个 tag 的文件）

## 不在 v0.x 做的事

- ❌ WebGPU backend（数值精度偶尔出问题，等 ort 1.26+）
- ❌ Node backend（设计目标是浏览器，加 Node 要 ort-node 适配 wasmPaths 切换）
- ❌ React Native backend（需要 onnxruntime-react-native）
- ❌ cls 模型（PP-OCRv5 没发布；可让用户自带 v2 cls）
- ❌ PP-Structure（表格/公式）

## 模块依赖图

```
core/
├── index.ts ─── 导出
├── engine.ts ── OcrEngine（主线程）
├── engine-worker.ts ── OcrEngineWorker
├── worker.ts ── worker entry，跑在 worker 里
├── rpc.ts ──── postMessage 协议
├── input.ts ── ImageInput → NormalizedImage
├── runtime.ts ── ort 配置 + fetch 进度
├── geometry.ts ── 凸包/minAreaRect/unclip
├── types.ts ── 公共类型
├── det/
│   ├── preprocess.ts
│   ├── postprocess.ts ── 连通域 + 几何 + 评分
│   └── module.ts ──── DetectionModule
└── rec/
    ├── crop.ts ──── perspective warp
    ├── preprocess.ts
    ├── decode.ts ── CTC greedy
    └── module.ts ── RecognitionModule（含批处理）

pdf/
└── pdf-ocr.ts ── PdfOcr，pdfjs render → engine.recognize
```
