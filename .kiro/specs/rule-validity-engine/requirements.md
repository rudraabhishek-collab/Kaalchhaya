# Requirements — rule-validity-engine

## Scope

A pure TypeScript module in `src/core` that answers, for any rule and any query date,
what lifecycle status the rule has, and builds a complete timeline for a rule and its chain
of successors. No UI imports, no network calls, no file I/O. All data is passed in as
arguments. All errors are returned as typed values; nothing is thrown for expected invalid
input.

Confidence levels and display states (Ghost, Ink, Fog, Ash, Reborn) are **not** part of
this spec. They are handled by a later module.

---

## Data model

A **Rule** record has:

| Field | Type | Notes |
|---|---|---|
| `id` | `string` | Non-empty (after trimming), unique within a ruleset; compared case-sensitively |
| `effectiveFrom` | `ISODateString` | Inclusive start date |
| `effectiveTo` | `ISODateString \| null` | Inclusive declared end date; `null` means open-ended |
| `supersedes` | `string \| null` | ID of the rule this one replaces; `null` or non-empty string only |
| `supersededBy` | `string \| null` | ID of the rule that replaces this one; `null` or non-empty string only |
| `coexists` | `boolean` | Optional, defaults to `false`. Read from the **successor** rule. |

An **Extension** record has:

| Field | Type | Notes |
|---|---|---|
| `ruleId` | `string` | The rule whose end date is being modified |
| `newEndDate` | `ISODateString` | The new inclusive end date; may be earlier or later than current end |
| `issuedOn` | `ISODateString` | Determines application order |

A **TimelineSegment** has:
`{ from: ISODateString | null, to: ISODateString | null, status: LifecycleStatus }`

- `from: null` means the segment extends infinitely into the past.
- `to: null` means the segment extends infinitely into the future.

**LifecycleStatus** values: `NOT_YET_EFFECTIVE`, `ACTIVE`, `EXPIRING`, `EXPIRED`, `SUPERSEDED`.

A **ChainResult** has:
`{ order: string[], timelines: Record<ruleId, TimelineSegment[]>, findings: Finding[] }`

**Finding** types: `BrokenLinkFinding`, `UnexplainedGapFinding`, `OverlapFinding`,
`InconsistentLinkFinding`, `SuccessorPrecedesPredecessorFinding`,
`MultipleSuccessorsFinding`.

**Typed error** types: `InvalidDateError`, `InvalidRuleError`, `InvalidExtensionError`,
`InvalidThresholdError`, `DuplicateIdError`, `UnknownRuleError`.

**Result envelope** (R11.1): every public function returns either
`{ ok: true, value: T, findings: Finding[] }` or `{ ok: false, errors: EngineError[] }`.

---

## Effective end

`effectiveEnd` is the computed inclusive end date used in all lifecycle and timeline
calculations. It is derived in this order:

1. Start from the rule's declared `effectiveTo`.
2. Apply extensions (per R4): replace the running end date with each extension's
   `newEndDate`, applied in ascending `issuedOn` order (ties broken by ascending
   `newEndDate`). After this step the result is the **extendedEnd** — the end date after
   extensions and before any successor cap (`null` if the rule is open-ended and no
   extension has been applied).
3. If an applicable successor exists (per the Resolution rules below), set `effectiveEnd`
   to the earlier of `extendedEnd` (if not `null`) and the day before the successor's
   `effectiveFrom`. If `extendedEnd` is `null`, `effectiveEnd` = the day before the
   successor's `effectiveFrom`.

`effectiveEnd` is `null` only if `extendedEnd` is `null` **and** there is no applicable
successor.

This computed value is used wherever `effectiveEnd` is referenced in R2 through R10.

---

## Resolution rules

For a predecessor A, its **claimants** are: every rule in the ruleset whose `supersedes`
equals `A.id`, plus the rule named by `A.supersededBy` if that rule exists in the ruleset.

Evaluate claimants in this order:

