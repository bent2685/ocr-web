# Tuning guide

The `opts` argument to `recognize(input, opts)` controls det post-processing. Defaults match PaddleOCR's recommendations and work for most scenarios. Tune only when you hit issues.

## Three core parameters

```ts
{
  detThreshold: 0.3,      // probability-map binarization threshold
  detBoxThreshold: 0.6,   // box average-probability filter
  unclipRatio: 1.6,       // box expansion factor
}
```

## Symptom → fix table

| What you see | Adjust | How |
|---|---|---|
| Missed detections (text is there but no box) | `detThreshold` ↓ | 0.3 → 0.2 |
| Boxes are fragmented / one line gets split | `detThreshold` ↓ + `unclipRatio` ↑ | 0.3 → 0.2, 1.6 → 2.0 |
| Boxes glued / two lines merged into one | `detThreshold` ↑ | 0.3 → 0.4 |
| Boxes too tight, characters get cut | `unclipRatio` ↑ | 1.6 → 2.0 |
| Boxes too loose, neighboring content swept in | `unclipRatio` ↓ | 1.6 → 1.4 |
| Noise gets recognized as garbage | `detBoxThreshold` ↑ | 0.6 → 0.7 |
| Real text gets filtered out | `detBoxThreshold` ↓ | 0.6 → 0.5 |
| Small fonts misrecognized (<16px) | combo: `detThreshold` 0.2 + `unclipRatio` 1.8 + `maxSideLen` 1280 | |
| Large images are slow | `maxSideLen` ↓ | 960 → 640 (sacrifices accuracy) |

## Per-parameter explanations

### `detThreshold` (default 0.3)

The det model outputs a `[0, 1]` probability map; pixels above this threshold are considered foreground.

- **Lower** (0.2): more pixels included → bigger, more connected boxes → **fewer misses, more false positives**
- **Higher** (0.4–0.5): only high-probability regions → tighter, sparser boxes → **fewer false positives, more misses**

Debugging tip: temporarily render the probability map in your example app and inspect visually (we did this during the spike).

### `detBoxThreshold` (default 0.6)

The mean probability of all pixels inside a candidate box. Boxes below this value are dropped.

- Filters out "low-quality boxes" — e.g. noise that barely connected during binarization but has low mean probability
- **Higher**: keep only high-quality boxes; recall ↓
- **Lower**: keep more boxes; may introduce noise

### `unclipRatio` (default 1.6)

DBNet shrinks ground-truth boxes during training, so its predictions are tighter than the real text. This parameter expands each box outward by `area * ratio / perimeter`.

- **Lower** (1.2–1.4): tighter boxes → rec may clip characters
- **Higher** (1.8–2.0): looser boxes → neighbors may be included, but rec usually tolerates this

### `maxSideLen` (default 960)

Upper bound on the longest side of the det input image. Larger images are scaled down.

- Determines how "fine" det perceives the image
- **Smaller** (480, 640): faster det, but small text recognition suffers
- **Larger** (1280, 1600): better small-font recognition, but slower det and higher memory

PP-OCRv5 was trained at 960; deviating in either direction may not help. **Tune only in special cases.**

### `minBoxSize` (default 3)

Boxes whose shorter side is below this many pixels are dropped outright. **Rarely needs tuning** — it's a connected-component noise filter.

## How to tell whether the defaults are good enough for you

The simplest way: take 5–10 representative images, compute character-level accuracy by hand:

```
correct chars / total chars = ?
```

`>= 92%`: don't bother tuning. `< 90%`: time to investigate which step (det missing boxes, or rec misreading).

```ts
const result = await engine.recognize(img, { detThreshold: 0.25 });
console.log(result.fullText);
// compare against ground truth
```

## Tuning script template

A small batch sweep:

```ts
const fixtures = [
  { name: "img1", img: bmp1, gt: "ground truth 1" },
  // ...
];

for (const dt of [0.2, 0.25, 0.3, 0.35]) {
  for (const ur of [1.4, 1.6, 1.8, 2.0]) {
    let correct = 0, total = 0;
    for (const f of fixtures) {
      const r = await engine.recognize(f.img, {
        detThreshold: dt, unclipRatio: ur,
      });
      total += f.gt.length;
      correct += levenshteinSimilarity(r.fullText, f.gt);
    }
    console.log(`dt=${dt} ur=${ur}: ${correct}/${total}`);
  }
}
```

## Don't

- ❌ **Don't tune per-image dynamically** — pick one set of constants that works best for your scenario and freeze it.
- ❌ **Don't expect "a tweak gets us to 99%"** — defaults are already near-optimal; single-parameter changes typically swing 1–3%, not transformative.
- ❌ **Don't share parameters across scenarios** — values tuned for invoices probably won't work for manga subtitles. Re-tune.

## Known limits

- Tiny fonts (effective height < 12px): rec model is at its capability ceiling — no amount of tuning helps. Upscale the image before OCR.
- Handwriting: PP-OCR is poor at it. No fix; switch to a TrOCR-style model.
- Severe rotation (>15°): no cls model is currently auto-correcting; preprocess yourself (via pdfjs or canvas).
