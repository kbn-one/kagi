/**
 * Every URL the app answers, in one place.
 *
 * `server/router.tsx` maps these to the controllers that answer them, and everything that links
 * reads `routes.my.href()` rather than spelling `/my` at each call site.
 *
 * Two kinds of route live here and they are deployed differently:
 *
 * - **Pages** (`home`, `kagi`, `my`) are rendered to static HTML by `deno task build` and served
 *   by Cloudflare as static assets.
 * - **Server routes** (`jwks` and everything under `api`) only exist on the live server — the
 *   Worker (`server/worker.ts`) on Cloudflare. Nothing links to them, so the static build's crawl
 *   never reaches them.
 */

import { get, post, put, route } from "@remix-run/fetch-router/routes";

export const routes = route("", {
  home: get("/"),
  /** The approver's screen: secrets, subscription, and the requests to approve. */
  kagi: get("/kagi"),
  /** Sign-in with id.kbn.one and push registration. */
  my: get("/my"),
  /** RP public JWKS — lets the IdP verify our `private_key_jwt` assertions for the push. */
  jwks: get("/.well-known/jwks.json"),
  api: route("api", {
    /** One approver subscription. `server/lib/kagi/` answers all four. */
    sub: route("sub", {
      /** The approver registers its id.kbn.one user and device key under a fresh random id. */
      register: put("/:id"),
      /** A requester submits a request; answers `202 { transaction_id }`. */
      req: post("/:id/req"),
      /** A requester waits for the result (`?transaction_id=…&wait=seconds`). */
      res: get("/:id/res"),
      /** The approver's WebSocket. */
      ws: get("/:id/ws"),
    }),
  }),
});
