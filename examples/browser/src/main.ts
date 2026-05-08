import { OcrEngineWorker } from "@ocr-web/core";
import OcrWorker from "@ocr-web/core/worker?worker";
import { ppocrV5 } from "@ocr-web/models-ppocrv5";
import { PdfOcr, type PdfRecognizeResult } from "@ocr-web/pdf";

const BASE = import.meta.env.BASE_URL;

const USE_LOCAL = await fetch(`${BASE}models/ppocrv5_det.onnx`, { method: "HEAD" })
	.then((r) => r.ok)
	.catch(() => false);

const detUrl = USE_LOCAL ? `${BASE}models/ppocrv5_det.onnx` : ppocrV5.detection;
const recUrl = USE_LOCAL ? `${BASE}models/ppocrv5_rec.onnx` : ppocrV5.recognition;
const dictUrl = USE_LOCAL ? `${BASE}models/ppocrv5_dict.txt` : ppocrV5.dictionary;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const globalStatusEl = $<HTMLDivElement>("globalStatus");
const modelSourceEl = $<HTMLDivElement>("modelSource");
modelSourceEl.textContent = `模型源：${USE_LOCAL ? "local /models/" : "jsDelivr CDN"}（worker 模式）`;

// tabs
for (const tab of document.querySelectorAll(".tab")) {
	tab.addEventListener("click", () => {
		const which = tab.getAttribute("data-tab");
		for (const t of document.querySelectorAll(".tab")) t.classList.toggle("active", t === tab);
		for (const s of document.querySelectorAll(".section"))
			s.classList.toggle("active", s.getAttribute("data-section") === which);
	});
}

let engine: OcrEngineWorker | null = null;
let pdfOcr: PdfOcr | null = null;

function setStatus(el: HTMLDivElement, msg: string, kind: "" | "ok" | "error" = "") {
	el.textContent = msg;
	el.className = `status${kind ? ` ${kind}` : ""}`;
}

async function init() {
	setStatus(globalStatusEl, "加载模型中…");
	try {
		const t0 = performance.now();
		const loaded: Record<string, number> = {};
		const totals: Record<string, number> = {};
		engine = await OcrEngineWorker.create({
			worker: new OcrWorker(),
			models: { detection: detUrl, recognition: recUrl },
			dictionary: dictUrl,
			wasmPaths: `${location.origin}${BASE}ort/`,
			onProgress: ({ loaded: l, total, file }) => {
				loaded[file] = l;
				totals[file] = total;
				const sumL = Object.values(loaded).reduce((a, b) => a + b, 0);
				const sumT = Object.values(totals).reduce((a, b) => a + b, 0);
				setStatus(
					globalStatusEl,
					`加载中 ${file}: ${(sumL / 1024 / 1024).toFixed(1)} / ${(sumT / 1024 / 1024).toFixed(1)} MB`,
				);
			},
		});
		pdfOcr = new PdfOcr({ engine });
		setStatus(globalStatusEl, `✅ 引擎就绪（${(performance.now() - t0).toFixed(0)}ms）。`, "ok");
		runImgBtn.disabled = !currentBitmap;
		runPdfBtn.disabled = !currentPdfFile;
	} catch (err) {
		setStatus(globalStatusEl, `❌ 初始化失败：${(err as Error).message}`, "error");
		console.error(err);
	}
}

// ===== Image tab =====

const imgFile = $<HTMLInputElement>("imgFile");
const runImgBtn = $<HTMLButtonElement>("runImg");
const imgStatusEl = $<HTMLDivElement>("imgStatus");
const overlayCanvas = $<HTMLCanvasElement>("overlay");
const linesEl = $<HTMLDivElement>("lines");
const fullTextEl = $<HTMLPreElement>("fullText");
let currentBitmap: ImageBitmap | null = null;

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

imgFile.addEventListener("change", async () => {
	const file = imgFile.files?.[0];
	if (!file) return;
	currentBitmap = await createImageBitmap(file);
	const ctx = overlayCanvas.getContext("2d")!;
	overlayCanvas.width = currentBitmap.width;
	overlayCanvas.height = currentBitmap.height;
	ctx.drawImage(currentBitmap, 0, 0);
	runImgBtn.disabled = !engine;
	setStatus(imgStatusEl, engine ? "已选图，点击 Recognize" : "等模型…");
});

