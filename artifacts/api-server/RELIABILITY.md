# Milestone 3C operational boundary

This is a **single-process development implementation**, not distributed production
infrastructure or billing. Only the existing OpenRouter generation adapter and
Tavily search adapter are configured. There is no real secondary chat provider.

## Execution and errors

The API composes stable `ProviderCandidate` IDs and passes them to
`ProviderExecutor`. A candidate can override its provider/model route without
changing the router, modes, citations, mobile transport, or UI. Mock candidates
exercise failover. Successful responses and model disclosure use the actual
candidate's provider and returned model metadata.

Retryable failures: timeouts, transport interruption, 429, 5xx, empty/invalid
responses and incomplete/invalid streams. Invalid input, hard budgets, policy
refusal, authentication/configuration errors and cancellation do not trigger
fallback. Cancellation is never caught as an ordinary failure.

Defaults: **zero retries**, at most two total AI attempts and one fallback.
Prefer the next candidate over retrying the primary. Retry backoff is exponential
and capped at two seconds; the timing boundary is injectable in tests.
Each attempt has a whole-attempt deadline, including streaming, in addition to
the adapter's HTTP timeout. These limits bound work, not necessarily upstream
charges: disconnect/cancellation cannot guarantee a remote provider stops billing.

Once meaningful text reaches the customer, no retry/fallback may append another
answer. Errors use the existing partial-text/retry UI. Before visible text,
fallback may proceed; held citation fragments are reset when the attempt changes.
Model-disclosure prose remains suppressed until deterministic disclosure can use
the final returned metadata. Normal chat remains streamed.

## Admission and circuit state

Generation and search use independent fail-fast async leases with thread-safe
counters, zero queued requests, and finally-based cleanup. A generation lease
covers both its search and inference, so an AI overload cannot first burn search
credits. Incoming JSON bytes are bounded before parsing. Original context/mode
and output budgets are checked before external calls; grounded input has an
additional configured ceiling checked before inference. Search has one call
maximum, its own deadline and no automatic retries.
If all allowed chat candidates already have unavailable circuits, admission fails
before spending on search. Concurrent circuit transitions can still race a lookup;
all external work remains bounded and cancellation-safe.

Circuit breakers are per candidate, process-local and thread-safe. The default
threshold is three retryable failures, cooldown 30 seconds, then exactly one
half-open recovery probe. Successful recovery closes the circuit. Cancellation
abandons a probe without claiming recovery. An expired open circuit is reported
as half-open/eligible, so readiness does not prevent recovery traffic forever.

The fixed-window limiter has independent global and advisory session limits.
The mobile transport supplies an Expo-generated random UUID kept only in module
memory; it is neither an account nor a durable device identity. The backend stores
only process-keyed HMAC buckets, never IP addresses or raw session tokens.
Missing/malformed tokens share an anonymous bucket. Sessions can be reset or
spoofed; bounded session storage and the global quota limit—but do not eliminate—
abuse. Window boundaries permit the usual fixed-window burst.

Multiple workers/instances require shared admission quotas, circuit coordination
and a trusted authenticated identity or gateway layer. No Redis, distributed
queue, accounts, anonymous allowance system, or analytics database is introduced.

## Usage and cost

`TokenUsage` contains only nonnegative provider-reported integer counts. Missing
counts stay null; totals are never derived and presented as reported. Usage-only
stream frames remain internal. Counts reported before a failed attempt remain
attached to that attempt. Interrupted calls can have unknown/unbilled usage.
The schema distinguishes reported, explicitly estimated, and unknown usage; no
token estimator is enabled in this milestone.

The bounded in-memory ledger contains generated internal request ID, UTC time,
requested/effective mode, task class, search provider/use/call count/error,
actual AI provider, configured/returned model, token counts/status, latency,
attempts, fallback flag, normalized outcome and estimated cost components.
Caller-supplied correlation IDs do not become operational IDs. Each fallback
attempt is costed independently. No ledger or cost dashboard is exposed publicly.

Cost arithmetic uses Decimal USD. The default configured `openrouter/free` route
has zero configured development token price; that is not a claim of zero total
operating cost or unlimited use. Search pricing is unknown by default. Unknown
usage or pricing yields null cost rather than an invented exact value. For a
configured zero token price the token component is zero even with unknown counts.
If any incurred component is unknown, total cost is unknown.

`KALILLAC_COST_CATALOG_JSON` accepts:

```json
{
  "models": [
    {"provider": "example", "model": "example/model",
     "input_per_million": "1.25", "output_per_million": "2.50",
     "cached_input_per_million": "0.10"}
  ],
  "search_per_request": {"tavily": "0.004"}
}
```

The example is illustrative, not a current rate. Concrete returned-model pricing
is preferred, otherwise configured-route pricing is used. No live pricing fetches.
Structured `kalillac.operations` LogRecords carry the same allowlisted schema,
never exception strings, messages, queries, snippets, keys, or session tokens.
The ledger interface is the boundary for future content-free persistent storage.

## Configuration (restart required)

| Variable | Default |
|---|---:|
| `KALILLAC_AI_PROVIDER_TIMEOUT_SECONDS` | 45 |
| `KALILLAC_PROVIDER_RETRIES` | 0 |
| `KALILLAC_MAX_PROVIDER_ATTEMPTS` | 2 |
| `KALILLAC_MAX_FALLBACKS` | 1 |
| `KALILLAC_RETRY_BACKOFF_SECONDS` | 0.1 |
| `KALILLAC_CIRCUIT_FAILURE_THRESHOLD` | 3 |
| `KALILLAC_CIRCUIT_COOLDOWN_SECONDS` | 30 |
| `KALILLAC_MAX_ACTIVE_GENERATIONS` | 4 |
| `KALILLAC_MAX_ACTIVE_SEARCHES` | 2 |
| `KALILLAC_TAVILY_TIMEOUT_SECONDS` | 8 |
| `KALILLAC_MAX_SEARCH_CALLS` | 1 (cannot exceed 1) |
| `KALILLAC_MAX_REQUEST_OUTPUT_TOKENS` | 8192 (mode limits still apply) |
| `KALILLAC_MAX_PREPARED_INPUT_CHARS` | 100000 |
| `KALILLAC_MAX_REQUEST_BODY_BYTES` | 600000 |
| `KALILLAC_RATE_REQUESTS` | 20 |
| `KALILLAC_GLOBAL_RATE_REQUESTS` | 120 |
| `KALILLAC_RATE_WINDOW_SECONDS` | 60 |
| `KALILLAC_RATE_MAX_SESSIONS` | 2048 |
| `KALILLAC_LEDGER_CAPACITY` | 500 |

Existing mode context/output and Tavily result/grounding limits remain enforced.
Configuration and mutable operational state are loaded once per backend instance.

## Health and verification limits

`/health` and `/api/healthz` remain cheap liveness. `/api/readyz` checks configured
secret presence, high-level circuit availability and generation overload without
calling external providers. Search configuration is reported separately; missing
search configuration does not disable timeless chat. Readiness is not a live
upstream connectivity check and exposes neither credentials nor ledger data.

Tests use mocks and injected timing; no live provider/search calls are required.
Native Save, encryption, long-code rendering, scrolling and Regenerate are not
changed. Build/export checks do not establish physical-iPhone acceptance.
