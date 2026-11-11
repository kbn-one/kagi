/**
 * Every URL the app answers, in one place.
 *
 * `server/router.tsx` maps these to the controllers that answer them, and everything that links
 * reads `routes.my.href()` rather than rebuilding `${base}/my` at each call site.
 *
 * The map is built with the deploy prefix as its base, so hrefs are correct under a GitHub Pages
 * repo sub-path or a PR preview URL without anyone prepending anything. On Cloudflare `base` is
 * empty.
 *
 * Two kinds of route live here and they are deployed differently:
 *
 * - **Pages** (`home`, `hydration`, `my`) are rendered to static HTML by the GitHub Pages build as
 *   well as served from the static build by Cloudflare.
 * - **Server routes** (`jwks` and everything under `api`) only exist on the live server. Nothing
 *   links to them, so the static build's crawl never reaches them, and they are not in
 *   `entryPoints`. The client may still name them (`routes.api.notify.href()`), which is why the
 *   shapes are stated here — a static deploy simply has no server to answer them.
 */

import { get, post, route } from "@remix-run/fetch-router/routes";

import { base } from "./base.ts";

export const routes = route(base, {
  home: get("/"),
  // [feature:hydration-demo]
  hydration: get("/hydration"),
  // [feature:signin] (the push card on this page is [feature:push])
  my: get("/my"),
  // [feature:fullscreen]
  fullscreen: get("/fullscreen"),
  // [feature:showcase]
  showcase: get("/showcase"),
  // [feature:spa]
  spa: route("spa", {
    /** One view of the SPA demo; the build generates each as its own static file. */
    show: get("/:id"),
  }),
  // [feature:blog]
  blog: route("blog", {
    index: get("/"),
    /** One article. Articles are Markdown files; `server/blog/` answers this by reading the slug's file. */
    show: get("/:slug"),
  }),
  // [feature:server-send] RP public JWKS — lets the IdP verify our `private_key_jwt` assertions.
  jwks: get("/.well-known/jwks.json"),
  api: route("api", {
    // [feature:server-send] Server-initiated push fan-out (delegates to the IdP). Not DPoP-protected.
    notify: post("/notify"),
    // [feature:turso] Turso (libSQL) + @remix-run/data-table sample.
    turso: get("/turso"),
    // [feature:protected-api] DPoP-protected JSON endpoints; `server/router.tsx` puts the DPoP middleware on this group.
    protected: route("protected", {
      get: get("/"),
      post: post("/"),
    }),
  }),
});
