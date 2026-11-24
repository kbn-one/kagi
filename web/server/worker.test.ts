import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import worker from "./worker.ts";
import { setKagiHub } from "./lib/kagi/hub.ts";
import { setRelayRunner, type WorkerLoaderLike } from "./lib/kagi/relay.ts";
import { relayMessage } from "../client/lib/kagi/protocol.ts";

const get = (path: string) => worker.fetch(new Request(`http://x${path}`));

/** Every error the Worker answers with is an RFC 9457 problem. */
async function assertProblem(res: Response, status: number) {
  assertEquals(res.status, status);
  assertEquals(res.headers.get("content-type"), "application/problem+json");
  const body = await res.json() as Record<string, unknown>;
  assertEquals(body.status, status);
  assertEquals(body.type, "about:blank");
  assertEquals(typeof body.title, "string");
  return body;
}

Deno.test("worker without the static assets binding has no pages to serve", async () => {
  await assertProblem(await get("/kagi"), 404);
});

/** The static assets, as the build wrote them: the live router's HTML, nonce and all. */
const assets = {
  fetch: (request: Request) => {
    const path = new URL(request.url).pathname;
    if (path === "/kagi") {
      return Promise.resolve(
        new Response(
          '<!DOCTYPE html><html><head><script nonce="BUILD=="></script>' +
            '<style nonce="BUILD==">p{}</style></head><body><p>kagi</p></body></html>',
          {
            headers: {
              "content-type": "text/html; charset=utf-8",
              etag: '"abc"',
            },
          },
        ),
      );
    }
    return Promise.resolve(
      new Response("x", { headers: { "content-type": "text/javascript" } }),
    );
  },
};

Deno.test("worker serves a page with a fresh nonce and a CSP header that names it", async () => {
  const nonces = new Set<string>();
  for (let i = 0; i < 2; i++) {
    const res = await worker.fetch(new Request("http://x/kagi"), {
      ASSETS: assets,
    });
    assertEquals(res.status, 200);
    const policy = res.headers.get("content-security-policy") ?? "";
    const nonce = policy.match(/'nonce-([^']+)'/)?.[1];
    assert(nonce && nonce !== "BUILD==");
    assertStringIncludes(policy, "'strict-dynamic'");
    const html = await res.text();
    assertEquals(html.split(`nonce="${nonce}"`).length - 1, 2);
    assert(!html.includes('nonce="BUILD=="'));
    assertEquals(res.headers.get("etag"), null);
    assertEquals(res.headers.get("cache-control"), "no-store");
    nonces.add(nonce);
  }
  assertEquals(nonces.size, 2);
});

Deno.test("worker passes non-HTML assets through untouched, without a CSP", async () => {
  const res = await worker.fetch(new Request("http://x/assets/app.js"), {
    ASSETS: assets,
  });
  assertEquals(res.headers.get("content-security-policy"), null);
  assertEquals(await res.text(), "x");
});

const post = (headers: Record<string, string>) =>
  worker.fetch(
    new Request("http://x/api/sub/abcdefghijklmnopqrstuv/req", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: "{}",
    }),
  );

Deno.test("worker rejects a cross-origin browser POST (cop)", async () => {
  const cases: Record<string, string>[] = [
    { "sec-fetch-site": "cross-site" },
    { origin: "http://evil.example" },
  ];
  for (const headers of cases) {
    const body = await assertProblem(await post(headers), 403);
    assertEquals(typeof body.reason, "string");
  }
});

Deno.test("worker lets a same-origin POST through to the action", async () => {
  const res = await post({ "sec-fetch-site": "same-origin" });
  // The unregistered id is the action's own 404, not cop's 403.
  const body = await assertProblem(res, 404);
  assertEquals(typeof body.detail, "string");
});

Deno.test("worker answers /api/sub from memory without the Durable Object binding", async () => {
  const id = "abcdefghijklmnopqrstuv";
  const keys = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const publicKey = await crypto.subtle.exportKey("jwk", keys.publicKey);
  const reg = await worker.fetch(
    new Request(`http://x/api/sub/${id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "u1", publicKey }),
    }),
  );
  assertEquals(reg.status, 201);
  const req = await worker.fetch(
    new Request(`http://x/api/sub/${id}/req`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secrets: [], url: "https://example.com/" }),
    }),
  );
  assertEquals(req.status, 202);
  const { transaction_id } = await req.json();
  const res = await get(
    `/api/sub/${id}/res?transaction_id=${transaction_id}&wait=0`,
  );
  assertEquals(res.status, 202);
  await res.body?.cancel();
});

Deno.test("worker forwards /api/sub to the KagiRoom Durable Object when bound", async () => {
  const seen: string[] = [];
  const namespace = {
    idFromName: (name: string) => name,
    get: (id: unknown) => ({
      fetch: (r: Request) => {
        seen.push(`${id} ${new URL(r.url).pathname}`);
        return Promise.resolve(new Response("from DO"));
      },
    }),
  };
  const id = "zyxwvutsrqponmlkjihgfe";
  const res = await worker.fetch(
    new Request(`http://x/api/sub/${id}/res?transaction_id=t`),
    { KAGI_ROOM: namespace },
  );
  assertEquals(await res.text(), "from DO");
  assertEquals(seen, [`${id} /api/sub/${id}/res`]);
  setKagiHub(undefined);
});

Deno.test("worker hands an approved relay upgrade to a Dynamic Worker from LOADER, once", async () => {
  const id = "relayrelayrelayrelay01";
  const keys = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign", "verify"],
  );
  const publicKey = await crypto.subtle.exportKey("jwk", keys.publicKey);
  await worker.fetch(
    new Request(`http://x/api/sub/${id}`, {
      method: "PUT",
      body: JSON.stringify({ publicKey }),
    }),
  );
  const submitted = await worker.fetch(
    new Request(`http://x/api/sub/${id}/req`, {
      method: "POST",
      body: JSON.stringify({
        secrets: ["KEY"],
        url: "https://no-cors.example/v1",
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

  const loads: string[] = [];
  const forwarded: string[] = [];
  const LOADER: WorkerLoaderLike = {
    load: (code) => {
      loads.push(code.env?.HOST ?? "");
      return {
        getEntrypoint: () => ({
          fetch: (r: Request) => {
            forwarded.push(r.headers.get("upgrade") ?? "");
            return Promise.resolve(new Response("upgraded"));
          },
        }),
      };
    },
  };
  const open = () =>
    worker.fetch(
      new Request(
        `http://x/api/sub/${id}/relay?transaction_id=${txId}&signature=${signature}`,
        { headers: { upgrade: "websocket" } },
      ),
      { LOADER },
    );
  try {
    const res = await open();
    assertEquals(await res.text(), "upgraded");
    assertEquals(loads, ["no-cors.example"]);
    assertEquals(forwarded, ["websocket"]);

    await assertProblem(await open(), 409);
    assertEquals(loads.length, 1);
  } finally {
    setRelayRunner(null);
  }
});

Deno.test("worker refuses a relay without the device key's signature", async () => {
  const res = await worker.fetch(
    new Request(
      "http://x/api/sub/relayrelayrelayrelay01/relay?transaction_id=t&signature=bad",
      { headers: { upgrade: "websocket" } },
    ),
  );
  assertEquals(res.status >= 400, true);
  await res.body?.cancel();
});
