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
| `id` | `string` | Non-empty, unique within a ruleset |
| `effectiveFrom` | `ISODateString` | Inclusive start date |
| `effectiveTo` | `ISODateString \| null` | Inclusive declared end date; `null` means open-ended |
| `supersedes` | `string \| null` | ID of the rule this one replaces |
| `supersededBy` | `string \| null` | ID of the rule that replaces this one |
| `coexists` | `boolean` | Optional, defaults to `false`. Read from the **successor** rule. |

An **Extension** record has:

| Field | Type | Notes |
|---|---|---|
| `ruleId` | `string` | The rule whose end date is being modified |
| `newEndDate` | `ISODateString` | The new inclusive end date (may be earlier or later than current) |
| `issuedOn` | `ISODateString` | Determines application order |

A **TimelineSegment** has:
`{ from: ISODateString | null, to: ISODateString | null, status: LifecycleStatus }`

- `from: null` means the segment extends infinitely into the past.
- `to: null` means the segment extends infinitely into the future.

**LifecycleStatus** values: `NOT_YET_EFFECTIVE`, `ACTIVE`, `EXPIRING`, `EXPIRED`, `SUPERSEDED`.

A **ChainResult** has:
`{ order: string[], timelines: Record<ruleId, TimelineSegment[]>, findings: Finding[] }`

**Finding** types: `BrokenLinkFinding`, `UnexplainedGapFinding`, `OverlapFinding`,
`CycleFinding`, `InconsistentLinkFinding`, `SuccessorPrecedesPredecessorFinding`,
`MultipleSuccessorsFinding`, `OrderMismatchFinding`.

**Typed error** types: `InvalidDateError`, `InvalidRuleError`, `InvalidExtensionError`,
`InvalidThresholdError`, `DuplicateIdError`, `UnknownRuleError`.

---

## Effective end

`effectiveEnd` is the computed inclusive end date used in all lifecycle and timeline
calculations. It is derived in this order:

1. Start from the rule's declared `effectiveTo`.
2. Apply extensions (per R4): replace the running end date with each extension's
   `newEndDate`, applied in ascending `issuedOn` order (ties broken by ascending
   `newEndDate`). After this step the result is the **extended end** (may be `null` if
   the rule is open-ended and no extension has been applied).
3. If an applicable successor exists (per R5), set `effectiveEnd` to the earlier of:
   the extended end (if not `null`) and the day before the successor's `effectiveFrom`.
   If the extended end is `null` (open-ended), `effectiveEnd` = the day before the
   successor's `effectiveFrom`.

`effectiveEnd` is `null` only if the rule is open-ended after extensions **and** has no
applicable successor.

This computed value is used wherever `effectiveEnd` is referenced in R2 through R8.

---

## Requirements

### R1 — Date string validation

**R1.1** When the engine receives a date string, it must accept strings that conform to
`YYYY-MM-DD`, represent a real calendar date, and whose year is in the range 1900–2100
inclusive.
*Example: `"2026-03-15"` is accepted.*

**R1.2** When the engine receives a date string that is syntactically valid `YYYY-MM-DD`
but represents an impossible date (e.g. a month-day combination that does not exist in
that year), it must return a typed `InvalidDateError` and must not throw.
*Example: `"2026-02-30"` returns `InvalidDateError`.*

**R1.3** When the engine receives a date string that does not match exactly the
`YYYY-MM-DD` format — including strings with a time part, timezone offset, or any
surrounding whitespace — it must return a typed `InvalidDateError` and must not throw.
*Example: `"26-3-2026"`, `"2026/03/15"`, `"2026-03-15T00:00:00Z"`,
`" 2026-03-15"` all return `InvalidDateError`.*

**R1.4** When comparing two valid date strings, the engine must treat both as UTC
midnight dates and must not apply any local-timezone offset.

**R1.5** When a rule has `effectiveTo` that is earlier than `effectiveFrom`, the engine
must return a typed `InvalidRuleError` and must not throw.
*Example: rule with `effectiveFrom: "2027-01-01"`, `effectiveTo: "2026-12-31"` returns
`InvalidRuleError`.*

**R1.6** When a rule has `effectiveFrom` equal to `effectiveTo`, the engine must accept
it as a valid single-day rule.
*Example: rule with `effectiveFrom: "2027-06-15"`, `effectiveTo: "2027-06-15"` is valid.*

**R1.7** When a rule has an empty string as its `id`, the engine must return a typed
`InvalidRuleError` and must not throw.

