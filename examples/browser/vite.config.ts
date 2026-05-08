import { defineConfig } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";

export default defineConfig({
	// GitHub Pages serves under /<repo>/; in dev keep root
	base: process.env.GITHUB_PAGES === "1" ? "/ocr-web/" : "/",
	plugins: [
		viteStaticCopy({
			targets: [
				{ src: "node_modules/onnxruntime-web/dist/*.wasm", dest: "ort" },
				{ src: "node_modules/onnxruntime-web/dist/*.mjs", dest: "ort" },
			],
		}),
	],
	server: { port: 5181 },
	optimizeDeps: { exclude: ["onnxruntime-web"] },
	build: { target: "esnext" },
});
