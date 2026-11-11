/**
 * POST /api/notify — demo endpoint for the server-initiated push path.
 *
 * Forwards `{ userIds, notification }` to the IdP via `sendRpNotification`,
 * which authenticates as this app with a `private_key_jwt` assertion. The IdP
 * fans the notification out to every device the named users registered.
 *
 * NOTE: this reference endpoint trusts its caller for `userIds`. A real app
 * must authorize the request (e.g. only allow sending to the signed-in user,
 * or restrict callers to trusted backends) before invoking the send helper.
 */

import type { Action } from "@remix-run/fetch-router";
import type { routes } from "../../../client/routes.ts";
import {
  type PushNotificationContent,
  sendRpNotification,
} from "../../lib/push/client.ts";
import { problem } from "../../lib/problem.ts";

const badRequest = (detail: string): Response =>
  problem({ status: 400, detail });

const parseNotification = (
  value: unknown,
): PushNotificationContent | null => {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.title !== "string" || !v.title.trim()) return null;
  if (typeof v.body !== "string" || !v.body.trim()) return null;
  const out: PushNotificationContent = { title: v.title, body: v.body };
  if (typeof v.url === "string" && v.url.trim()) out.url = v.url;
  if (typeof v.icon === "string" && v.icon.trim()) out.icon = v.icon;
  if (typeof v.tag === "string" && v.tag.trim()) out.tag = v.tag;
  // Demo: an arbitrary app-badge count. Accept any non-negative integer.
  if (
    typeof v.badgeCount === "number" && Number.isInteger(v.badgeCount) &&
    v.badgeCount >= 0
  ) {
    out.badgeCount = v.badgeCount;
  }
  return out;
};

export const notifyAction = {
  async handler(context) {
    let raw: unknown;
    try {
      raw = await context.request.json();
    } catch {
      return badRequest("Invalid JSON body");
    }
    const body = (raw ?? {}) as Record<string, unknown>;

    const userIds = Array.isArray(body.userIds)
      ? body.userIds.filter((x): x is string =>
        typeof x === "string" && x.length > 0
      )
      : [];
    if (userIds.length === 0) {
      return badRequest("userIds must be a non-empty array of strings");
    }

    const notification = parseNotification(body.notification);
    if (!notification) {
      return badRequest("notification must include a title and body");
    }

    try {
      const results = await sendRpNotification({ userIds, notification });
      return Response.json({ results });
    } catch (error) {
      return problem({
        status: 502,
        detail: error instanceof Error
          ? error.message
          : "Failed to send notification",
      });
    }
  },
} satisfies Action<typeof routes.api.notify>;
