---
inclusion: fileMatch
fileMatchPattern: "src/app/**"
---

# Design Language

## Atmosphere

Ink and parchment with a faint haunted feel. The UI is **readable first** — the atmosphere
is a texture, never a distraction. Dark theme by default. No decorative animations that
interfere with scanning data.

## Visual states

### Ghost — expiring within 90 days
- Apply reduced opacity to the background, border and decoration only. Text must always keep
  at least 4.5:1 contrast against its actual rendered background, including during the flicker
  animation.
- Soft violet tint (`oklch(0.65 0.12 290)` or equivalent)
- Slow, subtle flicker animation (opacity oscillates ±0.1 over 3 s)
- Icon: a fading circle with a clock hand
- Text label: **"Expiring soon"**
- `prefers-reduced-motion`: remove flicker, keep low opacity and violet tint

### Ink — confirmed active
- Full opacity, high contrast
- Near-white on dark background (`oklch(0.95 0.02 90)`)
- Small seal icon (filled circle with a checkmark)
- Text label: **"Confirmed"**
- No animation

### Fog — unconfirmed
- Blurred edge (CSS `filter: blur(1px)` on the card border only)
- Dashed outline
- Muted warm grey fill
- Text label: **"Needs a primary source"**
- No animation

### Ash — expired
- Full grey, no color
- Text struck through (`text-decoration: line-through`)
- Icon: an X in a circle
- Text label: **"Expired"**
- No animation

### Reborn — successor rule or renumbered HS code
- Teal glow (`oklch(0.75 0.14 185)`, soft box-shadow)
- Small arrow icon pointing to the predecessor card
- Text label: **"Successor"** with predecessor code shown beneath
- Transition: fade-in teal glow over 200 ms

## Accessibility rules

- **Never rely on color alone.** Every state has an icon, a color, and a text label. All
  three are always present — never omit the label for space reasons.
- **Contrast minimum 4.5:1** for all text against its background (WCAG AA). Verify with
  the oklch values above; adjust lightness if a theme change breaks this.
- **Keyboard-operable slider.** The time slider must use a native `<input type="range">`
  or a custom element with `role="slider"`, `aria-valuemin`, `aria-valuemax`,
  `aria-valuenow`, and `aria-valuetext` (e.g. `"1 January 2028"`). Arrow keys move one day.
  Page Up and Page Down move one month (this needs a custom keydown handler, so it will be
  defined in the UI spec).
- **`prefers-reduced-motion`.** Wrap all transitions and animations in a
  `@media (prefers-reduced-motion: no-preference)` block. Static fallbacks must look
  complete, not broken.
- **No autoplay sound.** The product has no sound. Do not add it.

## Motion budget

- No transition exceeds **300 ms**.
- Use `ease-out` or `linear` for data-driven state changes; never `bounce` or `spring`
  on compliance UI.
- The Ghost flicker is the only continuous animation; everything else is a one-shot
  transition triggered by user interaction or a data change.

## Typography and spacing

- Use the system font stack as the base; layer a serif for headings if desired, but
  legibility beats atmosphere.
- Body text minimum `1rem` / `16px`. Labels on state badges minimum `0.75rem` / `12px`.
- Adequate whitespace between cards — the radar should not feel cramped.
