---
inclusion: always
---

# Kaalchhaya — Product Steering

## What it is

Kaalchhaya (Sanskrit: "shadow of time") helps small exporters, freight forwarders and
chartered accountants see which trade rules and HS codes expire, change or get renumbered.
The core interaction is a **time slider** combined with a **product-by-rule view**: drag the
slider to any date and the radar shows which rules are live, which are sunsetting, and which
codes have been renumbered under that effective window.

## Users

- Small exporters who need to track which preferential schemes apply to their product lines.
- Freight forwarders managing compliance deadlines across multiple shipments.
- Chartered accountants advising clients on duty and classification changes.

## Visual states

| State | Meaning |
|-------|---------|
| **Ghost** | Expiring within 90 days — treat as a warning |
| **Ink** | Confirmed active, backed by a primary source |
| **Fog** | Unconfirmed — data exists but no primary source yet |
| **Ash** | Expired — no longer in effect |
| **Reborn** | Successor rule or renumbered HS code |

## Demo story

1. Upload 6 products with their current HS codes.
2. Drag the slider to **1 Jan 2028** — Ghost and Reborn states appear where codes change.
3. Drag to a real notice deadline — Ash states appear for expired rules.
4. Click a Ghost card to open the cited official source (the official notice).

## Display state precedence

Lifecycle (from dates) and confidence (from evidence) are separate inputs. The display state
is derived in this order:

1. Lifecycle is `EXPIRED` or `SUPERSEDED` → **Ash** (confidence is shown as a small secondary badge).
2. Else confidence is not `CONFIRMED` → **Fog** (show days-to-expiry in text if the rule has an end date).
3. Else the item is a successor rule or a renumbered HS code → **Reborn**.
4. Else lifecycle is `EXPIRING` → **Ghost**.
5. Else → **Ink**.

> `NOT_YET_EFFECTIVE` has no display state yet; it will be decided in the UI spec.

## Out of scope

- Live vessel or shipment tracking
- Geopolitical analysis or sanctions screening
- Billing, subscriptions or multi-tenancy
- Legal advice or a final HS classification determination
- Any feature that requires the LLM to be enabled in order to function correctly
