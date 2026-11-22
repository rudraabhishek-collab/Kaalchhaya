---
inclusion: always
---

# Evidence Policy

## Hard rules

1. **Source required for every claim.** Never state a legal effect, duty rate, effective date,
   notice number or scheme status without a source URL and an evidence ID (format EV-001,
   EV-002, ...). A claim with no source at all is not shown. A claim supported only by
   secondary sources is shown in the **Fog** state.

2. **No knowledge-base data.** You must NEVER supply rule dates, notice numbers, HS code
   mappings, tariff rates or scheme statuses from your own training knowledge. All such data
   comes exclusively from files under `data/` (rules, hs, evidence sub-folders). If the file
   does not exist, say so.

3. **Confirmation threshold.** A claim is CONFIRMED (Ink state) only when at least one primary
   source — an official gazette, a notice from the issuing authority (for Indian trade rules:
   DGFT, CBIC, Gazette of India, Ministry of Commerce), the WCO's published HS correlation
   tables for code mappings, or an equivalent government publication — directly supports it.
   Secondary sources (news, commentary, trade blogs) can corroborate but cannot alone confirm.

4. **Last-verified date.** Every output that includes rule or HS data must display a
   `last-verified` date drawn from the evidence record. Never omit it.

5. **Short summaries only.** Store our own brief summaries of official text (one to three
   sentences). Never store or reproduce long verbatim passages from official sources.

6. **No legal advice, no final classification.** The product never gives legal advice or issues
   a final HS classification. Where the user needs a binding opinion, the UI must say:
   > "This requires review by a licensed customs professional."

7. **Surface conflicts and gaps.** When sources conflict with each other, or when no source
   covers a claim, say so plainly in the UI and in any generated output. Do not silently
   pick one source or paper over a gap.

## Phrasing uncertainty

Use plain, graduated language — never hedge so softly that the uncertainty disappears,
and never overstate confidence.

| Situation | Preferred phrasing |
|-----------|-------------------|
| Single primary source | "Confirmed by [source], last verified [date]." |
| Secondary source only | "Reported by [source] — not yet confirmed by a primary source." |
| Conflicting sources | "Sources conflict: [A] states X; [B] states Y. Needs resolution." |
| No source at all | "No source on file. Treat as unconfirmed until a primary source is added." |
| Data older than 90 days | "Source last verified [date]. May be stale — re-verify before relying on this." |

Avoid: "it appears", "it seems", "likely", "probably" without a reason. If you are
uncertain, say *why* you are uncertain and what would resolve it.
