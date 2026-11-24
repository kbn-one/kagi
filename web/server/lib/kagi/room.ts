/**
 * One approver subscription (`/api/sub/:id/*`): its registration, its transactions, the approver's
 * WebSockets, and the requesters waiting on `GET /res`.
 *
 * The same class runs in two places. Locally (`deno serve`, tests) `hub.ts` keeps one per id in
 * memory. On Cloudflare each id is a Durable Object (`durable_object.ts`), which is what makes the
 * requester's `GET /res` and the phone's WebSocket meet in one process: Workers isolates share
 * nothing, a Durable Object is a single instance per id.
 *
 * The server never sees a secret. It holds the request text, tells the phone, and relays the
 * phone's (already scrubbed) answer to whoever asks for it — once. (A call the approver has the
 * server make, `relay.ts`, is only authorized here: its body never reaches the room.)
 */

import {
  challengeMessage,
  type ClientMessage,
  FINAL_STATUSES,
  isHttpRequest,
  type KagiResult,
  parseKagiRequest,
  PENDING_TTL_MS,
  RELAY_HEADERS,
  relayMessage,
  type ServerMessage,
  type Transaction,
  TX_RETENTION_MS,
  type TxStatus,
} from "../../../client/lib/kagi/protocol.ts";
import { parsePushSubscription } from "@remix-kbn/web-push";
import type { PushSubscriptionData } from "@remix-kbn/web-push/server";

import { problem } from "../problem.ts";
import type { ApprovalPush } from "./notify.ts";
import { relayTargetProblem } from "./relay_target.ts";

/** The subset of Durable Object storage (`ctx.storage`) the room uses. */
export interface RoomStorage {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<unknown>;
  list<T>(options: { prefix: string }): Promise<Map<string, T>>;
}

export type Upgrade = (
  request: Request,
) => { socket: WebSocket; response: Response };

export interface RoomDeps {
  storage: RoomStorage;
  upgrade: Upgrade;
  /** Tells the approver about a new transaction (`notify.ts`). */
  push: ApprovalPush;
  now?: () => number;
}

export interface Registration {
  subId: string;
  /** The approver's device key (ECDSA P-256), which signs the WebSocket challenge. */
  publicKey: JsonWebKey;
  /** Where to push the approver, set over the authenticated WebSocket. */
  push?: PushSubscriptionData;
  createdAt: number;
}

/** Longest a `GET /res` may wait, and its default. */
export const MAX_WAIT_SECONDS = 55;
export const DEFAULT_WAIT_SECONDS = 25;
export { PENDING_TTL_MS, TX_RETENTION_MS };
export const MAX_OPEN_TRANSACTIONS = 20;
export const MAX_REQUEST_BYTES = 64 * 1024;

type Outcome =
  | { kind: "result"; result: KagiResult }
  | { kind: "final"; tx: Transaction };

const REG_KEY = "registration";
/**
 * Left behind when the approver retires the id (`unregister`), so it is never registered again:
 * someone who learnt the old URL cannot claim it and receive what agents still send there.
 */
const RETIRED_KEY = "retired";
const txKey = (id: string) => `tx:${id}`;

const randomId = (bytes = 16): string =>
  crypto.getRandomValues(new Uint8Array(bytes)).toBase64({
    alphabet: "base64url",
    omitPadding: true,
  });

export const SUB_ID = /^[A-Za-z0-9_-]{16,64}$/;

export type RoomAction = "register" | "req" | "res" | "ws" | "relay";

/** `/…/sub/:id[/req|/res|/ws|/relay]` → the id and action, or null. Used where only the URL is known. */
export function parseSubPath(
  pathname: string,
  method: string,
): { subId: string; action: RoomAction } | null {
  const m = pathname.match(/\/api\/sub\/([^/]+)(?:\/(req|res|ws|relay))?\/?$/);
  if (!m || !SUB_ID.test(m[1])) return null;
  const action = (m[2] ?? (method === "PUT" ? "register" : null)) as
    | RoomAction
    | null;
  return action ? { subId: m[1], action } : null;
}

