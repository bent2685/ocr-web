# 调参指南

`recognize(input, opts)` 的 `opts` 决定 det 后处理的行为。默认值是 PaddleOCR 推荐值，对多数场景够用。出问题时再调。

## 三个核心参数

```ts
{
  detThreshold: 0.3,      // 概率图二值化阈值
  detBoxThreshold: 0.6,   // 框平均概率过滤
  unclipRatio: 1.6,       // 框扩张系数
}
```

## 症状 → 解药表

| 你看到 | 调这个 | 怎么调 |
|---|---|---|
| 漏识别（明明有字没框） | `detThreshold` ↓ | 0.3 → 0.2 |
| 框碎/一行被切成几段 | `detThreshold` ↓ + `unclipRatio` ↑ | 0.3 → 0.2，1.6 → 2.0 |
| 框粘连/两行被框成一个 | `detThreshold` ↑ | 0.3 → 0.4 |
| 框太紧导致字被切 | `unclipRatio` ↑ | 1.6 → 2.0 |
| 框太松卷入旁边内容 | `unclipRatio` ↓ | 1.6 → 1.4 |
| 噪点被识别成乱码 | `detBoxThreshold` ↑ | 0.6 → 0.7 |
| 真实文字被过滤掉 | `detBoxThreshold` ↓ | 0.6 → 0.5 |
| 小字号识别错（<16px） | 综合：`detThreshold` 0.2 + `unclipRatio` 1.8 + `maxSideLen` 1280 | |
| 大尺寸图慢 | `maxSideLen` ↓ | 960 → 640（牺牲精度） |

## 各参数详解

### `detThreshold`（默认 0.3）

det 模型输出 `[0, 1]` 概率图，> 这个阈值的像素视为前景。

- **更低**（0.2）：更多像素被纳入，框更大更连续，**漏字 ↓ 误识别 ↑**
- **更高**（0.4-0.5）：只接受高概率区域，框更紧更稀疏，**误识别 ↓ 漏字 ↑**

调试技巧：临时让 example 把概率图画出来肉眼看（spike 阶段做过）。

### `detBoxThreshold`（默认 0.6）

每个候选框内部所有像素的平均概率，< 这个值的框被丢弃。

- 用来过滤"低质量框"——比如阈值二值化时勉强连成一片但平均概率低的噪点
- **更高**：只保留高质量框，召回 ↓
- **更低**：保留更多框，可能引入噪声

### `unclipRatio`（默认 1.6）

DBNet 训练时对原始文字框做了"shrink"，所以预测出来的框比真实文字偏紧。这个参数把框按 `area * ratio / perimeter` 的距离往外扩。

- **更低**（1.2-1.4）：框紧，rec 容易切到字
- **更高**（1.8-2.0）：框松，旁边内容可能被卷入但 rec 通常能容忍

### `maxSideLen`（默认 960）

det 输入图片的最长边上限。原图大于这个值会缩放。

- 决定 det 阶段"看得多细"
- **小**（480, 640）：det 快，但小字识别差
- **大**（1280, 1600）：识别小字号好，但 det 慢且内存大

PP-OCRv5 训练分辨率是 960，太大或太小都不一定有收益。**特殊情况才调**。

### `minBoxSize`（默认 3）

最短边小于这个像素数的框直接丢弃。**几乎不用调**，过滤连通域噪点用。

## 怎么知道默认参数对自己的场景够不够

最简单：拿 5-10 张代表性图，手算字符级正确率：

```
正确字符数 / 总字符数 = ?
```

`>= 92%` 就别折腾。`< 90%` 才值得逐张分析问题在 det（漏框）还是 rec（识错）。

```ts
const result = await engine.recognize(img, { detThreshold: 0.25 });
console.log(result.fullText);
// 跟标准答案对比
```

## 调参代码模板

写个小脚本批量试：

```ts
const fixtures = [
  { name: "img1", img: bmp1, gt: "标准答案1" },
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

## 不要做的事

- ❌ **不要每张图动态调参** — 选一组对你场景最优的常量值，固化下来
- ❌ **不要相信"调一调就到 99%"** — 默认参数已经接近最优，单一参数变动通常带来 1-3% 摆动，不会有质变
- ❌ **不要跨场景共享一组参数** — 比如发票场景调好的参数搬到漫画字幕，多半要重调

## 已知边界

- 极小字号（高度 < 12px 等效）：rec 模型本身能力到顶，调参也救不回来 → 上 OCR 之前先 upscale 图片
- 手写体：PP-OCR 系列不擅长，无解，换 TrOCR 类模型
- 严重倾斜（>15°）：当前没 cls 模型自动校正，需要预处理（可以用 pdfjs 或自己 canvas 做）
