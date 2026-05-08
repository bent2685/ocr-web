// @ocr-web/models-ppocrv5
// 模型托管在仓库 git 树的 /models/ 目录，通过 jsDelivr CDN 分发（自带 CORS）。
// 模型规格（Phase 0 已确认）：
//   - det: input "x" [1,3,H,W] H,W∈32倍数 max=960; output [1,1,H,W] 含 sigmoid
//   - rec: input "x" [N,3,32,W] (v5 高度=32); output [N,T,18385]
//   - dict: 18383 行 + 末尾空格 = 18384 字符（多语言 + emoji）
// PP-OCRv5 没有发布独立的 cls 模型，cls 字段保留但暂时未导出。

// 用 git tag pin 死版本，避免 CDN 缓存旧文件 / 未来 main 改动破坏使用方。
const TAG = "v0.1.1";
const BASE = `https://cdn.jsdelivr.net/gh/bent2685/ocr-web@${TAG}/models`;

export const ppocrV5 = {
	detection: `${BASE}/ppocrv5_det.onnx`,
	recognition: `${BASE}/ppocrv5_rec.onnx`,
	dictionary: `${BASE}/ppocrv5_dict.txt`,
} as const;

export type PpocrV5 = typeof ppocrV5;
