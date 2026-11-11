/**
 * The button's behaviour — and only the button's.
 *
 * Opening the chat is the host app's job: `@remix-kbn/helper-agent` draws the panel and leaves
 * the affordance to the site. This is the site's half of that, and it is deliberately the only
 * part of the helper that every hydrating page loads. Everything expensive — the panel, the
 * in-page router, the agent — is one chunk that arrives on the first click and never on a page
 * where nobody clicks.
 *
 * Two things here are less obvious than they look.
 *
 * **The import is written so the bundler cannot read it.** `import(HELPER_SRC)` with a variable
 * leaves `helper/panel.ts` out of this graph entirely; it is an entrypoint of its own in
 * `server/assets.ts`, and the shell is handed its URL exactly as it is handed the runtime's. The
 * spelled-out `import("./panel.ts")` would work too, and would also put the chunk in this page's
 * `<link rel="modulepreload">` list — which downloads it on every hydrated page and gives back
 * the fifty kilobytes this is here to save.
 *
 * **The listener is on the document, not on the button.** An internal link is a soft navigation,
 * which swaps the document's contents — and on the SPA demo `run()` replaces the whole of
 * `<body>` on the first render. Either way the button that gets clicked is not the element that
 * was there when this ran. One delegated listener outlives all of them.
 */

import { HELPER_BUTTON_ID, HELPER_SRC_ATTRIBUTE } from "./button.ts";

/**
 * Where the chat's chunk is, read off the button the server rendered.
 *
 * At module load, which on the SPA demo is the only moment it can be: `run()` is about to replace
 * the body with a tree this value is needed to render. `null` on a page that ships no button.
 */
export const HELPER_SRC: string | null = document
  .getElementById(HELPER_BUTTON_ID)
  ?.getAttribute(HELPER_SRC_ATTRIBUTE) ?? null;

/** So two entrypoints in one document — which never happens, but would — install one listener. */
let installed = false;

/**
 * Makes the help button open the chat.
 *
 * Called by whichever runtime the page loaded, which is also the whole of the gating: the shell
 * renders the button only on a page that loads one, so a page with no JavaScript has no control
 * that does nothing.
 */
export function installHelper(): void {
  if (installed || HELPER_SRC === null) return;
  installed = true;

  let busy = false;

  document.addEventListener("click", async (event) => {
    const target = event.target;
    if (
      !(target instanceof Element) ||
      target.closest(`#${HELPER_BUTTON_ID}`) === null
    ) return;

    // The chunk is fetched once; after that the import resolves from the module map and the
    // toggle is immediate. The guard is for the first click being a double click, where the
    // second would otherwise build a second panel while the first is still on its way.
    if (busy) return;
    busy = true;

    try {
      // Typed by hand rather than with `typeof import("./panel.ts")`, so that not even a type
      // names the module and nothing can put it back in this graph.
      const module = await import(HELPER_SRC) as { toggleHelperPanel(): void };
      module.toggleHelperPanel();
    } finally {
      busy = false;
    }
  });
}
