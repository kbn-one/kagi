/**
 * GET /api/turso — Turso (libSQL) sample via `@remix-run/data-table`.
 *
 * Records a visit and returns the running total plus the most recent
 * timestamps, using the relational data-table API (`create` / `count` /
 * `findMany`) backed by the async Turso adapter (see lib/turso/db.ts). Returns
 * 503 when unconfigured so the app still runs without a database.
 */

import type { Action } from "@remix-run/fetch-router";
import type { routes } from "../../../client/routes.ts";
import { problem } from "../../lib/problem.ts";
import { getTursoDb, visits } from "../../lib/turso/db.ts";

export const tursoAction = {
  async handler(): Promise<Response> {
    const turso = getTursoDb();
    if (!turso) {
      return problem({
        status: 503,
        detail:
          "Turso is not configured. Set TURSO_DATABASE_URL (and TURSO_AUTH_TOKEN) to enable this sample.",
        configured: false,
      });
    }

    try {
      await turso.ensureSchema();
      await turso.db.create(visits, { at: new Date().toISOString() });
      const total = await turso.db.count(visits);
      const rows = await turso.db.findMany(visits, {
        orderBy: ["id", "desc"],
        limit: 5,
      });
      const recent = rows.map((row) => row.at);

      return Response.json({ configured: true, total, recent });
    } catch (error) {
      return problem({
        status: 502,
        detail: error instanceof Error ? error.message : "Turso query failed",
      });
    }
  },
} satisfies Action<typeof routes.api.turso>;