export class Room {
  readonly #subId: string;
  readonly #deps: RoomDeps;
  readonly #now: () => number;
  /** Authenticated approver sockets. */
  readonly #sockets = new Set<WebSocket>();
  /** Requesters waiting on `GET /res`, by transaction id. */
  readonly #waiters = new Map<string, Set<(o: Outcome) => void>>();
  /** Approver messages run one at a time, in arrival order: each reads what the last wrote. */
  #queue: Promise<void> = Promise.resolve();

  constructor(subId: string, deps: RoomDeps) {
    this.#subId = subId;
    this.#deps = deps;
    this.#now = deps.now ?? Date.now;
  }

  handle(request: Request, action: RoomAction): Promise<Response> {
    switch (action) {
      case "register":
        return this.#register(request);
      case "req":
        return this.#submit(request);
      case "res":
        return this.#result(request);
      case "ws":
        return this.#connect(request);
      case "relay":
        return this.#authorizeRelay(request);
    }
  }

  // --- registration ---------------------------------------------------------

  async #register(request: Request): Promise<Response> {
    const body = await readJson(request);
    if (body instanceof Response) return body;
    const { publicKey } = (body ?? {}) as Record<string, unknown>;
    if (!isP256PublicJwk(publicKey)) {
      return problem({
        status: 400,
        detail: "publicKey must be an EC P-256 public JWK",
      });
    }
    if (await this.#deps.storage.get(RETIRED_KEY)) return retiredSub();
    if (await this.#deps.storage.get(REG_KEY)) {
      return problem({
        status: 409,
        detail: "This subscription id is already registered",
      });
    }
    const { kty, crv, x, y } = publicKey;
    const registration: Registration = {
      subId: this.#subId,
      publicKey: { kty, crv, x, y },
      createdAt: this.#now(),
    };
    await this.#deps.storage.put(REG_KEY, registration);
    return Response.json({ id: this.#subId }, { status: 201 });
  }

  #registration(): Promise<Registration | undefined> {
    return this.#deps.storage.get<Registration>(REG_KEY);
  }

  /** The answer for an id with no registration: 410 once retired, 404 if it never was one. */
  async #missing(): Promise<Response> {
    return (await this.#deps.storage.get(RETIRED_KEY))
      ? retiredSub()
      : unknownSub();
  }

  /**
   * Retires the id: forgets the registration (and with it the push target) and every
   * transaction, answers anyone waiting, tells the approver, and closes its sockets.
   */
  async #unregister(): Promise<void> {
    const all = await this.#deps.storage.list<Transaction>({ prefix: "tx:" });
    for (const [key, tx] of all) {
      await this.#deps.storage.delete(key);
      this.#settle(tx.id, { kind: "final", tx: { ...tx, status: "expired" } });
    }
    await this.#deps.storage.put(RETIRED_KEY, { at: this.#now() });
    await this.#deps.storage.delete(REG_KEY);
    for (const socket of [...this.#sockets]) {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "unregistered" }));
        socket.close(4410, "unregistered");
      }
    }
    this.#sockets.clear();
  }

  // --- requester ------------------------------------------------------------

  async #submit(request: Request): Promise<Response> {
    const registration = await this.#registration();
    if (!registration) return this.#missing();

    const body = await readJson(request);
    if (body instanceof Response) return body;
    const parsed = parseKagiRequest(body);
    if (typeof parsed === "string") {
      return problem({ status: 400, detail: parsed });
    }

    const open = (await this.#transactions()).filter((t) =>
      !FINAL_STATUSES.includes(t.status)
    );
    if (open.length >= MAX_OPEN_TRANSACTIONS) {
      return problem({
        status: 429,
        detail: "Too many requests are waiting for the approver",
      });
    }