**(a) Contradicting own supersedes.** If a claimant C has `C.supersedes` non-null and
`C.supersedes ≠ A.id`, discard C from consideration and add an `InconsistentLinkFinding`
naming C (C's own `supersedes` field points elsewhere, so the link via `A.supersededBy`
is contradicted).

**(b) Successor precedes predecessor.** Discard any remaining claimant C where
`C.effectiveFrom ≤ A.effectiveFrom` and add a `SuccessorPrecedesPredecessorFinding`
naming C. Supersession is not applied for any discarded claimant.

**(c) Coexisting claimants.** Among remaining claimants, those with `C.coexists = true`
are **coexisting successors**. They never truncate A's `effectiveEnd`, never cause A to
become `SUPERSEDED`, do not raise `OverlapFinding` or `UnexplainedGapFinding` for their
boundary with A, and do not compete with other claimants in step (d).

**(d) Multiple non-coexisting claimants.** If more than one non-coexisting claimant
remains after steps (a)–(c), add a `MultipleSuccessorsFinding` listing all of them. The
**applicable successor** is the one with the earliest `effectiveFrom`; ties are broken by
ascending `id`.

**(e) Single non-coexisting claimant.** If exactly one non-coexisting claimant remains,
it is the applicable successor.

If zero non-coexisting claimants remain after all steps, A has no applicable successor.

**One-sided links.** Where a link is declared by only one side and the other rule exists
(and the claimant is not discarded by (a)), the link is applied and an
`InconsistentLinkFinding` is added naming the rule that omitted the back-reference.

**Broken links.** If a declared ID (`supersedes` or `supersededBy`) does not exist in
the ruleset, add a `BrokenLinkFinding` and do not apply supersession for that reference.

The term "applicable successor" throughout R5–R8 means the result of this procedure.

> **Note on termination.** Step (b) keeps only claimants whose `effectiveFrom` is
> strictly later than the predecessor's, so applied links strictly increase `effectiveFrom`.
> Cycles and out-of-order chains therefore cannot occur among applied links. A claimant
> that is the predecessor itself (self-supersession) is discarded by step (b) and reported
> as `SuccessorPrecedesPredecessorFinding`.

---

## Requirements

### R1 — Date string validation

**R1.1** The engine accepts a date string if and only if it matches exactly `YYYY-MM-DD`,
represents a real calendar date, and its year is in the range 1900–2100 inclusive.
*Example: `"2026-03-15"` is accepted.*

**R1.2** A syntactically valid `YYYY-MM-DD` string that represents an impossible date
causes an `InvalidDateError` to be added to `errors`; no status or timeline is computed.
*Example: `"2026-02-30"` → `InvalidDateError`.*

**R1.3** A string that does not match exactly `YYYY-MM-DD` — including strings with a
time part, timezone offset, or any surrounding whitespace — causes an `InvalidDateError`
to be added to `errors`; no status or timeline is computed.
*Examples: `"26-3-2026"`, `"2026/03/15"`, `"2026-03-15T00:00:00Z"`, `" 2026-03-15"`
all → `InvalidDateError`.*

**R1.4** When comparing two valid date strings, the engine must treat both as UTC
midnight dates and must not apply any local-timezone offset.

**R1.5** A rule whose `effectiveTo` is earlier than `effectiveFrom` causes an
`InvalidRuleError` to be added to `errors`; no status or timeline is computed.
*Example: `effectiveFrom: "2027-01-01"`, `effectiveTo: "2026-12-31"` → `InvalidRuleError`.*

**R1.6** A rule with `effectiveFrom` equal to `effectiveTo` is valid (a single-day rule).
*Example: `effectiveFrom: "2027-06-15"`, `effectiveTo: "2027-06-15"` is accepted.*

**R1.7** A rule whose `id` is empty or is empty after trimming whitespace causes an
`InvalidRuleError` to be added to `errors`; no status or timeline is computed. Rule ids
are compared exactly as given (case-sensitive, no trimming at comparison time).