**R1.8** When a ruleset contains two or more rules with the same `id`, the engine must
return a typed `DuplicateIdError` and must not throw.

---

### R2 — Lifecycle status for a single rule

**R2.1** When a valid rule and a query date D are provided, the engine must return exactly
one of: `NOT_YET_EFFECTIVE`, `ACTIVE`, `EXPIRING`, `EXPIRED`, or `SUPERSEDED`.

**R2.2** When D < `effectiveFrom`, the engine must return `NOT_YET_EFFECTIVE`.
*Example: rule `effectiveFrom: "2027-01-01"`, query date `"2026-12-31"` →
`NOT_YET_EFFECTIVE`.*

**R2.3** When D equals `effectiveFrom` and the rule has not expired or been superseded,
the engine must return `ACTIVE` or `EXPIRING` (whichever applies per R3).
*Example: rule `effectiveFrom: "2027-01-01"`, `effectiveTo: "2027-12-31"`, query date
`"2027-01-01"` → `ACTIVE` (364 days remain, above default N=90).*

**R2.4** When D equals `effectiveEnd` and the rule has not been superseded, the engine
must return `EXPIRING` (0 days remain, which satisfies (effectiveEnd − D) ≤ N for any
N ≥ 0).
*Example: rule `effectiveEnd: "2027-12-31"`, query date `"2027-12-31"` → `EXPIRING`.*

**R2.5** When D is strictly after `effectiveEnd` and no applicable successor exists, the
engine must return `EXPIRED`.
*Example: rule `effectiveEnd: "2027-12-31"`, query date `"2028-01-01"` → `EXPIRED`.*

**R2.6** When a rule is open-ended after extensions and has no applicable successor
(`effectiveEnd` is `null`), the engine must never return `EXPIRING` and must return
`ACTIVE` for any D ≥ `effectiveFrom`.

**R2.7** When D is strictly after `effectiveEnd` and an applicable successor exists whose
`effectiveFrom` ≤ D, the engine must return `SUPERSEDED`.

**R2.8** When D is exactly one day before `effectiveFrom`, the engine must return
`NOT_YET_EFFECTIVE`.
*Example: `effectiveFrom: "2027-01-01"`, query date `"2026-12-31"` →
`NOT_YET_EFFECTIVE`.*

**R2.9** When D is exactly one day after `effectiveEnd` and no applicable successor
exists, the engine must return `EXPIRED`.
*Example: `effectiveEnd: "2027-12-31"`, query date `"2028-01-01"` → `EXPIRED`.*

**R2.10** When D is strictly after `effectiveEnd` but strictly before the successor's
`effectiveFrom` (a gap day), the engine must return `EXPIRED`.
*Example: predecessor `effectiveEnd: "2027-12-31"`, successor `effectiveFrom:
"2028-02-01"`, query date `"2028-01-15"` → `EXPIRED`.*

---

### R3 — EXPIRING threshold

**R3.1** When no explicit threshold is provided, the engine must use a default threshold
of N = 90 days.

**R3.2** When an explicit threshold N is provided, the engine must use it in place of the
default.

**R3.3** When `effectiveFrom ≤ D ≤ effectiveEnd` and `effectiveEnd` is not `null`, the
engine must return `EXPIRING` if and only if `(effectiveEnd − D)` in whole UTC days is
≤ N. Otherwise it must return `ACTIVE`.
*Example: N=90, `effectiveEnd: "2027-03-31"`, query date `"2027-01-01"` →
effectiveEnd − D = 89 days → `EXPIRING`.*

**R3.4** When the number of days remaining exceeds N, the engine must return `ACTIVE`.
*Example: N=90, `effectiveEnd: "2027-12-31"`, query date `"2027-01-01"` →
effectiveEnd − D = 364 days → `ACTIVE`.*

**R3.5** When a rule's total in-scope duration (`effectiveEnd − effectiveFrom`) ≤ N days,
the entire in-scope period is `EXPIRING`; the `EXPIRING` segment starts at `effectiveFrom`
(it does not start before it). The EXPIRING segment in the timeline is
`[effectiveFrom, effectiveEnd]`.

**R3.6** When N is set to 0, the engine must return `EXPIRING` only on `effectiveEnd`
itself, and `ACTIVE` on all earlier in-scope dates.

**R3.7** When N is not a non-negative integer (e.g. negative, non-integer, or not a
number), the engine must return a typed `InvalidThresholdError` and must not throw.

---

### R4 — Extensions

**R4.1** When an extension is applied to a rule, the engine must replace the rule's
running end date with the extension's `newEndDate` for all subsequent calculations.

