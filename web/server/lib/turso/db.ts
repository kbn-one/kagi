/**
 * Turso (libSQL) sample wired through `@remix-run/data-table`.
 *
 * Uses `@remix-kbn/data-table-sqlite-turso` — an *asynchronous* SQLite
 * database for data-table — so the relational query API works against a remote
 * Turso database. (The upstream `@remix-run/data-table-sqlite` needs a
 * *synchronous* client like `node:sqlite`, which cannot drive remote Turso.)
 *
 * `createTursoSample(client)` is the reusable core: pass any `@libsql/client`
 * `Client` (remote, embedded replica, or a local `file:`/`:memory:` client in
 * tests). `getTursoDb()` is the app wrapper that builds a `@libsql/client/web`
 * client from the environment — the fetch/WebSocket build with no native addon,
 * so it runs on Cloudflare Workers (edge). Returns `null` when Turso is unconfigured.
 */

import { type Client, createClient } from "@libsql/client/web";
import { column, table } from "@remix-run/data-table";
import {
  createTursoDatabase,
  type TursoDatabase,
} from "@remix-kbn/data-table-sqlite-turso";

import { getConfig } from "../../config.ts";

/** The `visits` table: one row per request to `/api/turso`. */
export const visits = table({
  name: "visits",
  columns: {
    id: column.integer().primaryKey(),
    at: column.text().notNull(),
  },
});

const CREATE_VISITS =
  "CREATE TABLE IF NOT EXISTS visits (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL)";

export interface TursoSample {
  /** data-table handle bound to the Turso client. */
  readonly db: TursoDatabase;
  /** Creates the sample schema on first call (idempotent, cached). */
  ensureSchema(): Promise<void>;
}

/**
 * Build a {@link TursoDatabase} over the given libSQL client. The client choice
 * (remote / embedded / local) is the caller's — this is what makes the sample
 * testable against an in-memory database.
 */
export function createTursoSample(client: Client): TursoSample {
  const db = createTursoDatabase(client);
  let schema: Promise<void> | undefined;
  return {
    db,
    ensureSchema() {
      return (schema ??= db.executeScript(CREATE_VISITS));
    },
  };
}

let cached: TursoSample | null | undefined;

/**
 * The shared app database, or `null` when unconfigured. Built lazily from the
 * environment using the edge-friendly `@libsql/client/web` client.
 */
export function getTursoDb(): TursoSample | null {
  if (cached === undefined) {
    const { tursoDatabaseUrl, tursoAuthToken } = getConfig();
    cached = tursoDatabaseUrl
      ? createTursoSample(createClient({
        url: tursoDatabaseUrl,
        authToken: tursoAuthToken || undefined,
      }))
      : null;
  }
  return cached;
}
