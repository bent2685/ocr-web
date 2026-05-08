import { quadHeight, quadWidth } from "../geometry.js";
import type { NormalizedImage } from "../input.js";
import type { ort } from "../runtime.js";
import type { InternalDetBox, OcrLine, Quad } from "../types.js";
import { warpQuad } from "./crop.js";
import { ctcGreedyDecode } from "./decode.js";
import { preprocessRecCrop } from "./preprocess.js";

const REC_HEIGHT = 32;
const BATCH_SIZE = 8;
const PAD_TO_MULTIPLE = 16;

interface PreparedCrop {
	tensor: ort.Tensor;
	tensorWidth: number;
	box: Quad;
}

export class RecognitionModule {
	constructor(
		private readonly session: ort.InferenceSession,
		private readonly dict: readonly string[],
	) {}

	async recognizeBoxes(img: NormalizedImage, detBoxes: InternalDetBox[]): Promise<OcrLine[]> {
		if (detBoxes.length === 0) return [];

		const prepared: PreparedCrop[] = detBoxes.map(({ box }) => {
			const targetW = Math.max(REC_HEIGHT, Math.round(quadWidth(box)));
			const targetH = Math.max(REC_HEIGHT, Math.round(quadHeight(box)));
			const rgba = warpQuad(img, box, targetW, targetH);
			const { tensor, width } = preprocessRecCrop(rgba, targetW, targetH);
			return { tensor, tensorWidth: width, box };
		});

		// sort by width to minimize padding waste within each batch
		prepared.sort((a, b) => a.tensorWidth - b.tensorWidth);

		const lines: OcrLine[] = [];
		const inputName = this.session.inputNames[0]!;
		const outName = this.session.outputNames[0]!;

		for (let start = 0; start < prepared.length; start += BATCH_SIZE) {
			const chunk = prepared.slice(start, start + BATCH_SIZE);
			const maxW = Math.max(...chunk.map((c) => c.tensorWidth));
			const paddedW = Math.ceil(maxW / PAD_TO_MULTIPLE) * PAD_TO_MULTIPLE;
			const N = chunk.length;
			const planeSize = REC_HEIGHT * paddedW;
			const batchData = new Float32Array(N * 3 * planeSize);

			for (let i = 0; i < N; i++) {
				const { tensor, tensorWidth } = chunk[i]!;
				const src = tensor.data as Float32Array;
				const srcPlane = REC_HEIGHT * tensorWidth;
				for (let c = 0; c < 3; c++) {
					for (let y = 0; y < REC_HEIGHT; y++) {
						const srcOff = c * srcPlane + y * tensorWidth;
						const dstOff = i * 3 * planeSize + c * planeSize + y * paddedW;
						batchData.set(src.subarray(srcOff, srcOff + tensorWidth), dstOff);
					}
				}
			}

			const Tensor = chunk[0]!.tensor.constructor as typeof import("onnxruntime-web").Tensor;
			const batchTensor = new Tensor("float32", batchData, [N, 3, REC_HEIGHT, paddedW]);
			const outputs = await this.session.run({ [inputName]: batchTensor });
			const out = outputs[outName]!;
			const dims = out.dims as readonly number[];
			const T = dims[1] as number;
			const C = dims[2] as number;
			const logits = out.data as Float32Array;

			for (let i = 0; i < N; i++) {
				const slice = logits.subarray(i * T * C, (i + 1) * T * C);
				const { text, confidence } = ctcGreedyDecode(slice, T, C, this.dict);
				if (!text) continue;
				lines.push({ text, box: chunk[i]!.box, confidence });
			}
		}

		return lines;
	}
}
