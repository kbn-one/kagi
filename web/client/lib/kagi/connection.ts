/**
 * The approver's WebSocket to its subscription (`/api/sub/:id/ws`).
 *
 * Authenticates with the device key, keeps the list of open transactions, and reconnects with a
 * backoff while the page is visible. Results are held here, in memory only, until the server
 * relays a requester's `get` — they never touch storage.
 *
 * It also keeps the server's copy of this phone's push subscription current: once notifications
 * are allowed, every connection subscribes (no prompt, `@remix-kbn/web-push/client` reuses the
 * existing subscription or replaces one made with another key) and sends it. So a subscription the
 * push service dropped, or a new server key, mends itself the next time `/kagi` is opened.
 */

import {
  isPushSupported,
  subscribePush,
  unsubscribePush,
} from "@remix-kbn/web-push/client";

import type {
  ClientMessage,
  KagiResult,
  SealedResult,
  ServerMessage,
  Transaction,
} from "./protocol.ts";
import { signChallenge } from "./device.ts";
import { routes } from "../../routes.ts";

export type ConnectionState = "connecting" | "online" | "offline";

/**
 * Whether this phone gets pushed: `on`, `off` (it could be, press the button), `denied` (blocked in
 * the browser's settings), `unsupported` (no Push API, or iPhone outside the Home Screen app) or
 * `unavailable` (the server sends no pushes).
 */
export type PushState = "on" | "off" | "denied" | "unsupported" | "unavailable";

export interface KagiConnection {
  readonly state: ConnectionState;
  readonly transactions: Map<string, Transaction>;
  /** Unknown (null) until the connection is ready. */
  readonly push: PushState | null;
  /** Resolves once the server has accepted the device key; rejects after `ms`. */
  whenOnline(ms?: number): Promise<void>;
  /** Asks for notification permission (call it from a click) and starts the pushes. */
  enablePush(): Promise<void>;
  /**
   * Retires this subscription: the server forgets it and refuses its id from then on, and this
   * browser's push subscription is dropped too. Resolves once the server has confirmed; the
   * connection is closed after.
   */
  unregister(ms?: number): Promise<void>;
  decide(txId: string, approved: boolean): void;
  /** The call finished: keep its result until asked. */
  complete(txId: string, result: KagiResult | SealedResult): void;
  fail(txId: string, error: string): void;
  close(): void;
}

export function connect(
  subId: string,
  onChange: () => void,
): KagiConnection {
  const transactions = new Map<string, Transaction>();
  const results = new Map<string, KagiResult | SealedResult>();
  let state: ConnectionState = "connecting";
  let applicationServerKey: string | null = null;
  const onlineWaiters = new Set<() => void>();
  let onUnregistered: (() => void) | null = null;
  let pushStored = false;
  let socket: WebSocket | null = null;
  let closed = false;
  let retry = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const send = (m: ClientMessage) => {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(m));
  };

  const answer = (txId: string) => {
    const result = results.get(txId);
    if (result) {
      send({ type: "result", txId, result });
      results.delete(txId);
    } else {
      send({
        type: "result",
        txId,
        error: "The approver's device no longer has the result",
      });
    }
  };

  const open = () => {
    if (closed) return;
    state = "connecting";
    onChange();
    const url = new URL(routes.api.sub.ws.href({ id: subId }), location.href);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(url);
    socket = ws;

    ws.addEventListener("message", (event) => {
      void (async () => {
        const m = JSON.parse(String(event.data)) as ServerMessage;
        switch (m.type) {
          case "challenge":
            send({
              type: "auth",
              signature: await signChallenge(subId, m.nonce),
            });
            return;
          case "ready":
            retry = 0;
            state = "online";
            transactions.clear();
            for (const t of m.transactions) transactions.set(t.id, t);
            applicationServerKey = m.applicationServerKey;
            pushStored = m.push;
            for (const resolve of onlineWaiters) resolve();
            onlineWaiters.clear();
            // Allowed before: refresh what the server has, without a prompt.
            if (
              applicationServerKey && isPushSupported() &&
              Notification.permission === "granted"
            ) {
              void subscribe().catch((e) => console.warn("kagi: push", e));
            }
            break;
          case "push":
            pushStored = m.registered;
            break;
          case "unregistered":
            closed = true;
            onUnregistered?.();
            return;
          case "tx":
            transactions.set(m.transaction.id, m.transaction);
            break;
          case "get":
            answer(m.txId);
            return;
          case "error":
            console.warn("kagi:", m.detail);
            return;
        }
        onChange();
      })();
    });
    ws.addEventListener("close", () => {
      if (socket !== ws) return;
      socket = null;
      state = "offline";
      onChange();
      if (closed) return;
      // Hidden pages wait for `visibilitychange` instead of spinning.
      if (document.visibilityState === "visible") {
        timer = setTimeout(open, Math.min(30_000, 1000 * 2 ** retry++));
      }
    });
  };

  const subscribe = async () => {
    if (!applicationServerKey) throw new Error("サーバーが通知を送れません。");
    const subscription = await subscribePush({
      applicationServerKey,
      serviceWorkerUrl: "/sw.js",
    });
    send({ type: "push", subscription });
  };

  const pushState = (): PushState | null => {
    if (state !== "online") return null;
    if (!applicationServerKey) return "unavailable";
    if (!isPushSupported()) return "unsupported";
    if (Notification.permission === "denied") return "denied";
    return pushStored ? "on" : "off";
  };

  const onVisible = () => {
    if (document.visibilityState === "visible" && !socket && !closed) {
      clearTimeout(timer);
      open();
    }
  };
  document.addEventListener("visibilitychange", onVisible);
  open();

  return {
    get state() {
      return state;
    },
    transactions,
    get push() {
      return pushState();
    },
    whenOnline(ms = 15_000) {
      if (state === "online") return Promise.resolve();
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          onlineWaiters.delete(done);
          reject(
            new Error("サーバーにつながりません。電波を確かめてください。"),
          );
        }, ms);
        const done = () => {
          clearTimeout(timer);
          resolve();
        };
        onlineWaiters.add(done);
      });
    },
    async enablePush() {
      await subscribe();
    },
    async unregister(ms = 15_000) {
      await this.whenOnline(ms);
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          onUnregistered = null;
          reject(
            new Error("サーバーから応答がありません。もう一度試してください。"),
          );
        }, ms);
        onUnregistered = () => {
          clearTimeout(timer);
          onUnregistered = null;
          resolve();
        };
        send({ type: "unregister" });
      });
      this.close();
      // The server has forgotten it; the browser's subscription goes too, so the next
      // registration starts from a fresh push endpoint.
      await unsubscribePush().catch((e) =>
        console.warn("kagi: unsubscribe", e)
      );
    },
    decide: (txId, approved) => send({ type: "decision", txId, approved }),
    complete(txId, result) {
      results.set(txId, result);
      send({ type: "done", txId });
    },
    fail: (txId, error) => send({ type: "result", txId, error }),
    close() {
      closed = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      socket?.close();
    },
  };
}
