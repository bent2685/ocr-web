// @ocr-web/models-ppocrv5
// 模型自托管在本仓库 GitHub Release（SDD §10 风险缓解）。
// Phase 0 spike 已确认：
//   - det: input "x" [1,3,H,W] H,W∈32倍数 max=960; output "fetch_name_0" [1,1,H,W] 含 sigmoid
//   - rec: input "x" [N,3,32,W] (v5 高度=32); output "fetch_name_0" [N,T,18385]
//   - dict: 18383 行 + 末尾空格 = 18384 字符（多语言 + emoji）
// PP-OCRv5 没有发布独立的 cls 模型，cls 字段保留但暂时为 undefined。

const RELEASE_TAG = "models-v5.0.0";
const BASE = `https://github.com/bent2685/ocr-web/releases/download/${RELEASE_TAG}`;

export const ppocrV5 = {
	detection: `${BASE}/ppocrv5_det.onnx`,
	recognition: `${BASE}/ppocrv5_rec.onnx`,
	dictionary: `${BASE}/ppocrv5_dict.txt`,
} as const;

export type PpocrV5 = typeof ppocrV5;