**R1.8** A ruleset containing two or more rules with the same `id` causes a
`DuplicateIdError` to be added to `errors`; no status or timeline is computed.

**R1.9** A non-string value supplied as a date input (e.g. `undefined`, `null`, a number,
or an object) causes an `InvalidDateError` to be added to `errors`; no status or timeline
is computed.

**R1.10** A rule whose `supersedes` or `supersededBy` field is an empty string (rather
than `null`) causes an `InvalidRuleError` to be added to `errors`; `null` and non-empty
strings are the only valid values for these fields.

---

### R2 — Lifecycle status for a single rule

**R2.1** When a valid ruleset, extensions list, rule id and query date D are provided,
the engine must return exactly one of: `NOT_YET_EFFECTIVE`, `ACTIVE`, `EXPIRING`,
`EXPIRED`, or `SUPERSEDED`.

**R2.2** When D < `effectiveFrom`, the engine must return `NOT_YET_EFFECTIVE`.
*Examples: `effectiveFrom: "2027-01-01"`, D = `"2026-12-31"` → `NOT_YET_EFFECTIVE`;
D = `"2026-12-31"` (exactly one day before) → `NOT_YET_EFFECTIVE`.*

**R2.3** When D equals `effectiveFrom` and the rule has not expired or been superseded,
the engine must return `ACTIVE` or `EXPIRING` (whichever applies per R3).
*Example: `effectiveFrom: "2027-01-01"`, `effectiveTo: "2027-12-31"`, D = `"2027-01-01"`
→ `ACTIVE` (364 days remain, above default N = 90).*

**R2.4** When D equals `effectiveEnd` and the rule has not been superseded, the engine
must return `EXPIRING` (effectiveEnd − D = 0 days, satisfying ≤ N for any N ≥ 0).
*Example: `effectiveEnd: "2027-12-31"`, D = `"2027-12-31"` → `EXPIRING`.*

**R2.5** When D is strictly after `effectiveEnd` and no applicable successor exists, the
engine must return `EXPIRED`.
*Examples: `effectiveEnd: "2027-12-31"`, D = `"2028-01-01"` → `EXPIRED`;
D = `"2028-01-01"` (exactly one day after) → `EXPIRED`.*

**R2.6** When `effectiveEnd` is `null` (open-ended, no applicable successor), the engine
must return `ACTIVE` for any D ≥ `effectiveFrom`. It must never return `EXPIRING`.

**R2.7** When D > `effectiveEnd` and an applicable successor exists whose
`effectiveFrom` ≤ D, the engine must return `SUPERSEDED`. When D ≤ `effectiveEnd` the
status is never `SUPERSEDED`, regardless of the successor's existence.

**R2.8** *Removed (merged into R2.2 as a boundary example).*

**R2.9** *Removed (merged into R2.5 as a boundary example).*

**R2.10** When D > `effectiveEnd` and an applicable successor exists but D <
successor's `effectiveFrom` (a gap day), the engine must return `EXPIRED`.
*Example: predecessor `effectiveEnd: "2027-12-31"`, successor `effectiveFrom:
"2028-02-01"`, D = `"2028-01-15"` → `EXPIRED`.*

---

### R3 — EXPIRING threshold

**R3.1** When no explicit threshold is provided, the engine must use a default of N = 90.

**R3.2** When an explicit threshold N is provided, the engine must use it in place of the
default.

**R3.3** When `effectiveFrom ≤ D ≤ effectiveEnd` and `effectiveEnd` is not `null`, the
engine returns `EXPIRING` if and only if `(effectiveEnd − D)` in whole UTC days is ≤ N;
otherwise it returns `ACTIVE`.
*Example: N = 90, `effectiveEnd: "2027-03-31"`, D = `"2027-01-01"` →
effectiveEnd − D = 89 days → `EXPIRING`.*

**R3.4** When days remaining exceed N, the engine returns `ACTIVE`.
*Example: N = 90, `effectiveEnd: "2027-12-31"`, D = `"2027-01-01"` →
effectiveEnd − D = 364 days → `ACTIVE`.*

