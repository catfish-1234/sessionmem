# Conversational retrieval benchmark

`npm run benchmark` runs the committed LoCoMo corpus through the public
`storeMemory` capture and `retrieveMemories` recall APIs. It replaces the previous
ten exact-text queries and their 100% hit-rate claim. See
[benchmarks/README.md](../benchmarks/README.md) for the corpus license, selection
rules, metric definitions, and detailed reproduction instructions.

## Recorded result

This run used sessionmem 1.4.0, Node v24.19.0, Linux x64, top-5 retrieval, fixed
capture/retrieval time, and the production `deterministicEmbed`. It captured
5,882 turns across 272 sessions in 10 conversations. Of 1,986 annotations,
1,527 questions were scored; 446 adversarial, four missing-evidence, and nine
invalid-evidence questions were excluded by fixed annotation rules.

| Macro retrieval metric @5 | Result |
| --- | ---: |
| Hit rate | 1.44% |
| Precision | 0.29% |
| Recall | 0.88% |
| All-evidence rate | 0.65% |

| Question category | Questions | Hit rate | Precision | Recall |
| --- | ---: | ---: | ---: | ---: |
| Multi-hop | 278 | 2.52% | 0.50% | 0.47% |
| Temporal | 320 | 0.63% | 0.13% | 0.63% |
| Open-domain | 89 | 3.37% | 0.67% | 1.19% |
| Single-hop | 840 | 1.19% | 0.24% | 1.07% |

Recall latency was mean **11.12 ms**, median **10.49 ms**, p95 **18.74 ms**,
and maximum **38.94 ms**. These measurements include public service response
formatting and exclude capture, process startup, and corpus loading. Timing
depends on hardware and load; it is not a reproducible quality score.

The low scores show that the current hash-based embedding and retrieval pipeline
perform poorly on conversational questions with different wording from the
stored dialogue. The evaluation does not tune or replace that implementation.
A hit means at least one annotated turn was found; it does not establish that
enough evidence was found to answer a multi-hop question. This is retrieval
evaluation, not answer-generation accuracy or automatic summarization quality.

## Reproduce

After installing the lockfile dependencies:

```bash
npm run build
npm run benchmark -- --output benchmarks/results/locomo.json
```

The corpus is pinned to upstream commit
`3eb6f2c585f5e1699204e3c3bdf7adc5c28cb376`, SHA-256
`79fa87e90f04081343b8c8debecb80a9a6842b76a7aa537dc9fdf651ea698ff4`.
The runner verifies this checksum and blocks network calls. No API keys are
required. A second full run with an empty environment produced identical
retrieved IDs and quality metrics for all 1,527 questions. JSON output includes
every scored question, answer, evidence list, returned IDs, and exclusion reason
so failures can be inspected. The report above is a recorded result; the command
prints current results and writes JSON only when requested.
