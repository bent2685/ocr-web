import type { ImageInput } from "./types.js";

export interface NormalizedImage {
	data: Uint8ClampedArray;
	width: number;
	height: number;
}

async function blobToImageData(blob: Blob): Promise<NormalizedImage> {
	const bitmap = await createImageBitmap(blob);
	try {
		return bitmapToImageData(bitmap);
	} finally {
		bitmap.close();
	}
}

function bitmapToImageData(bmp: ImageBitmap): NormalizedImage {
	const canvas = new OffscreenCanvas(bmp.width, bmp.height);
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("OffscreenCanvas 2d context unavailable");
	ctx.drawImage(bmp, 0, 0);
	const img = ctx.getImageData(0, 0, bmp.width, bmp.height);
	return { data: img.data, width: img.width, height: img.height };
}

function canvasToImageData(canvas: HTMLCanvasElement | OffscreenCanvas): NormalizedImage {
	const ctx = canvas.getContext("2d") as
		| CanvasRenderingContext2D
		| OffscreenCanvasRenderingContext2D
		| null;
	if (!ctx) throw new Error("Canvas 2d context unavailable");
	const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
	return { data: img.data, width: img.width, height: img.height };
}

export async function normalizeInput(input: ImageInput): Promise<NormalizedImage> {
	if (typeof input === "string") {
		const res = await fetch(input);
		if (!res.ok) throw new Error(`Failed to fetch image: ${input} (${res.status})`);
		return blobToImageData(await res.blob());
	}
	if (input instanceof Blob) return blobToImageData(input);
	if (typeof ImageBitmap !== "undefined" && input instanceof ImageBitmap)
		return bitmapToImageData(input);
	if (typeof ImageData !== "undefined" && input instanceof ImageData)
		return { data: input.data, width: input.width, height: input.height };
	if (typeof HTMLCanvasElement !== "undefined" && input instanceof HTMLCanvasElement)
		return canvasToImageData(input);
	if (typeof OffscreenCanvas !== "undefined" && input instanceof OffscreenCanvas)
		return canvasToImageData(input);
	throw new Error("Unsupported ImageInput type");
}
