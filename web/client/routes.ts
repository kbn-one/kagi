/**
 * Every URL the app answers, in one place.
 *
 * `server/router.tsx` maps these to the controllers that answer them, and everything that links
 * reads `routes.kagi.href()` rather than spelling `/kagi` at each call site.
 *
 * Two kinds of route live here and they are deployed differently:
 *
 * - **Pages** (`home`, `kagi`, `docs`) are rendered to static HTML by `deno task build` and served
 *   by Cloudflare as static assets.
 * - **Server routes** (everything under `api`) only exist on the live server — the
 *   Worker (`server/worker.ts`) on Cloudflare. Nothing links to them, so the static build's crawl
 *   never reaches them.
 */

import { get, post, put, route } from "@remix-run/fetch-router/routes";

export const routes = route("", {
  home: get("/"),
  /** The approver's screen: secrets, subscription, and the requests to approve. */
  kagi: get("/kagi"),
  /** How to set up the phone, send requests, and limit git push with a GitHub App. */
  docs: get("/docs"),
  api: route("api", {
    /** One approver subscription. `server/lib/kagi/` answers all of them. */
    sub: route("sub", {
      /** The approver registers its device key under a fresh random id. */
      register: put("/:id"),
      /** A requester submits a request; answers `202 { transaction_id }`. */
      req: post("/:id/req"),
      /** A requester waits for the result (`?transaction_id=…&wait=seconds`). */
      res: get("/:id/res"),
      /** The approver's WebSocket. */
      ws: get("/:id/ws"),
      /**
       * The approver's WebSocket to a single-use Dynamic Worker that makes an approved call, for an
       * API without CORS (`server/lib/kagi/relay.ts`). Signed with the device key; once per
       * transaction; sealed end to end.
       */
      relay: get("/:id/relay"),
    }),
  }),
});
