# Cloud Summarization

## Default Mode

`sessionmem` defaults to local summarization. Local mode runs without external API calls.

## How to Enable Cloud Mode

Cloud mode activates only when both conditions are true:

1. `allowCloudSummarization=true`
2. `ANTHROPIC_API_KEY` is present (mapped to `anthropicApiKey` in runtime config)

If either condition is missing, execution stays local.

## How It Works

Cloud summarization uses a two-phase pipeline:

1. **Local preprocessing** -- the local summarizer runs first to extract, redact, and structure
   session events into a compact transcript. This ensures sensitive content is redacted before
   any data leaves the machine.

2. **Cloud compression** -- the preprocessed summary is sent to the Anthropic Messages API
   with a system prompt tuned for memory compression. Claude returns a compact, high-signal
   list of facts, decisions, and context.

### Model Configuration

The default model is `claude-sonnet-4-6`, defined as `DEFAULT_SUMMARIZER_MODEL` in
`src/core/config/policyConfig.ts`. Callers can override the model via the `model` field
in `CloudSummarizeInput`.

### Token Limits

The `max_tokens` parameter sent to the API is `summaryTokenCap * 2`, giving the model
headroom to produce a compressed summary within the configured cap.

## Runtime Warning Signals

When cloud mode is active, lifecycle responses include:

- warning code: `cloud_summarization_enabled`
- warning message: `Cloud summarization active: allowCloudSummarization=true and ANTHROPIC_API_KEY present`

These signals are emitted for observability and policy verification.

## Failure Fallback Behavior

Cloud summarization retries 2 times. If retries fail, pipeline falls back to local summarization automatically.

If fallback succeeds, warning payload includes cloud fallback indicators.
If fallback also fails, a durable failure record is written to `summarization_failures`.

## Manual Summarization When Auto Is Disabled

Setting `autoSummarize=false` disables automatic `session_end` summarization only.
Manual `summarizeSessionToMemory` remains available and functional.
