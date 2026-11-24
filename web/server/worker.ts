/**
 * The Cloudflare Workers entry: the server-only half of the app.
 *
 * Cloudflare serves the static build (`web/dist`, from `deno task build`) as Workers static assets
 * — the client chunks, the social cards, `sw.js`, the icons — straight to the browser. The API and
 * the pages reach this Worker first (`assets.runWorkerFirst` in `cloudflare.config.ts`): the API is
 * answered below, and a page is fetched from the assets and given this request's CSP nonce
 * (`pages.ts`). It never renders a page itself, so it needs none of the Deno-only machinery in
 * `router.tsx` (`Deno.bundle`, `Deno.readTextFile`, the file tree).
 *
 * `deno task build:worker` bundles this file into `web/worker-dist/worker.js`.
 */

import { cop } from "@remix-run/cop-middleware";
import { createRouter } from "@remix-run/fetch-router";

import { routes } from "../client/routes.ts";
import { subController } from "./controllers/api/sub.ts";
import {
  type DurableObjectNamespaceLike,
  useDurableObjects,
} from "./lib/kagi/hub.ts";
import {
  loaderRunner,
  setRelayRunner,
  type WorkerLoaderLike,
} from "./lib/kagi/relay.ts";
import { rateLimited, type RateLimiters } from "./lib/kagi/rate_limit.ts";
import { copDenied, problem } from "./lib/problem.ts";
import { type AssetsLike, createPagesRouter } from "./pages.ts";
import { withSecurityHeaders } from "./security_headers.ts";

/** The Durable Object class behind `KAGI_ROOM`; `cloudflare.config.ts` declares it. */
export { KagiRoom } from "./lib/kagi/durable_object.ts";

// `router.tsx` augments `RouterTypes` project-wide so every controller sees `context.render`. None
// of the API controllers use it, and this router has no render middleware, so the controllers are
// handed over as `never` rather than pulling the page renderer (and `Deno.bundle`) in.
// `cop()` rejects unsafe cross-origin browser requests. Errors are RFC 9457 problems
// (`lib/problem.ts`), the cop rejection and the 404 included.
const router = createRouter({
  middleware: [cop({ onDeny: copDenied })],
  defaultHandler: () => problem({ status: 404 }),
});

router.map(routes.api.sub, subController as never);

interface WorkerEnv extends RateLimiters {
  KAGI_ROOM?: DurableObjectNamespaceLike;
  ASSETS?: AssetsLike;
  /** The Worker Loader, which makes the single-use Dynamic Worker of each relayed call. */
  LOADER?: WorkerLoaderLike;
}

/** The API, behind the per-address limits (`lib/kagi/rate_limit.ts`). */
async function api(request: Request, env: RateLimiters): Promise<Response> {
  return (await rateLimited(request, env)) ?? router.fetch(request);
}

let boundDurableObjects = false;
let boundLoader: WorkerLoaderLike | undefined;
let pages: ReturnType<typeof createPagesRouter> | undefined;
let pagesAssets: AssetsLike | undefined;

export default {
  async fetch(request: Request, env?: WorkerEnv): Promise<Response> {
    return withSecurityHeaders(await answer(request, env));
  },
};

/** The response before the security headers (`security_headers.ts`). */
function answer(request: Request, env?: WorkerEnv): Promise<Response> {
  // Without the binding (the Deno tests) rooms stay in memory.
  if (!boundDurableObjects && env?.KAGI_ROOM) {
    useDurableObjects(env.KAGI_ROOM);
    boundDurableObjects = true;
  }
  // Without it (the Deno tests, unless they set one) the relay answers 501.
  if (env?.LOADER && boundLoader !== env.LOADER) {
    setRelayRunner(loaderRunner(env.LOADER));
    boundLoader = env.LOADER;
  }
  if (new URL(request.url).pathname.startsWith("/api/")) {
    return api(request, env ?? {});
  }
  // Everything else that reaches the Worker is a page (`runWorkerFirst`): see `pages.ts`.
  if (!pages || pagesAssets !== env?.ASSETS) {
    pages = createPagesRouter(env?.ASSETS);
    pagesAssets = env?.ASSETS;
  }
  return pages.fetch(request);
}
