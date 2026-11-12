import { assert, assertEquals } from "@std/assert";

import {
  challengeMessage,
  type ClientMessage,
  type ServerMessage,
} from "../../../client/lib/kagi/protocol.ts";
import { createMemoryHub, type KagiHub } from "./hub.ts";
import { parseSubPath, PENDING_TTL_MS, type Upgrade } from "./room.ts";

/** The server's half of a WebSocket, driven by the test as the phone. */
class FakeSocket extends EventTarget {
  readyState: number = WebSocket.OPEN;
  readonly inbox: ServerMessage[] = [];
  #waiting: ((m: ServerMessage) => void)[] = [];
  closed?: number;

  send(text: string) {
    const m = JSON.parse(text) as ServerMessage;
    const next = this.#waiting.shift();
    if (next) next(m);
    else this.inbox.push(m);
  }
  close(code?: number) {
    this.closed = code;
    this.readyState = WebSocket.CLOSED;
    this.dispatchEvent(new Event("close"));
  }
  /** The phone sends. */
  emit(m: ClientMessage) {
    this.dispatchEvent(
      new MessageEvent("message", { data: JSON.stringify(m) }),
    );
  }
  /** The next message the server sends the phone. */
  next(): Promise<ServerMessage> {
    const m = this.inbox.shift();
    return m ? Promise.resolve(m) : new Promise((r) => this.#waiting.push(r));
  }
}

const SUB = "abcdefghijklmnopqrstuv";
const base = `http://x/api/sub/${SUB}`;

async function setup(now = () => Date.now()) {
  const sockets: FakeSocket[] = [];
  const upgrade: Upgrade = () => {
    const socket = new FakeSocket();
    sockets.push(socket);
    return {
      socket: socket as unknown as WebSocket,
      response: new Response(null, { status: 200 }),
    };
  };
  const notified: string[] = [];
  const hub = createMemoryHub({
    upgrade,
    notify: (_reg, tx) => {
      notified.push(tx.id);
      return Promise.resolve(true);
    },
    now,
  });
  const keys = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const publicKey = await crypto.subtle.exportKey("jwk", keys.publicKey);
  const reg = await hub.dispatch(
    SUB,
    "register",
    new Request(base, {
      method: "PUT",
      body: JSON.stringify({ userId: "u1", publicKey }),
    }),
  );
  assertEquals(reg.status, 201);

  /** Opens the phone's socket and authenticates it. */
  const connect = async (key = keys.privateKey) => {
    await hub.dispatch(
      SUB,
      "ws",
      new Request(`${base}/ws`, { headers: { upgrade: "websocket" } }),
    );
    const socket = sockets.at(-1)!;
    const challenge = await socket.next();
    assert(challenge.type === "challenge");
    const signature = new Uint8Array(
      await crypto.subtle.sign(
        { name: "ECDSA", hash: "SHA-256" },
        key,
        new TextEncoder().encode(challengeMessage(SUB, challenge.nonce)),
      ),
    ).toBase64({ alphabet: "base64url", omitPadding: true });
    socket.emit({ type: "auth", signature });
    return socket;
  };
  return { hub, connect, notified };
}

const submit = (hub: KagiHub, body: unknown) =>
  hub.dispatch(
    SUB,
    "req",
    new Request(`${base}/req`, { method: "POST", body: JSON.stringify(body) }),
  );

const result = (hub: KagiHub, txId: string, wait = 5) =>
  hub.dispatch(
    SUB,
    "res",
    new Request(`${base}/res?transaction_id=${txId}&wait=${wait}`),
  );

const ghRequest = {
  secrets: ["GH_SECRET"],
  url: "https://api.github.com/user",
  headers: { authorization: "Bearer [GH_SECRET]" },
};

Deno.test("approve → done → requester gets the result once", async () => {
  const { hub, connect, notified } = await setup();
  const phone = await connect();
  assertEquals(await phone.next(), { type: "ready", transactions: [] });

  const res = await submit(hub, ghRequest);
  assertEquals(res.status, 202);
  const { transaction_id: txId, notified: pushed } = await res.json();
  assertEquals(pushed, true);
  assertEquals(notified, [txId]);

  const announced = await phone.next();
  assert(announced.type === "tx");
  assertEquals(announced.transaction.request, ghRequest);

  const waiting = result(hub, txId);
  phone.emit({ type: "decision", txId, approved: true });
  assertEquals((await phone.next()).type, "tx"); // approved
  phone.emit({ type: "done", txId });
  assertEquals((await phone.next()).type, "tx"); // done
  assertEquals(await phone.next(), { type: "get", txId });
  const answer = { status: 200, headers: {}, body: '{"login":"me"}' };
  phone.emit({ type: "result", txId, result: answer });

  const got = await waiting;
  assertEquals(got.status, 200);
  assertEquals((await got.json()).response, answer);

  const again = await result(hub, txId);
  assertEquals(again.status, 410);
  assertEquals((await again.json()).transaction_status, "delivered");
});

Deno.test("a result finished before anyone asked is fetched from the phone on GET", async () => {
  const { hub, connect } = await setup();
  const phone = await connect();
  await phone.next(); // ready
  const { transaction_id: txId } = await (await submit(hub, ghRequest)).json();
  await phone.next(); // tx
  phone.emit({ type: "decision", txId, approved: true });
  phone.emit({ type: "done", txId });
  await phone.next();
  await phone.next();

  const waiting = result(hub, txId);
  assertEquals(await phone.next(), { type: "get", txId });
  phone.emit({
    type: "result",
    txId,
    result: { status: 204, headers: {}, body: "" },
  });
  assertEquals((await (await waiting).json()).response.status, 204);
});

Deno.test("a phone that reconnects is asked for results a requester is waiting on", async () => {
  const { hub, connect } = await setup();
  const first = await connect();
  await first.next();
  const { transaction_id: txId } = await (await submit(hub, ghRequest)).json();
  first.emit({ type: "decision", txId, approved: true });
  first.emit({ type: "done", txId });
  first.close();

  const waiting = result(hub, txId);
  const second = await connect();
  const ready = await second.next();
  assert(ready.type === "ready");
  assertEquals(ready.transactions.map((t) => t.status), ["done"]);
  assertEquals(await second.next(), { type: "get", txId });
  second.emit({
    type: "result",
    txId,
    result: { status: 200, headers: {}, body: "ok" },
  });
  assertEquals((await waiting).status, 200);
});

Deno.test("rejection and failure are final problems", async () => {
  const { hub, connect } = await setup();
  const phone = await connect();
  await phone.next();

  const a = (await (await submit(hub, ghRequest)).json()).transaction_id;
  const waiting = result(hub, a);
  phone.emit({ type: "decision", txId: a, approved: false });
  const rejected = await waiting;
  assertEquals(rejected.status, 403);
  assertEquals(
    rejected.headers.get("content-type"),
    "application/problem+json",
  );
  assertEquals((await rejected.json()).transaction_status, "rejected");

  const b = (await (await submit(hub, ghRequest)).json()).transaction_id;
  phone.emit({ type: "decision", txId: b, approved: true });
  phone.emit({ type: "result", txId: b, error: "Failed to fetch" });
  // Let the socket handlers run.
  await new Promise((r) => setTimeout(r, 10));
  const failed = await result(hub, b);
  assertEquals(failed.status, 502);
  assert((await failed.json()).detail.includes("Failed to fetch"));
});

Deno.test("GET /res answers 202 while the approver has not decided", async () => {
  const { hub } = await setup();
  const { transaction_id: txId } = await (await submit(hub, ghRequest)).json();
  const res = await result(hub, txId, 0);
  assertEquals(res.status, 202);
  assertEquals(res.headers.get("retry-after"), "1");
  assertEquals(await res.json(), { transaction_id: txId, status: "pending" });
});

Deno.test("an undecided request expires", async () => {
  let t = 1_000_000;
  const { hub } = await setup(() => t);
  const { transaction_id: txId } = await (await submit(hub, ghRequest)).json();
  t += PENDING_TTL_MS + 1;
  const res = await result(hub, txId, 0);
  assertEquals(res.status, 410);
  assertEquals((await res.json()).transaction_status, "expired");
});

Deno.test("a wrong device key cannot open the approver socket", async () => {
  const { connect } = await setup();
  const other = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign", "verify"],
  );
  const socket = await connect(other.privateKey);
  const m = await socket.next();
  assertEquals(m.type, "error");
  await new Promise((r) => setTimeout(r, 0));
  assertEquals(socket.closed, 4401);
});

