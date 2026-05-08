import type { Point, Quad } from "./types.js";

export function convexHull(points: Point[]): Point[] {
	const n = points.length;
	if (n < 2) return points.slice();
	const sorted = points.slice().sort((a, b) => (a[0] === b[0] ? a[1] - b[1] : a[0] - b[0]));
	const cross = (o: Point, a: Point, b: Point) =>
		(a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

	const lower: Point[] = [];
	for (const p of sorted) {
		while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0)
			lower.pop();
		lower.push(p);
	}
	const upper: Point[] = [];
	for (let i = sorted.length - 1; i >= 0; i--) {
		const p = sorted[i]!;
		while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0)
			upper.pop();
		upper.push(p);
	}
	lower.pop();
	upper.pop();
	return lower.concat(upper);
}

export interface RotatedRect {
	cx: number;
	cy: number;
	width: number;
	height: number;
	angleRad: number;
}

// rotating calipers on convex hull
export function minAreaRect(hull: Point[]): RotatedRect {
	if (hull.length < 2) {
		const x = hull[0]?.[0] ?? 0;
		const y = hull[0]?.[1] ?? 0;
		return { cx: x, cy: y, width: 0, height: 0, angleRad: 0 };
	}
	let best: RotatedRect | null = null;
	let bestArea = Number.POSITIVE_INFINITY;
	const n = hull.length;
	for (let i = 0; i < n; i++) {
		const a = hull[i]!;
		const b = hull[(i + 1) % n]!;
		const dx = b[0] - a[0];
		const dy = b[1] - a[1];
		const len = Math.hypot(dx, dy) || 1;
		const ux = dx / len;
		const uy = dy / len;
		// project all hull points onto edge axis (u) and perpendicular (-uy, ux)
		let minU = Number.POSITIVE_INFINITY;
		let maxU = Number.NEGATIVE_INFINITY;
		let minV = Number.POSITIVE_INFINITY;
		let maxV = Number.NEGATIVE_INFINITY;
		for (const p of hull) {
			const u = p[0] * ux + p[1] * uy;
			const v = -p[0] * uy + p[1] * ux;
			if (u < minU) minU = u;
			if (u > maxU) maxU = u;
			if (v < minV) minV = v;
			if (v > maxV) maxV = v;
		}
		const w = maxU - minU;
		const h = maxV - minV;
		const area = w * h;
		if (area < bestArea) {
			bestArea = area;
			const midU = (minU + maxU) / 2;
			const midV = (minV + maxV) / 2;
			// inverse rotation back
			const cx = midU * ux - midV * uy;
			const cy = midU * uy + midV * ux;
			best = { cx, cy, width: w, height: h, angleRad: Math.atan2(uy, ux) };
		}
	}
	return best!;
}

export function rectCorners(r: RotatedRect): Quad {
	const cos = Math.cos(r.angleRad);
	const sin = Math.sin(r.angleRad);
	const hw = r.width / 2;
	const hh = r.height / 2;
	const local: Point[] = [
		[-hw, -hh],
		[hw, -hh],
		[hw, hh],
		[-hw, hh],
	];
	const corners = local.map<Point>(([x, y]) => [
		r.cx + x * cos - y * sin,
		r.cy + x * sin + y * cos,
	]);
	return [corners[0]!, corners[1]!, corners[2]!, corners[3]!];
}

// expand rotated rect outward by `distance` on each side (mimics PaddleOCR unclip)
export function unclipRect(r: RotatedRect, distance: number): RotatedRect {
	return {
		cx: r.cx,
		cy: r.cy,
		width: r.width + 2 * distance,
		height: r.height + 2 * distance,
		angleRad: r.angleRad,
	};
}

// distance = area * ratio / perimeter (per PaddleOCR DBPostProcess)
export function unclipDistance(r: RotatedRect, ratio: number): number {
	const area = r.width * r.height;
	const perimeter = 2 * (r.width + r.height) || 1;
	return (area * ratio) / perimeter;
}

// reorder so [0]=top-left, [1]=top-right, [2]=bottom-right, [3]=bottom-left
// "top" = smaller y; for ties (rotated text), use sum/diff trick like PaddleOCR
export function orderQuad(quad: Quad): Quad {
	const pts = quad.slice() as Point[];
	pts.sort((a, b) => a[1] - b[1]);
	const top = pts.slice(0, 2).sort((a, b) => a[0] - b[0]);
	const bot = pts.slice(2, 4).sort((a, b) => a[0] - b[0]);
	return [top[0]!, top[1]!, bot[1]!, bot[0]!];
}

export function quadWidth(q: Quad): number {
	return Math.max(
		Math.hypot(q[1][0] - q[0][0], q[1][1] - q[0][1]),
		Math.hypot(q[2][0] - q[3][0], q[2][1] - q[3][1]),
	);
}

export function quadHeight(q: Quad): number {
	return Math.max(
		Math.hypot(q[3][0] - q[0][0], q[3][1] - q[0][1]),
		Math.hypot(q[2][0] - q[1][0], q[2][1] - q[1][1]),
	);
}

export function quadCenter(q: Quad): Point {
	return [(q[0][0] + q[1][0] + q[2][0] + q[3][0]) / 4, (q[0][1] + q[1][1] + q[2][1] + q[3][1]) / 4];
}
