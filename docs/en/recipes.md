# Recipes

Copy-paste-ready snippets.

## Singleton engine (avoid re-initialization)

Share one engine across the whole app:

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

In application code:
```ts
import { getEngine } from "@/lib/ocr";

const engine = await getEngine();
const result = await engine.recognize(bitmap);
```

## React hook

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

  if (!ready) return <div>Loading model…</div>;
  if (error) return <div>Error: {error.message}</div>;

  return (
    <div>
      <input type="file" accept="image/*" onChange={async (e) => {
        const file = e.target.files?.[0];
        if (file) await recognize(await createImageBitmap(file));
      }} />
      {running && <div>Recognizing…</div>}
      {result && <pre>{result.fullText}</pre>}
    </div>
  );
}
```

## Smart PDF extraction (use pdfjs if text layer exists, otherwise OCR)

```ts
import * as pdfjs from "pdfjs-dist";
import { PdfOcr } from "@ocr-web/pdf";

async function extractPage(file: File, page: number, pdfOcr: PdfOcr): Promise<string> {
  // try native text layer first
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data }).promise;
  const p = await doc.getPage(page);
  const tc = await p.getTextContent();
  const native = tc.items
    .map((i: any) => ("str" in i ? i.str : ""))
    .join(" ")
    .trim();
  await doc.destroy();

  // text layer non-empty → return as-is
  if (native.length > 20) return native;

  // text layer empty/sparse (scan) → fall back to OCR
  return pdfOcr.recognize(file, page);
}

// usage
const pdfOcr = new PdfOcr({ engine });
const text = await extractPage(file, 1, pdfOcr);
```

The 20-character threshold is a heuristic — adjust to your content.

## Batch processing with progress

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

## Drag & drop upload

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

`engine.recognize()` accepts `Blob`, so a `File` works directly.

## Copy result to clipboard

```ts
async function ocrAndCopy(file: File) {
  const engine = await getEngine();
  const r = await engine.recognize(await createImageBitmap(file));
  await navigator.clipboard.writeText(r.fullText);
}
```

## Screen capture → OCR

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

## Electron main triggers, renderer runs OCR

The main process has no DOM/Worker, so OCR has to run in a renderer. Two approaches:

### Option A: hidden window for OCR

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

### Option B: send the image to the renderer

More common — OCR is usually triggered by user action, which is already in the renderer.

## Vue 3 composable

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

## Debounce: only OCR the latest image when the user uploads quickly

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

## Releasing resources

On page unload:

```ts
window.addEventListener("beforeunload", async () => {
  const engine = await enginePromise;  // don't await — may be too late; sync dispose is better
  engine.dispose();
});
```

Or call `engine.dispose()` from your framework's unmount hook (React/Vue).
