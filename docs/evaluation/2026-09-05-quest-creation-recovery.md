# Quest creation interruption recovery

The reported screen paused at 86% after book reading and displayed a generic HTTP error. Production inspection on September 5 found no active or paused jobs; the latest design-book upload was acknowledged as complete. Retained logs did not contain the reported failure, so its original provider cause is not established.

Two reproducible code defects were addressed:

- A second HTTP 409 during bounded recovery escaped the recovery handler, replacing the saved stage error with a generic local error. The client now loads the authoritative interrupted status, displays its message, and labels the resume action for the current stage.
- Practice-image preparation combined up to three slow image requests with quest writing in one HTTP invocation. It now yields after each newly submitted image, then replays the existing paid-call journal on the next advance. Request hashes, slot order, policy identity, and atomic artifact publication remain compatible with existing jobs. Source crops require no extra advance.

Image failures now return a useful error body. Quest-writing and image interruptions emit bounded stage diagnostics without source text or credentials. Individual image requests still use the existing synchronous Images API and timeout; this change does not claim to eliminate provider failures or make the entire workflow independent of browser polling.

Validation: 325 unit/integration tests passed; 8 opt-in live tests skipped. This includes a real migrated SQLite/D1 fixture and conditional R2 fixture exercising four fresh owners: three advances generate one image each, the fourth replays all three, preserves the world-generation slot, and publishes all image artifacts atomically. The bounded-retry regression preserves the server error without another retry. Production build, focused ESLint, and all three built-HTML checks passed. No full paid production game was submitted for this change.
