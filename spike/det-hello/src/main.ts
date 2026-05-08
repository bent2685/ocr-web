// PP-OCRv5 spike — 验证 det + rec 模型在 onnxruntime-web 下能加载并运行
// 不做真实后处理（findContours / unclip / perspective transform），那些是 Phase 1 工作
// 目的是把所有「会让 Phase 1 返工」的不确定性提前消掉

import * as ort from "onnxruntime-web";

ort.env.wasm.wasmPaths = "/ort/";
ort.env.wasm.numThreads = 1;
ort.env.logLevel = "warning";

const DET_URL = "/models/ppocrv5_det.onnx";
const REC_URL = "/models/ppocrv5_rec.onnx";
const DICT_URL = "/models/ppocrv5_dict.txt";

const MAX_SIDE_LEN = 960;
const MEAN = [0.485, 0.456, 0.406] as const;
const STD = [0.229, 0.224, 0.225] as const;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const metaEl = $<HTMLDivElement>("meta");
const fileInput = $<HTMLInputElement>("file");
const runDetBtn = $<HTMLButtonElement>("runDet");
const runRecBtn = $<HTMLButtonElement>("runRec");
const detStatusEl = $<HTMLDivElement>("detStatus");
const recStatusEl = $<HTMLDivElement>("recStatus");
const logEl = $<HTMLPreElement>("log");
const inputCanvas = $<HTMLCanvasElement>("inputCanvas");
const probCanvas = $<HTMLCanvasElement>("probCanvas");

let detSession: ort.InferenceSession | null = null;
let recSession: ort.InferenceSession | null = null;
let dict: string[] = [];
let currentBitmap: ImageBitmap | null = null;

function log(msg: string) {
	const ts = new Date().toLocaleTimeString();
	logEl.textContent += `[${ts}] ${msg}\n`;
	logEl.scrollTop = logEl.scrollHeight;
	console.log(msg);
}

function setMeta(html: string) {
	metaEl.innerHTML = html;
}

function setStatus(el: HTMLDivElement, msg: string, kind: "" | "ok" | "error" = "") {
	el.textContent = msg;
	el.className = `status${kind ? ` ${kind}` : ""}`;
}

async function loadAll() {
	setMeta("加载 det / rec / dict…");
	try {
		const t0 = performance.now();
		const [det, rec, dictText] = await Promise.all([
			ort.InferenceSession.create(DET_URL, {
				executionProviders: ["wasm"],
				graphOptimizationLevel: "all",
			}),
			ort.InferenceSession.create(REC_URL, {
				executionProviders: ["wasm"],
				graphOptimizationLevel: "all",
			}),
			fetch(DICT_URL).then((r) => r.text()),
		]);
		detSession = det;
		recSession = rec;
		// PaddleOCR 字典加载约定：行内字符 + 末尾追加一个空格 → 真正的字符表
		// CTC blank 占 idx 0，所以 C = chars.length + 1
		const lines = dictText.split("\n").filter((line) => line.length > 0);
		dict = [...lines, " "];
		log(`loaded in ${(performance.now() - t0).toFixed(0)}ms`);

		setMeta(`
			<div><strong>det</strong> inputs=${JSON.stringify(det.inputNames)} outputs=${JSON.stringify(det.outputNames)}</div>
			<div><strong>rec</strong> inputs=${JSON.stringify(rec.inputNames)} outputs=${JSON.stringify(rec.outputNames)}</div>
			<div><strong>dict</strong> chars=${dict.length} (期望 18384，含末尾空格；CTC blank 占 idx 0 → C=${dict.length + 1})</div>
		`);
		runRecBtn.disabled = false;
		setStatus(recStatusEl, "可以点击 Run rec sanity", "");
		setStatus(detStatusEl, "选图后可以 Run det", "");
	} catch (err) {
		const msg = (err as Error).message;
		setMeta(`<div class="error">加载失败：${msg}</div>`);
		log(`load error: ${(err as Error).stack ?? err}`);
	}
}

function resizeTo32(srcW: number, srcH: number, maxSide: number) {
	let ratio = 1;
	if (Math.max(srcW, srcH) > maxSide) ratio = maxSide / Math.max(srcW, srcH);
	const round32 = (n: number) => Math.max(32, Math.round(n / 32) * 32);
	return { w: round32(srcW * ratio), h: round32(srcH * ratio), ratio };
}

function bitmapToDetTensor(bmp: ImageBitmap): { tensor: ort.Tensor; w: number; h: number } {
	const { w, h } = resizeTo32(bmp.width, bmp.height, MAX_SIDE_LEN);
	const off = new OffscreenCanvas(w, h);
	const ctx = off.getContext("2d")!;
	ctx.drawImage(bmp, 0, 0, w, h);
	const { data } = ctx.getImageData(0, 0, w, h);
	const chw = new Float32Array(3 * h * w);
	const plane = h * w;
	const m0 = MEAN[0];
	const m1 = MEAN[1];
	const m2 = MEAN[2];
	const s0 = STD[0];
	const s1 = STD[1];
	const s2 = STD[2];
	for (let i = 0, p = 0; i < data.length; i += 4, p++) {
		chw[p] = (data[i]! / 255 - m0) / s0;
		chw[plane + p] = (data[i + 1]! / 255 - m1) / s1;
		chw[2 * plane + p] = (data[i + 2]! / 255 - m2) / s2;
	}
	return { tensor: new ort.Tensor("float32", chw, [1, 3, h, w]), w, h };
}

