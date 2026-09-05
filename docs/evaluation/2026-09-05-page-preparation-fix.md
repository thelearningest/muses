# Browser PDF preparation repair

Implements the repair proposed in `2026-09-05-page-preparation-diagnosis.md`, approved by the user on September 5.

## Behavior

- PDF parsing/rendering runs through one recoverable document queue; up to eight page uploads can be in flight independently. Queue waiting does not spend a page's render deadline.
- Each PDF phase has a cancellable 60-second visible-time deadline. Hidden documents pause admission and deadline accounting; returning to the page resumes it.
- Plain pages without annotations or optional-content layers use PDF.js print intent for offscreen rasterization. This avoids dependence on requestAnimationFrame even in embedded browsers that throttle frames while reporting visible. Pages with annotations or layers retain display intent so print visibility settings cannot silently change their content.
- The PDF.js 6 optional-content configuration is inspected through its iterator, not the removed getGroups API. Regression fixtures mirror that interface.
- A timed-out document is discarded and recreated once, within the serial render slot. The renderer owns its PDFWorker and terminates it explicitly; cleanup cannot wait indefinitely for a stalled worker handshake.
- Uploads have independent 30-second deadlines, caller cancellation, and bounded retries with the same encoded packet. Rendering is retried only for recognized image validation errors. The error names the affected upload page.
- A page that still fails is deferred while healthy pages finish. Resume requests only the server's missing page packets. Existing omission policy for persistently rejected image assets is preserved; timeouts are not silently converted into omissions.
- Local failures expose Resume preparation even when the server remains in reading_source. That action restarts the client driver without confirming a paid model retry. Cancelling the upload immediately aborts local work before waiting for server cleanup.
- Current render phases are visible in the progress panel. Timeout console diagnostics contain a phase and build marker, without book text, images, or capability tokens.

## Validation

- Full unit suite: 309 passed, 8 opt-in live tests skipped. Coverage includes a simulated 180-second hidden interval, visible deadline cancellation, hidden upload deadline, actual RenderTask cancellation, serial document restart, failure isolation across 40 pages, cancellation of a pending upload, late response rejection, resume controls under a non-interrupted server status, and static/display rendering selection.
- Production build passed. Three rendered-HTML smoke tests passed after supplying a test-only Cloudflare module adapter to Node; this adapter is not part of production code.
- Actual browser preparation of `design book 2.pdf`: all 210 pages passed the production image validator and received local upload acknowledgments. A fresh run completed in 82 seconds before the final static-intent improvement; this is a local preparation timing, not an end-to-end hosted game-generation timing.
- Browser cancellation retained 14 page receipts; subsequent runs resumed from the server's missing-page list. The local regression server keeps receipts for its lifetime and performs no model calls.
- The final static-rendering path completed the remaining work and confirmed all 210 receipts in a 159-second resumed run. This includes only local page preparation and validation; it is not a fresh-upload or paid-generation timing.
- Focused ESLint checks passed for the five changed application modules. Recovery state and source-file availability are reflected in React state rather than read from a ref during rendering.
- The in-app browser exposed the live site successfully. Its visibility controls did not change document.hidden, so no claim is made that a real hidden-tab transition was reproduced there. Hidden-time behavior is covered through controlled regression tests.
- Full TypeScript checking continues to report existing errors in untouched test fixtures (batch extraction/references, end-to-end generation, job routes, and verification). No new application-file type error was reported by that check before the final optional-content API correction. It did not catch the PDF.js API mismatch, making the real-browser check essential.

## Reproduce without model calls

Run `npx vite --config tests/manual/preparation-recovery/vite.config.ts`, then open `http://127.0.0.1:3003/`. The harness uses the real renderer, recovery queue, client driver, uploader, and production image validator. The source remains local. Restart the diagnostic server for an empty receipt set, or rerun/refresh it to check recovery.

The test-only Cloudflare loader supplies empty public homepage configuration for Node HTML rendering. It does not supply production secrets, simulate paid providers, or bypass live-site authentication or human verification.
