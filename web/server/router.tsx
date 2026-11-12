/**
 * The app, wired by hand.
 *
 * Route definitions live in `client/routes.ts` and this file maps them to what answers them — the
 * shape a Remix app has. `router.map(routes, controller)` is the whole of the mapping, and a
 * controller has to name an action for every route in the map it owns: leave one out and the
 * router throws while it is being built, rather than answering a route with nothing.
 *
 * It is used two ways:
 *
 * - **Locally** `deno serve router.tsx` answers the pages *and* the server-only routes (`/api/*`,
 *   `/.well-known/jwks.json`) live. This is also what the tests run against.
 * - **The static build** (`deno task build`, `@remix-kbn/ssg`) crawls this same object with
 *   `fetch()` and writes each page to `web/dist`, which Cloudflare serves as static assets. It
 *   starts from `entryPoints` and follows links, and nothing links to the server-only routes, so
 *   `/api/*` is never generated: on Cloudflare those are answered by `worker.ts` — this file uses
 *   Deno-only APIs and is not deployed there.
 */

import {
  createController,
  createRouter,
  type RouterContext,
} from "@remix-run/fetch-router";
import { cop } from "@remix-run/cop-middleware";
import { render } from "@remix-run/render-middleware";
import { createFileTree, githubPages } from "@remix-kbn/ssg/site";
import type { FileServerBehavior } from "@remix-kbn/ssg/site";

import { assets, assetsPath } from "./assets.ts";
import { contentSecurityPolicy, nonceOf } from "./csp.ts";
import { clientRuntime } from "./runtime.ts";
import { ogImage, ogPaths, serveOgImage } from "./og/mod.ts";
import { Layout, type PageModule } from "../client/layout.tsx";
import { routes } from "../client/routes.ts";

import * as Home from "../client/pages/index.tsx";
import * as Docs from "../client/pages/docs.tsx";
import * as Kagi from "../client/pages/kagi.tsx";
import * as My from "../client/pages/my.tsx";

import { subController } from "./controllers/api/sub.ts";
import { jwksAction } from "./controllers/well_known.ts";
import { kagiHub } from "./lib/kagi/hub.ts";
import { parseSubPath } from "./lib/kagi/room.ts";
import { copDenied } from "./lib/problem.ts";

/** How the static build names its files: `/kagi` → `kagi/index.html`. */
export const fileServer: FileServerBehavior = githubPages();

/**
 * Renders a page module into the shell.
 *
 * The route comes in alongside the module because the page's own path is what its social card is
 * registered under — the card is drawn from the same `title` and `description` the `<head>` gets.
 */
function pageAction(route: { href(): string }, page: PageModule) {
  const image = ogImage(route.href(), page);
  const Page = page.default;

  return (context: AppContext): Response =>
    context.render(
      <Layout
        nonce={nonceOf(context)}
        title={page.title}
        description={page.description}
        image={image}
        script={page.hydrate ? clientRuntime : null}
      >
        <Page />
      </Layout>,
    );
}

/** The files under `client/static/`, served verbatim at their own names. */
const staticFiles = await createFileTree({
  rootDir: `${import.meta.dirname}/../client/static`,
  basePath: "/static",
  cacheControl: "public, max-age=3600",
});

/**
 * The service worker, from `client/sw.js`.
 *
 * It is a route of its own rather than a file under `static/` because a worker's scope is the
 * directory it is served from: `/static/sw.js` could only control `/static/`.
 */
const serviceWorker = await Deno.readTextFile(
  new URL("../client/sw.js", import.meta.url),
);

/**
 * `cop()` rejects unsafe cross-origin browser requests by `Sec-Fetch-Site` / `Origin`, without
 * tokens, answering with an RFC 9457 problem (`lib/problem.ts`). `contentSecurityPolicy` is the CSP
 * (`csp.ts`). `render({ assets })` puts `context.render(node)` on every request.
 */
const router = createRouter({
  middleware: [
    cop({ onDeny: copDenied }),
    contentSecurityPolicy,
    render({ assets }),
  ],
});

/** The request context those middlewares produce — `context.render`, in practice. */
export type AppContext = RouterContext<typeof router>;

declare module "@remix-run/fetch-router" {
  interface RouterTypes {
    context: AppContext;
  }
}

/** The pages, and the JWKS document. `routes.api` is a map, so it is mapped separately below. */
const top = createController(routes, {
  actions: {
    home: pageAction(routes.home, Home),
    kagi: pageAction(routes.kagi, Kagi),
    docs: pageAction(routes.docs, Docs),
    my: pageAction(routes.my, My),
    jwks: jwksAction,
  },
});

router.map(routes, top);
router.map(routes.api.sub, subController);

router.get("/static/*path", ({ request }) => staticFiles.fetch(request));
router.get(`${assetsPath}/*path`, ({ request }) => assets.fetch(request));
router.get("/og/*path", ({ request }) => serveOgImage(request));
router.get(
  "/sw.js",
  () =>
    new Response(serviceWorker, {
      headers: {
        "content-type": "text/javascript; charset=utf-8",
        "cache-control": "no-cache",
        "service-worker-allowed": "/",
      },
    }),
);

/**
 * Where the static crawl starts.
 *
 * Pages are reached by following links from `/`. The exceptions are things nothing links to: the
 * social cards (an `og:image` is an absolute URL meant for someone else's server) and the service
 * worker (the push manager registers it by URL from script). `/api/*` is deliberately absent.
 */
export const entryPoints: readonly string[] = ["/", ...ogPaths(), "/sw.js"];

/**
 * What `deno serve` (and the static build) calls.
 *
 * The approver's WebSocket skips the router: `Deno.upgradeWebSocket` binds the upgrade to the very
 * `Request` Deno served and needs its own `Response` back, and the router hands neither through
 * unchanged ("Upgrade response was not returned from callback"). The Worker has no such limit
 * (`WebSocketPair`), so there the route goes through the router like the others.
 */
export default {
  fetch(request: Request): Promise<Response> {
    const target = request.headers.get("upgrade")
      ? parseSubPath(new URL(request.url).pathname, request.method)
      : null;
    if (target?.action === "ws") {
      return kagiHub().dispatch(target.subId, "ws", request);
    }
    return router.fetch(request);
  },
};
