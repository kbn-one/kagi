/**
 * The `css(...)` mixins more than one module uses.
 *
 * Every rule here is a mixin from `@remix-run/component`. The server collects the mixins a page actually
 * rendered and emits them as `<style>` tags in that page's `<head>`, so each page ships its own
 * CSS and nothing else: no extra request, and no rules for parts of the site the reader never
 * opened.
 *
 * What a mixin cannot do is choose its cascade layer — every one of them lands in Remix's `rmx` —
 * so the site's layer order and its document-level defaults live in `static/app.css` instead, in a
 * `base` layer ahead of `rmx`. That is also where the token values are; `./tokens.ts` names them.
 *
 * Two more things are worth knowing before editing:
 *
 * - `mix` takes an array, so mixins compose: `mix={[bandStyle, headerStyle]}` is how this site
 *   says what a stylesheet would have said with a grouped selector.
 * - What belongs in this file is what more than one module uses. A style used in one place belongs
 *   in that file, next to the markup it dresses.
 */

import { css } from "@remix-run/component";

import { color, radius } from "./tokens.ts";

// --- shared mixins -----------------------------------------------------------

/** A date, a byline, a caption: small, quiet, on a line of its own. */
export const metaStyle = css({
  display: "block",
  color: color.muted,
  fontSize: "0.85rem",
  marginBlock: "0.2rem",
});

/** A filled call to action. It goes on an `<a href>`, not on a `<button>`. */
export const buttonStyle = css({
  display: "inline-block",
  marginTop: "0.5rem",
  padding: "0.6rem 1rem",
  borderRadius: radius.md,
  background: color.accent,
  color: color.onAccent,
  textDecoration: "none",
  fontWeight: 600,
  transition: "filter 120ms ease",
  "&:hover": { filter: "brightness(1.08)" },
  "&:active": { transform: "translateY(1px)" },
});

/** A bordered, slightly raised block: the home page demo, a callout, a pull-out. */
export const cardStyle = css({
  marginBlock: "2rem",
  padding: "1.25rem",
  border: `1px solid ${color.border}`,
  borderRadius: radius.lg,
  background: color.card,
  "& > :first-child": { marginTop: 0 },
  "& > :last-child": { marginBottom: 0 },
});

/** A `<button>` that sits next to text: outlined by default, filled with {@link primaryStyle}. */
export const actionStyle = css({
  font: "inherit",
  fontSize: "0.9rem",
  cursor: "pointer",
  padding: "0.4rem 0.8rem",
  border: `1px solid ${color.border}`,
  borderRadius: radius.md,
  background: "transparent",
  color: color.fg,
  "&:hover:not(:disabled)": { borderColor: color.accent, color: color.accent },
  "&:disabled": { opacity: 0.5, cursor: "not-allowed" },
});

/** Composed after {@link actionStyle} to fill the button with the accent. */
export const primaryStyle = css({
  borderColor: color.accent,
  background: color.accent,
  color: color.onAccent,
  "&:hover:not(:disabled)": {
    filter: "brightness(1.08)",
    color: color.onAccent,
  },
});

/** A destructive action: the outline and the text, not a fill. */
export const dangerStyle = css({
  color: "#dc2626",
  "&:hover:not(:disabled)": { borderColor: "#dc2626", color: "#dc2626" },
});

/** A status line: `info`, `success`, `warning` or `error` colours the left edge. */
export const alertStyle = css({
  marginBlock: "0.75rem",
  padding: "0.6rem 0.9rem",
  border: `1px solid ${color.border}`,
  borderInlineStartWidth: "4px",
  borderRadius: radius.md,
  background: color.bg,
  '&[data-kind="info"]': { borderInlineStartColor: color.accent },
  '&[data-kind="success"]': { borderInlineStartColor: "#16a34a" },
  '&[data-kind="warning"]': { borderInlineStartColor: "#d97706" },
  '&[data-kind="error"]': { borderInlineStartColor: "#dc2626" },
});
