/**
 * End-to-end check that `@remix-run/data-table` drives Turso's async libSQL
 * client (`@remix-kbn/data-table-sqlite-turso`). Runs against an in-memory
 * libSQL database via `@libsql/client/node` — no network or Turso credentials
 * needed — exercising the same `createTursoSample` code path the app uses.
 *
 * Lives under `web/tests` so it runs with `-A` (the native libSQL addon
 * needs FFI), separate from the `-P` unit tests.
 */

import { assertEquals } from "@std/assert";
import { createClient } from "@libsql/client/node";

import { createTursoSample, visits } from "../server/lib/turso/db.ts";

Deno.test("data-table create/count/findMany over in-memory libSQL", async () => {
  const client = createClient({ url: ":memory:" });
  const turso = createTursoSample(client);
  await turso.ensureSchema();

  await turso.db.create(visits, { at: "2026-01-01T00:00:00.000Z" });
  await turso.db.create(visits, { at: "2026-01-02T00:00:00.000Z" });
  await turso.db.create(visits, { at: "2026-01-03T00:00:00.000Z" });

  const total = await turso.db.count(visits);
  assertEquals(total, 3);

  const recent = await turso.db.findMany(visits, {
    orderBy: ["id", "desc"],
    limit: 2,
  });
  assertEquals(recent.map((row) => row.at), [
    "2026-01-03T00:00:00.000Z",
    "2026-01-02T00:00:00.000Z",
  ]);

  client.close();
});
