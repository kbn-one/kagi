/**
 * Cloudflare deployment config, read by the `cf` CLI (`deno task cf deploy`).
 *
 * Cloudflare serves the static build (`web/dist`) as Workers static assets and runs only the
 * server-only routes in the Worker (`web/server/worker.ts`, bundled to `web/worker-dist/worker.js`
 * by `deno task build:worker`). `deno task build:cf` makes both.
 */

import { bindings, defineConfig } from "cf/config";

export default defineConfig({
  // Not a secret: it is only an identifier, and the API token is what authorizes.
  accountId: "ac92f36f0a2d84353b137574157f7480",
  worker: {
    name: "deno-remix-tmpl",
    compatibilityDate: "2026-10-01",
    entrypoint: "./web/worker-dist/worker.js",
    assets: {
      htmlHandling: "auto-trailing-slash",
      notFoundHandling: "none",
      // Only these reach the Worker; every other path is a static file.
      runWorkerFirst: ["/api/*", "/.well-known/jwks.json"],
    },
    env: {
      IDP_ORIGIN: bindings.text("https://id.kbn.one"),
      RP_ORIGIN: bindings.text("https://deno-remix-tmpl.kuboon.workers.dev"),
      // Secrets, set once with `deno task cf workers secrets update <NAME> --worker deno-remix-tmpl
      // --type secret_text --text ...`; declared here so a deploy keeps them.
      RP_SIGNING_KEY_JWK: bindings.secret(),
      TURSO_DATABASE_URL: bindings.text(
        "libsql://deno-remix-reference-kuboon.aws-ap-northeast-1.turso.io",
      ),
      TURSO_AUTH_TOKEN: bindings.secret(),
    },
  },
});
