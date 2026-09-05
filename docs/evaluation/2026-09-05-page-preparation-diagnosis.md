# Repeated browser page-preparation timeout

Assessment date: 2026-09-05. Reviewed source through `59baec3`. This is a diagnosis and proposed repair, not an implemented change.

## Conclusion

The screenshot reports an application-generated timeout around browser PDF preparation and asset upload. It does not establish a Chrome-specific defect or a model failure. The strongest current lead is browser-side rendering/scheduling; its exact stalled substep remains unconfirmed without a trace from the affected tab.

PDF.js uses requestAnimationFrame for the default display render path in the installed dependency. Browsers commonly pause those callbacks in hidden tabs. Our application still treats an unfinished page as a failure when its outer timer expires. This is a concrete compatibility weakness and a plausible explanation for rendering stopping while ordinary status requests keep succeeding. It is not proof the user's tab was hidden.

## Evidence

- Screenshot: 1 of 210 pages prepared; error names PDF page 1. Preparation is concurrent, so the one completed page need not be page 1.
- `app/book-job-client.ts:322`: eight concurrent preparation callbacks, each wrapped by a 120-second Promise.race. The callback includes renderer access, text extraction, rasterization, encoding, uploads, and fallback attempts.
- `app/visual-page-renderer.ts:83`: default PDF.js rendering; the RenderTask is not retained for cancellation. The installed `pdfjs-dist/build/pdf.mjs` sets `useRequestAnimationFrame: !intentPrint` and schedules work with `window.requestAnimationFrame`.
- `app/BookRpgApp.tsx:243`: fallback only follows HTTP 400/413 upload rejections. A never-settling render cannot reach these fallbacks. Transport failure also does not take this fallback path.
- `app/book-job-client.ts:39`: Promise.race rejects the wrapper without cancelling its underlying operation. A page deadline is not passed to the renderer or uploader. The shared map stops dispatching after a failure and waits for already-dispatched wrappers to settle. Renderer destruction later can overlap work whose wrapper already timed out.
- `app/BookRpgApp.tsx:112,162,292`: the local failure only sets an error string, while the retry button requires server stage `interrupted`. A client timeout can therefore say “Try again” without providing a retry button, exactly as shown.
- Production logs for September 5 around 14:29–14:32 Singapore time show successful source upload (202), manifest setup (200), advance (200), one extraction PUT around 14:30:09 (200, 2,097 ms), then successful status polls without further extraction PUTs in the returned sample. Earlier page PUTs also completed in about two seconds. One status GET at 14:28:04 returned 500; no extraction rejection appeared in the returned error sample. Job paths are redacted and the log sample is bounded, so it cannot definitively correlate every request to the screenshot or rule out unlogged failures.
- Latest saved Sites version 30 references `59baec3`. This does not prove which bundle an already-open user tab is running.
- Existing focused tests passed: 24 tests across the job client and renderer. The renderer tests mock PDF.js and canvas; the timeout-budget test checks the constant rather than exercising real preparation delays.
- The production audit records an earlier successful hosted 210-page run on version 20. That proves the source has previously been processed, not that later versions or this browser session are healthy. Older audit sections contain superseded pending statuses and should be read chronologically.

## Why the recent fixes did not establish a solution

| Fix | What it addresses | What remains |
| --- | --- | --- |
| `91bb30d`: waves and page deadline | Bounds the amount of dispatched work and surfaces stalls | A stalled page still stops preparation; no cancellation or substep diagnosis |
| `58805a4`, `5322144`: bundle/preload renderer | Runtime availability and cold loading | Does not address a render already underway; observed manifest/page progress means loading succeeded at least once |
| `cfccab4`: retry encodings and skip rejected assets | Server-rejected rendered packets | Does not recover a hung render or upload; broad 400 retries can also misclassify validation errors |
| `a1ca790`: advance request deadline | Waiting for downstream server work | Separate from the page-preparation timer in the screenshot |
| `59baec3`: 60 to 120 seconds | Gives one upload retry sequence more time | Does not restore a paused renderer; four render variants can each invoke the three-attempt uploader, so 120 seconds does not bound the complete fallback tree |

