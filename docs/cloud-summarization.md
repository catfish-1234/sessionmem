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

The default model is `claude-sonnet-5-5`, defined as `DEFAULT_SUMMARIZER_MODEL` in
`src/core/config/policyConfig.ts`, and runs at `low` effort, since compressing a
prepared transcript is a simple transform. Callers can override the model via the `model`
field in `CloudSummarizeInput`; a caller-chosen model keeps its own effort default, because
older models reject the parameter.

Requests enable the API's server-side fallback (`fallbacks: "default"`): if the model
declines for policy reasons, the API retries on its default fallback model within the same
call. If the request is still declined (`stop_reason: "refusal"`), the cloud step fails and
the local summary is used, as for any other cloud error.

### Token Limits

Current models think before answering, and thinking counts against `max_tokens`, so the
budget is `Math.min(Math.floor((summaryTokenCap ?? 4000) * 1.5) + 2048, 16000)`. Only the
response's text blocks are used, and the result is trimmed to `summaryTokenCap`.

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
