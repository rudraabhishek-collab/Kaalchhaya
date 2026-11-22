# Design — rule-validity-engine

## 1. Module layout

All files live under `src/core/rule-validity/`.

```
dates.ts    Pure civil-date arithmetic. No JS Date. No imports from this package.
errors.ts   EngineError and Finding union types plus constructors. Imports: nothing.
schema.ts   Zod schemas for Rule, Extension, options. Imports: errors.ts.
extend.ts   applyExtensions(). Imports: dates.ts, errors.ts.
resolve.ts  resolveRuleset(): claimant evaluation, extendedEnd, effectiveEnd.
            Imports: dates.ts, errors.ts, extend.ts.
status.ts   statusOn() point query. Imports: dates.ts, errors.ts, resolve.ts.
timeline.ts timelineFor() shape builder. Imports: dates.ts, errors.ts, status.ts,
            resolve.ts.
chain.ts    chainFor() forward walk. Imports: timeline.ts, resolve.ts, errors.ts.
index.ts    Re-exports public API. Imports: chain.ts, timeline.ts, status.ts,
            resolve.ts.
```

**Dependency order (no cycles):**
`index → chain → timeline → status → resolve → extend → dates`
`schema` and `errors` are leaves imported by any layer that needs them.

---

## 2. Date handling

**Representation:** Every date is an `integer day number` = days since the Unix epoch
(1970-01-01 = 0). Negative values reach back to 1900; values above ~47 000 reach 2100.
No `Date` object is ever constructed inside the engine. This satisfies R1.4 (no timezone
offset) and R9.8 (arithmetic on derived dates outside 1900–2100 is correct integer math).

**Boundary:** parse at input, format at output only.

**Signatures in `dates.ts`:**

```ts
// Parse "YYYY-MM-DD" → day number. Returns null if format is wrong,
// year out of [1900,2100], or calendar date is impossible. (R1.1–R1.3, R1.9)
function parseDate(s: unknown): number | null

// Format day number → "YYYY-MM-DD". Works for any integer, including
// values outside the 1900-2100 input range. (R9.8)
function formatDate(day: number): string

// True iff year y is a leap year (Gregorian). (R9.1, R9.2)
function isLeapYear(y: number): boolean

// Days from day a to day b (b - a). Both inclusive boundary math uses this.
function dayDiff(a: number, b: number): number

// Subtract n days from day d.
function subDays(d: number, n: number): number

// Add n days to day d.
function addDays(d: number, n: number): number
```

The civil-date algorithm converts (y, m, d) ↔ day number using the standard
proleptic Gregorian formula (no lookup tables, no `Date.UTC`).

---

## 3. Types and public API

```ts
// errors.ts
type EngineError =
  | { kind: "InvalidDateError";      input: unknown }
  | { kind: "InvalidRuleError";      ruleId: string; reason: string }
  | { kind: "DuplicateIdError";      id: string }
  | { kind: "InvalidExtensionError"; ruleId: string; newEndDate: string }
  | { kind: "InvalidThresholdError"; value: unknown }
  | { kind: "UnknownRuleError";      ruleId: string }

type Finding =
  | { kind: "BrokenLinkFinding";                    missingId: string; declaredIn: string }
  | { kind: "UnexplainedGapFinding";                predecessorId: string; successorId: string;
                                                    from: string; to: string }
  | { kind: "OverlapFinding";                       predecessorId: string; successorId: string;
                                                    from: string; to: string }
  | { kind: "InconsistentLinkFinding";              ruleId: string; reason: string }
  | { kind: "SuccessorPrecedesPredecessorFinding";  claimantId: string; predecessorId: string }
  | { kind: "MultipleSuccessorsFinding";            predecessorId: string; claimantIds: string[] }

type Result<T> =
  | { ok: true;  value: T; findings: Finding[] }
  | { ok: false; errors: EngineError[] }

// schema.ts (Zod)
type ISODateString = string   // branded; validated via parseDate()
type LifecycleStatus = "NOT_YET_EFFECTIVE"|"ACTIVE"|"EXPIRING"|"EXPIRED"|"SUPERSEDED"

interface Rule {
  id: string
  effectiveFrom: ISODateString
  effectiveTo:   ISODateString | null
  supersedes?:   string | null
  supersededBy?: string | null
  coexists?:     boolean
}

interface Extension {
  ruleId:     string
  newEndDate: ISODateString
  issuedOn:   ISODateString
}

interface Options { n?: number }   // threshold N; default 90

interface TimelineSegment {
  from:   ISODateString | null
  to:     ISODateString | null
  status: LifecycleStatus
}

interface ResolvedRuleset {
  // day-number maps for fast lookup
  extendedEnd:      Map<string, number | null>  // after extensions, before cap
  effectiveEnd:     Map<string, number | null>  // after cap
  applicableSucc:   Map<string, string | null>  // ruleId → successor id or null
  findings:         Finding[]                   // whole-ruleset findings
  byId:             Map<string, Rule>
}

interface ChainResult {
  order:     string[]
  timelines: Record<string, TimelineSegment[]>
  findings:  Finding[]
}

// Public API (index.ts)
function resolveRuleset(
  rules:      Rule[],
  extensions: Extension[],
  options?:   Options
): Result<ResolvedRuleset>                                // R11.6

function statusOn(
  rules:      Rule[],
  extensions: Extension[],
  ruleId:     string,
  date:       string,
  options?:   Options
): Result<LifecycleStatus>                                // R2.1

function timelineFor(
  rules:      Rule[],
  extensions: Extension[],
  ruleId:     string,
  options?:   Options
): Result<TimelineSegment[]>                              // R6.1

function chainFor(
  rules:      Rule[],
  extensions: Extension[],
  ruleId:     string,
  options?:   Options
): Result<ChainResult>                                    // R7.1
```

