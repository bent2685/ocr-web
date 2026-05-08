# Solution Design Document — `ocr-web`

> 一个独立的、面向浏览器/Electron 的 PP-OCRv5 推理库
> 状态：v0.1 草案 / 待立项
> 作者上下文：从 vetta-mono 项目分离出来独立开发，目标发布到 npm

---

## 1. 背景与动机

### 1.1 现状盘点（截止 2026-05）

| 方案 | 维护 | 中文精度 | 局限 |
|---|---|---|---|
| `tesseract.js`（~36k★） | 活跃 | 中（chi_sim_best 印刷体 ~85-92%） | 精度天花板低；非 PP-OCR 路线 |
| `@gutenye/ocr-browser`（数百★） | 一年未更新 | 中（卡在 PP-OCRv4） | 实验项目，模型停滞，bug 反馈未处理 |
| `@paddlejs-models/ocr` | 半停滞 | 一般 | 依赖 paddlejs 引擎，模型陈旧 |
| RapidOCR / PaddleOCR 原生 | 活跃 | 高（PP-OCRv5 ~95-97%） | 仅 Python/C++，无 JS Web 端 |
| 自建 sidecar | - | 高 | 跨平台编译 + 分发复杂，桌面 app 才能用 |

**结论**：JS/Web/Electron 生态缺少「**主流推理引擎 + 最新 PP-OCR 模型 + 持续维护**」三者齐全的库。该空缺真实存在，不是重复造轮子。

### 1.2 为什么独立成项目

1. **生态价值**：填补的是公共缺口，不该锁在某个产品代码库里
2. **复用面广**：浏览器端 OCR 是横向能力，多个上层产品可消费
3. **演进节奏独立**：模型版本（PP-OCRv5 → v6）和上层应用迭代节奏不同
4. **测试边界清晰**：精度回归、性能基准、跨浏览器兼容应在独立 CI 跑
5. **社区反馈循环**：发到 npm 后通过 issue / star 形成正向迭代

---

## 2. 实现目的

构建一个**真正可以无限迭代**的开源 OCR 库，长期目标：

- 成为浏览器/Electron 端做中英文 OCR 时的**默认选择**
- 跟随 PaddleOCR 官方模型节奏，提供 v5 / 未来 v6 / v7 的开箱可用
- 提供清晰的扩展点，让用户能换模型、换后端（WASM / WebGPU）、换字典
- 不挂任何 native binding，不需要 sidecar，不联网（除首次模型下载）

短期目标（v0.1.0）：
- 能在 Electron renderer / 现代浏览器跑 PP-OCRv5
- 中英混排清晰扫描件准确率 ≥ 92%
- 单页 A4 在 M2 Mac 上 ≤ 2s（WASM SIMD，单线程）
- 包体积（不含模型）≤ 12MB

---

## 3. 业务需求

### 3.1 功能性需求

| ID | 需求 | 优先级 |
|---|---|---|
| F-1 | 输入：HTMLCanvasElement / ImageData / ImageBitmap / Blob / URL string | P0 |
| F-2 | 输出：行级文本 + 多边形坐标 + 置信度 | P0 |
| F-3 | 中英文混排（PP-OCRv5 官方支持） | P0 |
| F-4 | 自动方向分类（0°/180°，cls 模型） | P1 |
| F-5 | 支持自定义模型 URL（不强绑模型版本） | P0 |
| F-6 | 支持自定义字典 | P1 |
| F-7 | 支持批量识别（复用 session，避免重复加载） | P0 |
| F-8 | 提供文本拼接的 fullText（按行排序输出纯文本） | P1 |

### 3.2 非功能性需求

