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

`safetyRuleSchema` enforces the first point: parsing an `active` rule without both
`reviewedBy` and `reviewedAt` fails.

---

## Where rules live

```
packages/clinical-safety/src/
  rule-schema.ts                        rule + condition schema (spec §8.3.A)
  rule-sets/red-flags.v0.1.0-draft.ts   a pinned, immutable rule set
  registry.ts                           version pinning and resolution
  evaluator.ts                          the deterministic runner
```

A rule set is a TypeScript module so it typechecks against the schema in CI, and is
validated again at load time by `defineRuleSet`. A malformed rule, a duplicate rule id,
or an unreviewed `active` rule is a load-time failure, never a silent runtime skip.

---

## Rule source format

Fields are those listed in spec §8.3.A.

| Field                       | Required                         | Meaning                                                                                                                                            |
| --------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                        | yes                              | Stable identifier, `rf.<snake_case>`. Appears in `SafetyAssessment.ruleIds` and in logs (`ruleId` is a safe log field per spec §18). Never reused. |
| `version`                   | yes                              | Semver of this rule.                                                                                                                               |
| `status`                    | yes                              | `draft` \| `active` \| `retired`.                                                                                                                  |
| `requiredInputs`            | yes                              | Facts the rule needs before it can be decided. Consumed by the missing-critical-fact pathway (spec §8.3.B step 4).                                 |
| `conditions`                | yes                              | Non-empty array, **ANDed** together.                                                                                                               |
| `urgencyResult`             | yes                              | A `UrgencyClass` from `@kkd/contracts` (spec §8.2).                                                                                                |
| `patientMessageKey`         | yes                              | i18n key. Never literal patient-facing text.                                                                                                       |
| `requiresHumanEscalation`   | no, default `false`              | See "Open decisions" below.                                                                                                                        |
| `clinicalRationale`         | no                               | Internal review note. **Must never name a disease.**                                                                                               |
| `sourceMetadata`            | no                               | Protocol or source the rule derives from.                                                                                                          |
| `reviewedBy` / `reviewedAt` | required when `status: "active"` | Clinical sign-off.                                                                                                                                 |

### Condition language

Conditions are data, not functions, so a reviewer can read a rule without reading
TypeScript, and so a rule set can be diffed and version-pinned.

| Condition                                                     | Fires when                                     |
| ------------------------------------------------------------- | ---------------------------------------------- |
| `{ kind: "symptom_reported", concept }`                       | the concept appears in reported symptoms       |
| `{ kind: "symptom_denied", concept }`                         | the concept appears in a `deniedSymptoms` list |
| `{ kind: "symptom_severity_at_least", concept, value }`       | that symptom carries a severity ≥ `value`      |
| `{ kind: "measurement_at_least", measurement, value, unit? }` | a measurement of that name is ≥ `value`        |
| `{ kind: "measurement_at_most", measurement, value, unit? }`  | a measurement of that name is ≤ `value`        |
| `{ kind: "all_of" \| "any_of" \| "none_of", conditions }`     | combinators, nestable                          |

Three semantics matter more than the list:

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
explainable. The evaluator runs `draft` and `active` rules and never runs `retired` ones.

---

## Review process (proposed — needs a decision)

Not yet agreed, because no reviewer is assigned. Proposed, for the team to confirm:

1. Author the rule as `draft` with a `clinicalRationale` and `sourceMetadata`.
2. Open a PR touching only the rule set file and this directory.
3. A named clinical reviewer approves the condition logic, the threshold, the resulting
   `UrgencyClass`, and the English/Kiswahili strings behind `patientMessageKey`.
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
