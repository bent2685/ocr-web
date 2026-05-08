# 食谱 / 实战示例

可拷贝即用的代码片段。

## 单例引擎（避免重复初始化）

整个应用共用一个 engine：

```ts
// src/lib/ocr.ts
import { OcrEngineWorker } from "@ocr-web/core";
import OcrWorker from "@ocr-web/core/worker?worker";
import { ppocrV5 } from "@ocr-web/models-ppocrv5";

let enginePromise: Promise<OcrEngineWorker> | null = null;

export function getEngine(): Promise<OcrEngineWorker> {
  if (!enginePromise) {
    enginePromise = OcrEngineWorker.create({
      worker: new OcrWorker(),
      models: { detection: ppocrV5.detection, recognition: ppocrV5.recognition },
      dictionary: ppocrV5.dictionary,
      wasmPaths: `${location.origin}/ort/`,
    });
  }
  return enginePromise;
}
```

业务里：
```ts
import { getEngine } from "@/lib/ocr";

const engine = await getEngine();
const result = await engine.recognize(bitmap);
```

## React Hook

```tsx
// src/hooks/useOcr.ts
import { useEffect, useState } from "react";
import { getEngine } from "@/lib/ocr";
import type { OcrEngineWorker, OcrResult, ImageInput } from "@ocr-web/core";

export function useOcrEngine() {
  const [engine, setEngine] = useState<OcrEngineWorker | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    getEngine().then(setEngine).catch(setError);
  }, []);

  return { engine, error };
}

export function useOcr() {
  const { engine, error: initError } = useOcrEngine();
  const [result, setResult] = useState<OcrResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<Error | null>(initError);

  const recognize = async (input: ImageInput) => {
    if (!engine) return;
    setRunning(true);
    setError(null);
    try {
      const r = await engine.recognize(input);
      setResult(r);
      return r;
    } catch (e) {
      setError(e as Error);
    } finally {
      setRunning(false);
    }
  };

  return { recognize, result, running, ready: !!engine, error };
}
```

```tsx
function OcrPanel() {
  const { recognize, result, running, ready, error } = useOcr();

  if (!ready) return <div>加载模型中…</div>;
  if (error) return <div>错误：{error.message}</div>;

  return (
    <div>
      <input type="file" accept="image/*" onChange={async (e) => {
        const file = e.target.files?.[0];
        if (file) await recognize(await createImageBitmap(file));
      }} />
      {running && <div>识别中…</div>}
      {result && <pre>{result.fullText}</pre>}
    </div>
  );
}
```

## 智能 PDF 提取（已有文本层就用 pdfjs，否则 OCR）

```ts
import * as pdfjs from "pdfjs-dist";
import { PdfOcr } from "@ocr-web/pdf";

async function extractPage(file: File, page: number, pdfOcr: PdfOcr): Promise<string> {
  // 先尝试原生文本
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data }).promise;
  const p = await doc.getPage(page);
  const tc = await p.getTextContent();
  const native = tc.items
    .map((i: any) => ("str" in i ? i.str : ""))
    .join(" ")
    .trim();
  await doc.destroy();

  // 文本层有内容，直接返回
  if (native.length > 20) return native;

  // 文本层为空 / 极少（扫描件） → 走 OCR
  return pdfOcr.recognize(file, page);
}

// 用法
const pdfOcr = new PdfOcr({ engine });
const text = await extractPage(file, 1, pdfOcr);
```

阈值 20 字符是经验值，根据你的内容调。

## 批量处理多个文件，进度可查

```ts
async function batchOcr(files: File[], onProgress: (cur: number, total: number, name: string) => void) {
  const engine = await getEngine();
  const results: { name: string; text: string }[] = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    onProgress(i, files.length, f.name);
    const bmp = await createImageBitmap(f);
    const r = await engine.recognize(bmp);
    bmp.close();
    results.push({ name: f.name, text: r.fullText });
  }
  return results;
}
```

## Drag & Drop 上传

```ts
document.body.addEventListener("dragover", (e) => e.preventDefault());
document.body.addEventListener("drop", async (e) => {
  e.preventDefault();
  const file = e.dataTransfer?.files?.[0];
  if (!file) return;
  const engine = await getEngine();
  const result = await engine.recognize(file);
  console.log(result.fullText);
});
```

注意 `engine.recognize()` 接受 `Blob`，所以 `File` 直接传就行。

## 复制识别结果到剪贴板

```ts
async function ocrAndCopy(file: File) {
  const engine = await getEngine();
  const r = await engine.recognize(await createImageBitmap(file));
  await navigator.clipboard.writeText(r.fullText);
}
```

## 截屏 → OCR

```ts
const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
const video = document.createElement("video");
video.srcObject = stream;
await video.play();

const canvas = new OffscreenCanvas(video.videoWidth, video.videoHeight);
canvas.getContext("2d")!.drawImage(video, 0, 0);
stream.getTracks().forEach(t => t.stop());

const engine = await getEngine();
const r = await engine.recognize(canvas);
console.log(r.fullText);
```

## Electron 主进程触发，渲染进程跑 OCR

主进程没有 DOM/Worker，所以 OCR 必须在 renderer 跑。两种方式：

### 方式 A：弹一个隐藏窗口跑 OCR

```ts
// main.ts
import { BrowserWindow, ipcMain } from "electron";

const ocrWin = new BrowserWindow({
  show: false,
  webPreferences: { preload: path.join(__dirname, "ocr-preload.js"), nodeIntegration: false }
});
ocrWin.loadFile("ocr.html");

ipcMain.handle("ocr", async (_, imageBuffer: ArrayBuffer) => {
  return ocrWin.webContents.executeJavaScript(`runOcr(${imageBuffer})`);
});
```

### 方式 B：把图片传给 renderer

更常见——OCR 是用户行为触发的，本来就在 renderer 里。

## Vue 3 Composable

```ts
// src/composables/useOcr.ts
import { ref, onMounted, onUnmounted } from "vue";
import { OcrEngineWorker } from "@ocr-web/core";
import OcrWorker from "@ocr-web/core/worker?worker";
import { ppocrV5 } from "@ocr-web/models-ppocrv5";

export function useOcr() {
  const engine = ref<OcrEngineWorker | null>(null);
  const ready = ref(false);

  onMounted(async () => {
    engine.value = await OcrEngineWorker.create({
      worker: new OcrWorker(),
      models: { detection: ppocrV5.detection, recognition: ppocrV5.recognition },
      dictionary: ppocrV5.dictionary,
      wasmPaths: `${location.origin}/ort/`,
    });
    ready.value = true;
  });

  onUnmounted(() => engine.value?.dispose());

  const recognize = async (input: any) => engine.value?.recognize(input);
  return { engine, ready, recognize };
}
```

## 防抖：用户连续上传图片只识别最后一张

```ts
let pendingPromise: Promise<unknown> | null = null;
let pendingFile: File | null = null;

async function ocrDebounced(file: File) {
  pendingFile = file;
  if (pendingPromise) return;
  pendingPromise = (async () => {
    while (pendingFile) {
      const cur = pendingFile;
      pendingFile = null;
      const engine = await getEngine();
      const r = await engine.recognize(cur);
      // emit r ...
    }
    pendingPromise = null;
  })();
}
```

## 释放资源

页面卸载时：

```ts
window.addEventListener("beforeunload", async () => {
  const engine = await enginePromise;  // 不要 await，可能太晚；同步 dispose 更好
  engine.dispose();
});
```

或者 React/Vue 框架的卸载钩子里调 `engine.dispose()`。