**R4.2** When multiple extensions apply to the same rule, the engine must apply them in
ascending `issuedOn` order. Extensions are applied before supersession is computed.

**R4.3** When the same extension record is applied twice (identical `ruleId`,
`newEndDate`, and `issuedOn`), the result must be identical to applying it once
(idempotent).

**R4.4** When an extension's `newEndDate` is strictly earlier than the rule's
`effectiveFrom`, the engine must return a typed `InvalidExtensionError` and must not
apply the extension.

**R4.5** When an extension's `newEndDate` equals the rule's `effectiveFrom`, the engine
must accept it (the extended rule becomes a same-day rule, which is valid per R1.6).

**R4.6** When an extension's `issuedOn` date is itself invalid per R1, the engine must
return `InvalidDateError`.

**R4.7** When two or more extensions for the same rule share the same `issuedOn` date,
the engine must apply them in ascending `newEndDate` order among themselves so that the
largest `newEndDate` is applied last. Duplicate records (identical `ruleId`, `newEndDate`,
and `issuedOn`) must be de-duplicated before ordering, so each unique record is applied
exactly once.

**R4.8** When an extension references a `ruleId` that does not exist in the provided
ruleset, the engine must return a typed `UnknownRuleError` and must not apply the
extension.

**R4.9** An extension may move `effectiveEnd` either later or earlier than the current
value, subject to R4.4 (it may never move it before `effectiveFrom`). Extensions are
always applied before supersession is computed (per the "Effective end" section).

---

### R5 — Supersession

**R5.1** Supersession applies when at least one side of the link is declared and the
referenced rule exists in the ruleset. Specifically:
- If successor B declares `supersedes: A` **and** predecessor A declares `supersededBy: B`,
  the link is fully consistent.
- If only one side declares the link and the other rule exists, the link is applied and an
  `InconsistentLinkFinding` is added (see R8.7).
- If the referenced ID does not exist in the ruleset, a `BrokenLinkFinding` is added and
  supersession is not applied (per R8.1).

**R5.2** When supersession applies, the predecessor's `effectiveEnd` is computed per the
"Effective end" section: the extended end is capped at the day before the successor's
`effectiveFrom`. If the predecessor is open-ended after extensions, its `effectiveEnd`
becomes the day before the successor's `effectiveFrom`.
*Example: predecessor extended end `"2028-06-30"`, successor `effectiveFrom: "2028-04-01"`
→ predecessor `effectiveEnd` = `"2028-03-31"`.*

**R5.3** When the predecessor is open-ended after extensions (`effectiveTo` is `null` and
no extension has set a later end), the engine must set the predecessor's `effectiveEnd`
to the day before the successor's `effectiveFrom`.
*Example: successor `effectiveFrom: "2028-04-01"` → predecessor `effectiveEnd` =
`"2028-03-31"`.*

**R5.4** When D ≥ successor's `effectiveFrom` and D > predecessor's `effectiveEnd`, the
engine must return `SUPERSEDED` for the predecessor (per R2.7).

**R5.5** When D ≤ predecessor's `effectiveEnd`, the engine must not return `SUPERSEDED`
for the predecessor, regardless of the successor's existence.

**R5.6** `coexists` is read from the **successor** rule (the rule that declares
`supersedes`). When `successor.coexists` is `true`:
- The predecessor is **not** truncated; its `effectiveEnd` is computed without the
  successor cap.
- The predecessor never receives `SUPERSEDED` status from this successor.
- No `OverlapFinding` is raised for this pair.

**R5.7** When `successor.effectiveFrom` ≤ `predecessor.effectiveFrom`, the engine must
add a `SuccessorPrecedesPredecessorFinding` and must **not** apply supersession for this
pair.

**R5.8** When two or more rules claim to supersede the same predecessor, the engine must
add a `MultipleSuccessorsFinding`. It must then apply the successor with the earliest
`effectiveFrom` (ties broken by ascending `id`), and ignore the remaining claimants for
the purpose of computing the predecessor's `effectiveEnd`.

---

### R6 — Timeline for a single rule

A timeline covers **all** dates — from negative infinity to positive infinity — using
`from: null` for the unbounded-past sentinel and `to: null` for the unbounded-future
sentinel.

**R6.1** The engine must return a list of `TimelineSegment` records that is:
- **Sorted** by `from` (treating `null` as −∞).
- **Non-overlapping**: no date belongs to two segments.
- **Contiguous**: the day after one segment's `to` equals the next segment's `from`
  (treating `null` appropriately at boundaries).
