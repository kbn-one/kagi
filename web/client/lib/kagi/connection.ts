/**
 * The approver's WebSocket to its subscription (`/api/sub/:id/ws`).
 *
 * Authenticates with the device key, keeps the list of open transactions, and reconnects with a
 * backoff while the page is visible. Results are held here, in memory only, until the server
 * relays a requester's `get` — they never touch storage.
 */

import type {
  ClientMessage,
  KagiResult,
  ServerMessage,
  Transaction,
} from "./protocol.ts";
import { signChallenge } from "./device.ts";
import { routes } from "../../routes.ts";

export type ConnectionState = "connecting" | "online" | "offline";

export interface KagiConnection {
  readonly state: ConnectionState;
  readonly transactions: Map<string, Transaction>;
  decide(txId: string, approved: boolean): void;
  /** The call finished: keep its result until asked. */
  complete(txId: string, result: KagiResult): void;
  fail(txId: string, error: string): void;
  close(): void;
}

export function connect(
  subId: string,
  onChange: () => void,
): KagiConnection {
  const transactions = new Map<string, Transaction>();
  const results = new Map<string, KagiResult>();
  let state: ConnectionState = "connecting";
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
            break;
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
