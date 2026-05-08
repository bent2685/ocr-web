# ocr-web

PP-OCRv5 推理库，面向浏览器与 Electron。

> 状态：v0.0.0 — Phase 0 spike 阶段。完整设计见 [`ocr-web-sdd.md`](./ocr-web-sdd.md)。

## 仓库结构

```
ocr-web/
├── packages/
│   ├── core/             # @ocr-web/core           引擎主体
│   └── models-ppocrv5/   # @ocr-web/models-ppocrv5 PP-OCRv5 模型 URL
├── spike/
│   └── det-hello/        # Phase 0 单点验证：det ONNX 能否跑出概率图
├── examples/             # （Phase 1+）
└── ocr-web-sdd.md        # 解决方案设计文档
```

## 快速开始（开发）

```bash
pnpm install
pnpm spike     # 跑 Phase 0 验证 demo
```

详细 spike 步骤见 [`spike/det-hello/README.md`](./spike/det-hello/README.md)。

## 路线图

- **Phase 0** — det 模型加载验证（当前）
- **Phase 1** — det/cls/rec 全链路 + v0.1.0 发布
- **Phase 2** — Worker / 批处理
- **Phase 3** — WebGPU / Node / RN backend
- **Phase 4** — PP-OCRv6 跟进 / PP-Structure

完整 roadmap 见 SDD §7。

## License

MIT
