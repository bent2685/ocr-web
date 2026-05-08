import { OcrEngine } from "@ocr-web/core";
import { ppocrV5 } from "@ocr-web/models-ppocrv5";

// Default: use models from local public/models if present (faster dev iteration),
// fall back to GitHub Release URLs from @ocr-web/models-ppocrv5
const USE_LOCAL = await fetch("/models/ppocrv5_det.onnx", { method: "HEAD" })
	.then((r) => r.ok)
	.catch(() => false);

const detUrl = USE_LOCAL ? "/models/ppocrv5_det.onnx" : ppocrV5.detection;
const recUrl = USE_LOCAL ? "/models/ppocrv5_rec.onnx" : ppocrV5.recognition;
const dictUrl = USE_LOCAL ? "/models/ppocrv5_dict.txt" : ppocrV5.dictionary;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const fileInput = $<HTMLInputElement>("file");
const runBtn = $<HTMLButtonElement>("run");
const statusEl = $<HTMLDivElement>("status");
const overlayCanvas = $<HTMLCanvasElement>("overlay");
const linesEl = $<HTMLDivElement>("lines");
const fullTextEl = $<HTMLPreElement>("fullText");
const modelSourceEl = $<HTMLDivElement>("modelSource");
modelSourceEl.textContent = `模型源：${USE_LOCAL ? "local /models/" : "GitHub Release"}`;

let engine: OcrEngine | null = null;
let currentBitmap: ImageBitmap | null = null;

function setStatus(msg: string, kind: "" | "ok" | "error" = "") {
	statusEl.textContent = msg;
	statusEl.className = `status${kind ? ` ${kind}` : ""}`;
}

async function init() {
	setStatus("加载模型中（首次约 5-10s，会缓存）…");
	try {
		const t0 = performance.now();
		engine = await OcrEngine.create({
			models: { detection: detUrl, recognition: recUrl },
			dictionary: dictUrl,
			wasmPaths: "/ort/",
		});
		setStatus(`✅ 引擎就绪（${(performance.now() - t0).toFixed(0)}ms）。选择图片开始识别。`, "ok");
		(window as unknown as { __engine: OcrEngine }).__engine = engine;
	} catch (err) {
		setStatus(`❌ 初始化失败：${(err as Error).message}`, "error");
		console.error(err);
	}
}

function drawOverlay(bmp: ImageBitmap, lines: { box: [number, number][]; text: string }[]) {
	overlayCanvas.width = bmp.width;
	overlayCanvas.height = bmp.height;
	const ctx = overlayCanvas.getContext("2d")!;
	ctx.drawImage(bmp, 0, 0);
	ctx.lineWidth = Math.max(2, bmp.width / 500);
	ctx.strokeStyle = "rgba(255, 0, 80, 0.85)";
	for (const { box } of lines) {
		ctx.beginPath();
		ctx.moveTo(box[0]![0], box[0]![1]);
		for (let i = 1; i < box.length; i++) ctx.lineTo(box[i]![0], box[i]![1]);
		ctx.closePath();
		ctx.stroke();
	}
}

function renderLines(lines: { text: string; confidence: number }[]) {
	linesEl.innerHTML = "";
	for (const { text, confidence } of lines) {
		const div = document.createElement("div");
		div.className = "line";
		div.innerHTML = `<span class="conf">${(confidence * 100).toFixed(0)}%</span><span class="text"></span>`;
		div.querySelector(".text")!.textContent = text;
		linesEl.appendChild(div);
	}
}

async function run() {
	if (!engine || !currentBitmap) return;
	runBtn.disabled = true;
	setStatus("识别中…");
	try {
		const result = await engine.recognize(currentBitmap);
		drawOverlay(
			currentBitmap,
			result.lines.map((l) => ({ box: l.box as [number, number][], text: l.text })),
		);
		renderLines(result.lines);
		fullTextEl.textContent = result.fullText;
		setStatus(
			`✅ 识别完成：${result.lines.length} 行，耗时 ${result.durationMs.toFixed(0)}ms`,
			"ok",
		);
	} catch (err) {
		setStatus(`❌ ${(err as Error).message}`, "error");
		console.error(err);
	} finally {
		runBtn.disabled = false;
	}
}

fileInput.addEventListener("change", async () => {
	const file = fileInput.files?.[0];
	if (!file) return;
	currentBitmap = await createImageBitmap(file);
	const ctx = overlayCanvas.getContext("2d")!;
	overlayCanvas.width = currentBitmap.width;
	overlayCanvas.height = currentBitmap.height;
	ctx.drawImage(currentBitmap, 0, 0);
	runBtn.disabled = !engine;
	setStatus(engine ? "已选图，点击 Recognize" : "等模型…");
});

runBtn.addEventListener("click", run);

init();
