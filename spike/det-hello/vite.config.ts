import { defineConfig } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";

// 把 onnxruntime-web 的 wasm 文件拷到 dev server 静态目录
// dist 目录名在 1.x 是 "dist"
export default defineConfig({
	plugins: [
		viteStaticCopy({
			targets: [
				{
					src: "node_modules/onnxruntime-web/dist/*.wasm",
					dest: "ort",
				},
				{
					src: "node_modules/onnxruntime-web/dist/*.mjs",
					dest: "ort",
				},
			],
		}),
	],
	server: {
		port: 5180,
		// COOP/COEP 头让 SharedArrayBuffer 可用（多线程 wasm 需要）
		// spike 默认单线程，留着方便后续切多线程
		headers: {
			"Cross-Origin-Opener-Policy": "same-origin",
			"Cross-Origin-Embedder-Policy": "require-corp",
		},
	},
	optimizeDeps: {
		exclude: ["onnxruntime-web"],
	},
});
