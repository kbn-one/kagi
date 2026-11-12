/**
 * The Cloudflare Workers entry: the server-only half of the app.
 *
 * Cloudflare serves the static build (`web/dist`, from `deno task build`) as Workers static assets
 * — the pages, the client chunks, the social cards, `sw.js`. `cloudflare.config.ts` sends only the
 * routes below to this Worker (`assets.runWorkerFirst`), so it never renders a page and needs none
 * of the Deno-only machinery in `router.tsx` (`Deno.bundle`, `Deno.readTextFile`, the file tree).
 *
 * `deno task build:worker` bundles this file into `web/worker-dist/worker.js`.
 */

import { cop } from "@remix-run/cop-middleware";
import { createRouter } from "@remix-run/fetch-router";

import { routes } from "../client/routes.ts";
import { subController } from "./controllers/api/sub.ts";
import { jwksAction } from "./controllers/well_known.ts";
import {
  type DurableObjectNamespaceLike,
  useDurableObjects,
} from "./lib/kagi/hub.ts";
import { copDenied, problem } from "./lib/problem.ts";

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

router.get(routes.jwks, jwksAction.handler as never);
router.map(routes.api.sub, subController as never);

interface WorkerEnv {
  KAGI_ROOM?: DurableObjectNamespaceLike;
}

let boundDurableObjects = false;

export default {
  fetch(request: Request, env?: WorkerEnv) {
    // Without the binding (the Deno tests) rooms stay in memory.
    if (!boundDurableObjects && env?.KAGI_ROOM) {
      useDurableObjects(env.KAGI_ROOM);
      boundDurableObjects = true;
    }
    return router.fetch(request);
  },
};
