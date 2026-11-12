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
 * Whether the deployed Worker has the `RP_SIGNING_KEY_JWK` secret yet.
 *
 * Declaring a secret makes a deploy inherit it from the previous version, and the very first deploy
 * has none to inherit (`cannot inherit bindings: no previous version exists`). So the deploy
 * workflow checks first (`deno task set-signing-key --check`) and sets `KAGI_HAS_SIGNING_KEY=0`
 * when the secret is missing; anything else declares it, so a deploy that skipped the check never
 * drops an existing key.
 */
const hasSigningKey = envVar("KAGI_HAS_SIGNING_KEY") !== "0";

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
      // Only these reach the Worker; every other path is a static file.
      runWorkerFirst: ["/api/*", "/.well-known/jwks.json"],
    },
    exports: {
      KagiRoom: exports.durableObject({ storage: "sqlite" }),
    },
    env: {
      KAGI_ROOM: bindings.durableObject({
        worker: WORKER,
        exportName: "KagiRoom",
      }),
      IDP_ORIGIN: bindings.text("https://id.kbn.one"),
      // Must be in the IdP's AUTHORIZE_WHITELIST for the approval push to be accepted.
      RP_ORIGIN: bindings.text("https://kagi.kbn.one"),
      // Secret, generated and set by `web/server/set_signing_key.ts` (after the first deploy, and by
      // the `signing-key` workflow to rotate); declared here so a deploy keeps it.
      RP_SIGNING_KEY_JWK: hasSigningKey ? bindings.secret() : null,
    },
  },
});
