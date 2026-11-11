/**
 * The app, wired by hand.
 *
 * Route definitions live in `client/routes.ts` and this file maps them to what answers them — the
 * shape a Remix app has. `router.map(routes, controller)` is the whole of the mapping, and a
 * controller has to name an action for every route in the map it owns: leave one out and the
 * router throws while it is being built, rather than answering a route with nothing.
 *
 * What is exported is a plain `@remix-run/fetch-router` router, and it is deployed two ways from
 * this one file:
 *
 * - **Locally** `deno serve router.tsx` answers the pages *and* the server-only routes (`/api/*`,
 *   `/.well-known/jwks.json`) live. This is also what the tests run against.
 * - **Cloudflare Workers** serves the static build below as static assets and answers only the
 *   server-only routes, from `worker.ts` — this file uses Deno-only APIs and is not deployed there.
 * - **GitHub Pages** is `@remix-kbn/ssg` crawling this same object with `fetch()` and writing each
 *   response to disk. It starts from `entryPoints` and follows links, and nothing links to the
 *   server-only routes, so `/api/*` is never generated.
 */

import {
  createController,
  createRouter,
  type RouterContext,
} from "@remix-run/fetch-router";
import { cop } from "@remix-run/cop-middleware";
import { render } from "@remix-run/render-middleware";
import { createFileTree, githubPages } from "@remix-kbn/ssg/site";
import { stripBase } from "@remix-kbn/ssg/base";
import type { FileServerBehavior } from "@remix-kbn/ssg/site";

import { assets, assetsPath } from "./assets.ts";
import { contentSecurityPolicy, nonceOf } from "./csp.ts";
// [feature:spa] `spaRuntime`
import { clientRuntime, spaRuntime } from "./runtime.ts";
import { ogImage, ogPaths, serveOgImage } from "./og/mod.ts";
import { base } from "../client/base.ts";
import { Layout, type PageModule } from "../client/layout.tsx";
import { routes } from "../client/routes.ts";

import { blogController } from "./blog/mod.tsx"; // [feature:blog]
import * as Fullscreen from "../client/pages/fullscreen.tsx"; // [feature:fullscreen]
import * as Home from "../client/pages/index.tsx";
import * as Showcase from "../client/pages/showcase.tsx"; // [feature:showcase]
import * as Spa from "../client/pages/spa.tsx"; // [feature:spa]
import { versions } from "./versions.ts"; // [feature:showcase]
import * as Hydration from "../client/pages/hydration.tsx";
import * as My from "../client/pages/my.tsx";

// [feature:protected-api] / [feature:server-send] / [feature:turso]: the server API.
import { apiController } from "./controllers/api/controller.ts";
import { notifyAction } from "./controllers/api/notify.ts";
import { tursoAction } from "./controllers/api/turso.ts";
import { jwksAction } from "./controllers/well_known.ts";
import { copDenied } from "./lib/problem.ts";

/** Deploy path prefix. The build strips it back off when writing, so output lands at the root. */
export { base };

/** Where the static build deploys. The build writes the file this rule would serve. */
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
        viewport={page.viewport}
        bare={page.bare}
        script={page.hydrate ? clientRuntime : null}
      >
        <Page />
      </Layout>,
    );
}

/** The files under `client/static/`, served verbatim at their own names. */
const staticFiles = await createFileTree({
  rootDir: `${import.meta.dirname}/../client/static`,
  basePath: `${base}/static`,
  cacheControl: "public, max-age=3600",
});

/**
 * The service worker, from `client/sw.js`.
 *
 * It is a route of its own rather than a file under `static/` because a worker's scope is the
 * directory it is served from: `${base}/static/sw.js` could only control `${base}/static/`.
 */
const serviceWorker = await Deno.readTextFile(
  new URL("../client/sw.js", import.meta.url),
);

/**
 * `cop()` rejects unsafe cross-origin browser requests (`POST /api/notify`, the protected API) by
 * `Sec-Fetch-Site` / `Origin`, without tokens, answering with an RFC 9457 problem (`lib/problem.ts`). `contentSecurityPolicy` is the CSP (`csp.ts`). `render({ assets })`
 * puts `context.render(node)` on every request.
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

/**
 * The direct routes at the top of the map: the pages, and the JWKS document.
 *
 * `routes.api` is a map, so it is mapped separately below.
 */
