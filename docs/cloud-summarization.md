# Cloud Summarization

## Default Mode

`sessionmem` defaults to local summarization. Local mode runs without external API calls.

## How to Enable Cloud Mode

Cloud mode activates only when both conditions are true:

1. `allowCloudSummarization=true`
2. `ANTHROPIC_API_KEY` is present (mapped to `anthropicApiKey` in runtime config)

If either condition is missing, summarization stays local.

## How It Works

Cloud summarization runs in two steps:

1. **Local preprocessing** - the local summarizer extracts and structures session events
   into a short transcript, with secret redaction applied before it leaves the machine.

2. **Cloud compression** - the transcript is sent to the Anthropic Messages API with
   instructions to compress it into a short list of facts, decisions, and context.

### Model Configuration

The default model is `claude-sonnet-4-6`, defined as `DEFAULT_SUMMARIZER_MODEL` in
`src/core/config/policyConfig.ts`. Callers can override the model via the `model` field
in `CloudSummarizeInput`.

### Token Limits

The API's `max_tokens` parameter is `Math.min(Math.floor((summaryTokenCap ?? 4000) * 1.5), 8192)`.
The response is then trimmed to `summaryTokenCap`.

## Runtime Warning Signals

When cloud mode is active, lifecycle responses include:

- warning code: `cloud_summarization_enabled`
- warning message: `Cloud summarization active: allowCloudSummarization=true and ANTHROPIC_API_KEY present`

Use these warnings to check whether cloud summarization is active.

## Failure Fallback Behavior

Cloud summarization retries 2 times. If the retries fail, it falls back to local summarization automatically.

Cloud failures are saved in `summarization_failures`. If local fallback succeeds,
the response includes a warning about the cloud failure. If fallback also fails,
an additional failure record is saved.

## Manual Summarization When Auto Is Disabled

Setting `autoSummarize=false` disables automatic `session_end` summarization only.
You can still call `summarizeSessionToMemory` manually.
