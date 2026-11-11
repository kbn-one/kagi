/**
 * The browser entrypoint for the SPA demo, in place of `hydration.ts`.
 *
 * [feature:spa] delete this file with the feature — see TEMPLATE.md.
 *
 * A document gets one runtime, and these two start different ones. `hydration.ts` calls
 * `@remix-run/component`'s `run()` with a `loadModule`, which hydrates the islands a page placed;
 * `@remix-run/spa`'s `run()` wires the runtime to a router instead, and its `loadModule` throws —
 * an SPA response carries a node, so there is no client entry in it to hydrate.
 *
 * So the two never share a page. `server/router.ts` sends this one to the demo's URLs and
 * `hydration.ts` to every other page, which is also why this is its own entrypoint in
 * `server/assets.ts`. The `@remix-run/component` runtime they both pull in is emitted once, into a chunk
 * they share, exactly as it is for two islands.
 *
 * `ready()` resolves once the initial route has rendered. Nothing here waits on it — the page is
 * already on screen, server-rendered — but awaiting it is what a caller with something to do after
 * the first render would reach for. `run(router, { fallback })` takes a node to show while that
 * first route resolves; this demo has no use for one, because the server already rendered the view
 * into the file.
 */

import { run } from "@remix-run/spa";

import { guardBrowserNavigations } from "../navigation-guard.ts";
import { installHelper } from "../helper/install.ts";
import { spaRouter } from "./app.tsx";

// The same two navigations the islands runtime hands back — this `run()` starts the same
// Navigation API listener, so it needs the same guard. See `client/navigation-guard.ts`.
guardBrowserNavigations();

// The demo's shell renders the same help button as every other page, and the helper does not care
// which runtime is in the document: it posts to a router of its own rather than navigating.
installHelper();

run(spaRouter);