const top = createController(routes, {
  actions: {
    home: pageAction(routes.home, Home),
    // [feature:fullscreen]
    fullscreen: pageAction(routes.fullscreen, Fullscreen),
    // [feature:showcase] Written out rather than built by `pageAction` because its badges are
    // read off the import map, which a page in `client/` cannot open.
    showcase: (context) =>
      context.render(
        <Layout
          nonce={nonceOf(context)}
          title={Showcase.title}
          description={Showcase.description}
          image={showcaseImage}
          script={Showcase.hydrate ? clientRuntime : null}
        >
          <Showcase.default versions={versions()} />
        </Layout>,
      ),
    hydration: pageAction(routes.hydration, Hydration),
    my: pageAction(routes.my, My),
    jwks: jwksAction, // [feature:server-send]
  },
});

/**
 * The server-only API. Static builds never reach it — see the header.
 *
 * `routes.api.protected` is a map of its own, owned by `apiController`, because the DPoP
 * middleware belongs to those two routes and not to `notify`/`turso`.
 */
const api = createController(routes.api, {
  actions: {
    notify: notifyAction, // [feature:server-send]
    turso: tursoAction, // [feature:turso]
  },
});

/** [feature:showcase] */
const showcaseImage = ogImage(routes.showcase.href(), Showcase);

// [feature:spa] Everything down to `router.map` below. It
// has a controller of its own because the view its `:id` names is handed to the screen rather than
// read back out of the router, and because it loads a different script than every other page.
const spaImages = new Map(
  Spa.SPA_IDS.map((id) => [
    id,
    ogImage(routes.spa.show.href({ id }), {
      title: Spa.titleFor(id),
      description: Spa.description,
    }),
  ]),
);

const spa = createController(routes.spa, {
  actions: {
    show: (context) => {
      const id = Spa.parseSpaId(context.params.id);
      // A `404` for anything that is not one of the demo's views, which is what an unknown id is.
      // The router in the browser answers the same URL the same way — see `client/spa/app.tsx`.
      if (id === null) {
        return new Response("Not Found", {
          status: 404,
          headers: { "content-type": "text/plain; charset=utf-8" },
        });
      }

      return context.render(
        <Layout
          nonce={nonceOf(context)}
          title={Spa.titleFor(id)}
          description={Spa.description}
          image={spaImages.get(id) ?? null}
          // Not `clientRuntime`: this page starts a router rather than hydrating islands, and a
          // document gets one runtime. See `client/spa/entry.ts`.
          script={spaRuntime}
          // The shell's links leave the client router's world, so they go to the browser.
          documentLinks
        >
          {
            /*
            What the build writes into the file. `run()` replaces it with its own first render as
            soon as the script loads, which is the takeover the screen reports.
          */
          }
          <Spa.default id={id} renderedBy="server" navigations={0} />
        </Layout>,
      );
    },
  },
});

router.map(routes, top);
// [feature:spa]
router.map(routes.spa, spa);
// [feature:blog] Both blog routes at once: the listing, and one article.
router.map(routes.blog, blogController);
router.map(routes.api, api);
router.map(routes.api.protected, apiController); // [feature:protected-api]

router.get(`${base}/static/*path`, ({ request }) => staticFiles.fetch(request));
router.get(`${assetsPath}/*path`, ({ request }) => assets.fetch(request));
router.get(`${base}/og/*path`, ({ request }) => serveOgImage(request));
// [feature:push] The service worker.
router.get(
  `${base}/sw.js`,
  () =>
    new Response(serviceWorker, {
      headers: {
        "content-type": "text/javascript; charset=utf-8",
        "cache-control": "no-cache",
        "service-worker-allowed": `${base}/`,
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
export const entryPoints: readonly string[] = [
  "/",
  ...ogPaths(),
  "/sw.js", // [feature:push]
  // [feature:helper] The chat's chunk is only named by an attribute on the help button, which a
  // link-following crawl never reads — see `client/helper/install.ts`.
  `/${stripBase(clientRuntime.helper, base)}`,
];

export default router;
