import { quadHeight, quadWidth } from "../geometry.js";
import type { NormalizedImage } from "../input.js";
import type { ort } from "../runtime.js";
import type { InternalDetBox, OcrLine, Quad } from "../types.js";
import { warpQuad } from "./crop.js";
import { ctcGreedyDecode } from "./decode.js";
import { preprocessRecCrop } from "./preprocess.js";

const REC_HEIGHT = 32;

export class RecognitionModule {
	constructor(
		private readonly session: ort.InferenceSession,
		private readonly dict: readonly string[],
	) {}

	async recognizeBoxes(img: NormalizedImage, detBoxes: InternalDetBox[]): Promise<OcrLine[]> {
		const lines: OcrLine[] = [];
		for (const { box } of detBoxes) {
			const targetW = Math.max(REC_HEIGHT, Math.round(quadWidth(box)));
			const targetH = Math.max(REC_HEIGHT, Math.round(quadHeight(box)));
			const rgba = warpQuad(img, box, targetW, targetH);
			const { tensor } = preprocessRecCrop(rgba, targetW, targetH);
			const inputName = this.session.inputNames[0]!;
			const outputs = await this.session.run({ [inputName]: tensor });
			const outName = this.session.outputNames[0]!;
			const out = outputs[outName]!;
			const dims = out.dims as readonly number[];
			const T = dims[1] as number;
			const C = dims[2] as number;
			const { text, confidence } = ctcGreedyDecode(out.data as Float32Array, T, C, this.dict);
			if (!text) continue;
			lines.push({ text, box: box as Quad, confidence });
		}
		return lines;
	}
}
