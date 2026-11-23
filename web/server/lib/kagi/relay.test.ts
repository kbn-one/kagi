import { assert, assertEquals, assertStringIncludes } from "@std/assert";

import type { RelayCall } from "../../../client/lib/kagi/protocol.ts";
import {
  loaderRunner,
  moduleRunner,
  relay,
  RELAY_MODULE,
  setRelayRunner,
  type WorkerLoaderLike,
} from "./relay.ts";

const post = (call: unknown) =>
  new Request("http://x/api/sub/abcdefghijklmnopqrstuv/relay", {
    method: "POST",
    headers: { "kagi-transaction": "t", "kagi-signature": "s" },
    body: JSON.stringify(call),
  });

const call: RelayCall = {
  url: "https://api.example.com/v1/things?x=1",
  method: "POST",
  headers: { authorization: "Bearer s3cret", "content-type": "text/plain" },
  body: "hello",
};

/** A fake upstream that records what it was sent. */
function upstream(answer = () => new Response('{"ok":true}', { status: 201 })) {
  const seen: { url: string; init?: RequestInit }[] = [];
  const fetchImpl = ((url: string | URL, init?: RequestInit) => {
    seen.push({ url: String(url), init });
    return Promise.resolve(answer());
  }) as typeof fetch;
  return { seen, fetchImpl };
}

Deno.test("the relay module makes the call to the approved host and wraps the answer", async () => {
  const { seen, fetchImpl } = upstream(() =>
    new Response("made it", { status: 201, headers: { "x-id": "7" } })
  );
  const res = await moduleRunner(fetchImpl)(post(call), "api.example.com");
  assertEquals(res.status, 200);
  const answer = await res.json();
  assertEquals(answer.status, 201);
  assertEquals(answer.body, "made it");
  assertEquals(answer.headers["x-id"], "7");

  assertEquals(seen.length, 1);
  assertEquals(seen[0].url, call.url);
  assertEquals(seen[0].init?.method, "POST");
  assertEquals(seen[0].init?.body, "hello");
  assertEquals(seen[0].init?.redirect, "manual");
  assertEquals(
    new Headers(seen[0].init?.headers).get("authorization"),
    "Bearer s3cret",
  );
});

Deno.test("the relay module refuses any other host, and plain http", async () => {
  const { seen, fetchImpl } = upstream();
  const run = moduleRunner(fetchImpl);

  const elsewhere = await run(
    post({ ...call, url: "https://evil.example/steal" }),
    "api.example.com",
  );
  assertEquals(elsewhere.status, 403);
  assertEquals(
    elsewhere.headers.get("content-type"),
    "application/problem+json",
  );
  assertStringIncludes((await elsewhere.json()).detail, "evil.example");

  const plain = await run(
    post({ ...call, url: "http://api.example.com/" }),
    "api.example.com",
  );
  assertEquals(plain.status, 400);

  const malformed = await run(post({ url: 1 }), "api.example.com");
  assertEquals(malformed.status, 400);

  assertEquals(seen.length, 0);
});

Deno.test("the relay module hands a redirect back instead of following it", async () => {
  const { fetchImpl } = upstream(() =>
    new Response(null, {
      status: 302,
      headers: { location: "https://elsewhere.example/" },
    })
  );
  const res = await moduleRunner(fetchImpl)(post(call), "api.example.com");
  const answer = await res.json();
  assertEquals(answer.status, 302);
  assertEquals(answer.headers.location, "https://elsewhere.example/");
});

Deno.test("the relay module sends no body with GET", async () => {
  const { seen, fetchImpl } = upstream();
  await moduleRunner(fetchImpl)(
    post({ ...call, method: "get" }),
    "api.example.com",
  );
  assertEquals(seen[0].init?.method, "GET");
  assertEquals(seen[0].init?.body, undefined);
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
            return Promise.resolve(Response.json({ status: 200 }));
          },
        }),
      };
    },
  };
  const run = loaderRunner(loader);
  const request = post(call);
  await run(request, "api.example.com");
  await run(post(call), "api.example.com");

  // `load()`, never `get(id)`: a new isolate every time, nothing cached.
  assertEquals(loads.length, 2);
  assertEquals(loads[0].env, { HOST: "api.example.com" });
  assertEquals(loads[0].limits, { subRequests: 1 });
  assertEquals(loads[0].modules, { "relay.js": RELAY_MODULE });
  assertEquals(loads[0].mainModule, "relay.js");
  // The phone's request is passed on as it came, body unread.
  assert(forwarded[0] === request);
  assertEquals(request.bodyUsed, false);
});

Deno.test("relay() asks the room with the headers only, and stops at its refusal", async () => {
  const ran: string[] = [];
  setRelayRunner((_request, host) => {
    ran.push(host);
    return Promise.resolve(Response.json({ status: 200 }));
  });
  try {
    const asked: Request[] = [];
    const allowed = await relay(post(call), (bodiless) => {
      asked.push(bodiless);
      return Promise.resolve(Response.json({ host: "api.example.com" }));
    });
    assertEquals(allowed.status, 200);
    assertEquals(ran, ["api.example.com"]);
    assertEquals(asked[0].body, null);
    assertEquals(asked[0].headers.get("kagi-transaction"), "t");
    assertEquals(asked[0].headers.get("kagi-signature"), "s");
    assertEquals(asked[0].headers.get("authorization"), null);

    const refused = await relay(
      post(call),
      () => Promise.resolve(Response.json({ detail: "no" }, { status: 401 })),
    );
    assertEquals(refused.status, 401);
    assertEquals(ran.length, 1);
  } finally {
    setRelayRunner(null);
  }
});

Deno.test("relay() without a runner answers 501", async () => {
  setRelayRunner(null);
  const res = await relay(
    post(call),
    () => Promise.resolve(Response.json({ host: "api.example.com" })),
  );
  assertEquals(res.status, 501);
});
