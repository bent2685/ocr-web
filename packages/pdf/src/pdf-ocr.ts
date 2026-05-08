import type { OcrEngine, OcrEngineWorker, OcrLine, RecognizeOptions } from "@ocr-web/core";
import * as pdfjs from "pdfjs-dist";

const DEFAULT_WORKER_SRC = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

export type PdfInput = ArrayBuffer | Uint8Array | Blob | string;

export interface PdfPageRecognizeResult {
	text: string;
	lines: OcrLine[];
	durationMs: number;
}

export type PdfRecognizeResult = Record<number, PdfPageRecognizeResult>;

export interface PdfOcrOptions {
	engine: OcrEngine | OcrEngineWorker;
	scale?: number;
	workerSrc?: string;
	recognize?: RecognizeOptions;
	onPageProgress?: (current: number, total: number, page: number) => void;
}

let workerSrcConfigured = false;

export class PdfOcr {
	private readonly engine: OcrEngine | OcrEngineWorker;
	private readonly scale: number;
	private readonly recognizeOpts: RecognizeOptions | undefined;
	private readonly onPageProgress: PdfOcrOptions["onPageProgress"];

	constructor(opts: PdfOcrOptions) {
		this.engine = opts.engine;
		this.scale = opts.scale ?? 2;
		this.recognizeOpts = opts.recognize;
		this.onPageProgress = opts.onPageProgress;

		if (!workerSrcConfigured) {
			pdfjs.GlobalWorkerOptions.workerSrc = opts.workerSrc ?? DEFAULT_WORKER_SRC;
			workerSrcConfigured = true;
		}
	}

	// Single page → just the text
	async recognize(pdf: PdfInput, page: number): Promise<string>;
	// Whole pdf or specified pages → keyed by page number
	async recognize(pdf: PdfInput, pages?: "all" | number[]): Promise<PdfRecognizeResult>;
	async recognize(
		pdf: PdfInput,
		pages: number | "all" | number[] = "all",
	): Promise<string | PdfRecognizeResult> {
		const doc = await this.loadDocument(pdf);
		try {
			if (typeof pages === "number") {
				const r = await this.processPage(doc, pages);
				return r.text;
			}
			const list =
				pages === "all"
					? Array.from({ length: doc.numPages }, (_, i) => i + 1)
					: pages.slice().sort((a, b) => a - b);
			const out: PdfRecognizeResult = {};
			for (let i = 0; i < list.length; i++) {
				const p = list[i]!;
				out[p] = await this.processPage(doc, p);
				this.onPageProgress?.(i + 1, list.length, p);
			}
			return out;
		} finally {
			await doc.destroy();
		}
	}

	async pageCount(pdf: PdfInput): Promise<number> {
		const doc = await this.loadDocument(pdf);
		try {
			return doc.numPages;
		} finally {
			await doc.destroy();
		}
	}

	private async loadDocument(pdf: PdfInput): Promise<pdfjs.PDFDocumentProxy> {
		let data: Uint8Array;
		if (typeof pdf === "string") {
			const res = await fetch(pdf);
			if (!res.ok) throw new Error(`Failed to fetch PDF: ${pdf} (${res.status})`);
			data = new Uint8Array(await res.arrayBuffer());
		} else if (pdf instanceof Blob) {
			data = new Uint8Array(await pdf.arrayBuffer());
		} else if (pdf instanceof Uint8Array) {
			data = pdf;
		} else {
			data = new Uint8Array(pdf);
		}
		return pdfjs.getDocument({ data }).promise;
	}

	private async processPage(
		doc: pdfjs.PDFDocumentProxy,
		pageNum: number,
	): Promise<PdfPageRecognizeResult> {
		if (pageNum < 1 || pageNum > doc.numPages) {
			throw new Error(`Page ${pageNum} out of range (1..${doc.numPages})`);
		}
		const page = await doc.getPage(pageNum);
		try {
			const viewport = page.getViewport({ scale: this.scale });
			const w = Math.ceil(viewport.width);
			const h = Math.ceil(viewport.height);
			const canvas = new OffscreenCanvas(w, h);
			const ctx = canvas.getContext("2d");
			if (!ctx) throw new Error("OffscreenCanvas 2d context unavailable");
			// pdfjs accepts CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D in 4.x
			await page.render({
				canvasContext: ctx as unknown as CanvasRenderingContext2D,
				viewport,
			}).promise;
			const bitmap = canvas.transferToImageBitmap();
			const result = await this.engine.recognize(bitmap, this.recognizeOpts);
			bitmap.close();
			return {
				text: result.fullText,
				lines: result.lines,
				durationMs: result.durationMs,
			};
		} finally {
			page.cleanup();
		}
	}
}
