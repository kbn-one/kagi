import { assertEquals } from "@std/assert";
import worker from "./worker.ts";

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

Deno.test("worker /api/turso degrades to 503 without Turso env", async () => {
  const body = await assertProblem(await get("/api/turso"), 503);
  assertEquals(body.configured, false);
});

Deno.test("worker /api/protected rejects a request without a DPoP proof", async () => {
  await assertProblem(await get("/api/protected"), 401);
});

Deno.test("worker does not render pages (static assets answer those)", async () => {
  await assertProblem(await get("/hydration"), 404);
});

const post = (headers: Record<string, string>) =>
  worker.fetch(
    new Request("http://x/api/notify", {
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
  // The empty body is the action's own 400, not cop's 403.
  const body = await assertProblem(res, 400);
  assertEquals(typeof body.detail, "string");
});