**R3.5** When `effectiveEnd − effectiveFrom` ≤ N days, the entire in-scope period
`[effectiveFrom, effectiveEnd]` is `EXPIRING`. The EXPIRING segment starts at
`effectiveFrom` and must not start before it.

**R3.6** When N = 0, the engine returns `EXPIRING` only on `effectiveEnd` itself, and
`ACTIVE` on all earlier in-scope dates.

**R3.7** When N is not a safe integer (per `Number.isSafeInteger`) or N < 0 or N >
100 000, an `InvalidThresholdError` is added to `errors`; no status or timeline is
computed.

---

### R4 — Extensions

**R4.1** When an extension is applied to a rule, the engine replaces the rule's running
end date with the extension's `newEndDate` for all subsequent calculations. An extension
may move the end date either earlier or later than the current value, but never before
`effectiveFrom` (see R4.4). Extensions are always applied before supersession is computed.

**R4.2** When multiple extensions apply to the same rule, the engine applies them in
ascending `issuedOn` order. Extensions are applied before supersession is computed.

**R4.3** When the same extension record is applied twice (identical `ruleId`,
`newEndDate`, and `issuedOn`), the result must be identical to applying it once.

**R4.4** When an extension's `newEndDate` is strictly earlier than the rule's
`effectiveFrom`, an `InvalidExtensionError` is added to `errors`; the extension is not
applied and no status or timeline is computed.

**R4.5** When an extension's `newEndDate` equals the rule's `effectiveFrom`, the engine
accepts it (the rule becomes a same-day rule per R1.6).

**R4.6** When an extension's `issuedOn` is invalid per R1, an `InvalidDateError` is
added to `errors`; no status or timeline is computed.

**R4.7** When two or more extensions for the same rule share the same `issuedOn` date,
the engine applies them in ascending `newEndDate` order so the largest `newEndDate` is
applied last. Duplicate records (identical `ruleId`, `newEndDate`, `issuedOn`) are
de-duplicated before ordering, so each unique record is applied exactly once.

**R4.8** When an extension's `ruleId` is not found in the provided ruleset, an
`UnknownRuleError` is added to `errors`; no status or timeline is computed.

**R4.9** *Removed (content merged into R4.1).*

---

### R5 — Supersession

**R5.1** The applicable successor for any rule is determined by the Resolution rules
section. All of R5.2–R5.8 apply only to the applicable successor (if any).

**R5.2** When supersession applies, `effectiveEnd` is computed per the "Effective end"
section: the extended end is capped at the day before the successor's `effectiveFrom`.
If the predecessor is open-ended after extensions, `effectiveEnd` becomes the day before
the successor's `effectiveFrom`.
*Example: predecessor extended end `"2028-06-30"`, successor `effectiveFrom: "2028-04-01"`
→ `effectiveEnd = "2028-03-31"`.*

**R5.3** When the predecessor is open-ended after extensions, the engine sets
`effectiveEnd` to the day before the successor's `effectiveFrom`.
*Example: successor `effectiveFrom: "2028-04-01"` → `effectiveEnd = "2028-03-31"`.*

**R5.4** *Removed (merged into R2.7).*

**R5.5** *Removed (merged into R2.7).*

**R5.6** When `successor.coexists` is `true` (per the Resolution rules, step (c)):
the predecessor is not truncated, never becomes `SUPERSEDED` from this successor, and no
`OverlapFinding` or `UnexplainedGapFinding` is raised for this pair.

**R5.7** *Removed (merged into Resolution rules step (b) and R8.8).*

**R5.8** *Removed (merged into Resolution rules step (d) and R8.9).*

---

### R6 — Timeline for a single rule

A timeline covers **all** dates using `from: null` (unbounded past) and `to: null`
(unbounded future) as sentinels.

