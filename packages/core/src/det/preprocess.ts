import type { NormalizedImage } from "../input.js";
import { ort } from "../runtime.js";

const MEAN: readonly [number, number, number] = [0.485, 0.456, 0.406];
const STD: readonly [number, number, number] = [0.229, 0.224, 0.225];

export interface DetPreprocessResult {
	tensor: ort.Tensor;
	resizedW: number;
	resizedH: number;
	scaleX: number;
	scaleY: number;
}

function roundTo32(n: number): number {
	return Math.max(32, Math.round(n / 32) * 32);
}

export function preprocessForDet(img: NormalizedImage, maxSideLen: number): DetPreprocessResult {
	const { width: srcW, height: srcH } = img;
	const ratio = Math.max(srcW, srcH) > maxSideLen ? maxSideLen / Math.max(srcW, srcH) : 1;
	const targetW = roundTo32(srcW * ratio);
	const targetH = roundTo32(srcH * ratio);

	const off = new OffscreenCanvas(targetW, targetH);
	const ctx = off.getContext("2d");
	if (!ctx) throw new Error("OffscreenCanvas 2d context unavailable");
	const srcCanvas = new OffscreenCanvas(srcW, srcH);
	const srcImageData = new ImageData(new Uint8ClampedArray(img.data), srcW, srcH);
	srcCanvas.getContext("2d")!.putImageData(srcImageData, 0, 0);
	ctx.drawImage(srcCanvas, 0, 0, targetW, targetH);
	const { data } = ctx.getImageData(0, 0, targetW, targetH);

	const chw = new Float32Array(3 * targetH * targetW);
	const plane = targetH * targetW;
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

	return {
		tensor: new ort.Tensor("float32", chw, [1, 3, targetH, targetW]),
		resizedW: targetW,
		resizedH: targetH,
		scaleX: srcW / targetW,
		scaleY: srcH / targetH,
	};
}
