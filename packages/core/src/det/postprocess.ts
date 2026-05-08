import {
	convexHull,
	minAreaRect,
	orderQuad,
	rectCorners,
	unclipDistance,
	unclipRect,
} from "../geometry.js";
import type { InternalDetBox, Point, Quad } from "../types.js";

export interface DetPostprocessOptions {
	threshold: number;
	boxThreshold: number;
	unclipRatio: number;
	minBoxSize: number;
	scaleX: number;
	scaleY: number;
}

export function postprocessDet(
	probMap: Float32Array,
	w: number,
	h: number,
	opts: DetPostprocessOptions,
): InternalDetBox[] {
	const bin = new Uint8Array(w * h);
	for (let i = 0; i < probMap.length; i++) {
		if (probMap[i]! > opts.threshold) bin[i] = 1;
	}

	const components = findComponents(bin, w, h);
	const boxes: InternalDetBox[] = [];
	for (const pts of components) {
		if (pts.length < opts.minBoxSize) continue;
		const hull = convexHull(pts);
		if (hull.length < 3) continue;
		const rect = minAreaRect(hull);
		if (Math.min(rect.width, rect.height) < 3) continue;

		const score = boxScore(probMap, w, h, pts);
		if (score < opts.boxThreshold) continue;

		const distance = unclipDistance(rect, opts.unclipRatio);
		const expanded = unclipRect(rect, distance);
		if (Math.min(expanded.width, expanded.height) < opts.minBoxSize) continue;

		const corners = rectCorners(expanded);
		const ordered = orderQuad(corners);
		const scaled = ordered.map<Point>(([x, y]) => [x * opts.scaleX, y * opts.scaleY]) as Quad;

		boxes.push({ box: scaled, score });
	}
	return boxes;
}

// 8-connectivity BFS connected components on binary map; returns pixel point lists
function findComponents(bin: Uint8Array, w: number, h: number): Point[][] {
	const visited = new Uint8Array(w * h);
	const components: Point[][] = [];
	const stack: number[] = [];
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const idx = y * w + x;
			if (!bin[idx] || visited[idx]) continue;
			const pts: Point[] = [];
			stack.push(idx);
			visited[idx] = 1;
			while (stack.length) {
				const cur = stack.pop()!;
				const cy = (cur / w) | 0;
				const cx = cur - cy * w;
				pts.push([cx, cy]);
				for (let dy = -1; dy <= 1; dy++) {
					for (let dx = -1; dx <= 1; dx++) {
						if (dx === 0 && dy === 0) continue;
						const nx = cx + dx;
						const ny = cy + dy;
						if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
						const nIdx = ny * w + nx;
						if (visited[nIdx] || !bin[nIdx]) continue;
						visited[nIdx] = 1;
						stack.push(nIdx);
					}
				}
			}
			components.push(pts);
		}
	}
	return components;
}

function boxScore(probMap: Float32Array, w: number, h: number, pts: Point[]): number {
	let sum = 0;
	for (const [x, y] of pts) sum += probMap[y * w + x] ?? 0;
	return sum / pts.length;
}
