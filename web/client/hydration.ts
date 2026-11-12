/**
 * The client runtime, started once per document.
 *
 * `run()` walks the document for the hydration markers `renderToStream` emitted and hydrates each
 * one, importing the module the server named for it. That name is a real URL by the time it
 * reaches here — `assets.ts` resolved it during render — so this hook is the whole of it.
 *
 * The shell loads this as a `<script type="module">` on any page that hydrates, and on no other.
 *
 * `run()` also takes over same-origin navigation, which is what makes a plain `<a href>` on a
 * hydrated page a soft navigation. Two kinds of navigation are handed back to the browser first —
 * see `navigation-guard.ts`.
 */

import { run } from "@remix-run/component";

import { guardBrowserNavigations } from "./navigation-guard.ts";

guardBrowserNavigations();

const app = run({
  loadModule: async (moduleUrl, exportName) => {
    const module = await import(moduleUrl) as Record<string, unknown>;
    const picked = module[exportName];
    if (typeof picked !== "function") {
      throw new Error(
        `Module "${moduleUrl}" has no function export "${exportName}".`,
      );
    }
    return picked;
  },
});

await app.ready();

// The browser smoke test (`web/tests`) waits on this before it clicks anything.
(globalThis as unknown as { __rmxReady?: boolean }).__rmxReady = true;
