import type { NormalizedImage } from "../input.js";
import type { Quad } from "../types.js";

// solve 8x8 system via Gauss-Jordan to get homography that maps src[i] → dst[i]
function solveHomography(src: Quad, dst: Quad): Float64Array {
	const A: number[][] = [];
	const b: number[] = [];
	for (let i = 0; i < 4; i++) {
		const [sx, sy] = src[i]!;
		const [dx, dy] = dst[i]!;
		A.push([sx, sy, 1, 0, 0, 0, -dx * sx, -dx * sy]);
		b.push(dx);
		A.push([0, 0, 0, sx, sy, 1, -dy * sx, -dy * sy]);
		b.push(dy);
	}
	// gauss-jordan elimination
	const n = 8;
	const M: number[][] = A.map((row, i) => [...row, b[i]!]);
	for (let i = 0; i < n; i++) {
		let pivot = i;
		for (let r = i + 1; r < n; r++) {
			if (Math.abs(M[r]![i]!) > Math.abs(M[pivot]![i]!)) pivot = r;
		}
		if (pivot !== i) [M[i], M[pivot]] = [M[pivot]!, M[i]!];
		const div = M[i]![i]!;
		if (Math.abs(div) < 1e-12) throw new Error("Singular matrix in homography");
		for (let c = i; c <= n; c++) M[i]![c] = M[i]![c]! / div;
		for (let r = 0; r < n; r++) {
			if (r === i) continue;
			const factor = M[r]![i]!;
			if (factor === 0) continue;
			for (let c = i; c <= n; c++) M[r]![c] = M[r]![c]! - factor * M[i]![c]!;
		}
	}
	return new Float64Array([
		M[0]![8]!,
		M[1]![8]!,
		M[2]![8]!,
		M[3]![8]!,
		M[4]![8]!,
		M[5]![8]!,
		M[6]![8]!,
		M[7]![8]!,
		1,
	]);
}

function invertHomography(h: Float64Array): Float64Array {
	const a = h[0]!;
	const b = h[1]!;
	const c = h[2]!;
	const d = h[3]!;
	const e = h[4]!;
	const f = h[5]!;
	const g = h[6]!;
	const hh = h[7]!;
	const i = h[8]!;
	const det = a * (e * i - f * hh) - b * (d * i - f * g) + c * (d * hh - e * g);
	if (Math.abs(det) < 1e-12) throw new Error("Non-invertible homography");
	const inv = new Float64Array(9);
	inv[0] = (e * i - f * hh) / det;
	inv[1] = (c * hh - b * i) / det;
	inv[2] = (b * f - c * e) / det;
	inv[3] = (f * g - d * i) / det;
	inv[4] = (a * i - c * g) / det;
	inv[5] = (c * d - a * f) / det;
	inv[6] = (d * hh - e * g) / det;
	inv[7] = (b * g - a * hh) / det;
	inv[8] = (a * e - b * d) / det;
	return inv;
}

// returns RGBA image of size targetW x targetH containing the warped quad
export function warpQuad(
	src: NormalizedImage,
	quad: Quad,
	targetW: number,
	targetH: number,
): Uint8ClampedArray {
	const dst: Quad = [
		[0, 0],
		[targetW - 1, 0],
		[targetW - 1, targetH - 1],
		[0, targetH - 1],
	];
	const fwd = solveHomography(quad, dst);
	const inv = invertHomography(fwd);
	const out = new Uint8ClampedArray(targetW * targetH * 4);
	const sw = src.width;
	const sh = src.height;
	const sd = src.data;

	for (let y = 0; y < targetH; y++) {
		for (let x = 0; x < targetW; x++) {
			const wz = inv[6]! * x + inv[7]! * y + inv[8]!;
			const sx = (inv[0]! * x + inv[1]! * y + inv[2]!) / wz;
			const sy = (inv[3]! * x + inv[4]! * y + inv[5]!) / wz;
			const x0 = Math.floor(sx);
			const y0 = Math.floor(sy);
			const x1 = x0 + 1;
			const y1 = y0 + 1;
			const dx = sx - x0;
			const dy = sy - y0;
			const oOff = (y * targetW + x) * 4;
			if (x0 < 0 || y0 < 0 || x1 >= sw || y1 >= sh) {
				out[oOff] = 0;
				out[oOff + 1] = 0;
				out[oOff + 2] = 0;
				out[oOff + 3] = 255;
				continue;
			}
			const i00 = (y0 * sw + x0) * 4;
			const i10 = (y0 * sw + x1) * 4;
			const i01 = (y1 * sw + x0) * 4;
			const i11 = (y1 * sw + x1) * 4;
			const w00 = (1 - dx) * (1 - dy);
			const w10 = dx * (1 - dy);
			const w01 = (1 - dx) * dy;
			const w11 = dx * dy;
			for (let c = 0; c < 3; c++) {
				out[oOff + c] =
					sd[i00 + c]! * w00 + sd[i10 + c]! * w10 + sd[i01 + c]! * w01 + sd[i11 + c]! * w11;
			}
			out[oOff + 3] = 255;
		}
	}
	return out;
}
