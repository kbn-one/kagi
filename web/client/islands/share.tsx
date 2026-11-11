import { clientEntry, css } from "@remix-run/component";
import type { Handle, HostProps } from "@remix-run/component";
import type { ShareButtonsElement } from "@kuboon/share-element";
// Imported for its side effect: this is what registers `<share-buttons>`.
import "@kuboon/share-element";

import { color } from "../tokens.ts";

/**
 * `<share-buttons>` is a custom element, so Remix's JSX has to be told the tag exists.
 *
 * `IntrinsicElements` is where a host tag is declared, and it carries no catch-all for hyphenated
 * names — an undeclared one is a type error rather than an `any`. Typing it against the package's
 * own element interface is what makes `url` and `show` checked like any other prop.
 */
declare global {
  namespace JSX {
    interface IntrinsicElements {
      "share-buttons": HostProps<ShareButtonsElement>;
    }
  }
}

/**
 * The line under every article, and the one custom element on this site.
 *
 * [`@kuboon/share-element`](https://jsr.io/@kuboon/share-element) is a plain custom element rather
 * than a Remix component, so this island is the join between the two. Everything about the buttons
 * is the package's — X, LINE and Threads, the copy-URL button, and the native share sheet where
 * one exists. Everything about *where they go* is this site's, which is the whole of what is
 * written here: a line, a label, and the tag.
 *
 * It sits inline rather than behind a "Share" button on purpose. The package collapses the row to
 * the native share sheet alone on a touch device that has one, so on a phone this is a single
 * button — and a single button behind another button is two taps to reach one. On a desktop it is
 * the five that are actually worth having there.
 *
 * Nothing here passes a URL. An empty `<share-buttons>` shares the page it is on, read at the
 * moment of the click, which is the one form of an article's address that is right at the domain
 * root, under a repo sub-path and on a PR preview alike — and still right after a frame
 * navigation, which is how this site moves between pages.
 *
 * Importing the package at the top is safe even though this module renders on the server first: it
 * registers the element wherever there is a DOM and does nothing anywhere else, which is exactly
 * the shape an SSG build needs. On the server the tag is just a tag and the row arrives empty in
 * the HTML; in the browser the registration upgrades it and it fills in.
 *
 * The buttons themselves are dressed by `static/app.css`, not from here — see the note at the end
 * of that file for why a `css(...)` mixin could not have done it.
 */
export const ShareRow = clientEntry(
  import.meta.url,
  function ShareRow(handle: Handle<{ label: string }>) {
    return () => (
      <div mix={rowStyle}>
        <span mix={labelStyle}>{handle.props.label}</span>
        <share-buttons />
      </div>
    );
  },
);

/** The island's own CSS, in the island's own file — the line, not the buttons. */
const rowStyle = css({
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: "0.75rem",
});

const labelStyle = css({
  color: color.muted,
  fontSize: "0.9rem",
});