function drawInput(bmp: ImageBitmap) {
	inputCanvas.width = bmp.width;
	inputCanvas.height = bmp.height;
	inputCanvas.getContext("2d")!.drawImage(bmp, 0, 0);
}

function drawProb(probMap: Float32Array, w: number, h: number) {
	probCanvas.width = w;
	probCanvas.height = h;
	const ctx = probCanvas.getContext("2d")!;
	const img = ctx.createImageData(w, h);
	let min = Infinity;
	let max = -Infinity;
	for (let i = 0; i < probMap.length; i++) {
		const v = probMap[i]!;
		if (v < min) min = v;
		if (v > max) max = v;
	}
	const range = max - min || 1;
	for (let i = 0; i < probMap.length; i++) {
		const v = Math.round(((probMap[i]! - min) / range) * 255);
		img.data[i * 4] = v;
		img.data[i * 4 + 1] = v;
		img.data[i * 4 + 2] = v;
		img.data[i * 4 + 3] = 255;
	}
	ctx.putImageData(img, 0, 0);
	log(`prob map ${w}x${h} range=[${min.toFixed(3)}, ${max.toFixed(3)}]`);
}

async function runDet() {
	if (!detSession || !currentBitmap) return;
	try {
		runDetBtn.disabled = true;
		setStatus(detStatusEl, "推理中…");
		drawInput(currentBitmap);
		const { tensor, w, h } = bitmapToDetTensor(currentBitmap);
		log(`det input shape=[1,3,${h},${w}]`);
		const inputName = detSession.inputNames[0]!;
		const t0 = performance.now();
		const out = await detSession.run({ [inputName]: tensor });
		const dt = performance.now() - t0;
		const outName = detSession.outputNames[0]!;
		const probTensor = out[outName]!;
		log(`det inference ${dt.toFixed(0)}ms output dims=${JSON.stringify(probTensor.dims)}`);
		const ow = probTensor.dims[3] as number;
		const oh = probTensor.dims[2] as number;
		drawProb(probTensor.data as Float32Array, ow, oh);
		setStatus(detStatusEl, `✅ det 完成（${dt.toFixed(0)}ms）`, "ok");
	} catch (err) {
		setStatus(detStatusEl, `❌ ${(err as Error).message}`, "error");
		log(`det error: ${(err as Error).stack ?? err}`);
	} finally {
		runDetBtn.disabled = false;
	}
}

// 简易 CTC greedy decode（Phase 1 的 §6.2 实现的迷你版本）
function ctcGreedyDecode(logits: Float32Array, T: number, C: number): string {
	const out: string[] = [];
	let prev = -1;
	for (let t = 0; t < T; t++) {
		let maxIdx = 0;
		let maxVal = -Infinity;
		for (let c = 0; c < C; c++) {
			const v = logits[t * C + c]!;
			if (v > maxVal) {
				maxVal = v;
				maxIdx = c;
			}
		}
		if (maxIdx !== 0 && maxIdx !== prev) {
			const ch = dict[maxIdx - 1];
			if (ch) out.push(ch);
		}
		prev = maxIdx;
	}
	return out.join("");
}

async function runRecSanity() {
	if (!recSession) return;
	try {
		runRecBtn.disabled = true;
		setStatus(recStatusEl, "推理中…");
		const N = 1;
		const H = 32; // PP-OCRv5 rec 输入高度是 32（SDD §11.2 写的 48 是 v4 旧规格，v5 已改）
		const W = 320;
		// 全零张量，纯粹验证流水线
		const data = new Float32Array(N * 3 * H * W);
		const inputName = recSession.inputNames[0]!;
		const tensor = new ort.Tensor("float32", data, [N, 3, H, W]);
		log(`rec input shape=[${N},3,${H},${W}] (zeros)`);
		const t0 = performance.now();
		const out = await recSession.run({ [inputName]: tensor });
		const dt = performance.now() - t0;
		const outName = recSession.outputNames[0]!;
		const logits = out[outName]!;
		log(`rec inference ${dt.toFixed(0)}ms output dims=${JSON.stringify(logits.dims)}`);

		const dims = logits.dims as readonly number[];
		const T = dims[1] as number;
		const C = dims[2] as number;
		const expectedC = dict.length + 1;

		const text = ctcGreedyDecode(logits.data as Float32Array, T, C);
		log(`rec decoded (zeros input, 应为空或乱字符): "${text}"`);

		if (C !== expectedC) {
			setStatus(
				recStatusEl,
				`⚠️ output C=${C}, 期望 ${expectedC}（dict+1）。字典或模型不匹配，Phase 1 要处理`,
				"error",
			);
		} else {
			setStatus(
				recStatusEl,
				`✅ rec 流水线 OK（${dt.toFixed(0)}ms, T=${T} C=${C}, 与字典对齐）`,
				"ok",
			);
		}
	} catch (err) {
		setStatus(recStatusEl, `❌ ${(err as Error).message}`, "error");
		log(`rec error: ${(err as Error).stack ?? err}`);
	} finally {
		runRecBtn.disabled = false;
	}
}

fileInput.addEventListener("change", async () => {
	const file = fileInput.files?.[0];
	if (!file) return;
	currentBitmap = await createImageBitmap(file);
	drawInput(currentBitmap);
	runDetBtn.disabled = !detSession;
	setStatus(detStatusEl, detSession ? "可 Run det" : "等模型…");
	log(`image ${file.name} ${currentBitmap.width}x${currentBitmap.height}`);
});

runDetBtn.addEventListener("click", runDet);
runRecBtn.addEventListener("click", runRecSanity);

loadAll();
