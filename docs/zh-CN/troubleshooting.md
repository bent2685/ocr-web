# 常见问题 / 报错排查

## 安装阶段

### `Cannot find module 'onnxruntime-web'`

`onnxruntime-web` 是 peer dependency，必须显式装：

```bash
pnpm add onnxruntime-web
```

### `Module not found: @ocr-web/core/worker`

确认 `@ocr-web/core` 版本 ≥ 0.2.0：
```bash
pnpm view @ocr-web/core version
```

旧版本（0.1.x）没有 `/worker` entry。升级：
```bash
pnpm up @ocr-web/core@latest
```

## 初始化阶段

### `Failed to fetch ort-wasm-simd-threaded.wasm` (404)

Wasm 文件没拷到 `wasmPaths` 指向的位置。

- Vite：检查 `vite.config.ts` 的 `viteStaticCopy`，确认 `dest: "ort"` 跟代码里的 `wasmPaths: "/ort/"` 匹配
- 浏览器 Network 面板看 wasm 实际请求 URL，对得上吗
- Worker 模式下 `wasmPaths` 用了相对路径 → 改 `${location.origin}/ort/`

### `Failed to fetch detection from ...`（CORS / 网络）

- 网络：本地能 curl 到那个 URL 吗
- CORS：浏览器 console 是不是有 "blocked by CORS" 警告？
  - 用 `ppocrV5.detection`（jsDelivr CDN，带 CORS）就行
  - 自己 host 的话要确保返回 `Access-Control-Allow-Origin: *`

### 加载到一半卡住，没报错

Worker 启动失败但没抛错，常见于：
- Webpack/Rspack 没识别 `?worker` 语法 → 改用 `new Worker(new URL(...), { type: "module" })`
- CSP 阻止了 worker → 检查 CSP `worker-src` directive

## 识别阶段

### 报错 `Got invalid dimensions for input: x for the following indices index: 2 Got: ... Expected: ...`

模型与 core 版本不匹配。
- v5 rec 高度是 32（v4 是 48）
- 用 `@ocr-web/models-ppocrv5` 配 `@ocr-web/core` 不会出这问题

### 识别结果是空 / `lines.length === 0`

可能性按概率排：

1. **det 没检出框** → `detThreshold` 调低到 0.2
2. **图片太小** → `recognize()` 之前确保 width/height >= 32 像素
3. **图片是纯白/纯黑** → 没有可识别内容
4. **maxSideLen 太小** → 超大图被压成 32x32 等于啥都没了

排查：临时把概率图画出来看（参考 spike 代码或 [架构](./architecture.md)）。

### 识别精度比预期差

走 [调参指南](./tuning.md)。

### 识别结果有怪字符 / 乱码

通常是 **dictionary 不匹配模型**：
- v4 模型配 v5 字典 → 大量错位
- v5 模型配 v4 字典（6623 字符）→ output dim 不对，应该报 dimension 错才对

确认：
```ts
const dict = await fetch(ppocrV5.dictionary).then(r => r.text());
console.log(dict.split("\n").filter(l => l).length);  // 应该是 18383
```

### 中文逗号变英文逗号 / 全角变半角

**这是模型本身的特性**，不是 bug。PP-OCRv5 训练数据里中英标点混用，识别时倾向常见形式。如果业务必须保留原始全角，自己后处理：
```ts
const normalized = result.fullText.replace(/,/g, "，").replace(/\?/g, "？");
```

## 性能阶段

### 单页要几秒，慢

- 主线程版本 → 上 Worker（不会更快但 UI 不卡）
- 多行 → 自动批处理已经用上了，没法再快
- 真实瓶颈：rec 是大头。短期没法降。WebGPU 后端会快 2-3x，等 v0.4。

### Workers 启动慢

每次 `OcrEngineWorker.create()` 都重新加载 ort 和模型 ~600ms。**不要为每次识别新建 engine**，复用同一个实例。

## PDF

### `Setting up fake worker failed: ...`

pdfjs worker URL 不可达。检查浏览器 Network 看 `pdf.worker.min.mjs` 请求。

CSP 严格的项目要把 `https://cdn.jsdelivr.net` 加到 `worker-src`，或者自己 host 这个文件并传 `workerSrc`。

### 大 PDF 处理慢/卡

- 50+ 页一次跑完会用很多内存（每页一个 OffscreenCanvas）
- 改成分批：自己 loop `recognize(pdf, [n])` 每次一页

### PDF 已有文本层，OCR 没必要

正确——别用 PdfOcr。直接用 pdfjs 提取：
```ts
const page = await doc.getPage(n);
const txt = await page.getTextContent();
const text = txt.items.map(i => "str" in i ? i.str : "").join(" ");
```

完整判断逻辑参考 [食谱：智能 PDF 提取](./recipes.md#智能-pdf-提取已有文本层就用-pdfjs否则-ocr)。

## 部署阶段

### GitHub Pages 上 wasm 404

`vite.config.ts` 里 `base` 配错了。GH Pages 路径是 `/<repo>/`：
```ts
base: process.env.GITHUB_PAGES === "1" ? "/your-repo/" : "/",
```

且代码里用 `import.meta.env.BASE_URL` 拼 `wasmPaths`：
```ts
wasmPaths: `${location.origin}${import.meta.env.BASE_URL}ort/`,
```

### Bundle 体积超大

26MB 是 ort wasm 的大小（不可避免，是 ML 推理的成本）。优化方向：
- 用 `ort-wasm-simd-threaded.wasm`（13MB）而不是 `.jsep.wasm`（26MB），如果你不用 WebGPU
  - vite-plugin-static-copy 时按文件名过滤，只拷需要的
- jsDelivr CDN 上的 wasm 浏览器会缓存，只首次下载

### Electron / `file://` 下 dictionary 加载怪异（≤ v0.2.0）

v0.2.0 及以前 `fetchDictionary` 只识别 `http://` `https://` `/` `./` `../`，**`file://` 不在白名单**——会把整个 URL 字符串当字典内容用，识别全错。

- **修复**：升级到 `@ocr-web/core@0.2.1+`（用 `new URL()` 判断，覆盖所有协议）
- **临时 workaround**：自己 fetch + `text()` 后传 `string[]`：
  ```ts
  const dictText = await (await fetch(dictUrl)).text();
  const dict = dictText.split("\n").filter(Boolean);
  await OcrEngine.create({ ..., dictionary: dict });
  ```

## 我看了所有文档还是不行

提 issue：https://github.com/bent2685/ocr-web/issues

带上：
- 浏览器版本
- 控制台报错
- 复现 PDF/图片（不涉密的话）
- `@ocr-web/*` 各包版本（`pnpm list | grep ocr-web`）