- **Canonical**: adjacent segments with the same status are merged into one.

**R6.2** The first segment must have `from: null` and status `NOT_YET_EFFECTIVE`
(covering all dates before `effectiveFrom`). If `effectiveFrom` is the beginning of the
representable range this segment collapses and is omitted.

**R6.3** The last segment must have `to: null`. Its status is:
- `ACTIVE` if the rule is open-ended with no applicable successor.
- `SUPERSEDED` if the rule was superseded and `coexists` is `false`.
- `EXPIRED` if the rule has a fixed `effectiveEnd` and no applicable successor, or if
  there is a gap between the rule's end and the successor's start.

**R6.4** For every date D, the status returned by the lifecycle function must equal the
`status` of the unique segment whose range contains D.

**R6.5** The EXPIRING segment, when present, starts at
`max(effectiveFrom, effectiveEnd − N days)` and ends at `effectiveEnd`.

**R6.6** Canonical timeline shapes (segments with zero length are omitted):

| Scenario | Segment sequence |
|---|---|
| Open-ended, no successor | `NOT_YET_EFFECTIVE(null→d-1)`, `ACTIVE(d→null)` |
| Fixed end, no successor | `NOT_YET_EFFECTIVE(null→d-1)`, `ACTIVE(d→e-N-1)`, `EXPIRING(e-N→e)`, `EXPIRED(e+1→null)` |
| Superseded, no gap | `NOT_YET_EFFECTIVE(null→d-1)`, `ACTIVE(d→s-N-1)`, `EXPIRING(s-N→s-1)`, `SUPERSEDED(s→null)` |
| Superseded, with gap | `NOT_YET_EFFECTIVE(null→d-1)`, `ACTIVE(d→e-N-1)`, `EXPIRING(e-N→e)`, `EXPIRED(e+1→s-1)`, `SUPERSEDED(s→null)` |

Where `d` = `effectiveFrom`, `e` = `effectiveEnd`, `s` = successor's `effectiveFrom`,
`N` = threshold. Segments whose range would be empty are omitted. When
`effectiveEnd − effectiveFrom ≤ N`, the ACTIVE segment is omitted and the EXPIRING
segment starts at `effectiveFrom`.

---

### R7 — Chain timeline

**R7.1** When a chain is requested for any rule in the chain, the engine must:
1. Walk `supersedes` links backwards to find the root (the rule with no applicable
   predecessor in the ruleset).
2. Walk `supersededBy` links forward from the root to collect all rules.
3. The `order` array in `ChainResult` reflects this link order.
4. If the link order and ascending-`effectiveFrom` order disagree for any pair of
   adjacent rules, add an `OrderMismatchFinding`.

**R7.2** The chain result is:
```
{ order: string[], timelines: Record<ruleId, TimelineSegment[]>, findings: Finding[] }
```
Each rule's entry in `timelines` is that rule's own full individual timeline (as produced
by R6). Timelines are **not** stitched together into one merged timeline.

**R7.3** When a chain is requested for a rule that has no `supersededBy` and no
`supersedes`, the engine must return a chain with one entry in `order` and one timeline.

**R7.4** When a cycle is detected — including self-supersession (a rule where
`supersedes` equals its own `id`) — the engine must add a `CycleFinding` listing the
cycle's IDs, stop traversal, and must not recurse infinitely.

---

### R8 — Chain validation findings

Findings are typed values in the `findings` array on the result object. None of them
cause the engine to throw. The engine must not stop at the first finding; all applicable
findings for a chain are collected.

**R8.1** When a `supersedes` or `supersededBy` ID refers to a rule not present in the
provided ruleset, the engine must add a `BrokenLinkFinding` naming the missing ID.

**R8.2** When the predecessor's `effectiveEnd` plus one day is strictly before the
successor's `effectiveFrom`, and `successor.coexists` is not `true`, the engine must add
an `UnexplainedGapFinding` specifying the gap range `[predecessor.effectiveEnd + 1,
successor.effectiveFrom − 1]`.

**R8.3** When supersession applies (`successor.coexists` is `false`) and the
predecessor's extended declared end (after extensions, before the successor cap) is not
`null` and is on or after the successor's `effectiveFrom`, the engine must add an
`OverlapFinding` specifying the overlap range. A superseded open-ended predecessor (whose
extended declared end is `null`) does **not** trigger an `OverlapFinding`.

**R8.4** When a cycle is detected, the engine must add a `CycleFinding` listing the IDs
involved and stop traversal.

