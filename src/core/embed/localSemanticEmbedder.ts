import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

export interface LocalSemanticEmbedder {
  /** Includes model, tokenizer, pooling and truncation versions. */
  id: string;
  dimension: number;
  embed(text: string): Promise<number[]>;
}

const MODEL_SHA = "6fd5d72fe4589f189f8ebc006442dbb529bb7ce38f8082112682524616046452";
const TOKENIZER_SHA = "be50c3628f2bf5bb5e3a7f17b1f74611b2561a3a27eeab05e5aa30f411572037";
export const LOCAL_SEMANTIC_MODEL = `minilm-l6-v2:${MODEL_SHA}:${TOKENIZER_SHA}:mean256-v1`;
let loaded: Promise<LocalSemanticEmbedder | null> | undefined;

/** Only local package files are opened. No download or remote provider path. */
export function loadLocalSemanticEmbedder(): Promise<LocalSemanticEmbedder | null> {
  return loaded ??= load().catch(() => null);
}

async function load(): Promise<LocalSemanticEmbedder> {
  const require = createRequire(import.meta.url);
  const model = require.resolve("@xcidos/genesis-memory-model/onnx/model.onnx");
  const tokenizerPath = require.resolve("@xcidos/genesis-memory-model/tokenizer.json");
  for (const [file, expected] of [[model, MODEL_SHA], [tokenizerPath, TOKENIZER_SHA]]) {
    if (createHash("sha256").update(readFileSync(file)).digest("hex") !== expected) {
      throw new Error("Local semantic model checksum mismatch");
    }
  }
  const ort = await import("onnxruntime-node");
  const { Tokenizer } = await import("@huggingface/tokenizers");
  const tokenizer = new Tokenizer(JSON.parse(readFileSync(tokenizerPath, "utf8")), {});
  const session = await ort.InferenceSession.create(model, {
    executionProviders: ["cpu"], intraOpNumThreads: 1, interOpNumThreads: 1,
    logSeverityLevel: 3,
  });
  return {
    id: LOCAL_SEMANTIC_MODEL, dimension: 384,
    async embed(text) {
      let ids = tokenizer.encode(text).ids;
      if (ids.length > 256) ids = [...ids.slice(0, 255), 102]; // retain BERT's SEP
      const input = new ort.Tensor("int64", BigInt64Array.from(ids, BigInt), [1, ids.length]);
      const ones = new ort.Tensor("int64", new BigInt64Array(ids.length).fill(1n), [1, ids.length]);
      const zeros = new ort.Tensor("int64", new BigInt64Array(ids.length), [1, ids.length]);
      const output = await session.run({ input_ids: input, attention_mask: ones, token_type_ids: zeros });
      try {
        const hidden = output.last_hidden_state.data as Float32Array;
        const vector = new Array<number>(384).fill(0);
        for (let token = 0; token < ids.length; token++) {
          for (let dim = 0; dim < 384; dim++) vector[dim] += hidden[token * 384 + dim] / ids.length;
        }
        const norm = Math.hypot(...vector);
        return vector.map(v => v / (norm || 1));
      } finally {
        input.dispose(); ones.dispose(); zeros.dispose();
        for (const tensor of Object.values(output)) tensor.dispose();
      }
    },
  };
}
