# @ocr-web/pdf

PDF 文本提取，基于 [`@ocr-web/core`](../core)。把每一页用 `pdfjs-dist` 渲染成图片后喂给 OcrEngine。

## 安装

```bash
pnpm add @ocr-web/pdf @ocr-web/core @ocr-web/models-ppocrv5 onnxruntime-web
```

## 用法

```ts
import { OcrEngineWorker } from "@ocr-web/core";
import OcrWorker from "@ocr-web/core/worker?worker";
import { ppocrV5 } from "@ocr-web/models-ppocrv5";
import { PdfOcr } from "@ocr-web/pdf";

const engine = await OcrEngineWorker.create({
  worker: new OcrWorker(),
  models: { detection: ppocrV5.detection, recognition: ppocrV5.recognition },
  dictionary: ppocrV5.dictionary,
  wasmPaths: "/ort/",
});

const pdfOcr = new PdfOcr({ engine });

// 单页 → 直接返回字符串
const text = await pdfOcr.recognize(file, 3);

// 全部页 → 返回 { 页号: { text, lines, durationMs } }
const all = await pdfOcr.recognize(file);
console.log(all[1].text, all[2].text);

// 指定多页
const some = await pdfOcr.recognize(file, [1, 3, 5]);
```

## API

```ts
type PdfInput = ArrayBuffer | Uint8Array | Blob | string;

class PdfOcr {
  constructor(opts: PdfOcrOptions);
  recognize(pdf: PdfInput, page: number): Promise<string>;
  recognize(pdf: PdfInput, pages?: "all" | number[]): Promise<PdfRecognizeResult>;
  pageCount(pdf: PdfInput): Promise<number>;
}

interface PdfOcrOptions {
  engine: OcrEngine | OcrEngineWorker;
  scale?: number;          // pdfjs render scale, default 2 (2x dpi, 利于小字 OCR)
  workerSrc?: string;      // pdfjs worker URL，默认走 jsDelivr CDN
  recognize?: RecognizeOptions;  // 透传给 engine.recognize
  onPageProgress?: (current: number, total: number, page: number) => void;
}

interface PdfPageRecognizeResult {
  text: string;
  lines: OcrLine[];
  durationMs: number;
}

type PdfRecognizeResult = Record<number, PdfPageRecognizeResult>;
```

## 注意

- **pdfjs worker**：默认从 jsDelivr CDN 加载 `pdf.worker.min.mjs`（带 CORS）。如果你的应用需要离线/CSP 严格，传 `workerSrc` 指向自己 host 的副本。
- **render scale**：默认 2x。文档清晰度低或字号小可以提高到 3-4，代价是耗时和内存增加。
- **页号 1-indexed**：跟 PDF 习惯一致，跟 pdfjs 一致。

## License

MIT
