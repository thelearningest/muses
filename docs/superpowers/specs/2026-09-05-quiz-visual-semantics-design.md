# Quiz Visual Semantics

Status: design approved on 2026-09-05; awaiting specification review before implementation.

## Goal

Prevent explanatory graphics about a design concept from being used as the object of a visual quiz. A quiz must instead show an applied design artifact that lets the learner inspect how a principle works in practice. Preserve the existing visual-first requirement and minimum of three quests.

## Semantic classes

Every visual candidate receives exactly one application-visible class during batch extraction:

- `applied_example`: an executed design outcome or comparable artifact whose visible properties can be inspected, compared, diagnosed, or improved. Examples include interfaces, layouts, posters, packaging, publications, wayfinding, environments, products, and before/after executions.
- `meta_explanation`: a framework, process diagram, taxonomy, teaching schematic, labeled concept map, or other graphic whose primary purpose is to explain the book's content. It may support source understanding but is never quiz-image evidence.
- `decorative`: artwork, page furniture, portraits, or other imagery without a useful applied design judgment.

The decisive question is not whether a graphic is attractive or relevant. It is whether the learner is looking at a design execution and can infer a principle from its visible treatment. If the labels or explanatory text *state* the lesson rather than the visual *instantiating* it, classify it as `meta_explanation`.

## Pipeline behavior

1. Extend the batch extraction schema and trusted prompt with the semantic class. The extractor may still retain meta-designs as source context, but only `applied_example` candidates enter the quiz visual pool.
2. Apply a deterministic hard filter in the batch-reference adapter. Unknown, missing, meta, and decorative classes are ineligible; they cannot be rescued by a high appeal score.
3. Add the same distinction to the visual/quest reviewer instructions as defense in depth. Reject any question whose image mainly explains a framework, exposes the answer through labels, or depicts placeholder boxes instead of an applied artifact.
4. Keep visual appeal ranking only *after* semantic eligibility. Among applied examples, continue ranking composition, focal clarity, contrast, distinctiveness, and card-size impact.
5. If fewer than three source visuals qualify, do not relax the rule. Use the existing practice-image path to generate original applied design examples grounded in verified book principles until the game has three distinct visual quests.

## Compatibility and persistence

Increment the extraction prompt/version so old cached results are not interpreted under the new contract. Persist the class with each extracted visual and propagate it to the visual candidate record. Existing historical jobs remain readable through their existing versioned workflow; new jobs use the stricter schema.

No extra classification model call is introduced. The current full-page extraction makes the first classification, while the already-required quest visual review provides the independent semantic safeguard.

## Validation

Add focused tests for:

- a process/framework diagram classified as `meta_explanation` and excluded even with maximum appeal;
- an applied layout or interface classified as `applied_example` and retained;
- missing or unknown classification failing closed;
- the reviewer prompt rejecting explanatory diagrams and label-revealed answers;
- fewer than three eligible book images using generated practice visuals rather than meta-designs.

Run the smallest relevant unit-test set and production build. Then deploy through the existing Sites workflow and perform one production smoke run with `design book 2.pdf`, checking that the Person-First process diagram is absent and all three quests use different applied visuals.
