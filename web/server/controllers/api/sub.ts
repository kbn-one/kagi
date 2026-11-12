/**
 * /api/sub/:id/* — the kagi API. Every action hands the request to the subscription's room
 * (`lib/kagi/`), which lives in memory locally and in a Durable Object on Cloudflare.
 */

import { createController } from "@remix-run/fetch-router";

import { routes } from "../../../client/routes.ts";
import { kagiHub } from "../../lib/kagi/hub.ts";
import { type RoomAction, SUB_ID } from "../../lib/kagi/room.ts";
import { problem } from "../../lib/problem.ts";

const to = (action: RoomAction) =>
(
  { params, request }: {
    params: Record<string, string | undefined>;
    request: Request;
  },
): Promise<Response> | Response => {
  const id = params.id ?? "";
  return SUB_ID.test(id)
    ? kagiHub().dispatch(id, action, request)
    : problem({ status: 404, detail: "No such subscription" });
};

export const subController = createController(routes.api.sub, {
  actions: {
    register: to("register"),
    req: to("req"),
    res: to("res"),
    ws: to("ws"),
  },
});