    const tx: Transaction = {
      id: crypto.randomUUID(),
      request: parsed,
      status: "pending",
      createdAt: this.#now(),
    };
    await this.#save(tx);
    this.#broadcast({ type: "tx", transaction: tx });

    const notified = await this.#notify(registration, tx);

    return Response.json(
      { transaction_id: tx.id, status: tx.status, notified },
      { status: 202 },
    );
  }

  /** Pushes `tx` to the approver; forgets a push subscription the push service says is dead. */
  async #notify(registration: Registration, tx: Transaction): Promise<boolean> {
    if (!registration.push) return false;
    let outcome;
    try {
      outcome = await this.#deps.push.notify(registration.push, tx);
    } catch (e) {
      console.error("kagi: push failed", e);
      return false;
    }
    if (outcome === "gone") {
      const current = await this.#registration();
      if (current?.push?.endpoint === registration.push.endpoint) {
        delete current.push;
        await this.#deps.storage.put(REG_KEY, current);
        this.#broadcast({ type: "push", registered: false });
      }
    }
    return outcome === "sent";
  }

  async #result(request: Request): Promise<Response> {
    if (!(await this.#registration())) return this.#missing();
    const url = new URL(request.url);
    const txId = url.searchParams.get("transaction_id");
    if (!txId) {
      return problem({ status: 400, detail: "transaction_id is required" });
    }
    const waitParam = Number(url.searchParams.get("wait") ?? NaN);
    const waitSeconds = Number.isFinite(waitParam)
      ? Math.min(Math.max(waitParam, 0), MAX_WAIT_SECONDS)
      : DEFAULT_WAIT_SECONDS;

    const tx = await this.#load(txId);
    if (!tx) {
      return problem({ status: 404, detail: "No such transaction" });
    }
    if (FINAL_STATUSES.includes(tx.status)) return finalResponse(tx);

    const outcome = await this.#wait(tx, waitSeconds * 1000, request.signal);
    if (!outcome) {
      const current = (await this.#load(txId)) ?? tx;
      if (FINAL_STATUSES.includes(current.status)) {
        return finalResponse(current);
      }
      return Response.json(
        { transaction_id: txId, status: current.status },
        { status: 202, headers: { "retry-after": "1" } },
      );
    }
    if (outcome.kind === "final") return finalResponse(outcome.tx);
    return Response.json({
      transaction_id: txId,
      status: "delivered" satisfies TxStatus,
      response: outcome.result,
    });
  }

  /** Waits for `tx` to finish, asking the phone for the result if it already has it. */
  #wait(
    tx: Transaction,
    ms: number,
    signal?: AbortSignal,
  ): Promise<Outcome | null> {
    return new Promise((resolve) => {
      let settled = false;
      const set = this.#waiters.get(tx.id) ?? new Set();
      this.#waiters.set(tx.id, set);
      const done = (o: Outcome | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        set.delete(listener);
        if (set.size === 0) this.#waiters.delete(tx.id);
        resolve(o);
      };
      const listener = (o: Outcome) => done(o);
      const abort = () => done(null);
      const timer = setTimeout(() => done(null), ms);
      signal?.addEventListener("abort", abort);
      set.add(listener);
      if (tx.status === "done") this.#broadcast({ type: "get", txId: tx.id });
    });
  }

  #settle(txId: string, outcome: Outcome): boolean {
    const set = this.#waiters.get(txId);
    if (!set?.size) return false;
    for (const listener of [...set]) listener(outcome);
    return true;
  }

  // --- relay ----------------------------------------------------------------

  /**
   * Whether the approver may have the server make the call of a transaction (`relay.ts`): signed by
   * the device key, once per transaction, and to a host the relay may call (`relay_target.ts`).
   * Answers `{ host }`, the only host the call may go to.
   *
   * A `pending` transaction is accepted too: the phone sends its `decision` over the WebSocket and
   * this right after, so this can arrive first, and the signature is the approver's say-so anyway.
   * The body (the call itself, with the secrets) never comes here.
   */
  async #authorizeRelay(request: Request): Promise<Response> {
    const registration = await this.#registration();
    if (!registration) return this.#missing();
    const txId = request.headers.get(RELAY_HEADERS.transaction);
    const signature = request.headers.get(RELAY_HEADERS.signature);
    if (!txId || !signature) {
      return problem({
        status: 401,
        detail:
          `${RELAY_HEADERS.transaction} and ${RELAY_HEADERS.signature} are required`,
      });
    }
    if (
      !(await verifyMessage(
        registration,
        relayMessage(registration.subId, txId),
        signature,
      ))
    ) {
      return problem({ status: 401, detail: "Bad signature" });
    }
    // In line with the approver's WebSocket messages, so two relays of one transaction cannot race.
    const run = this.#queue.then(async (): Promise<Response> => {
      const tx = await this.#load(txId);
      if (!tx) return problem({ status: 404, detail: "No such transaction" });
      if (!isHttpRequest(tx.request)) {
        return problem({
          status: 409,
          detail: "Only http requests are relayed",
        });
      }
      if (tx.status !== "pending" && tx.status !== "approved") {
        return problem({
          status: 409,
          detail: `The transaction is ${tx.status}`,
        });
      }
      if (tx.relayed) {
        return problem({
          status: 409,
          detail: "The transaction was already relayed",
        });
      }
      let host: string;
      try {
        host = new URL(tx.request.url).host;
      } catch {
        return problem({ status: 400, detail: "The request has no valid url" });
      }
      // Checked before the one relay is used up, so the phone can still make the call itself.
      const refused = relayTargetProblem(host, new URL(request.url).hostname);
      if (refused) return problem({ status: 403, detail: refused });
      tx.relayed = true;
      await this.#save(tx);
      return Response.json({ host }, {
        headers: { "cache-control": "no-store" },
      });
    });
    this.#queue = run.then(() => {}, () => {});
    return run;
  }

  // --- approver -------------------------------------------------------------

  async #connect(request: Request): Promise<Response> {
    const registration = await this.#registration();
    if (!registration) return this.#missing();
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return problem({
        status: 426,
        detail: "Expected a WebSocket upgrade",
      }, { upgrade: "websocket" });
    }

    const { socket, response } = this.#deps.upgrade(request);
    const nonce = randomId(32);
    let authed = false;

    const send = (m: ServerMessage) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(m));
    };
    const greet = () => send({ type: "challenge", nonce });
    if (socket.readyState === WebSocket.OPEN) greet();
    else socket.addEventListener("open", greet, { once: true });

    socket.addEventListener("message", (event) => {
      this.#queue = this.#queue.then(async () => {
        let msg: ClientMessage;
        try {
          msg = JSON.parse(String(event.data));
        } catch {
          return send({ type: "error", detail: "Invalid JSON" });
        }
        if (!authed) {
          if (msg.type !== "auth" || typeof msg.signature !== "string") {
            send({ type: "error", detail: "Authenticate first" });
            return socket.close(4401, "unauthenticated");
          }
          if (
            !(await verifyMessage(
              registration,
              challengeMessage(registration.subId, nonce),
              msg.signature,
            ))
          ) {
            send({ type: "error", detail: "Bad signature" });
            return socket.close(4401, "bad signature");
          }
          authed = true;
          this.#sockets.add(socket);
          // Everything still kept, finished ones too: the phone keeps its own history of them.
          const kept = await this.#transactions();
          send({
            type: "ready",
            transactions: kept,
            applicationServerKey: await this.#applicationServerKey(),
            push: !!(await this.#registration())?.push,
          });
          // A requester may have been waiting while the phone was away.
          for (const t of kept) {
            if (t.status === "done" && this.#waiters.has(t.id)) {
              send({ type: "get", txId: t.id });
            }
          }
          return;
        }
        await this.#onApproverMessage(msg, send);
      }).catch((e) => {
        console.error("kagi: websocket message failed", e);
        send({ type: "error", detail: "Internal error" });
      });
    });
    const drop = () => this.#sockets.delete(socket);
    socket.addEventListener("close", drop);
    socket.addEventListener("error", drop);

    return response;
  }

  #applicationServerKey(): Promise<string | null> {
    return this.#deps.push.applicationServerKey().catch((e) => {
      console.error("kagi: no VAPID key", e);
      return null;
    });
  }

  /** Stores where to push the approver. */
  async #setPush(
    value: unknown,
    send: (m: ServerMessage) => void,
  ): Promise<void> {
    const registration = await this.#registration();
    if (!registration) return;
    const parsed = parsePushSubscription(value);
    if (typeof parsed === "string") {
      return send({ type: "error", detail: parsed });
    }
    const { endpoint, keys: { p256dh, auth } } = parsed;
    const isNew = registration.push?.endpoint !== endpoint;
    registration.push = { endpoint, keys: { p256dh, auth } };
    if (isNew) {
      // Not awaited: the phone should hear `registered` now, and the push arrives on its own.
      const pushed = registration.push;
      void this.#deps.push.confirm(pushed).catch((e) =>
        console.error("kagi: confirmation push failed", e)
      );
    }
    await this.#deps.storage.put(REG_KEY, registration);
    send({ type: "push", registered: !!registration.push });
  }

  async #onApproverMessage(
    msg: ClientMessage,
    send: (m: ServerMessage) => void,
  ): Promise<void> {
    if (msg.type === "push") return this.#setPush(msg.subscription, send);
    if (msg.type === "unregister") return this.#unregister();
    if (msg.type === "auth" || typeof msg.txId !== "string") return;
    const tx = await this.#load(msg.txId);
    if (!tx || FINAL_STATUSES.includes(tx.status)) return;

    switch (msg.type) {
      case "decision": {
        if (tx.status !== "pending") return;
        tx.status = msg.approved ? "approved" : "rejected";
        await this.#save(tx);
        this.#broadcast({ type: "tx", transaction: tx });
        if (!msg.approved) this.#settle(tx.id, { kind: "final", tx });
        return;
      }
      case "done": {
        if (tx.status !== "approved") return;
        tx.status = "done";
        await this.#save(tx);
        this.#broadcast({ type: "tx", transaction: tx });
        if (this.#waiters.has(tx.id)) {
          this.#broadcast({ type: "get", txId: tx.id });
        }
        return;
      }
      case "result": {
        if (msg.error !== undefined || !msg.result) {
          if (tx.status !== "approved" && tx.status !== "done") return;
          tx.status = "failed";
          tx.error = String(msg.error ?? "No result").slice(0, 500);
          await this.#save(tx);
          this.#broadcast({ type: "tx", transaction: tx });
          this.#settle(tx.id, { kind: "final", tx });
          return;
        }
        if (tx.status !== "done" && tx.status !== "approved") return;
        if (!isResult(msg.result)) return;
        // Delivered only if someone was there to take it; otherwise the phone keeps it.
        if (this.#settle(tx.id, { kind: "result", result: msg.result })) {
          tx.status = "delivered";
          await this.#save(tx);
          this.#broadcast({ type: "tx", transaction: tx });
        }
        return;
      }
    }
  }

  #broadcast(m: ServerMessage): void {
    const text = JSON.stringify(m);
    for (const s of this.#sockets) {
      if (s.readyState === WebSocket.OPEN) s.send(text);
    }
  }

  // --- storage --------------------------------------------------------------

  #save(tx: Transaction): Promise<void> {
    return this.#deps.storage.put(txKey(tx.id), tx);
  }

  /** A transaction, with `expired` applied. */
  async #load(id: string): Promise<Transaction | undefined> {
    const tx = await this.#deps.storage.get<Transaction>(txKey(id));
    return tx && this.#expire(tx);
  }

  /** Every transaction still kept, oldest first; forgets the ones past retention. */
  async #transactions(): Promise<Transaction[]> {
    const all = await this.#deps.storage.list<Transaction>({ prefix: "tx:" });
    const out: Transaction[] = [];
    for (const [key, tx] of all) {
      if (this.#now() - tx.createdAt > TX_RETENTION_MS) {
        await this.#deps.storage.delete(key);
        continue;
      }
      out.push(await this.#expire(tx));
    }
    return out.sort((a, b) => a.createdAt - b.createdAt);
  }

  async #expire(tx: Transaction): Promise<Transaction> {
    if (
      (tx.status === "pending" || tx.status === "approved") &&
      this.#now() - tx.createdAt > PENDING_TTL_MS
    ) {
      tx.status = "expired";
      await this.#save(tx);
    }
    return tx;
  }
}