---

## 4. Algorithms

### 4.1 Input validation — `validateInputs()` (R11.2)

```
errors ← []
N ← options.n ?? 90
if not isSafeInteger(N) or N < 0 or N > 100000: errors.push(InvalidThresholdError) // R3.7
for each rule:
  if rule.id.trim() = "": errors.push(InvalidRuleError)                // R1.7
  if rule.supersedes="" or rule.supersededBy="": errors.push(InvalidRuleError) // R1.10
  validate rule.effectiveFrom, rule.effectiveTo (R1.1–R1.3, R1.9)
  if effectiveFrom > effectiveTo: errors.push(InvalidRuleError)        // R1.5
if duplicate ids: errors.push(DuplicateIdError)                        // R1.8
for each ext:
  if ext.ruleId not in byId: errors.push(UnknownRuleError)             // R4.8
  validate ext.newEndDate, ext.issuedOn                                // R4.6
if errors.length > 0: return { ok: false, errors }                     // R11.2
```

### 4.2 Extension application — `applyExtensions()` (R4, extend.ts)

```
for each rule:
  exts ← extensions where ruleId = rule.id
  dedup by (ruleId, newEndDate, issuedOn)                          // R4.3, R4.7
  sort by (issuedOn ASC, newEndDate ASC)                           // R4.2, R4.7
  running ← parse(rule.effectiveTo)                                // null = open-ended
  for each ext: running ← parse(ext.newEndDate)                   // R4.4 already caught
  extendedEnd[rule.id] ← running                                  // R4.1
```

### 4.3 Claimant resolution — `resolveRuleset()` (Resolution rules, resolve.ts)

```
findings ← []
for each rule A:
  claimants ← rules where r.supersedes = A.id
               ∪ { byId[A.supersededBy] } if A.supersededBy in byId

  // (a) contradicting own supersedes → InconsistentLinkFinding, discard
  // broken links → BrokenLinkFinding (declared ID absent from ruleset)
  // (b) C.effectiveFrom ≤ A.effectiveFrom → SuccessorPrecedesPredecessorFinding, discard
  // one-sided remaining links → InconsistentLinkFinding (naming omitting rule)
  // (c) coexisting = true → set aside, never compete or truncate
  // (d) >1 non-coexisting → MultipleSuccessorsFinding; pick earliest effectiveFrom (tie: id ASC)
  // (e) exactly 1 non-coexisting → applicable successor

  applicableSucc[A.id] ← applicable?.id ?? null
  xe ← extendedEnd[A.id]
  if applicable:
    cap ← parse(applicable.effectiveFrom) - 1
    effectiveEnd[A.id] ← (xe = null) ? cap : min(xe, cap)         // R5.2, R5.3
    if xe ≠ null:
      if xe + 1 < cap + 1: findings.push(UnexplainedGapFinding)   // R8.2
      if xe >= cap + 1:    findings.push(OverlapFinding)           // R8.3
  else:
    effectiveEnd[A.id] ← xe

sort findings by (kind ASC, ids ASC, dateRangeStart ASC)           // R11.5
```

### 4.4 Status function — `computeStatus()` (R2, R3, status.ts)

```
d ← parse(date)                       // already validated
from ← parse(rule.effectiveFrom)
e    ← effectiveEnd[rule.id]          // number | null
N    ← options.n ?? 90

if d < from:   return NOT_YET_EFFECTIVE                         // R2.2
if e = null:   return ACTIVE                                    // R2.6
if d > e:
  succ ← applicableSucc[rule.id]
  if succ not null and d >= parse(succ.effectiveFrom):
    return SUPERSEDED                                           // R2.7
  return EXPIRED                                               // R2.5, R2.10
// d in [from, e]:
if (e - d) <= N: return EXPIRING                               // R3.3, R2.4
return ACTIVE                                                  // R3.4
```

