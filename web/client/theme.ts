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

/**
 * Typography for a tree of elements this site never writes: the Markdown articles.
 *
 * A stylesheet would reach these with bare element selectors, and would then be styling every
 * `<table>` on the site. Nesting under the one class on the article wrapper says the same thing
 * locally, and it stops at the article.
 */
export const proseStyle = css({
  "& h2, & h3, & h4": { lineHeight: 1.25, marginBlock: "2rem 0.5rem" },
  "& h2": { fontSize: "1.5rem" },
  "& h3": { fontSize: "1.2rem" },
  "& p, & ul, & ol": { marginBlock: "1rem" },
  "& li": { marginBlock: "0.3rem" },
  "& a": { textDecorationThickness: "1px", textUnderlineOffset: "2px" },
  // @kuboon/md wraps every heading in its own anchor link. Left to the base layer's default it
  // would paint each heading accent-blue and underline it.
  "& :is(h1, h2, h3, h4, h5, h6) a": {
    color: "inherit",
    textDecoration: "none",
  },
  "& :is(h1, h2, h3, h4, h5, h6) a:hover": { textDecoration: "underline" },
  "& img": { maxWidth: "100%", height: "auto", borderRadius: radius.md },
  "& blockquote": {
    margin: "1.5rem 0",
    paddingInlineStart: "1rem",
    borderInlineStart: `3px solid ${color.border}`,
    color: color.muted,
  },
  "& hr": {
    border: 0,
    borderTop: `1px solid ${color.border}`,
    marginBlock: "2rem",
  },
  "& table": {
    width: "100%",
    borderCollapse: "collapse",
    marginBlock: "1.5rem",
  },
  "& th, & td": {
    padding: "0.4rem 0.6rem",
    borderBottom: `1px solid ${color.border}`,
    textAlign: "left",
  },
  // Shiki paints the block itself, inline, so all this owes a code block is room to breathe and
  // somewhere to scroll. The inner <code> has to give back what the base layer's `code` gave it,
  // or a light chip sits on top of a dark block.
  "& pre": {
    marginBlock: "1.5rem",
    padding: "0.9rem 1rem",
    borderRadius: radius.md,
    overflowX: "auto",
    fontSize: "0.85rem",
    lineHeight: 1.5,
  },
  "& pre code": { background: "none", padding: 0, fontSize: "inherit" },
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
