/**
 * Cloudflare deployment config, read by the `cf` CLI (`deno task cf deploy`).
 *
 * Cloudflare serves the static build (`web/dist`) as Workers static assets and runs only the
 * server-only routes in the Worker (`web/server/worker.ts`, bundled to `web/worker-dist/worker.js`
 * by `deno task build:worker`). `deno task build:cf` makes both.
 *
 * Each kagi subscription is a `KagiRoom` Durable Object (`web/server/lib/kagi/durable_object.ts`),
 * so the approver's WebSocket and the requester's `GET /api/sub/:id/res` meet in one instance.
 */

import { bindings, defineConfig, exports } from "cf/config";

const WORKER = "kagi";

/** An environment variable, under Deno or Node (whichever runs `cf`). */
const envVar = (name: string): string | undefined =>
  (globalThis as { Deno?: { env: { get(k: string): string | undefined } } })
    .Deno?.env.get(name) ??
    (globalThis as { process?: { env: Record<string, string | undefined> } })
      .process?.env[name];

/**
 * Whether the deployed Worker has the `VAPID_KEYS` secret yet.
 *
 * Declaring a secret makes a deploy inherit it from the previous version, and a version without it
 * has none to inherit (`cannot inherit bindings`). So the deploy workflow checks first
 * (`deno task set-vapid-keys --check`) and sets `KAGI_HAS_VAPID_KEYS=0` when the secret is missing;
 * anything else declares it, so a deploy that skipped the check never drops an existing key.
 */
const hasVapidKeys = envVar("KAGI_HAS_VAPID_KEYS") !== "0";

export default defineConfig({
  // Not a secret: it is only an identifier, and the API token is what authorizes.
  accountId: "ac92f36f0a2d84353b137574157f7480",
  worker: {
    name: WORKER,
    compatibilityDate: "2026-10-01",
    entrypoint: "./web/worker-dist/worker.js",
    // Needs the kbn.one zone on this account.
    domains: ["kagi.kbn.one"],
    assets: {
      htmlHandling: "auto-trailing-slash",
      notFoundHandling: "none",
      // The API and the pages reach the Worker first; the files the pages load go straight to the
      // assets. A page gets this request's CSP nonce there (`web/server/pages.ts`).
      runWorkerFirst: [
        "/*",
        "!/assets/*",
        "!/static/*",
        "!/og/*",
        "!/icons/*",
        "!/sw.js",
        "!/manifest.webmanifest",
      ],
    },
    exports: {
      KagiRoom: exports.durableObject({ storage: "sqlite" }),
    },
    env: {
      // The static build, which the Worker fetches pages from (`web/server/pages.ts`).
      ASSETS: bindings.assets(),
      KAGI_ROOM: bindings.durableObject({
        worker: WORKER,
        exportName: "KagiRoom",
      }),
      // Makes the single-use Dynamic Worker that each relayed call runs in
      // (`web/server/lib/kagi/relay.ts`), for APIs that do not allow CORS.
      LOADER: bindings.workerLoader(),
      // Per client address (`web/server/lib/kagi/rate_limit.ts`): relayed calls and registrations,
      // the two calls that cost this server something for anyone at all. The namespaces are this
      // account's own numbers; another Worker using the same one would share the count.
      RELAY_LIMIT: bindings.rateLimit({
        namespace: "91701",
        simple: { limit: 20, period: 60 },
      }),
      REGISTER_LIMIT: bindings.rateLimit({
        namespace: "91702",
        simple: { limit: 5, period: 60 },
      }),
      // Secret, generated and set by `web/server/set_vapid_keys.ts` (by the deploy when missing, and
      // by the `vapid-keys` workflow to rotate); declared here so a deploy keeps it.
      VAPID_KEYS: hasVapidKeys ? bindings.secret() : null,
    },
  },
});