### 4.5 Timeline builder — `buildTimeline()` (R6, timeline.ts)

```
// Shapes from R6.6
from ← parse(rule.effectiveFrom)
e    ← effectiveEnd[rule.id]     // null | number
succ ← applicableSucc[rule.id]
N    ← options.n ?? 90
segments ← []

// Always-present first segment (R6.2)
segments.push({ from: null, to: formatDate(from - 1), status: NOT_YET_EFFECTIVE })

if e = null:                          // shape (a)
  segments.push({ from: formatDate(from), to: null, status: ACTIVE })
else:
  X ← max(from, e - N)               // R6.5
  if X > from:                        // ACTIVE segment exists
    segments.push({ from: formatDate(from), to: formatDate(X - 1), status: ACTIVE })
  segments.push({ from: formatDate(X), to: formatDate(e), status: EXPIRING })

  if succ = null:                     // shape (b)
    segments.push({ from: formatDate(e + 1), to: null, status: EXPIRED })
  else:                               // shape (c)
    s ← parse(succ.effectiveFrom)
    if e + 1 < s:                     // gap exists
      segments.push({ from: formatDate(e+1), to: formatDate(s-1), status: EXPIRED })
    segments.push({ from: formatDate(s), to: null, status: SUPERSEDED })

// Merge adjacent same-status segments (R6.1 canonical)
return merge(segments)
```

### 4.6 Chain walk — `chainFor()` (R7, chain.ts)

```
// Forward-only; termination guaranteed by R9.8 / Resolution rules note (P8)
visited ← Set { ruleId }
order   ← [ ruleId ]
cur     ← ruleId
loop:
  next ← applicableSucc[cur]
  if next = null or next in visited: break    // termination
  visited.add(next)
  order.push(next)
  cur ← next

timelines ← {}
for id in order: timelines[id] ← buildTimeline(id)

// Filter findings to those involving only rules in order (R11.4)
chainFindings ← resolved.findings.filter(f => f involves any id in order)
return { order, timelines, findings: chainFindings }
```

---

## 5. Traceability table

| Requirement | Implementing function | Planned test file |
|---|---|---|
| R1.1–R1.9 | `validateInputs` | `tests/unit/dates.test.ts` |
| R1.10 | `validateInputs` | `tests/unit/dates.test.ts` |
| R2.2–R2.10 | `computeStatus` | `tests/unit/status.test.ts` |
| R3.1–R3.7 | `computeStatus`, `validateInputs` | `tests/unit/status.test.ts` |
| R4.1–R4.8 | `applyExtensions`, `validateInputs` | `tests/unit/extend.test.ts` |
| R5.1–R5.6 | `resolveRuleset` | `tests/unit/resolve.test.ts` |
| R6.1–R6.6 | `buildTimeline` | `tests/unit/timeline.test.ts` |
| R7.1–R7.3 | `chainFor` | `tests/unit/chain.test.ts` |
| R8.1–R8.9 | `resolveRuleset` | `tests/unit/resolve.test.ts` |
| R9.1–R9.8 | `parseDate`, `formatDate` | `tests/unit/dates.test.ts` |
| R10.1–R10.3 | all (determinism is structural) | `tests/props/determinism.test.ts` |
| R11.1–R11.6 | `resolveRuleset`, all public fns | `tests/unit/api.test.ts` |
| P1–P9 | `statusOn`, `timelineFor` | `tests/props/` |

---

## 6. Correctness properties

**P1** For any valid rule and date D: `ACTIVE`/`EXPIRING` iff `from ≤ D ≤ e` (or `e` null); `NOT_YET_EFFECTIVE` iff `D < from`; `EXPIRED`/`SUPERSEDED` iff `D > e`.
*Validates: R2.2–R2.10, R3.3, R3.4*

**P2a** For any chain where every non-coexisting successor starts at `extendedEnd + 1` (or predecessor is open-ended): no `UnexplainedGapFinding`, no `OverlapFinding`.
*Validates: R8.2, R8.3*

**P2b** For every non-coexisting pair: gap finding iff `extendedEnd + 1 < succ.from`; overlap finding iff `extendedEnd ≥ succ.from`.
*Validates: R8.2, R8.3*

**P3** Applying extension E twice gives same result as once.
*Validates: R4.3, R4.7*

**P4** Timeline segments are contiguous, non-overlapping, cover all dates; `statusOn(D)` = segment containing D.
*Validates: R6.1–R6.6, R2*

**P5** Any permutation of the extensions list gives the same `effectiveEnd`.
*Validates: R4.2, R4.7, R10.2*

**P6** Status rank is non-decreasing as D increases.
*Validates: R2, R3*

**P7** Any permutation of the ruleset array gives identical output including findings.
*Validates: R10.3, R11.5*