| ID | 需求 | 阈值 |
|---|---|---|
| N-1 | 准确率（清晰印刷体扫描件） | 字符级 ≥ 92% |
| N-2 | 单页 A4 端到端耗时 | M2 Mac ≤ 2s，中端 PC ≤ 5s |
| N-3 | 库主包体积 gzip | ≤ 4MB |
| N-4 | 模型包体积 | det+rec+cls+dict 总计 ≤ 20MB |
| N-5 | 浏览器兼容 | Chrome/Edge 100+, Safari 15+, Electron 28+ |
| N-6 | TypeScript 类型完整 | 100% 公开 API 有 .d.ts |
| N-7 | 代码覆盖率 | 核心模块 ≥ 80% |
| N-8 | 文档 | README + API doc + 至少 3 个 example |

### 3.3 范围之外

明确**不做**的事（避免膨胀）：

- ❌ 训练 / 微调（用 PaddleOCR 官方 + RapidOCR 转换的 ONNX）
- ❌ 表格识别 / 公式识别（PP-Structure 是另一个项目，未来 v0.5+ 再说）
- ❌ Node.js / React Native backend（v0.1 只做 Web；后续按需加，但要保持 backend-agnostic 的核心层）
- ❌ 手写体识别（PP-OCR 不擅长，不做承诺）
- ❌ 实时视频流（v0.1 不做，但 API 不应排除这种用法）
- ❌ 多语言切换 UI / 后处理纠错（这些是上层应用职责）

---

## 4. 技术选型

| 层 | 选型 | 理由 |
|---|---|---|
| 推理引擎 | **onnxruntime-web @ ^1.25** | 微软维护，主流，WASM SIMD + WebGPU 双后端 |
| 模型来源 | **RapidOCR 官方转换的 PP-OCRv5 ONNX** | RapidOCR 持续跟进 PaddleOCR 新版本，ONNX 已校验 |
| 几何后处理 | **`@techstark/opencv-js` ^4.x**（findContours）+ **`js-clipper` ^1.0**（unclip） | 这是 PaddleOCR Python 端的等价路线，无更轻可信替代 |
| 构建 | **tsup** 或 **vite library mode** | 输出 ESM + CJS + .d.ts |
| 包管理 | **pnpm workspaces**（推荐）或 **bun workspaces** | 模型包 / 核心包分离需要 monorepo |
| 测试 | **vitest** + **playwright**（E2E 浏览器跑通） | 单元 + 端到端 |
| Lint/Format | **biome**（与 vetta-mono 一致） | 单工具搞定 |
| CI | GitHub Actions | 跑测试 + 体积检查 + 精度回归 |

**关键技术约束**：
- 不引入 native binding
- 不依赖 Node-only 包（核心层）
- WASM 文件路径必须可配置（适配 file:// 和 web 两种宿主）

---

## 5. 架构设计

### 5.1 包拓扑（monorepo）

```
ocr-web/                         # 仓库根
├── packages/
│   ├── core/                    # @ocr-web/core
│   │   └── 引擎主体，不绑模型
│   ├── models-ppocrv5/          # @ocr-web/models-ppocrv5
│   │   └── PP-OCRv5 模型文件 + 元数据
│   └── examples/                # 不发包
│       ├── electron/
│       ├── browser-vanilla/
│       └── react/
├── docs/
└── benchmarks/                  # 精度 + 性能基线
```

**双包设计的原因**：模型 16-20MB，频繁迭代；引擎稳定。分开后用户可锁引擎版本独立升模型。

### 5.2 数据流

```
input (Canvas/ImageData/...)
    │
    ▼
┌─ preprocess ─┐
│ resize-32x   │
│ normalize    │
└──────────────┘
    │
    ▼
┌─ detection ──┐    onnxruntime-web
│ DBNet infer  │◄───────────────
└──────────────┘
    │ probability map
    ▼
┌─ postprocess ─┐
│ binarize     │
│ findContours │◄─ opencv-js
│ unclip       │◄─ js-clipper
│ rotated-rect │
└──────────────┘
    │ List<Polygon>
    ▼
┌─ classification (optional) ─┐
│ crop + cls infer            │
│ rotate 180 if needed        │
└─────────────────────────────┘
    │
    ▼
┌─ recognition ──┐
│ perspective    │
│ resize h=48    │
│ rec infer      │
│ CTC decode     │◄─ 字典查表
└────────────────┘
    │
    ▼
output: Line[] = { text, box, confidence }
```

