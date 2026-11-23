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
field in `CloudSummarizeInput`; a caller-chosen model is sent without an effort setting or
server-side fallback, because older models reject effort and some current ones (Claude
Haiku 5.5) reject fallbacks.

Requests to the default model enable the API's server-side fallback (`fallbacks: "default"`):
if the model declines for policy reasons, the API retries on its default fallback model
within the same call. If the request is still declined (`stop_reason: "refusal"`), with any
model, the cloud step fails and the local summary is used, as for any other cloud error.

### Time Limits

Cloud summarization runs inside the SessionEnd hook, which the host stops after a minute by
default. One request may take 25 seconds; the SDK's own retries are off, and the session
lifecycle retries a timeout, a dropped connection, a rate limit or a server error only while
another attempt still fits in a 45-second budget. A bad request, an authentication failure, a
refusal or a missing key is not retried. When the budget runs out the local summary is stored, so
a slow API never leaves a session without one.

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
