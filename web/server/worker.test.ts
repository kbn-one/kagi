import { assertEquals } from "@std/assert";
import worker from "./worker.ts";
import { setKagiHub } from "./lib/kagi/hub.ts";

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

Deno.test("worker serves the RP JWKS", async () => {
  const res = await get("/.well-known/jwks.json");
  assertEquals(res.status, 200);
  const body = await res.json() as { keys: { kty: string }[] };
  assertEquals(body.keys[0].kty, "EC");
});

Deno.test("worker does not render pages (static assets answer those)", async () => {
  await assertProblem(await get("/kagi"), 404);
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