**R6.1** The engine returns a list of `TimelineSegment` records that is:
- **Sorted** by `from` (treating `null` as −∞).
- **Non-overlapping**: no date belongs to two segments.
- **Contiguous**: the day after one segment's `to` equals the next segment's `from`.
- **Canonical**: adjacent segments with the same status are merged into one.

**R6.2** The first segment always has `from: null` and status `NOT_YET_EFFECTIVE`,
covering all dates before `effectiveFrom`. (This segment always exists; it is never
omitted.)

**R6.3** The last segment always has `to: null`. Its status is:
- `ACTIVE` if `effectiveEnd` is `null` (open-ended, no applicable successor).
- `SUPERSEDED` if an applicable successor exists.
- `EXPIRED` otherwise (fixed end with no applicable successor).

A gap between the predecessor's `effectiveEnd` and the successor's `effectiveFrom` is
represented as a separate `EXPIRED` segment placed immediately before the final
`SUPERSEDED` segment (see shape (c) in R6.6).

**R6.4** For every date D, the status returned by the lifecycle function must equal the
`status` of the unique segment whose range contains D.

**R6.5** The EXPIRING segment, when present, starts at X = `max(effectiveFrom,
effectiveEnd − N days)` and ends at `effectiveEnd`.

**R6.6** Canonical timeline shapes. Let:
- `d` = `effectiveFrom`
- `e` = `effectiveEnd`
- `s` = applicable successor's `effectiveFrom`
- `N` = threshold
- `X` = `max(d, e − N)`

Segments whose range would be empty are omitted.

**(a) `e` is `null` (open-ended, no successor):**
```
NOT_YET_EFFECTIVE (null → d-1)
ACTIVE            (d    → null)
```

**(b) `e` not null, no applicable successor:**
```
NOT_YET_EFFECTIVE (null → d-1)
ACTIVE            (d    → X-1)      ← omitted if X = d (entire in-scope is EXPIRING)
EXPIRING          (X    → e)
EXPIRED           (e+1  → null)
```

**(c) `e` not null, applicable successor exists:**
```
NOT_YET_EFFECTIVE (null → d-1)
ACTIVE            (d    → X-1)      ← omitted if X = d
EXPIRING          (X    → e)
EXPIRED           (e+1  → s-1)      ← omitted if e+1 = s (no gap)
SUPERSEDED        (s    → null)
```

**Worked synthetic example** (verify: d = `2027-01-01`, e = `2027-12-31`, N = 90,
s = `2028-02-01`):
- X = max(`2027-01-01`, `2027-12-31` − 90 days) = max(`2027-01-01`, `2027-10-02`) =
  `2027-10-02`
- ACTIVE: `2027-01-01` → `2027-10-01` (274 days)
- EXPIRING: `2027-10-02` → `2027-12-31` (91 days; effectiveEnd − X = 90 days ✓)
- EXPIRED: `2028-01-01` → `2028-01-31` (31 days; gap before s)
- SUPERSEDED: `2028-02-01` → null

Day-count note: 2027-12-31 − 2027-10-02 = 90 days (the EXPIRING window [X, e] inclusive
contains 91 calendar dates but spans 90 days, satisfying ≤ N = 90 ✓).

---

### R7 — Chain timeline

**R7.1** The chain for rule R is: R, followed by R's applicable successor, then that
rule's applicable successor, and so on until a rule has no applicable successor. There is
no backward walk. Claimants that are not chosen as the applicable successor appear only
in findings, not in `order`.

**R7.2** The chain result is:
```
{ order: string[], timelines: Record<ruleId, TimelineSegment[]>, findings: Finding[] }
```
Each entry in `timelines` is that rule's own full individual timeline (per R6).
Timelines are **not** stitched into a merged timeline.

**R7.3** When a chain is requested for a rule that has no applicable successor, the engine
returns a chain with one entry in `order` and one timeline.

**R7.4** *Removed (cycles cannot occur among applied links; see the note at the end of
the Resolution rules).*

---

### R8 — Chain validation findings

