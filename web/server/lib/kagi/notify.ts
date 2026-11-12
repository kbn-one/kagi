/**
 * The push that tells the approver a request is waiting, sent through id.kbn.one
 * (`lib/push/client.ts`) to every device the approver registered there.
 */

import type { Transaction } from "../../../client/lib/kagi/protocol.ts";
import { secretNamesOf, summarize } from "../../../client/lib/kagi/protocol.ts";
import { routes } from "../../../client/routes.ts";
import { getConfig } from "../../config.ts";
import { sendRpNotification } from "../push/client.ts";
import type { Registration } from "./room.ts";

/** The approval page for a transaction, absolute when `RP_ORIGIN` is known. */
export const approvalUrl = (tx: Transaction): string => {
  const path = `${routes.kagi.href()}?tx=${encodeURIComponent(tx.id)}`;
  const { rpOrigin } = getConfig();
  return rpOrigin ? new URL(path, rpOrigin).href : path;
};

export async function notifyApprover(
  registration: Registration,
  tx: Transaction,
): Promise<boolean> {
  const { request } = tx;
  const secrets = secretNamesOf(request);
  const results = await sendRpNotification({
    userIds: [registration.userId],
    notification: {
      title: "kagi: 承認リクエスト",
      body: `${summarize(request)}\n秘密: ${secrets.join(", ") || "なし"}`,
      url: approvalUrl(tx),
      tag: `kagi-${tx.id}`,
      requireInteraction: true,
      urgency: "high",
      ttl: 600,
    },
  });
  return results.some((r) => r.ok);
}