### 5.3 公开 API

```ts
// @ocr-web/core
export interface OcrEngineOptions {
	models: {
		detection: string | ArrayBuffer;        // URL 或 bytes
		recognition: string | ArrayBuffer;
		classification?: string | ArrayBuffer;  // 可选
	};
	dictionary: string | string[];             // URL/字符串/字符数组
	runtime?: "wasm" | "webgpu";               // 默认 wasm
	wasmPaths?: string | Record<string, string>;
	numThreads?: number;                        // 默认 1
}

export interface RecognizeOptions {
	useClassification?: boolean;                // 默认 true（如果 cls 提供）
	detThreshold?: number;                      // 默认 0.3
	detBoxThreshold?: number;                   // 默认 0.6
	maxSideLen?: number;                        // 默认 960
	unclipRatio?: number;                       // 默认 1.6
}

export interface OcrLine {
	text: string;
	box: [[number, number], [number, number], [number, number], [number, number]]; // 四点
	confidence: number;
}

export interface OcrResult {
	lines: OcrLine[];
	fullText: string;            // 按阅读序拼接
	durationMs: number;
}

export class OcrEngine {
	static create(opts: OcrEngineOptions): Promise<OcrEngine>;
	recognize(input: ImageInput, opts?: RecognizeOptions): Promise<OcrResult>;
	dispose(): Promise<void>;
}

export type ImageInput =
	| HTMLCanvasElement
	| OffscreenCanvas
	| ImageData
	| ImageBitmap
	| Blob
	| string; // URL
```

```ts
// @ocr-web/models-ppocrv5
export const ppocrV5: {
	detection: string;        // URL（vite ?url 友好）
	recognition: string;
	classification: string;
	dictionary: string;
};
```

使用样例：

```ts
import { OcrEngine } from "@ocr-web/core";
import { ppocrV5 } from "@ocr-web/models-ppocrv5";

const engine = await OcrEngine.create({
	models: {
		detection: ppocrV5.detection,
		recognition: ppocrV5.recognition,
		classification: ppocrV5.classification,
	},
	dictionary: ppocrV5.dictionary,
});

const result = await engine.recognize(canvas);
console.log(result.fullText);
console.log(result.lines); // [{text, box, confidence}, ...]
```

### 5.4 扩展点

- **自定义模型**：用户传任意 PP-OCR 系列 ONNX URL
- **自定义字典**：支持非中文场景（日韩、印地语等 PaddleOCR 多语种）
- **后端切换**：v0.1 wasm，v0.3+ 加 webgpu（API 不变）
- **预/后处理钩子**：`onBeforeDet`、`onAfterRec` 等回调供高级用户介入

---

## 6. 实现细节关键点

### 6.1 检测（DBNet）后处理

PaddleOCR Python 参考实现：
- `tools/infer/utility.py` → `DBPostProcess`
- `ppocr/postprocess/db_postprocess.py`

JS 等价步骤：
1. det 模型输出 shape `[1, 1, H, W]` 概率图
2. Sigmoid → 二值化（threshold=0.3）
3. 用 `opencv-js` 的 `findContours` 找轮廓
4. 对每个轮廓用 `js-clipper` 做 unclip 扩张（unclipRatio=1.6）
5. `minAreaRect` 取最小外接旋转矩形
6. 过滤面积 < min_size 的小框

**核心难点**：opencv-js 的 ImageData 转 cv.Mat 经常踩坑，要写干净的封装。

### 6.2 识别（CTC 解码）

