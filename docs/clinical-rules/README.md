# Clinical rules

Versioned rule sources and review notes for `packages/clinical-safety`.
Wording here is not patient-facing until clinically reviewed.

Owner: Antonia (Workstream 4, spec §8). Ticket: KKD-SAFETY-001 (spec §28).

---

## Status: nothing is clinically approved yet

**Every rule currently shipped has `status: "draft"`.**

The spec requires clinical sign-off in five places — §8.2 ("a small, clinically reviewed
disposition enum"), §8.3.A (`reviewed_by`, `reviewed_at`), §8.3.B ("return the **approved**
safety message"), §8.3.D ("All exact wording requires clinical review") and §20
("Conservative **approved** failure response") — but §3's ownership table assigns no
clinical reviewer, and the spec defines no approval process.

Until that is resolved (`docs/adr/ws4-plan.md` §5, issue F):

- no rule may be promoted to `status: "active"`;
- no patient-facing wording is written in this repository. Rules carry a
  `patientMessageKey` i18n key only. The reviewed strings are Brian's to author in
  `@kkd/i18n` (spec §10.4.A: "Critical fixed strings must live in reviewed locale files").

Two things enforce this rather than convention:

- `safetyRuleSchema` refuses to parse an `active` rule that lacks both `reviewedBy` and
  `reviewedAt`.
- **The evaluator runs `active` rules only.** A `draft` rule fires only when the caller
  passes `executeUnreviewedDraftRules: true`, which exists for tests and rule authoring.
  Passing it in a patient-facing path means an unreviewed rule is deciding what a patient
  is told to do, and should not survive code review.

Because every shipped rule and pathway is currently `draft`, the default evaluation over
the shipped rule set fires nothing and asks nothing: it returns `unknown` with
`unknownReason: "no_pathway_matched"`. That is the intended state until a clinical
reviewer exists — spec §8.3.C prefers `unknown` over reassurance nobody approved, and the
reason field says which kind of `unknown` it is rather than letting a UI read it as an
all-clear.

---

## Where rules live

```
packages/clinical-safety/src/
  rule-schema.ts                                   rule + condition schema (spec §8.3.A)
  pathway-schema.ts                                complaint-pathway schema (spec §8.3.B step 4)
  rule-sets/red-flags.v0.1.0-draft.ts              a pinned, immutable rule set
  rule-sets/complaint-pathways.v0.1.0-draft.ts     its required-field tables
  registry.ts                                      version pinning and resolution
  pathways.ts                                      what is established, what is still missing
  evaluator.ts                                     the deterministic runner
```

A rule set is a TypeScript module so it typechecks against the schema in CI, and is
validated again at load time by `defineRuleSet`. A malformed rule, a duplicate rule id,
or an unreviewed `active` rule is a load-time failure, never a silent runtime skip. The
same holds for the pathway tables, which `defineRuleSet` pins into the same rule set
version — so `SafetyAssessment.ruleSetVersion` identifies everything that decided an
assessment, its `missingCriticalFacts` included (spec §8.7).

---

## Rule source format

Fields are those listed in spec §8.3.A.

| Field                       | Required                         | Meaning                                                                                                                                                                          |
| --------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                        | yes                              | Stable identifier, `rf.<snake_case>`. Appears in `SafetyAssessment.ruleIds` and in logs (`ruleId` is a safe log field per spec §18). Never reused.                               |
| `version`                   | yes                              | Semver of this rule.                                                                                                                                                             |
| `status`                    | yes                              | `draft` \| `active` \| `retired`.                                                                                                                                                |
| `requiredInputs`            | yes                              | Facts the rule needs before it can be decided, in the same vocabulary as a pathway's required-field ids. Every one must be covered by some complaint pathway (enforced by test). |
| `conditions`                | yes                              | Non-empty array, **ANDed** together.                                                                                                                                             |
| `urgencyResult`             | yes                              | A `UrgencyClass` from `@kkd/contracts` (spec §8.2).                                                                                                                              |
| `patientMessageKey`         | yes                              | i18n key. Never literal patient-facing text.                                                                                                                                     |
| `requiresHumanEscalation`   | no, default `false`              | See "Open decisions" below.                                                                                                                                                      |
| `clinicalRationale`         | no                               | Internal review note. **Must never name a disease.**                                                                                                                             |
| `sourceMetadata`            | no                               | Protocol or source the rule derives from.                                                                                                                                        |
| `reviewedBy` / `reviewedAt` | required when `status: "active"` | Clinical sign-off.                                                                                                                                                               |

### Condition language

Conditions are data, not functions, so a reviewer can read a rule without reading
TypeScript, and so a rule set can be diffed and version-pinned.

| Condition                                                     | Fires when                                     |
| ------------------------------------------------------------- | ---------------------------------------------- |
| `{ kind: "symptom_reported", concept }`                       | the concept appears in reported symptoms       |
| `{ kind: "symptom_denied", concept }`                         | the concept appears in a `deniedSymptoms` list |
| `{ kind: "symptom_severity_at_least", concept, value }`       | that symptom carries a severity ≥ `value`      |
| `{ kind: "fact_reported", factKind }`                         | a fact of that `kind` was reported             |
| `{ kind: "fact_equals", factKind, value }`                    | a fact of that `kind` has that value           |
| `{ kind: "measurement_at_least", measurement, value, unit? }` | a measurement of that name is ≥ `value`        |
| `{ kind: "measurement_at_most", measurement, value, unit? }`  | a measurement of that name is ≤ `value`        |
| `{ kind: "all_of" \| "any_of" \| "none_of", conditions }`     | combinators, nestable                          |

Rules read both `symptoms` and `facts` from the evaluation input. The fact conditions use
`factKind` rather than `kind`, because `kind` is already the condition's own discriminator.

Four semantics matter more than the list:

1. **There is no "symptom not mentioned" condition, deliberately.** Spec §5.2: "Never
   translate 'not mentioned' into 'denied'." `symptom_denied` means the patient explicitly
   denied it. Absence of information is handled by `requiredInputs` and surfaces as a
   missing critical fact, never as a negative finding.
2. **No unit conversion.** A rule that pins `unit` matches only that unit. A measurement
   whose value is not a plain finite number ("38-39", "about 39") is treated as
   unavailable rather than parsed into a number nobody reported.
3. **All confidence levels count as reported, including `uncertain`.** Ignoring uncertain
   reports would suppress red flags, which §8.3.C forbids. Deliberate, and itself pending
   clinical review.
4. **Fact values are compared without coercion.** `ReportedFact.value` is `unknown`
   (spec §5.1), so a rule may only compare it against a string, number, or boolean. The
   string `"true"` never matches the boolean `true`, so a rule cannot fire on a value
   shaped differently from the one the reviewer approved.

### Writing a rule

Rules describe **reported observations**. They never name, imply, or encode a disease —
product constitution §1.1 ("Never diagnose", "Never speculate diagnostically"). This
applies to `id`, `patientMessageKey`, and `clinicalRationale` alike, because rationale
text reaches clinical reviewers and handover documents.

```
✅  id: "rf.fever_with_neck_stiffness"
    clinicalRationale: "Fever reported together with neck stiffness is a recognised
                        immediate-escalation trigger."

❌  id: "rf.suspected_meningitis"
    clinicalRationale: "Likely meningitis."
```

---

## Complaint-pathway required-field tables

Spec §8.3.B, after the critical rules have run:

> 4. identify critical missing facts for the current complaint pathway;
> 5. ask those questions before lower-value detail questions.

A pathway answers, for one presenting complaint, **which facts must be established before
any disposition is trustworthy — including a reassuring one.** They live in
`rule-sets/complaint-pathways.v0.1.0-draft.ts` as plain data, for the same reason rule
conditions are data: a reviewer can read and diff a table without reading TypeScript.

The tables shipped today cover the complaints the `red-flags@0.1.0-draft` rules act on
(chest pain, breathlessness, fever, abdominal pain, bleeding), so that any complaint a
rule can fire on is also a complaint the engine can say what it still needs about. A unit
test enforces that every rule's `requiredInputs` is covered by some pathway.

| Field                       | Required                         | Meaning                                                                                                                    |
| --------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `id`                        | yes                              | Stable identifier, `pathway.<snake_case>`.                                                                                 |
| `version`                   | yes                              | Semver of this pathway.                                                                                                    |
| `status`                    | yes                              | `draft` \| `active` \| `retired`. Same lifecycle and same gate as a rule — see below.                                      |
| `presentingConcepts`        | yes                              | Reported symptom concepts that activate the pathway. Matched against every reported concept, not only a "chief complaint". |
| `requiredFields`            | yes                              | The facts to establish, each with a `priority` and a `questionKey`.                                                        |
| `clinicalRationale`         | no                               | Internal review note. **Must never name a disease.**                                                                       |
| `sourceMetadata`            | no                               | Protocol or source the pathway derives from.                                                                               |
| `reviewedBy` / `reviewedAt` | required when `status: "active"` | Clinical sign-off.                                                                                                         |

A required field:

| Field           | Meaning                                                                                                                                                                                                   |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`            | Same vocabulary as a rule's `requiredInputs`: `symptom.<concept>`, `symptom.<concept>.<attribute>`, `measurement.<name>`, `fact.<kind>`. This is what appears in `SafetyAssessment.missingCriticalFacts`. |
| `priority`      | Ask order. Lower first; ties break on `id`. By convention **10** = red-flag discriminator, **20** = pathway-critical, **30+** = detail.                                                                   |
| `establishedBy` | What settles the field (below).                                                                                                                                                                           |
| `questionKey`   | i18n key for the question that would establish it. Key only, never literal wording.                                                                                                                       |
| `rationale`     | Internal note, usually naming the rule the field discriminates for.                                                                                                                                       |

### What "established" means

**Established means the patient settled the question either way — it never means "true".**
Spec §5.2: "Never translate 'not mentioned' into 'denied'", so silence leaves a field
missing, and a missing field is never a negative finding.

| `establishedBy`                                     | Established when                                                                |
| --------------------------------------------------- | ------------------------------------------------------------------------------- |
| `{ kind: "symptom_presence", concept }`             | the concept was reported **or** explicitly denied                               |
| `{ kind: "symptom_attribute", concept, attribute }` | that symptom carries the attribute — or the concept was explicitly denied       |
| `{ kind: "measurement", measurement, unit? }`       | a usable measurement of that name (and unit, when pinned) was supplied          |
| `{ kind: "fact", factKind }`                        | a fact of that kind was reported, **whatever its value** — `false` is an answer |
| `{ kind: "any_of", establishedBy }`                 | any branch is established                                                       |

Three semantics worth stating:

1. **A denied concept closes its attributes.** If the patient denies chest pain, asking
   how severe it is establishes nothing, so `symptom.chest_pain.severity` counts as
   settled. But a concept that was never mentioned leaves its attributes _missing_.
2. **`uncertain` counts as established.** Spec §5.2 distinguishes `uncertain` ("patient
   was unsure") from `unknown` ("not established"): an unsure answer is an answer, and
   re-asking it would loop. This is a different test from §6.5's completeness rule, which
   counts only `explicit` and `clarified` — see `docs/adr/ws4-plan.md` §5, issue I.
3. **`any_of` exists so a pathway can always be completed.** The fever pathway accepts
   either a temperature measurement or a fact saying none is available. Without that
   branch, a patient with no thermometer could never complete the pathway, and the engine
   could never distinguish "unmeasured" from "unmeasurable".

Pathways carry the same `draft`/`active` gate as rules, and the evaluator runs `draft`
pathways only under the same `executeUnreviewedDraftRules` opt-in. That is deliberate: a
_completed_ pathway is what licenses §8.3.D's "no urgent warning sign has been
identified…" wording, and from an unreviewed table that sentence would be a guess.

### Question prioritisation

`missingCriticalFacts` is returned in ask-first order — `priority` ascending, ties broken
on field id — so a caller can take the first entry and ask that. `missingCriticalFieldsFor()`
returns the same fields with their `questionKey`s, and `nextRequiredQuestion()` returns
just the first. A field required by several active pathways appears once, at its most
urgent declared priority.

Missing facts are reported at _every_ urgency, not only at `unknown`. At `emergency` or
`urgent_today`, §8.3.B step 3 still requires the approved safety message **before** any
further questioning — the list records what was never established; it is not a licence to
keep interrogating someone who needs to be seen now.

---

## The two kinds of `unknown`

`urgency: "unknown"` covers two situations that must never be presented the same way:

- **"We asked everything and found no red flag."**
- **"We cannot tell, because critical information is missing."**

Spec §8.2 fixes `UrgencyClass` at five values and Duncan's `SystemScoreSnapshot` (§6.3.D)
consumes that enum, so the distinction cannot be a sixth urgency class. It travels beside
it instead, as `SafetyAssessment.unknownReason` — set by the engine whenever `urgency` is
`unknown`, and only then (`safetyAssessmentSchema` rejects it on any other urgency).

| `unknownReason`            | What happened                                                                                 | `missingCriticalFacts`        |
| -------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------- |
| `missing_critical_facts`   | A pathway is active and required fields for it are unestablished. The engine cannot tell yet. | non-empty, in ask-first order |
| `no_pathway_matched`       | No pathway covers what was reported, so the engine cannot even enumerate what it would need.  | empty                         |
| `screened_no_rule_matched` | Every required field of every active pathway is established, and no rule fired.               | empty                         |

**How a UI must tell them apart.** Branch on `unknownReason`, never on `urgency` alone:

- `missing_critical_facts` → ask `missingCriticalFacts[0]` (via its `questionKey`). Show
  no disposition and no summary of findings. Nothing about this state means "nothing
  found"; it means "nothing established".
- `no_pathway_matched` → do not claim any screening happened. Continue open questioning,
  or offer the general care-connection path. This is the state a session reaches when the
  reported complaint is outside the shipped tables entirely — today, with every pathway
  still `draft`, it is also what a production caller sees for _every_ input.
- `screened_no_rule_matched` → and **only** here, §8.3.D's second sentence is available:
  "No urgent warning sign has been identified from the information collected so far.
  Continue monitoring and seek professional care sooner if the listed warning signs
  appear." Note that even this wording is bounded by "so far" and pairs with the warning
  signs; it is not an all-clear.
- `urgency: "unknown"` with **no** `unknownReason` did not come from the engine — for
  example a session's pre-evaluation zero state, since §5's `KkdSession.safety` is
  non-optional. Treat it as "not evaluated" (see `docs/adr/ws4-plan.md` §5, issue K). It
  is never evidence that nothing was found.

The failure this guards against is one wording: a "we found nothing" message rendered for
a patient the engine never actually screened. §8.3.C exists for exactly that case.

---

## Versioning

A rule set version is **immutable once used in production**, mirroring the rule spec
§6.3.D states for score algorithm versions. Spec §8.7 requires that "every decision
identifies rule IDs/version internally", and §8.6 requires "deterministic
same-input/same-rule-version behavior" — neither holds if a version's contents can change
under a stored assessment.

To change a rule: publish a new rule set version. Do not edit a published one.

The evaluator resolves the exact `ruleSetVersion` it was given and throws
`UnknownRuleSetVersionError` if it is not registered. There is no "latest" fallback.

Naming: `<set>@<semver>[-draft]`, e.g. `red-flags@0.1.0-draft`.

Retired rules stay in the file with `status: "retired"` so historical assessments remain
explainable. `retired` rules are never executed, with or without the draft opt-in.

---

## Review process (proposed — needs a decision)

Not yet agreed, because no reviewer is assigned. Proposed, for the team to confirm:

1. Author the rule as `draft` with a `clinicalRationale` and `sourceMetadata`.
2. Open a PR touching only the rule set file and this directory.
3. A named clinical reviewer approves the condition logic, the threshold, the resulting
   `UrgencyClass`, and the English/Kiswahili strings behind `patientMessageKey`. For a
   pathway, they approve which fields are critical, their ask order, and the strings
   behind each `questionKey` — a pathway that omits a critical field would let the engine
   report a screening it did not perform.
4. On approval, set `status: "active"` and fill `reviewedBy` and `reviewedAt` in the same
   commit as the sign-off.
5. Publish as a new rule set version and pin callers to it.

Open questions blocking step 3 are tracked in `docs/adr/ws4-plan.md` §5.

---

## Open decisions affecting this format

- **`requiresHumanEscalation` has no defined trigger.** Spec §8.2 declares the field;
  §8 never says when it is true. It is declared per rule rather than inferred by the
  engine, so the decision stays with the rules and the reviewer. Needs a call with Dancun,
  who consumes it for voice handoff (spec §12.3.E). See plan §5, issue D.
- **Who signs `reviewedBy`.** See plan §5, issue F.

---

## Diagnosis-language guard

Spec §14, plus §8.3.D's "Never say" line and §8.4.D's prohibited trend statements.
Implemented in `packages/clinical-safety/src/diagnosis-language/`.

```
diagnosis-language/
  pattern-schema.ts               surfaces, pattern + locale-set schema, fragment helpers
  patterns/en.v0.1.0-draft.ts     the English pattern set (data)
  registry.ts                     locale lookup
  guard.ts                        normalization + the matcher
```

### What it covers

**Two patient-facing surfaces, and only two.** The caller says which one it is checking:

| Surface               | Text it guards                                     | Spec         |
| --------------------- | -------------------------------------------------- | ------------ |
| `urgency_explanation` | the prose that explains a disposition to a patient | §8.3.D       |
| `trend_statement`     | the factual sentence describing check-in history   | §8.4.D, §8.7 |

Both are Workstream 4 surfaces. Both are specified: §8.3.D and §8.4.D each give approved
wordings _and_ prohibited wordings, which is what makes a pattern set writable rather than
guessed at.

The two sentences the spec names by hand are covered by name, and each has its own test:

- §8.3.D — _"You probably have X, so you can wait."_ → `en.unapproved_deferral.diagnosis_led`
- §8.4.D — _"Your likelihood of X is increasing."_ → `en.likelihood_statement.probability_noun`

### What it deliberately does not cover

- **Ranked possible causes — scope open.** Whether KKD ever shows a ranked list of possible
  causes has not been decided by the team. This guard takes no position on it: there is no
  surface for it, no pattern written against it, and no assumption about it in the corpus.
  If that feature ships, it arrives as a **new surface with its own patterns and its own
  caller**. Nothing in this guard needs to change for the two surfaces above to keep
  behaving exactly as they do now. Guessing the shape of that feature now and building
  patterns around the guess is the failure mode this note exists to prevent.
- **The other §14 surfaces.** §14 also lists web, summary, WhatsApp, USSD free text, voice
  scripts, MCP outputs, and exported patient documents. Those belong to their channel
  owners. They can call this guard, but the surfaces they need are theirs to specify — a
  voice script and a trend sentence do not have the same approved wordings, so they do not
  share a pattern list.
  Note that `apps/api/src/modules/voice/diagnosis-guard.ts` already carries a small literal
  phrase list of its own. It is deliberately untouched here (voice is Dancun's). Folding it
  into a `voice_script` surface is a follow-up conversation, not this slice.
- **Kiswahili.** The shipped registry is English only. §10.4.D makes the per-language
  corpus a joint piece of work with Brian and Evans, and the Kiswahili patterns are theirs
  to review. Until they exist, a call with `locale: "sw"` **fails closed** (see below).
- **Rewriting.** The guard reports; it does not repair. A rewrite would be new
  patient-facing wording, and no wording ships from this repository before clinical review.
- **Prompting and structured output.** §14: _"A post-generation guard does not replace good
  prompts and structured outputs; use all three layers."_ This is the third layer only.

### Why it is not a phrase list

§10.4.D: _"A literal phrase list is not enough; test paraphrases and code switching."_

Patterns match the **frame** of a diagnostic sentence, never a list of disease names. A
frame is composed from lexical fragments — a subject, hedges, a possession verb, a
deferral, a claim verb — joined by `words()` (adjacent) or `near()` (within one sentence,
with a gap). Three consequences:

1. **Paraphrase.** "You are most likely suffering from X", "You have got some kind of X"
   and "You probably have X" are one pattern, not three strings.
2. **Code switching.** The condition name, the subject, and the trailing verb can be in
   another language and the frame still trips: _"You probably have homa ya matumbo, so you
   can wait"_, _"Pole sana, but wewe probably have typhoid"_, _"Your likelihood ya kupata
   malaria inaongezeka"_. What the guard cannot catch is a frame that is **wholly** in
   another language — that needs that language's pattern set, which is exactly why the
   unsupported-locale case fails closed rather than passing.
3. **Unknown conditions.** No disease list means no gap for a disease nobody listed.

The likelihood pattern is deliberately blunt: on these two surfaces KKD does not state a
probability _at all_, so the noun alone is prohibited with no object required. That is what
survives a code-switched connector.

### Adding a locale is a data addition

Write `patterns/<locale>.v<semver>-draft.ts`, composing patterns from the helpers exported
by `pattern-schema.ts` (`anyOf`, `words`, `near`, `prohibitedPattern`), and register the
set in `registry.ts`. No guard, schema or matcher code changes. A test in
`guard.test.ts` builds a second locale from those helpers alone to keep that true.

`defineLocalePatternSet` validates at load: a malformed pattern, a duplicate id, an id
belonging to another locale, or a `g`/`y` regex (whose `lastIndex` would make the guard
non-deterministic between calls) is a load-time failure.

**There is no clinical-review gate on pattern sets**, unlike rules and pathways. A rule
decides what a patient is told to do, so an unreviewed one must not run. This guard only
ever _refuses_ text: running an unreviewed pattern can over-block, never under-block, and
gating it behind review would make the conservative behaviour the opt-in. Linguistic review
still matters and is tracked per pattern-set version.

### Fail closed, and say so

`allowed` and `coverage` are separate fields, for the same reason `urgency` and
`unknownReason` are separate: _"we checked and found nothing"_ and _"we could not check"_
must never be presented identically.

| `coverage`                | Meaning                                             | `allowed`          |
| ------------------------- | --------------------------------------------------- | ------------------ |
| `checked`                 | patterns exist for this locale and surface, and ran | findings-dependent |
| `unsupported_locale`      | no pattern set registered for the locale            | always `false`     |
| `no_patterns_for_surface` | locale registered, but declares nothing for it      | always `false`     |

Unchecked text is never allowed. §8.3.C's principle — never manufacture reassurance out of
an absence of information — applies to the guard as much as to the engine.

### Synchronous, like the engine

`DiagnosisLanguageGuard.inspect` returns a verdict, not a `Promise`. Normalization and
regex matching over an in-memory, version-pinned pattern set are pure computation with no
I/O, so there is nothing for a Promise to represent. It also sits in the same synchronous
safety path as `SafetyEngine` (§8.7, _"safety-critical execution is synchronous"_); an
async guard would invite a caller to render text before the check resolved. The interface
was changed from the `Promise`-returning scaffold for the same reason `SafetyEngine` was.

### Known false positives, accepted

The guard prefers a false positive (a template gets rewritten) to a false negative (a
diagnosis reaches a patient). A deterministic layer cannot tell a disease name from a
symptom name without a lexicon, so possession frames are flagged whatever follows them:

> ❌ "You have had a fever for three days." → ✅ "You reported fever for three days."

That rewrite is the house style anyway — §8.4.C requires check-ins built on _"previously
reported facts, not a disease label"_. Every wording the spec itself approves is tested to
pass, including §8.3.D's _"Based on what you have reported…"_, which is why the possession
pattern exempts reporting verbs and only reporting verbs.

`DiagnosisLanguageFinding.matchedText` is patient-derived text. §18 forbids raw symptom
text in logs — the loggable field is `patternId`, the way `ruleId` is for rules.

### Regression corpus

Cases live in `packages/testing/src/regression/diagnosis-language.ts` so the other channel
owners can read and extend them (§21.3, §10.4.D). Each case names its folder from the
declared `regressionSuiteFolders`, its surface, its locale, and whether the guard must
prohibit or allow it — the `allowed` cases are the false-positive rail, and include all
five wordings §8.3.D and §8.4.D approve.

A case that cannot pass yet carries `blockedOn` and is not asserted as a match; it is still
asserted to be _refused_ rather than passed, and is listed in test output so the gap stays
visible. Today that is one case: a wholly Kiswahili diagnostic frame, blocked on the
Kiswahili pattern set.