runImgBtn.addEventListener("click", async () => {
	if (!engine || !currentBitmap) return;
	runImgBtn.disabled = true;
	setStatus(imgStatusEl, "识别中…（worker 跑，UI 不卡）");
	try {
		const result = await engine.recognize(currentBitmap);
		drawOverlay(
			currentBitmap,
			result.lines.map((l) => ({ box: l.box as [number, number][], text: l.text })),
		);
		renderLines(result.lines);
		fullTextEl.textContent = result.fullText;
		setStatus(
			imgStatusEl,
			`✅ ${result.lines.length} 行，耗时 ${result.durationMs.toFixed(0)}ms`,
			"ok",
		);
	} catch (err) {
		setStatus(imgStatusEl, `❌ ${(err as Error).message}`, "error");
		console.error(err);
	} finally {
		runImgBtn.disabled = false;
	}
});

// ===== PDF tab =====

const pdfFileInput = $<HTMLInputElement>("pdfFile");
const pdfPagesInput = $<HTMLInputElement>("pdfPages");
const runPdfBtn = $<HTMLButtonElement>("runPdf");
const pdfStatusEl = $<HTMLDivElement>("pdfStatus");
const pdfResultEl = $<HTMLDivElement>("pdfResult");
let currentPdfFile: File | null = null;

pdfFileInput.addEventListener("change", () => {
	const file = pdfFileInput.files?.[0];
	if (!file) return;
	currentPdfFile = file;
	runPdfBtn.disabled = !pdfOcr;
	setStatus(pdfStatusEl, pdfOcr ? `已选 ${file.name}，点击 Extract` : "等模型…");
});

function parsePages(s: string): "all" | number | number[] {
	const t = s.trim();
	if (!t || t === "all") return "all";
	if (!t.includes(",")) {
		const n = Number(t);
		if (Number.isInteger(n) && n > 0) return n;
		throw new Error(`无效的页输入：${t}`);
	}
	const arr = t.split(",").map((x) => {
		const n = Number(x.trim());
		if (!Number.isInteger(n) || n <= 0) throw new Error(`无效的页输入：${x}`);
		return n;
	});
	return arr;
}

function renderPdfResult(result: string | PdfRecognizeResult) {
	pdfResultEl.innerHTML = "";
	if (typeof result === "string") {
		const card = document.createElement("div");
		card.className = "page-card";
		card.innerHTML = "<h4>单页结果</h4><pre></pre>";
		card.querySelector("pre")!.textContent = result;
		pdfResultEl.appendChild(card);
		return;
	}
	const pages = Object.keys(result)
		.map(Number)
		.sort((a, b) => a - b);
	for (const p of pages) {
		const card = document.createElement("div");
		card.className = "page-card";
		const r = result[p]!;
		card.innerHTML = `<h4>Page ${p} — ${r.lines.length} 行 / ${r.durationMs.toFixed(0)}ms</h4><pre></pre>`;
		card.querySelector("pre")!.textContent = r.text;
		pdfResultEl.appendChild(card);
	}
}

runPdfBtn.addEventListener("click", async () => {
	if (!pdfOcr || !currentPdfFile) return;
	runPdfBtn.disabled = true;
	try {
		const pages = parsePages(pdfPagesInput.value);
		setStatus(pdfStatusEl, "解析中…");
		const t0 = performance.now();
		let result: string | PdfRecognizeResult;
		if (typeof pages === "number") {
			result = await pdfOcr.recognize(currentPdfFile, pages);
		} else {
			const ocrInst = new PdfOcr({
				engine: engine!,
				onPageProgress: (cur, total, p) =>
					setStatus(pdfStatusEl, `处理中… page ${p} (${cur}/${total})`),
			});
			result = await ocrInst.recognize(currentPdfFile, pages);
		}
		const dt = performance.now() - t0;
		renderPdfResult(result);
		setStatus(pdfStatusEl, `✅ 完成（${dt.toFixed(0)}ms）`, "ok");
	} catch (err) {
		setStatus(pdfStatusEl, `❌ ${(err as Error).message}`, "error");
		console.error(err);
	} finally {
		runPdfBtn.disabled = false;
	}
});

init();
