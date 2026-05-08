# examples/browser

`@ocr-web/core` + `@ocr-web/models-ppocrv5` 浏览器端最小 demo。

## 跑

```bash
# 在仓库根
pnpm install
pnpm example
```

打开 http://localhost:5181 ，选图 → Recognize。

## 模型源

example 默认优先用 `public/models/` 下的本地 ONNX（开发态加速），找不到才回退到 GitHub Release。
本地模型不入库（`.gitignore` 排除），首次需自己下载，或直接走 Release 模式。

## 验证过的端到端

合成 4 行中英文混排：450ms，全部 100% 正确（置信度 90-99%）。
合成 13 行复杂排版：1.4s，11/13 行完全正确，2 行 16px 小字号有降级（可调 `unclipRatio` / `detThreshold` 缓解）。