Deno.test("requests are validated and unknown ids are 404", async () => {
  const { hub } = await setup();
  const cases: [unknown, string][] = [
    [{ secrets: ["A"], url: "https://x/[B]" }, "[B]"],
    [{ secrets: ["A"], url: "https://x/" }, "not used"],
    [{ secrets: ["A"], url: "https://[A].evil/" }, "host"],
    [{ secrets: [], url: "ftp://x/" }, "http"],
    [{ secrets: [], url: "https://x/", method: "TRACE" }, "method"],
  ];
  for (const [body, fragment] of cases) {
    const res = await submit(hub, body);
    assertEquals(res.status, 400, JSON.stringify(body));
    assert((await res.json()).detail.includes(fragment), fragment);
  }

  const other = createMemoryHub({ notify: () => Promise.resolve(false) });
  const res = await other.dispatch(
    SUB,
    "req",
    new Request(`${base}/req`, {
      method: "POST",
      body: JSON.stringify(ghRequest),
    }),
  );
  assertEquals(res.status, 404);
});

Deno.test("an id cannot be registered twice", async () => {
  const { hub } = await setup();
  const res = await hub.dispatch(
    SUB,
    "register",
    new Request(base, {
      method: "PUT",
      body: JSON.stringify({
        userId: "attacker",
        publicKey: { kty: "EC", crv: "P-256", x: "a", y: "b" },
      }),
    }),
  );
  assertEquals(res.status, 409);
});

Deno.test("parseSubPath reads the id and action off a URL", () => {
  assertEquals(parseSubPath(`/api/sub/${SUB}`, "PUT"), {
    subId: SUB,
    action: "register",
  });
  assertEquals(parseSubPath(`/api/sub/${SUB}/res`, "GET"), {
    subId: SUB,
    action: "res",
  });
  assertEquals(parseSubPath(`/api/sub/${SUB}`, "GET"), null);
  assertEquals(parseSubPath(`/api/sub/short/req`, "POST"), null);
});
