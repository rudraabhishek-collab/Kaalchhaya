---
inclusion: always
---

# Tech Steering

## Stack

| Layer | Choice |
|-------|--------|
| Framework | Next.js 16 App Router |
| UI runtime | React 19 |
| Language | TypeScript — `strict: true`, no `any`, no `@ts-ignore` |
| Styling | Tailwind v4 — CSS-first, no `tailwind.config` file |
| Validation | Zod v3 API (`z.object`, `.parse`, `.safeParse`) |
| Runtime | Node 24 |
| Test runner | Vitest |
| Property testing | fast-check |

## Architecture rules

- **Pure core.** All business logic lives in `src/core/`. Files there must have zero UI
  imports (`react`, `next/*`, JSX) and zero network calls. They are plain TypeScript
  functions that take data and return data.
- **Dates as UTC ISO strings.** Represent every date as an ISO 8601 string
  (`"2028-01-01"`). Compare dates by converting to `Date` objects in UTC — never rely on
  local timezone arithmetic or string comparison. Dates are date-only strings in YYYY-MM-DD
  format and must be real calendar dates (reject `2026-02-30`). Validate with Zod.
- **Zod at every data boundary.** Parse and validate with Zod whenever data crosses a
  trust boundary: file reads from `data/`, API responses, user uploads, URL params.
  Never pass raw `unknown` or `any` into core logic.
- **LLM-off baseline.** The app must fully work with the LLM disabled. No feature may be
  gated solely behind an AI call. AI features are progressive enhancements only.
- **UI component location.** UI components live in `src/app/_components`. All UI code lives
  under `src/app`.

## Testing rules

- Tests must exercise real behavior. A test that only imports a module, or that asserts
  something trivially true (e.g. `expect(1).toBe(1)`), will be rejected in review.
- Any change to logic in `src/core/` requires at least one property-based test using
  fast-check.
- When a property test fails, fix the **implementation**, not the test. The test encodes
  a contract; shrink the counterexample to understand it, then fix the code.
- Unit tests live in `tests/` mirroring the `src/` structure. Property tests live in
  `tests/props/`.
- Test names and `describe` blocks must include the requirement ID (for example `R1.2`) or
  property ID (for example `P3`) they verify.

## npm scripts

| Script | Command |
|--------|---------|
| `test` | `vitest run` |
| `test:props` | `vitest run tests/props` |
| `lint` | `eslint src` |
| `typecheck` | `tsc --noEmit` |
| `build` | `next build` |