```ts
function ctcGreedyDecode(logits: Float32Array, T: number, C: number, dict: string[]): { text: string; confidence: number } {
	const indices: number[] = [];
	const probs: number[] = [];
	for (let t = 0; t < T; t++) {
		let maxIdx = 0, maxVal = -Infinity;
		for (let c = 0; c < C; c++) {
			const v = logits[t * C + c];
			if (v > maxVal) { maxVal = v; maxIdx = c; }
		}
		indices.push(maxIdx);
		probs.push(maxVal);
	}
	// 去重 + 去 blank（idx 0）
	const out: string[] = [];
	const outProbs: number[] = [];
	let prev = -1;
	for (let i = 0; i < indices.length; i++) {
		const idx = indices[i];
		if (idx !== 0 && idx !== prev) {
			out.push(dict[idx - 1]); // PaddleOCR 字典从 idx 1 开始
			outProbs.push(probs[i]);
		}
		prev = idx;
	}
	return {
		text: out.join(""),
		confidence: outProbs.length ? outProbs.reduce((a, b) => a + b) / outProbs.length : 0,
	};
}
```

### 6.3 性能优化策略

按优先级实现：
1. **Session 复用**：`OcrEngine.create` 后 session 持久，多次 `recognize` 不重新加载（v0.1 必做）
2. **模型缓存**：`fetch` 模型走浏览器 HTTP 缓存（v0.1 默认即生效）
3. **批处理**：rec 阶段把多个检测框 padding 后一次推理（v0.2）
4. **WebGPU 后端**：精度可控前提下显著提速（v0.3）
5. **Worker 化**：把整个引擎跑在 Web Worker 里，避免阻塞 UI（v0.2）

### 6.4 包体积控制

- 核心包：`onnxruntime-web` 是大头（~3MB gzip）。要 sideEffects: false + tree-shake 友好
- opencv-js：用按需导入版本，只引 imgproc 模块，**不要 4MB 的全量包**
- 模型包：默认走 `?url` 让 vite/webpack 单独切 chunk，不阻塞主 bundle

---

## 7. 路线图（Roadmap）

### Phase 0 — Spike（1-2 天）
- 起仓库 + 基础结构
- 跑通 Hello World：`onnxruntime-web` 加载 PP-OCRv5 det 模型，输入一张固定图，输出概率图正确
- 验证 RapidOCR HuggingFace 上的 PP-OCRv5 ONNX 模型 shape 和 PaddleOCR 文档一致
- **门槛**：能在 Electron / Chrome 跑出概率图

### Phase 1 — MVP / v0.1.0（4-5 天）
- 完成 det/cls/rec 全链路
- 准确率回归测试通过（5-10 张已知答案的图）
- 文档 README + 一个 examples/electron
- 发到 npm（先 unscoped 名字占位 + scoped 正式版）
- **门槛**：清晰扫描件准确率 ≥ 92%

### Phase 2 — 优化 / v0.2.x
- Worker 化
- 批处理
- 浏览器 example + React example
- 精度回归 CI

### Phase 3 — 后端扩展 / v0.3.x
- WebGPU backend
- Node.js backend（onnxruntime-node）
- React Native backend（onnxruntime-react-native）

### Phase 4 — 模型矩阵 / v0.4.x+
- PP-OCRv6 跟进（一旦发布）
- 多语种字典预设包
- PP-Structure 探索（表格/公式）

---

## 8. 与上层项目的组合方式

> 这一节给消费方（如某 Electron 桌面 app）参考

### 在 Electron 隐藏窗口里使用

```ts
// renderer 进程
import { OcrEngine } from "@ocr-web/core";
import { ppocrV5 } from "@ocr-web/models-ppocrv5";

const engine = await OcrEngine.create({
	models: {
		detection: ppocrV5.detection,
		recognition: ppocrV5.recognition,
	},
	dictionary: ppocrV5.dictionary,
	wasmPaths: "./ort/", // 如果用 vite-plugin-static-copy 把 ort wasm 拷到这
});

// 多页 PDF 场景
for (let p = 1; p <= totalPages; p++) {
	const canvas = await renderPdfPage(p);
	const { fullText, lines } = await engine.recognize(canvas);
	emit({ page: p, text: fullText, lines });
}

await engine.dispose();
```

### 在浏览器 SPA 里使用