// --- helpers ----------------------------------------------------------------

const unknownSub = () =>
  problem({ status: 404, detail: "No such subscription" });

const retiredSub = () =>
  problem({
    status: 410,
    detail:
      "This subscription was turned off by its approver. Ask the human for the new URL.",
  });

async function readJson(request: Request): Promise<unknown | Response> {
  const text = await request.text();
  if (text.length > MAX_REQUEST_BYTES) {
    return problem({ status: 413, detail: "Request body is too large" });
  }
  try {
    return JSON.parse(text);
  } catch {
    return problem({ status: 400, detail: "Invalid JSON body" });
  }
}

function finalResponse(tx: Transaction): Response {
  const base = { transaction_id: tx.id, transaction_status: tx.status };
  switch (tx.status) {
    case "rejected":
      return problem({
        status: 403,
        detail: "The approver rejected the request",
        ...base,
      });
    case "failed":
      return problem({
        status: 502,
        detail: `The approver's call failed: ${tx.error ?? "unknown error"}`,
        ...base,
      });
    case "expired":
      return problem({
        status: 410,
        detail: "Nobody approved the request in time",
        ...base,
      });
    default:
      return problem({
        status: 410,
        detail: "The result has already been delivered",
        ...base,
      });
  }
}

function isP256PublicJwk(v: unknown): v is JsonWebKey {
  if (!v || typeof v !== "object") return false;
  const k = v as JsonWebKey;
  return k.kty === "EC" && k.crv === "P-256" && typeof k.x === "string" &&
    typeof k.y === "string" && k.d === undefined;
}

