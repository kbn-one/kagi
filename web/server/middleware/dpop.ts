/**
 * DPoP middleware — verifies RFC 9449 DPoP proofs on incoming requests and
 * exposes the session via `context.get(DpopSession)`.
 *
 * Thin wrapper over `@scope/remix-dpop-session-middleware` so controllers can
 * import a pre-configured middleware + re-export the context key from one
 * place. Sessions have a 1-hour TTL and live in Turso (libSQL) when
 * `TURSO_DATABASE_URL` is set. Otherwise they stay in memory, which is fine for
 * local development but is per-isolate on Cloudflare Workers, so configure
 * Turso there.
 */

import { createClient } from "@libsql/client/web";
import { MemoryKvRepo } from "@kuboon/kv/memory.ts";
import { TursoKvRepo } from "@kuboon/kv/turso.ts";
import { dpopSession } from "@scope/remix-dpop-session-middleware";
import { createKvSessionStorage } from "@scope/session-storage-kv";
import type { Session } from "@remix-run/session";

import { getConfig } from "../config.ts";

export { DpopSession } from "@scope/remix-dpop-session-middleware";

const options = { expireIn: 3_600_000 };
const { tursoDatabaseUrl, tursoAuthToken } = getConfig();

const sessionStorage = createKvSessionStorage(
  tursoDatabaseUrl
    ? new TursoKvRepo<Session["data"]>(
      createClient({
        url: tursoDatabaseUrl,
        authToken: tursoAuthToken || undefined,
      }),
      ["dpop-session"],
      options,
    )
    : new MemoryKvRepo<Session["data"]>(["dpop-session"], options),
);

export const dpop = dpopSession({ sessionStorage });
