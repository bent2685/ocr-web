# spike/det-hello — PP-OCRv5 detection 验证

## 唯一目标

证明 onnxruntime-web 能在浏览器加载 PP-OCRv5 det ONNX 并跑出有意义的概率图。
通过这一关，SDD §10 风险表里最大的两条（v5 shape 不兼容、ort-web 跑不动）就消掉了。

## 步骤

### 1. 下载模型

到 RapidOCR 的 HuggingFace 仓库下 PP-OCRv5 det ONNX，文件名一般是
`PP-OCRv5_mobile_det_infer.onnx` 或 `PP-OCRv5_server_det_infer.onnx`（先用 mobile，更小）。

来源：
- HuggingFace: https://huggingface.co/RapidAI/RapidOCR （搜 PP-OCRv5）
- GitHub: https://github.com/RapidAI/RapidOCR

把文件**改名为 `ppocrv5_det.onnx`**，放到：
```
spike/det-hello/public/models/ppocrv5_det.onnx
```

### 2. 装依赖

在仓库根：
```bash
pnpm install
```

### 3. 起服务

```bash
pnpm spike
```
浏览器打开 http://localhost:5180

### 4. 验证

1. 选一张含中文/英文文字的图（清晰扫描件最佳）
2. 等待页面顶部状态显示「模型已加载」
3. 点 "Run detection"
4. 看右侧 "Probability map"

**通过标准**：概率图里文字区域明显比背景亮（白色亮块呈条带状/块状分布在文字位置）。

**失败排查**：
- shape 报错 → 模型可能不是 v5 mobile/server det，确认文件正确
- 全黑/全白 → 归一化参数不对，先检查 MEAN/STD
- wasm 404 → vite 静态拷贝没生效，检查 `vite.config.ts` 的 `viteStaticCopy` 配置和 ort 版本

### 5. 通过后

- 把跑通的 det 模型 + 待传的 cls/rec/dict 一起上传到 GitHub Release `models-v5.0.0`
- 更新 `packages/models-ppocrv5/src/index.ts` 里的 owner/repo
- 删除整个 `spike/` 目录，进入 Phase 1
