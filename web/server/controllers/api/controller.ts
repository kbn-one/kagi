/**
 * /api/protected — DPoP-protected JSON endpoints.
 *
 * Both actions require a valid DPoP proof (see `middleware/dpop.ts`).
 * GET returns the session payload; POST merges the request body into it.
 */

import { createController } from "@remix-run/fetch-router";

import { problem } from "../../lib/problem.ts";
import { dpop, DpopSession } from "../../middleware/dpop.ts";
import { routes } from "../../../client/routes.ts";

export const apiController = createController(routes.api.protected, {
  middleware: [dpop],
  actions: {
    get(context) {
      const session = context.get(DpopSession);
      const [data] = session.data;
      return Response.json({
        thumbprint: session.thumbprint,
        sessionData: data,
        message: "DPoP proof verified successfully",
      });
    },

    async post(context) {
      const session = context.get(DpopSession);
      let body: unknown;
      try {
        body = await context.request.json();
      } catch {
        return problem({ status: 400, detail: "Invalid JSON body" });
      }
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return problem({ status: 400, detail: "Body must be a JSON object" });
      }
      for (const [k, v] of Object.entries(body)) {
        session.set(k, v);
      }
      const [data] = session.data;

      return Response.json({
        thumbprint: session.thumbprint,
        sessionData: data,
        message: "Session data updated",
      });
    },
  },
});
