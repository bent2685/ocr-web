import { ort } from "../runtime.js";

const REC_HEIGHT = 32;
const PAD_TO_MULTIPLE = 16;

// PaddleOCR rec normalization: scale [0,255] to [-1,1] via (v/255 - 0.5)/0.5
export interface RecPreprocessResult {
	tensor: ort.Tensor;
	width: number;
}

export function preprocessRecCrop(
	rgba: Uint8ClampedArray,
	srcW: number,
	srcH: number,
): RecPreprocessResult {
	// resize to height = 32, keep aspect ratio, pad width to multiple of 16
	const targetH = REC_HEIGHT;
	const ratio = targetH / srcH;
	let targetW = Math.ceil(srcW * ratio);
	if (targetW < PAD_TO_MULTIPLE) targetW = PAD_TO_MULTIPLE;
	const paddedW = Math.ceil(targetW / PAD_TO_MULTIPLE) * PAD_TO_MULTIPLE;

	const srcCanvas = new OffscreenCanvas(srcW, srcH);
	const srcImageData = new ImageData(new Uint8ClampedArray(rgba), srcW, srcH);
	srcCanvas.getContext("2d")!.putImageData(srcImageData, 0, 0);
	const dstCanvas = new OffscreenCanvas(paddedW, targetH);
	const ctx = dstCanvas.getContext("2d")!;
	ctx.fillStyle = "black";
	ctx.fillRect(0, 0, paddedW, targetH);
	ctx.drawImage(srcCanvas, 0, 0, srcW, srcH, 0, 0, targetW, targetH);
	const { data } = ctx.getImageData(0, 0, paddedW, targetH);

	const chw = new Float32Array(3 * targetH * paddedW);
	const plane = targetH * paddedW;
	for (let i = 0, p = 0; i < data.length; i += 4, p++) {
		chw[p] = (data[i]! / 255 - 0.5) / 0.5;
		chw[plane + p] = (data[i + 1]! / 255 - 0.5) / 0.5;
		chw[2 * plane + p] = (data[i + 2]! / 255 - 0.5) / 0.5;
	}
	return {
		tensor: new ort.Tensor("float32", chw, [1, 3, targetH, paddedW]),
		width: paddedW,
	};
}