function isResult(v: unknown): v is KagiResult {
  if (!v || typeof v !== "object") return false;
  const r = v as KagiResult;
  return typeof r.status === "number" && typeof r.body === "string" &&
    !!r.headers && typeof r.headers === "object";
}

/** Whether the device key signed `message`. */
async function verifyMessage(
  registration: Registration,
  message: string,
  signature: string,
): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey(
      "jwk",
      registration.publicKey,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    return await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      Uint8Array.fromBase64(signature, { alphabet: "base64url" }),
      new TextEncoder().encode(message),
    );
  } catch {
    return false;
  }
}

/** An in-memory {@link RoomStorage}, for `deno serve` and the tests. */
export class MemoryStorage implements RoomStorage {
  readonly #map = new Map<string, unknown>();
  get<T>(key: string): Promise<T | undefined> {
    const v = this.#map.get(key);
    return Promise.resolve(
      v === undefined ? undefined : structuredClone(v as T),
    );
  }
  put<T>(key: string, value: T): Promise<void> {
    this.#map.set(key, structuredClone(value));
    return Promise.resolve();
  }
  delete(key: string): Promise<boolean> {
    return Promise.resolve(this.#map.delete(key));
  }
  list<T>({ prefix }: { prefix: string }): Promise<Map<string, T>> {
    const out = new Map<string, T>();
    for (const [k, v] of this.#map) {
      if (k.startsWith(prefix)) out.set(k, structuredClone(v as T));
    }
    return Promise.resolve(out);
  }
}
