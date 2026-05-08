import { describe, expect, it } from "vitest";
import {
	convexHull,
	minAreaRect,
	orderQuad,
	rectCorners,
	unclipDistance,
	unclipRect,
} from "../src/geometry.js";
import type { Quad } from "../src/types.js";

describe("convexHull", () => {
	it("returns hull of square points", () => {
		const pts: [number, number][] = [
			[0, 0],
			[1, 0],
			[0, 1],
			[1, 1],
			[0.5, 0.5],
		];
		const hull = convexHull(pts);
		expect(hull.length).toBe(4);
	});
	it("handles collinear points", () => {
		const pts: [number, number][] = [
			[0, 0],
			[1, 0],
			[2, 0],
		];
		const hull = convexHull(pts);
		expect(hull.length).toBeGreaterThanOrEqual(2);
	});
});

describe("minAreaRect", () => {
	it("axis-aligned square gives area = w*h", () => {
		const hull = convexHull([
			[0, 0],
			[10, 0],
			[10, 5],
			[0, 5],
		]);
		const r = minAreaRect(hull);
		expect(r.width * r.height).toBeCloseTo(50, 5);
	});
	it("rotated rectangle preserves area", () => {
		const angle = Math.PI / 6;
		const cos = Math.cos(angle);
		const sin = Math.sin(angle);
		const local: [number, number][] = [
			[-5, -2],
			[5, -2],
			[5, 2],
			[-5, 2],
		];
		const pts = local.map<[number, number]>(([x, y]) => [x * cos - y * sin, x * sin + y * cos]);
		const r = minAreaRect(convexHull(pts));
		expect(r.width * r.height).toBeCloseTo(40, 4);
	});
});

describe("rectCorners + unclip", () => {
	it("axis-aligned rect produces correct corners", () => {
		const corners = rectCorners({ cx: 5, cy: 3, width: 10, height: 6, angleRad: 0 });
		expect(corners.map((c) => c.map((v) => Math.round(v)))).toEqual([
			[0, 0],
			[10, 0],
			[10, 6],
			[0, 6],
		]);
	});
	it("unclip expands rect symmetrically", () => {
		const r = { cx: 5, cy: 3, width: 10, height: 6, angleRad: 0 };
		const d = unclipDistance(r, 1.6);
		const expanded = unclipRect(r, d);
		expect(expanded.width).toBeGreaterThan(r.width);
		expect(expanded.height).toBeGreaterThan(r.height);
		expect(expanded.cx).toBe(r.cx);
		expect(expanded.cy).toBe(r.cy);
	});
});

describe("orderQuad", () => {
	it("orders corners as TL, TR, BR, BL", () => {
		const shuffled: Quad = [
			[10, 10],
			[0, 10],
			[10, 0],
			[0, 0],
		];
		const ordered = orderQuad(shuffled);
		expect(ordered).toEqual([
			[0, 0],
			[10, 0],
			[10, 10],
			[0, 10],
		]);
	});
});