Findings are typed values in the `findings` array. None cause the engine to throw. All
applicable findings are collected; the engine does not stop at the first one. Findings are
sorted deterministically: by type name ascending, then by involved IDs ascending, then by
date range (R11.5).

Each entry below names when the finding is raised and what its payload contains. The
behavior that triggers each finding is defined in the Resolution rules or in R5.

**R8.1 BrokenLinkFinding** — Raised per the Resolution rules (broken links step) when a
declared `supersedes` or `supersededBy` ID is not found in the ruleset. Payload: the
missing ID.

**R8.2 UnexplainedGapFinding** — Raised when an applicable non-coexisting successor
exists, `extendedEnd` is not `null`, and `extendedEnd + 1 < successor.effectiveFrom`.
Payload: gap range `[extendedEnd + 1, successor.effectiveFrom − 1]`.

**R8.3 OverlapFinding** — Raised when an applicable non-coexisting successor exists,
`extendedEnd` is not `null`, and `extendedEnd ≥ successor.effectiveFrom`. An open-ended
predecessor (`extendedEnd` is `null`) does not trigger this finding.
Payload: overlap range `[successor.effectiveFrom, extendedEnd]`.

**R8.4** *Removed (CycleFinding removed; cycles cannot occur among applied links).*

**R8.5** *Removed (behavior lives in R5.6 and Resolution rules step (c)).*

**R8.6** *Removed (restated as the opening paragraph of this section).*

**R8.7 InconsistentLinkFinding** — Raised per the Resolution rules (one-sided links and
step (a)) when a link is one-sided or when a claimant's own `supersedes` contradicts
the back-reference. Payload: the ID of the rule that omitted the back-reference or whose
`supersedes` pointed elsewhere.

**R8.8 SuccessorPrecedesPredecessorFinding** — Raised per Resolution rules step (b) when
a claimant's `effectiveFrom` ≤ predecessor's `effectiveFrom`. Payload: the claimant's ID.

**R8.9 MultipleSuccessorsFinding** — Raised per Resolution rules step (d) when more than
one non-coexisting claimant survives to that step. Payload: list of all surviving
claimant IDs.

**R8.10** *Removed (OrderMismatchFinding removed; forward-only chain traversal via
applicable successors guarantees strictly increasing effectiveFrom).*

---

### R9 — Boundary and calendar correctness

**R9.1** When a rule spans a leap day, the engine must accept it and count days correctly
across the Feb 28–Mar 1 boundary.
*Example: `effectiveFrom: "2028-02-28"`, `effectiveTo: "2028-03-01"`:
`effectiveTo − effectiveFrom` = 2 days; `"2028-02-29"` is a valid in-range date.*

**R9.2** When a year is not a leap year, `"YYYY-02-29"` is rejected as an invalid date
per R1.2. 2100 is NOT a leap year (divisible by 100, not by 400). 1900 is NOT a leap
year. 2000 IS a leap year (divisible by 400).
*Example: `"2027-02-29"` → `InvalidDateError`; `"2000-02-29"` → accepted.*

**R9.3** A same-day rule (effectiveFrom = effectiveTo = D₀) must behave as follows:
- D < D₀ → `NOT_YET_EFFECTIVE`.
- D = D₀ → `EXPIRING` (effectiveEnd − D = 0 days, satisfying ≤ N for any N ≥ 0).
- D > D₀ → `EXPIRED`.

**R9.4** *Removed (merged into R9.3).*

**R9.5** *Removed (merged into R9.3).*

**R9.6** The boundary year 1900 is valid. `"1900-01-01"` is accepted.
`"1899-12-31"` → `InvalidDateError` (year out of range).

**R9.7** The boundary year 2100 is valid. `"2100-12-31"` is accepted.
`"2101-01-01"` → `InvalidDateError` (year out of range).