**P8** Chain traversal terminates; `effectiveFrom` strictly increases along `order`.
*Validates: Resolution rules termination note, R7.1*

**P9** For any rule over a 2-day-step window, `timelineFor` agrees with a brute-force oracle in `tests/props/oracle.ts`. The oracle calls `statusOn` day by day independently of `buildTimeline`. They share only `dates.ts` helpers.
*Validates: R6.4, R2.1, consistency between statusOn and timelineFor*

---

## 7. Test strategy

**Generators** (`tests/props/generators.ts`):

- **Date window:** `2026-01-01` to `2030-12-31` as the compact window (gaps and overlaps
  are frequent); boundary dates `1900-01-01`, `2000-02-29`, `2100-12-31` and leap days
  are sampled separately.
- **Rulesets:** 0–8 rules; include dangling links (ID not in set), one-sided links,
  contradicting links (C.supersedes ≠ A.id via A.supersededBy), self-links, and
  rulesets whose declared links form cycles before the Resolution rules discard them.
- **Extensions:** same-`issuedOn` collisions; exact duplicate records; `newEndDate`
  moving end earlier; `newEndDate = effectiveFrom` (same-day result).
- **N values:** sampled from `{0, 1, 89, 90, 91, 100000}` plus arbitrary safe integers.

**Six deliberate bugs the tests must catch:**

1. **Off-by-one on `≤`** — using `<` instead of `≤` in `(e - d) <= N` returns `ACTIVE`
   on the last day of the EXPIRING window (breaks R3.3, P1).
2. **Wrong extension order** — sorting by `newEndDate` before `issuedOn` causes the
   wrong final end date when two extensions have different `issuedOn` values (breaks R4.2, P5).
3. **Truncating a coexisting predecessor** — applying the successor cap when
   `coexists = true` shrinks `effectiveEnd` incorrectly (breaks R5.6, P2a).
4. **Skipping de-duplication** — applying a duplicate extension record twice moves the
   end date to the wrong value when the duplicate is not the last in sort order (breaks R4.3, P3).
5. **Local-timezone arithmetic** — using `new Date(str).getTime()` for day arithmetic
   causes off-by-one errors in UTC-offset environments (breaks R1.4, P4).
6. **Omitting the gap segment** — returning `SUPERSEDED` immediately after `EXPIRING`
   without an `EXPIRED` gap segment makes `timelineFor` and `statusOn` disagree for dates
   in the gap (breaks R6.3, P4, P9).

---

## 8. Edge-case table

| Case | Expected behaviour | Requirement |
|---|---|---|
| Empty ruleset (`rules = []`) | `resolveRuleset` succeeds with empty maps and no findings | R11.1 |
| Unknown `ruleId` in `statusOn` | `{ ok: false, errors: [InvalidRuleError] }` | R1.7, R11.2 |
| Unknown `ruleId` in `timelineFor` | Same as above | R1.7, R11.2 |
| `options` omitted | N defaults to 90 | R3.1 |
| Huge N (100 000) | Entire in-scope period is EXPIRING if duration ≤ N; otherwise ACTIVE then EXPIRING | R3.5 |
| Query date outside 1900–2100 | `{ ok: false, errors: [InvalidDateError] }` | R1.1, R9.6, R9.7 |

---

## 9. Out of scope

Confidence levels, display states (Ghost/Ink/Fog/Ash/Reborn), file I/O, network calls,
and any UI code are outside this module. See the product and design-language steering
files for those concerns.

---

## Contradictions and gaps found in requirements.md

1. **R8.2 and open-ended predecessors.** R8.2 fires only when `extendedEnd` is not null.
   An open-ended predecessor truncated by a non-coexisting successor gets
   `effectiveEnd = succ.from − 1` but `extendedEnd = null`, so R8.2 never fires for it.
   That means an open-ended predecessor with a gap produces no `UnexplainedGapFinding`.
   This may be intentional (open-ended predecessors are always "tight" after truncation)
   but it is not stated explicitly in the requirements.

2. **R11.4 scope for `resolveRuleset`.** R11.6 says `resolveRuleset` returns ALL findings
   for the whole ruleset. R11.4 says status/timeline/chain return only findings for
   involved IDs. There is no explicit statement about what `resolveRuleset` returns vs
   what the wrapper functions filter — the design treats `resolveRuleset` as the full-set
   source and the other functions as filtered views, which is consistent but implicit.

3. **`ruleId` passed to `statusOn`/`timelineFor` is not in the ruleset.** R2.1 requires
   "a valid ruleset … and rule id". The requirements say empty IDs are `InvalidRuleError`
   (R1.7) but do not explicitly address a non-empty ID that simply is not present in the
   provided ruleset. The edge-case table above treats this as `InvalidRuleError`; a
   `BrokenLinkFinding` could also be argued.