**R8.5** When `successor.coexists` is `true`, the engine must skip both the
`OverlapFinding` check (R8.3) and the `UnexplainedGapFinding` check (R8.2) for that
successor–predecessor pair.

**R8.6** When multiple findings of different types apply to the same chain, all must
appear in the `findings` array.

**R8.7** When only one side of a supersession link is declared and the referenced rule
exists, the engine must add an `InconsistentLinkFinding` naming the rule that omitted the
back-link, and must still apply supersession.

**R8.8** When `successor.effectiveFrom` ≤ `predecessor.effectiveFrom`, the engine must
add a `SuccessorPrecedesPredecessorFinding` and must not apply supersession for that pair.

**R8.9** When two or more rules claim to supersede the same predecessor, the engine must
add a `MultipleSuccessorsFinding` listing all claimants, then apply the one with the
earliest `effectiveFrom` (ties broken by ascending `id`).

---

### R9 — Boundary and calendar correctness

**R9.1** When a rule spans a leap day, the engine must accept it and must count days
correctly across the Feb 28–Mar 1 boundary.
*Example: rule `effectiveFrom: "2028-02-28"`, `effectiveTo: "2028-03-01"`:
`effectiveTo − effectiveFrom` = 2 days; `"2028-02-29"` is a valid date and falls
within the rule's range.*

**R9.2** When a year is not a leap year, `"YYYY-02-29"` must be rejected as an invalid
date per R1.2.
*Example: `"2027-02-29"` → `InvalidDateError`. Note: 2100 is NOT a leap year (divisible
by 100 but not 400); 1900 is NOT a leap year; 2000 IS a leap year.*

**R9.3** When a same-day rule is queried on its single valid date, the engine must return
`EXPIRING` (effectiveEnd − D = 0, which satisfies ≤ N for any N ≥ 0).

**R9.4** When a same-day rule is queried on the day before `effectiveFrom`, the engine
must return `NOT_YET_EFFECTIVE`.

**R9.5** When a same-day rule is queried on the day after `effectiveTo`, the engine must
return `EXPIRED`.

**R9.6** The boundary year 1900 must be accepted as a valid year. `"1900-01-01"` is a
valid date. `"1899-12-31"` returns `InvalidDateError` (year 1899 is out of range).

**R9.7** The boundary year 2100 must be accepted. `"2100-12-31"` is a valid date.
`"2101-01-01"` returns `InvalidDateError` (year 2101 is out of range).

---

### R10 — Determinism

**R10.1** When the engine is called with the same rule, the same extensions, the same
ruleset, and the same query date, it must return the same result on every call.

**R10.2** When the engine is called with extensions provided in a different array order,
the result must be the same after the engine applies its defined ordering (ascending
`issuedOn`, ties broken by ascending `newEndDate` per R4.7).

---

## Property candidates

The following statements describe contracts to be verified as property-based tests using
fast-check in a later step. They are listed here for traceability. Do not write tests yet.

**P1** For any valid rule and any date D:
- The engine returns `ACTIVE` or `EXPIRING` if and only if
  `effectiveFrom ≤ D` and (`effectiveEnd` is `null` or `D ≤ effectiveEnd`).
- D before `effectiveFrom` → `NOT_YET_EFFECTIVE`.
- D after `effectiveEnd` → `EXPIRED` or `SUPERSEDED` (depending on whether an applicable
  successor exists and D ≥ successor's `effectiveFrom`).

**P2a** For any chain constructed such that each successor's `effectiveFrom` equals the
predecessor's `effectiveEnd` plus one day, the chain produces no `UnexplainedGapFinding`
and no `OverlapFinding`.

**P2b** For any chain, an `UnexplainedGapFinding` is present in the findings if and only
if a gap (at least one day) exists between a predecessor's `effectiveEnd` and its
successor's `effectiveFrom`.

**P3** For any rule and any extension E: applying E once and applying E twice to the same
rule produce identical results (idempotent).

**P4** For any rule's timeline: segments are contiguous, non-overlapping, cover all dates
(the union of all segment ranges is all dates), and for every date D the status returned
by the lifecycle function equals the `status` field of the unique segment whose range
contains D.

**P5** For any rule and any permutation of a valid extension list: the resulting
`effectiveEnd` is the same regardless of the order in which the extensions are passed in.

**P6** For any rule, as D increases monotonically, the lifecycle status rank is
non-decreasing, where rank is defined as:
`NOT_YET_EFFECTIVE (0) < ACTIVE (1) < EXPIRING (2) < EXPIRED (3) < SUPERSEDED (4)`.
