import type { NormalizedImage } from "../input.js";
import type { ort } from "../runtime.js";
import type { InternalDetBox, RecognizeOptions } from "../types.js";
import { postprocessDet } from "./postprocess.js";
import { preprocessForDet } from "./preprocess.js";

export class DetectionModule {
	constructor(private readonly session: ort.InferenceSession) {}

	async detect(img: NormalizedImage, opts: Required<RecognizeOptions>): Promise<InternalDetBox[]> {
		const { tensor, resizedW, resizedH, scaleX, scaleY } = preprocessForDet(img, opts.maxSideLen);
		const inputName = this.session.inputNames[0]!;
		const outputs = await this.session.run({ [inputName]: tensor });
		const outName = this.session.outputNames[0]!;
		const out = outputs[outName]!;
		const probMap = out.data as Float32Array;
		const dims = out.dims as readonly number[];
		const oh = dims[2] as number;
		const ow = dims[3] as number;
		if (ow !== resizedW || oh !== resizedH) {
			// model output may not match exactly due to internal stride; use actual dims
		}
		return postprocessDet(probMap, ow, oh, {
			threshold: opts.detThreshold,
			boxThreshold: opts.detBoxThreshold,
			unclipRatio: opts.unclipRatio,
			minBoxSize: opts.minBoxSize,
			scaleX: img.width / ow,
			scaleY: img.height / oh,
		});
	}
}