**R9.8** The 1900–2100 restriction applies to **input** dates only. Derived boundary
dates computed internally (e.g. the day before `effectiveFrom`, the day after
`effectiveEnd`) may fall outside this range (such as `"1899-12-31"` or `"2101-01-01"`)
and must still be represented as correct `YYYY-MM-DD` strings. The engine must not
error when computing such derived dates.

---

### R10 — Determinism

**R10.1** The same rule, extensions, ruleset, query date, and threshold always produce
the same result.

**R10.2** Extensions provided in a different array order produce the same result after
the engine applies its defined ordering (ascending `issuedOn`, ties broken by ascending
`newEndDate` per R4.7).

**R10.3** Results and findings do not depend on the order of the ruleset array. Any
permutation of the ruleset array produces identical output including identical findings.

---

### R11 — API result contract

**R11.1** Every public function in the engine returns either:
- `{ ok: true, value: T, findings: Finding[] }` on success (findings may be non-empty
  even on success), or
- `{ ok: false, errors: EngineError[] }` when any input validation error is present.

**R11.2** All input validation errors across the entire ruleset, extensions list, query
date, and threshold are collected before returning. If any error exists, the engine
returns `{ ok: false, errors }` and computes no status, timeline, or chain (no partial
results are returned alongside errors).

**R11.3** The engine must not mutate any input (rules, extensions, findings arrays). All
returned objects are fresh values.

**R11.4** Status, timeline and chain functions return only the findings whose involved
IDs include the queried rule or any rule in the returned chain.

**R11.5** Findings in any result are sorted deterministically: by type name ascending,
then by involved IDs ascending, then by date range start ascending.

**R11.6** A `resolveRuleset` function resolves all links in the ruleset once and returns
the applicable successor for every rule plus ALL findings for the whole ruleset. The
`status`, `timeline`, and `chain` functions are defined in terms of its result; they do
not re-resolve links independently.

---

## Property candidates

The following statements describe contracts to be verified as property-based tests using
fast-check in a later step. They are listed here for traceability. Do not write tests yet.

**P1** For any valid rule and any date D:
- Returns `ACTIVE` or `EXPIRING` if and only if `effectiveFrom ≤ D` and (`effectiveEnd`
  is `null` or `D ≤ effectiveEnd`).
- D < `effectiveFrom` → `NOT_YET_EFFECTIVE`.
- D > `effectiveEnd` → `EXPIRED` or `SUPERSEDED` depending on whether an applicable
  successor exists and D ≥ successor's `effectiveFrom`.

**P2a** For any chain where every applied non-coexisting successor's `effectiveFrom`
equals its predecessor's `extendedEnd` plus one day, or the predecessor's `extendedEnd`
is `null`: the result contains no `UnexplainedGapFinding` and no `OverlapFinding`.

**P2b** For every applied non-coexisting pair: an `UnexplainedGapFinding` exists if and
only if `extendedEnd` is non-null and `extendedEnd + 1 < successor.effectiveFrom`; an
`OverlapFinding` exists if and only if `extendedEnd` is non-null and
`extendedEnd ≥ successor.effectiveFrom`.

**P3** For any rule and any extension E: applying E once and applying E twice produce
identical results.

**P4** For any rule's timeline: segments are contiguous, non-overlapping, cover all dates
(from −∞ to +∞), and for every date D the status returned by the lifecycle function
equals the `status` field of the unique segment whose range contains D.

**P5** For any rule and any permutation of a valid extension list: the resulting
`effectiveEnd` is the same regardless of input order.

**P6** For any rule, as D increases monotonically, the lifecycle status rank is
non-decreasing, where rank is:
`NOT_YET_EFFECTIVE (0) < ACTIVE (1) < EXPIRING (2) < EXPIRED (3) < SUPERSEDED (4)`.

**P7** Shuffling the ruleset array and the extensions array (independently or together)
gives identical results, including identical findings (after deterministic sorting per
R11.5).

**P8** For any generated ruleset — including rulesets whose declared links form cycles
— chain traversal terminates and `effectiveFrom` strictly increases along the returned
`order` array.