## Options

1. **Recommended immediate repair: make browser preparation observable, cancellable, and resumable.** Smallest change focused on demonstrated defects; retains the current temporary storage and extraction contracts.
2. **Durable server-side page preparation.** Best longer-term choice if processing must continue after the browser closes. A queued rendering service reads the already-uploaded source, writes the existing page packets, and checkpoints progress. Requires a suitable rendering runtime, memory/CPU limits, scheduling, cleanup, and operating cost validation. Simply moving canvas code into the current request handler is not this solution.
3. **More timeout increases or progressively smaller images.** Easy but not recommended as the primary repair: neither resolves suspended scheduling, missing cancellation, nor inaccessible recovery, and smaller images can reduce source fidelity.

## Recommended repair design

1. Add structured per-page phase tracking: document load, text extraction, render, encode, upload, acknowledgment. Record elapsed time, page/revision/attempt, visibility changes, actual worker startup failures, deployed build identifier, and a correlation identifier. Do not log book text, images, or capability tokens.
2. Separate rendering from upload scheduling. Start with one or two renders and a separately bounded upload queue; tune using this 31.7 MB source. Compressed upload size is not a bound on decoded image memory.
3. Explicitly handle browser visibility. In the current display-rendering path, pause admission and render-active-time accounting while hidden, show a paused state, and resume when visible. Keep network request deadlines separate. Handle freeze/resume and reconcile server receipts on return. Do not advertise uninterrupted background execution from this browser-only design.
4. Give operations real cancellation ownership. Retain RenderTasks, connect job/page aborts to render cancellation and fetch aborts, and drain cancelled work before destroying or replacing a shared document. If the PDF worker itself stops responding, recreate it once and requeue only unacknowledged pages. Ignore late callbacks from previous attempts.
5. Use distinct rendering and upload retry policies. A network retry reuses the encoded packet; a recoverable image validation rejection may rerender. Do not rerender on arbitrary malformed-request responses. Reconcile an uncertain upload against its durable receipt before replacing it or submitting a skip.
6. A single problematic page should enter a deferred retry set while healthy pages continue. After bounded recovery, expose the exact unresolved pages. Any allowed omission must be explicit in coverage and excluded from evidence; widespread failures must pause the job rather than silently skip the book.
7. Model client recovery independently of server processing status. Always expose “Resume preparation” after a local preparation failure. Resume the existing job and confirmed page receipts; do not create another job or authorize another paid model operation just to restart browser rendering.

## Acceptance criteria

- Reproduce with the actual `design book 2.pdf` and the production application path, initially without model calls: prepare and acknowledge all 210 page packets or identify explicit unresolved pages.
- Compare foreground and background behavior in current Chrome and Firefox, including a hidden interval longer than 120 seconds, minimize/restore, refresh/reselect, and cancellation during preparation.
- Inject a hung render, hung text extraction, worker failure, slow/aborted upload, lost acknowledgment, and image validation rejection. Verify bounded recovery, no late writes/progress after cancellation, no duplicate paid work, and a working resume control.
- Verify all retained page imagery and coverage remain suitable for the existing evidence pipeline. No completion claim based solely on smaller payloads or silently skipped pages.
- After preparation passes, perform one complete hosted upload-to-game run with the same source and inspect its durable coverage and cost accounting.

## Reference behavior

- [MDN requestAnimationFrame](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame): background tabs and hidden frames commonly pause animation callbacks.
- [PDF.js RenderTask](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib-RenderTask.html): explicit render cancellation.
- [PDF.js PDFDocumentLoadingTask](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib-PDFDocumentLoadingTask.html): destruction aborts requests and destroys the worker.

No application code or deployment was changed during this investigation. The affected Chrome tab was not exposed to the browser connector, so this assessment does not claim a live reproduction of that tab's failure.

