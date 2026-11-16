/**
 * The push that tells the approver a request is waiting, sent by this server itself
 * (`@remix-kbn/web-push`) to the push subscription the approver's phone stored with its
 * registration.
 *
 * The VAPID key pair is the `VAPID_KEYS` secret. Without it, a Deno process (`deno serve`, tests)
 * makes one up, which lasts until the process exits; a Worker has no push at all, rather than a
 * key per isolate that would break every subscription made against another isolate.
 */

import {
  createPushSender,
  generateVapidKeys,
  importVapidKeys,
  type PushSender,
  type PushSubscriptionData,
} from "@remix-kbn/web-push/server";

import type { Transaction } from "../../../client/lib/kagi/protocol.ts";
import { secretNamesOf, summarize } from "../../../client/lib/kagi/protocol.ts";
import { routes } from "../../../client/routes.ts";
import { getConfig } from "../../config.ts";

/** How a push went: delivered to the push service, the subscription is dead, or it failed. */
export type NotifyOutcome = "sent" | "gone" | "failed";

/** What a room needs from the push: the key phones subscribe with, and the send. */
export interface ApprovalPush {
  /** The VAPID public key (base64url), or null when push is not configured. */
  applicationServerKey(): Promise<string | null>;
  notify(
    subscription: PushSubscriptionData,
    tx: Transaction,
  ): Promise<NotifyOutcome>;
}

/** The approval page for a transaction. The service worker resolves it against its own origin. */
export const approvalUrl = (tx: Transaction): string =>
  `${routes.kagi.href()}?tx=${encodeURIComponent(tx.id)}`;

let sender: Promise<PushSender | null> | undefined;

function pushSender(): Promise<PushSender | null> {
  return sender ??= (async () => {
    const { vapidKeys, pushContact } = getConfig();
    let keys: CryptoKeyPair;
    if (vapidKeys) {
      keys = await importVapidKeys(JSON.parse(vapidKeys));
    } else if ((globalThis as { Deno?: unknown }).Deno) {
      keys = await generateVapidKeys();
    } else {
      console.error("kagi: VAPID_KEYS is not set; approval pushes are off");
      return null;
    }
    return createPushSender({ vapidKeys: keys, contact: pushContact });
  })();
}

/** The push as sent through `VAPID_KEYS`. */
export const approvalPush: ApprovalPush = {
  async applicationServerKey() {
    return (await pushSender())?.applicationServerKey ?? null;
  },
  async notify(subscription, tx) {
    const push = await pushSender();
    if (!push) return "failed";
    const { request } = tx;
    const secrets = secretNamesOf(request);
    const result = await push.send(subscription, {
      title: "kagi: 承認リクエスト",
      body: `${summarize(request)}\n秘密: ${secrets.join(", ") || "なし"}`,
      url: approvalUrl(tx),
      tag: `kagi-${tx.id}`,
      requireInteraction: true,
      data: { txId: tx.id },
    }, { urgency: "high", ttl: 600 });
    if (result.ok) return "sent";
    console.error("kagi: push refused:", result.error.message);
    return result.gone ? "gone" : "failed";
  },
};
