import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";

import {
  type KagiResult,
  type RelayCall,
  type RelayFrame,
  relayMessage,
} from "../../../client/lib/kagi/protocol.ts";
import {
  type RelaySocket,
  sealedCall,
} from "../../../client/lib/kagi/relay_seal.ts";
import router from "../../router.tsx";
import { kagiHub } from "./hub.ts";
import {
  importRelayModule,
  loaderRunner,
  relay,
  RELAY_MODULE,
  type RelaySocketLike,
  setRelayRunner,
  type WorkerLoaderLike,
} from "./relay.ts";

const SECRET = "s3cret-value";

const call: RelayCall = {
  url: "https://api.example.com/v1/things?key=" + SECRET,
  method: "POST",
  headers: { authorization: `Bearer ${SECRET}`, "content-type": "text/plain" },
  body: `hello ${SECRET}`,
};

type Listener = (event: { data?: unknown }) => void;

/** One end of an in-memory WebSocket. */
class End implements RelaySocket, RelaySocketLike {
  peer!: End;
  readonly #listeners = new Map<string, Listener[]>();
  closed = false;
  constructor(readonly wire: string[]) {}
  addEventListener(type: string, listener: Listener) {
    this.#listeners.set(type, [...(this.#listeners.get(type) ?? []), listener]);
  }
  emit(type: string, event: { data?: unknown }) {
    for (const l of this.#listeners.get(type) ?? []) l(event);
  }
  send(data: string) {
    if (this.closed) return;
    // Everything that crosses is what the server in the middle would carry.
    this.wire.push(data);
    queueMicrotask(() => this.peer.emit("message", { data }));
  }
  close() {
    if (this.closed) return;
    this.closed = this.peer.closed = true;
    queueMicrotask(() => {
      this.emit("close", {});
      this.peer.emit("close", {});
    });
  }
}

/** A connected pair: the phone's end and the Dynamic Worker's, and the frames that crossed. */
function socketPair() {
  const wire: string[] = [];
  const phone = new End(wire);
  const worker = new End(wire);
  phone.peer = worker;
  worker.peer = phone;
  return { phone, worker, wire };
}

/** Swaps the global fetch (the module's) for the duration of `run`. */
async function withUpstream<T>(
  answer: (url: string, init?: RequestInit) => Response,
  run: (seen: { url: string; init?: RequestInit }[]) => Promise<T>,
): Promise<T> {
  const seen: { url: string; init?: RequestInit }[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = ((url: string | URL, init?: RequestInit) => {
    if (!String(url).startsWith("https://api.example.com/")) {
      return original(url, init);
    }
    seen.push({ url: String(url), init });
    return Promise.resolve(answer(String(url), init));
  }) as typeof fetch;
  try {
    return await run(seen);
  } finally {
    globalThis.fetch = original;
  }
}

/** Runs one relay between `sealedCall` and the module's `serve`. */
async function relayOnce(
  c: RelayCall,
  host = "api.example.com",
): Promise<{ result: Promise<KagiResult>; wire: string[] }> {
  const { serve } = await importRelayModule();
  const { phone, worker, wire } = socketPair();
  const result = sealedCall(phone, c);
  await serve(worker, host);
  return { result, wire };
}

Deno.test("relay: the call and its answer cross sealed, and the module calls the approved host", async () => {
  await withUpstream(
    (_url, init) =>
      new Response(`you sent ${init?.body}`, {
        status: 201,
        headers: { "x-echo": SECRET },
      }),
    async (seen) => {
      const { result, wire } = await relayOnce(call);
      const answer = await result;
      assertEquals(answer.status, 201);
      assertEquals(answer.body, `you sent hello ${SECRET}`);
      assertEquals(answer.headers["x-echo"], SECRET);

      assertEquals(seen.length, 1);
      assertEquals(seen[0].url, call.url);
      assertEquals(seen[0].init?.method, "POST");
      assertEquals(seen[0].init?.body, call.body);
      assertEquals(seen[0].init?.redirect, "manual");
      assertEquals(
        new Headers(seen[0].init?.headers).get("authorization"),
        `Bearer ${SECRET}`,
      );

      // What the server in between carried: key, call, result — and no secret, either way.
      const frames = wire.map((w) => JSON.parse(w) as RelayFrame);
      assertEquals(frames.map((f) => f.type), ["key", "call", "result"]);
      for (const w of wire) {
        assert(!w.includes(SECRET), w);
        assert(!w.includes("you sent"), w);
        assert(!w.includes("api.example.com"), w);
      }
    },
  );
});

Deno.test("relay: another host is refused, and the refusal is sealed too", async () => {
  await withUpstream(() => new Response("no"), async (seen) => {
    const { result, wire } = await relayOnce({
      ...call,
      url: `https://api.example.com.evil.example/?k=${SECRET}`,
    });
    const error = await assertRejects(() => result, Error);
    assertStringIncludes(error.message, "api.example.com.evil.example");
    assertEquals(seen.length, 0);
    for (const w of wire) assert(!w.includes("evil.example"), w);
  });
});

Deno.test("relay: only https", async () => {
  const { result } = await relayOnce({
    ...call,
    url: "http://api.example.com/",
  });
  await assertRejects(() => result, Error, "Only https");
});

Deno.test("relay: a redirect is handed back, not followed", async () => {
  await withUpstream(
    () =>
      new Response(null, {
        status: 302,
        headers: { location: "https://elsewhere.example/" },
      }),
    async (seen) => {
      const answer = await (await relayOnce(call)).result;
      assertEquals(answer.status, 302);
      assertEquals(answer.headers.location, "https://elsewhere.example/");
      assertEquals(seen.length, 1);
    },
  );
});

Deno.test("relay: a call sealed for another key does not open", async () => {
  const { serve } = await importRelayModule();
  const { phone, worker } = socketPair();
  const frames: RelayFrame[] = [];
  phone.addEventListener(
    "message",
    (e) => frames.push(JSON.parse(String(e.data))),
  );
  await serve(worker, "api.example.com");
  await new Promise((r) => setTimeout(r, 0));
  assertEquals(frames[0].type, "key");
  // A call from someone who does not hold the key the phone would derive.
  phone.send(JSON.stringify(
    {
      type: "call",
      publicKey: (frames[0] as { publicKey: string }).publicKey,
      iv: "AAAAAAAAAAAAAAAA",
      data: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    } satisfies RelayFrame,
  ));
  await new Promise((r) => setTimeout(r, 50));
  assertEquals(frames[1]?.type, "error");
  assert(worker.closed);
});

Deno.test("loaderRunner loads a fresh worker with only the host, one subrequest, no bindings", async () => {
  const loads: Parameters<WorkerLoaderLike["load"]>[0][] = [];
  const forwarded: Request[] = [];
  const loader: WorkerLoaderLike = {
    load(code) {
      loads.push(code);
      return {
        getEntrypoint: () => ({
          fetch: (r: Request) => {
            forwarded.push(r);
            return Promise.resolve(new Response(null, { status: 200 }));
          },
        }),
      };
    },
  };
  const run = loaderRunner(loader);
  const request = new Request("http://x/api/sub/abcdefghijklmnopqrstuv/relay", {
    headers: { upgrade: "websocket" },
  });
  await run(request, "api.example.com");
  await run(request, "api.example.com");

  // `load()`, never `get(id)`: a new isolate every time, nothing cached.
  assertEquals(loads.length, 2);
  assertEquals(loads[0].env, { HOST: "api.example.com" });
  assertEquals(loads[0].limits, { subRequests: 1 });
  assertEquals(loads[0].modules, { "relay.js": RELAY_MODULE });
  assertEquals(loads[0].mainModule, "relay.js");
  // The phone's upgrade is passed on as it came.
  assert(forwarded[0] === request);
});

const upgrade = (query = "?transaction_id=t&signature=s") =>
  new Request(`http://x/api/sub/abcdefghijklmnopqrstuv/relay${query}`, {
    headers: { upgrade: "websocket" },
  });

Deno.test("relay() asks the room with the transaction and signature only, and stops at its refusal", async () => {
  const ran: string[] = [];
  setRelayRunner((_request, host) => {
    ran.push(host);
    return new Response(null, { status: 200 });
  });
  try {
    const asked: Request[] = [];
    const allowed = await relay(upgrade(), (bodiless) => {
      asked.push(bodiless);
      return Promise.resolve(Response.json({ host: "api.example.com" }));
    });
    assertEquals(allowed.status, 200);
    assertEquals(ran, ["api.example.com"]);
    assertEquals(asked[0].body, null);
    assertEquals(asked[0].headers.get("kagi-transaction"), "t");
    assertEquals(asked[0].headers.get("kagi-signature"), "s");

    const refused = await relay(
      upgrade(),
      () => Promise.resolve(Response.json({ detail: "no" }, { status: 401 })),
    );
    assertEquals(refused.status, 401);
    assertEquals(ran.length, 1);

    // Not a WebSocket.
    const plain = await relay(
      new Request("http://x/api/sub/abcdefghijklmnopqrstuv/relay"),
      () => Promise.resolve(Response.json({ host: "api.example.com" })),
    );
    assertEquals(plain.status, 426);
  } finally {
    setRelayRunner(null);
  }
});

Deno.test("relay() without a runner answers 501", async () => {
  setRelayRunner(null);
  const res = await relay(
    upgrade(),
    () => Promise.resolve(Response.json({ host: "api.example.com" })),
  );
  assertEquals(res.status, 501);
});

Deno.test("deno serve: a real WebSocket relays one sealed call, once", async () => {
  // `router.tsx` sets the Deno runner when it loads; the tests above may have cleared it.
  const { moduleRunner } = await import("./relay.ts");
  setRelayRunner(moduleRunner());
  const id = "relayrelayrelayrelay03";
  const keys = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign", "verify"],
  );
  const publicKey = await crypto.subtle.exportKey("jwk", keys.publicKey);
  const base = `http://x/api/sub/${id}`;
  await kagiHub().dispatch(
    id,
    "register",
    new Request(base, { method: "PUT", body: JSON.stringify({ publicKey }) }),
  );
  const submitted = await kagiHub().dispatch(
    id,
    "req",
    new Request(`${base}/req`, {
      method: "POST",
      body: JSON.stringify({
        secrets: ["KEY"],
        url: "https://api.example.com/v1",
        headers: { "x-api-key": "[KEY]" },
      }),
    }),
  );
  const { transaction_id: txId } = await submitted.json();
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      keys.privateKey,
      new TextEncoder().encode(relayMessage(id, txId)),
    ),
  ).toBase64({ alphabet: "base64url", omitPadding: true });

  const server = Deno.serve(
    { port: 0, hostname: "127.0.0.1", onListen() {} },
    (request) => router.fetch(request),
  );
  const open = () =>
    new WebSocket(
      `ws://127.0.0.1:${server.addr.port}/api/sub/${id}/relay?transaction_id=${txId}&signature=${signature}`,
    );
  try {
    await withUpstream(
      (_url, init) =>
        new Response(`key was ${new Headers(init?.headers).get("x-api-key")}`),
      async (seen) => {
        const answer = await sealedCall(open(), {
          url: "https://api.example.com/v1",
          method: "GET",
          headers: { "x-api-key": SECRET },
        });
        assertEquals(answer.status, 200);
        assertEquals(answer.body, `key was ${SECRET}`);
        assertEquals(seen.length, 1);

        // Once per transaction: the second upgrade is refused before any socket opens.
        await assertRejects(
          () =>
            sealedCall(open(), {
              url: "https://api.example.com/v1",
              method: "GET",
              headers: {},
            }),
          Error,
        );
        assertEquals(seen.length, 1);
      },
    );
  } finally {
    setRelayRunner(null);
    await server.shutdown();
  }
});
