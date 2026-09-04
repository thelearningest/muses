# Bounded OpenAI stream timeout

## Purpose

Give a slow but healthy OpenAI stream enough time to complete without adding provider-side background retention or changing the pipeline's correctness and billing safeguards.

## Evidence and decision

Production job `63a82c45-2fce-49c9-9fcb-39009ffa1189` processed all 100 pages and produced a valid nine-quest game. Twelve of thirteen concurrent extraction calls completed within the existing 90-second request lifetime. One call reached that boundary, became indeterminate, and required explicit retry. Excluding the manual approval pause, active processing was approximately 218 seconds, within the four-minute target.

The approved minimal change raises the foreground request timeout from 90 to 120 seconds. Requests continue to use streaming, `store: false`, Fast service tier, strict structured output, and the existing operation journal. No background mode, automatic duplicate POST, or additional provider retention is introduced.

## Failure handling

- A completed terminal response is validated and committed exactly once.
- A rejected request follows the existing free-rejection path.
- A transport failure, malformed response, or 120-second timeout remains indeterminate and pauses for explicit retry.
- Completed extraction calls are never repeated when another concurrent call fails.
- Logs remain limited to status, category, and provider request ID.

## Verification

Run the focused OpenAI-provider and extraction tests, TypeScript, and the production build. After deployment, one fresh 100-page production run is the release gate. It passes only if a validated nine-quest game is saved and acknowledged within 240 seconds without manual retry or resume.