```ts
const file = e.target.files[0];
const bitmap = await createImageBitmap(file);
const result = await engine.recognize(bitmap);
```

### 与 sidecar OCR 对照

如果消费方既已有 sidecar 路线，本库定位为 **default fallback**：sidecar 不存在时用本库，存在时优先 sidecar（精度更高）。两条路 API 可保持一致以便切换。

---

## 9. 成功标准

### v0.1 验收

- [ ] 在 Chrome 最新版 + Electron 30+ 运行无错
- [ ] 准确率：附带 10 张测试图（5 中 + 5 英）字符级 ≥ 92%
- [ ] 性能：M2 Mac 单页 A4 ≤ 2.5s
- [ ] 体积：核心包 gzip ≤ 4MB（不含模型）
- [ ] 类型：所有公开 API 有 .d.ts
- [ ] 文档：README + API doc + 一个 working example
- [ ] 已发布到 npm（dist-tag: next 或 0.1.0）

### 长期健康度指标

- npm 周下载量趋势上升
- GitHub issue 响应时间 < 7 天
- 至少跟一个 PaddleOCR 模型版本（v6 出来后 30 天内适配）

---

## 10. 风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| PP-OCRv5 ONNX shape 与 v4 不兼容，后处理参数要重调 | 中 | 中 | Phase 0 spike 必须先验证；保留参数化接口 |
| opencv-js 体积超预期 | 中 | 中 | 用按需子包；最坏情况自己实现 connected-components 替代 |
| WASM 在 file:// 下 SharedArrayBuffer 限制导致只能单线程 | 高（已确认） | 中 | v0.1 默认单线程；Worker 内多线程留 v0.2 |
| 跨浏览器兼容（Safari WASM 行为差异） | 中 | 低 | CI 加 Safari，必要时 polyfill |
| RapidOCR 上游模型链接变动 | 低 | 中 | 模型自托管 GitHub Release |
| 维护人力不足 | 中 | 高 | 设清楚 issue 模板、欢迎社区 PR、对外公开 roadmap |

---

## 11. 附录

### 11.1 关键参考资料

- PaddleOCR 官方 inference 代码：https://github.com/PaddlePaddle/PaddleOCR/tree/main/tools/infer
- RapidOCR Python 实现（最干净的参考）：https://github.com/RapidAI/RapidOCR/tree/main/python
- PP-OCRv5 模型 ONNX 转换（HuggingFace）：搜索 "RapidAI PP-OCRv5"
- onnxruntime-web 文档：https://onnxruntime.ai/docs/tutorials/web/
- DBNet 论文：https://arxiv.org/abs/1911.08947

### 11.2 PP-OCRv5 模型 I/O 速查（Phase 0 验证后填）

```
det:  input  [1, 3, H, W]  H,W ∈ multiple of 32, max_side=960
      output [1, 1, H, W]
cls:  input  [N, 3, 48, 192]
      output [N, 2]  // 0°/180° softmax
rec:  input  [N, 3, 48, W]  W = round(原宽 * 48 / 原高), padded to multiple of 16
      output [N, T, C]  // C = len(dict) + 1, blank=0
```

### 11.3 字典文件

PaddleOCR 中文字典：`ppocr_keys_v1.txt`（约 6623 字符）+ blank 占位

---

## 12. 起步行动项（给执行的 Claude Code）

1. `git init` 新仓库 `ocr-web`
2. 用 pnpm + workspaces 起 `packages/core` 和 `packages/models-ppocrv5`
3. 执行 Phase 0 spike：用 RapidOCR HuggingFace 上的 PP-OCRv5 det 模型，写一个 50 行的 HTML 页面，证明能加载并出概率图
4. spike 通过后，**先实现 rec + 字典 + CTC decode**（最确定性的部分）
5. 再实现 det 后处理（最坑的部分，占 60% 调试时间）
6. 最后串起来 + 测试 + 发布

**spike 失败时的回退**：先用 PP-OCRv4 ONNX（@gutenye/ocr-models 现成有），证明流水线 OK，再迁 v5。
