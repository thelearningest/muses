# Selective extraction fallback

Approved spec: `../specs/2026-09-04-selective-extraction-fallback-proposal.md`.

1. Finish cancellation/expiry regression checks for existing stage transitions.
2. Introduce a version-2 manifest: Luna initially and at revision 1, Sol only at revision 2. Preserve exact version-1 requests and pricing. Pin fallback prices in each new manifest and record actual model/prices in page provenance.
3. Reuse the documented 5.6-family high-detail image bound (2,500 patches, 1.2 multiplier), applying the selected model's prices, including conservative cache-write allowance. Never retry unknown calls implicitly.
4. Add general tile/decorative-text instructions. Omit unreliable optional refined text geometry, preserving raw responses and visual candidates for later inspection.
5. Test model routing, budget rejection, legacy compatibility, provenance, replay and a live failed-page regression. Then run the fresh full book through the website and inspect source/quest quality.
6. Run regression tests, types and build. Document measured results and remaining gaps. No public deployment or push under this approval.

The optional writing-plans/subagent workflow skills are unavailable. Execute locally with the existing test framework, without delegation. Passing unit tests alone does not establish full-book acceptance.
