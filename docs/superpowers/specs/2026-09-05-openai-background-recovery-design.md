# Recoverable OpenAI response streams

## Purpose

Prevent a single dropped or slow OpenAI response stream from pausing an otherwise healthy PDF-to-RPG job for manual retry. The change must preserve extraction quality, avoid duplicate paid generation, keep source content temporary, and support a clean 100-page production run in less than four minutes.

## Evidence and decision

The production run `63a82c45-2fce-49c9-9fcb-39009ffa1189` completed all 100 pages and produced a valid nine-quest game. Twelve of thirteen extraction calls completed normally; one stream exceeded the current 90-second transport lifetime and became indeterminate. The server-side job lasted 280 seconds including the manual approval pause. Its active processing segments were approximately 218 seconds.

OpenAI background Responses are temporarily retained for polling even when `store: false`; the temporary response is deleted after roughly ten minutes. The approved design uses that recovery mechanism rather than issuing a duplicate POST.

## Request and recovery flow

1. Production Responses requests set `background: true`, `store: false`, and continue to stream terminal events.
2. The provider records the response ID from the first `response.created`, `response.queued`, or other event carrying a response object.
3. Normal streams behave exactly as before: only a complete terminal response is accepted.
4. If the stream ends, times out, or becomes unreadable after a response ID is known, the provider retrieves `GET /v1/responses/{response_id}` using fresh bounded requests.
5. Retrieval polls while the same response is `queued` or `in_progress`, then returns only a `completed` response. Failed, cancelled, incomplete, malformed, or expired responses stay indeterminate and require the existing explicit-retry path.
6. If transmission fails before any response ID is received, the result remains indeterminate. The pipeline never guesses that an unacknowledged POST was free.

## Boundaries

- No source text, image data, API keys, or response bodies are added to logs.
- Retrieval uses the same API key and existing redacted request-ID diagnostics.
- `store` remains false. No conversation or reusable server-side state is created.
- Recovery has a strict deadline and bounded polling interval so a request cannot hold a Worker indefinitely.
- Structured-output, usage-accounting, schema validation, journal ownership, and source-grounding checks remain unchanged.
- The public privacy copy will state that in-progress OpenAI responses may be retained for roughly ten minutes for recovery.

## Alternatives rejected

- Raising the 90-second timeout alone does not recover a broken connection and still produces an unknown outcome.
- Automatically repeating the POST can double-charge the user and generate a second conflicting result.
- Batch-uploading page assets is a larger optimization. It is deferred unless a clean recoverable run still exceeds four minutes.

## Verification

Focused provider tests will prove that a normal terminal stream uses one POST, a broken stream after `response.created` retrieves the same response without another POST, retrieval polls only queued/in-progress states, and malformed or terminal-failure retrieval remains indeterminate. Existing extraction and job-recovery tests must remain green, followed by TypeScript and the production build.

After deployment, one fresh authorized 100-page run is the release gate. Timing starts immediately before job creation and ends only when the validated nine-quest game is saved and acknowledged. A manual retry, resumed job, cached game, partial page set, or result over 240 seconds does not pass.
