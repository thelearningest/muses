# Direct PDF ingestion validation

## Change

New OpenAI ingestion jobs read server-created PDF sections through Responses
`input_file`. Browser page rendering is reserved for selected reference crops.
Existing jobs retain their original manifests. Background request receipts are
journaled before polling, and completed outputs are saved before settlement and
provider cleanup. Section access uses expiring, section-scoped signed URLs.

The request-driven host has no durable scheduler configured. Submitted model
requests continue when the tab closes; the next application stage resumes on
return. The UI states this limitation. Temporary provider response storage is
explicitly enabled for recovery and deleted on collection/job cleanup.

## Actual source PDF

- Input: local `design book 2.pdf`, 210 pages, 31,661,033 bytes.
- Local Cloudflare Worker split: 27 sections, 42,825,860 bytes total, largest
  section 4,458,202 bytes; 513 ms in the isolated Worker probe. This timing excludes
  production R2/network writes and is not an end-to-end generation estimate.
- Ordinary copying initially produced 668,850,354 bytes because annotation
  navigation references recursively copied other pages. Model-only copies now
  omit navigation targets/actions while retaining annotation appearance. The
  original stored PDF is unchanged.
- Pixel comparison at scale 0.6: original pages 1, 5, 7, 101, 209 and 210 versus
  their section copies, zero changed channels on all six (483,208 channels each).

## Bounded real API probe

First eight-page section sent to gpt-5.6-sol through the production provider
implementation with Base64 PDF input substituted for its private URL transport.
The private section URL authorization is covered separately by route tests.

- Count endpoint: 22,974 estimated input tokens, 3.15 seconds.
- Background submission receipt: 4.75 seconds from probe start.
- Completion: 17.05 seconds; all expected page indexes 0 through 7 returned.
- Reported generation usage: 22,784 input and 766 output tokens.
- Provider response cancelled/deleted after collection. No full paid game run.

## Automated checks

- Regression suite: 321 passed, eight opt-in live tests skipped; a subsequently
  added server-manifest route test also passed (322 passing tests total).
- Full-book mocked route test: 210 pages in 27 background requests, repeated
  polling and fresh stage ownership cause no additional submissions; canonical
  artifacts publish atomically after all records are collected.
- Server manifest creation uses the uploaded PDF without any browser manifest.
- Section ordering, preserved fonts/vector content, cross-page navigation
  isolation, malformed sources, page limits, cancellation between sections and
  saved-manifest resume are covered.
- Signed section URLs cannot be reused for another section or original source.
  The browser can retrieve the original with its job capability.
- Focused application ESLint passed. Production build passed.
- Whole-repository TypeScript checking still reports pre-existing test-fixture
  typing errors in batch extraction/references, generation, end-to-end, job
  routes and verification tests; no application-source errors were reported.

## References

- https://developers.openai.com/api/docs/guides/file-inputs
- https://developers.openai.com/api/docs/guides/background
- https://developers.openai.com/api/reference/resources/responses/subresources/input_tokens/methods/count
