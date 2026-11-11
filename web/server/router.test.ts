import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import router from "./router.tsx";

Deno.test("GET / returns the shell with nav links and the runtime script", async () => {
  const res = await router.fetch(new Request("http://x/"));
  assertEquals(res.status, 200);
  assertStringIncludes(res.headers.get("content-type") ?? "", "text/html");
  const html = await res.text();
  assertStringIncludes(html, "<!DOCTYPE html>");
  assertStringIncludes(html, "Remix3 on Deno Template");
  assertStringIncludes(html, "kuboon.github.io/deno-remix-tmpl");
  assertStringIncludes(html, 'href="/hydration"');
  assertStringIncludes(html, '<script type="module" src="/assets/hydration');
  // Soft navigation is the runtime's default now; no frame target attributes.
  assert(!html.includes("rmx-target"));
});

Deno.test("GET /hydration includes the Counter clientEntry marker", async () => {
  const res = await router.fetch(new Request("http://x/hydration"));
  assertEquals(res.status, 200);
  const html = await res.text();
  assertStringIncludes(html, "/assets/islands/counter");
  assertStringIncludes(html, "Counter");
  assertStringIncludes(html, 'aria-label="increment"');
});

Deno.test("GET /my embeds idp-origin meta", async () => {
  const res = await router.fetch(new Request("http://x/my"));
  assertEquals(res.status, 200);
  const html = await res.text();
  assertStringIncludes(html, '<meta name="idp-origin"');
  assertStringIncludes(html, "https://id.kbn.one");
});

Deno.test("GET /my has a デモ panel holding 状態, 仕組み and the server send controls", async () => {
  const res = await router.fetch(new Request("http://x/my"));
  const html = await res.text();
  const demo = html.slice(html.indexOf("<h2>デモ</h2>"));
  assertStringIncludes(demo, "<h3>状態</h3>");
  assertStringIncludes(demo, "DPoP thumbprint");
  assertStringIncludes(demo, "仕組み");
  assertStringIncludes(demo, 'aria-label="バッジ数"');
  assertStringIncludes(demo, "サーバーから送信");
  // The push card keeps its own controls but no longer carries the demo ones.
  const before = html.slice(0, html.indexOf("<h2>デモ</h2>"));
  assert(!before.includes("バッジ数"));
  assert(!before.includes("<h2>状態</h2>"));
});

Deno.test("GET /sw.js serves the worker with a root scope", async () => {
  const res = await router.fetch(new Request("http://x/sw.js"));
  assertEquals(res.status, 200);
  assertStringIncludes(res.headers.get("content-type") ?? "", "javascript");
  assertEquals(res.headers.get("service-worker-allowed"), "/");
  assertStringIncludes(await res.text(), "addEventListener");
});

Deno.test("GET /api/protected without DPoP proof is rejected", async () => {
  const res = await router.fetch(new Request("http://x/api/protected"));
  assert(
    res.status === 401 || res.status === 400,
    `expected 400 or 401, got ${res.status}`,
  );
  await res.body?.cancel();
});

Deno.test("GET /api/turso reports unconfigured without Turso env", async () => {
  // No TURSO_DATABASE_URL in the test environment — the sample degrades to a
  // 503 instead of attempting a connection.
  const res = await router.fetch(new Request("http://x/api/turso"));
  assertEquals(res.status, 503);
  assertEquals(res.headers.get("content-type"), "application/problem+json");
  const body = await res.json() as { configured?: boolean; status?: number };
  assertEquals(body.status, 503);
  assertEquals(body.configured, false);
});

Deno.test("GET /.well-known/jwks.json publishes the RP key", async () => {
  const res = await router.fetch(
    new Request("http://x/.well-known/jwks.json"),
  );
  assertEquals(res.status, 200);
  const body = await res.json() as { keys: { kty: string }[] };
  assertEquals(body.keys[0].kty, "EC");
});

for (
  const [path, needle] of [
    ["/blog", "Blog"],
    ["/blog/hello-remix-ssg", "Hello, remix-ssg"],
    ["/showcase", "showcase"],
    ["/spa/1", "SPA"],
  ] as const
) {
  Deno.test(`GET ${path} renders inside the shell`, async () => {
    const res = await router.fetch(new Request(`http://x${path}`));
    assertEquals(res.status, 200);
    const html = await res.text();
    assertStringIncludes(html, "<main");
    assertStringIncludes(html, needle);
  });
}

Deno.test("GET /fullscreen is a bare page with no shell", async () => {
  const res = await router.fetch(new Request("http://x/fullscreen"));
  assertEquals(res.status, 200);
  const html = await res.text();
  assert(!html.includes("<main"));
  assertStringIncludes(html, "FullscreenGame");
});

Deno.test("GET /spa/unknown is a 404", async () => {
  const res = await router.fetch(new Request("http://x/spa/nope"));
  assertEquals(res.status, 404);
  await res.body?.cancel();
});

Deno.test("HTML responses carry a nonce-based CSP, and every executable tag has the nonce", async () => {
  for (const path of ["/", "/hydration", "/my", "/spa/1"]) {
    const res = await router.fetch(new Request(`http://x${path}`));
    const policy = res.headers.get("content-security-policy") ?? "";
    const nonce = policy.match(/'nonce-([^']+)'/)?.[1];
    assert(nonce, `${path}: no nonce in ${JSON.stringify(policy)}`);
    assertStringIncludes(policy, "'strict-dynamic'");
    assertStringIncludes(policy, "object-src 'none'");

    const html = await res.text();
    const executable = [
      ...html.matchAll(/<script\b[^>]*>|<link\b[^>]*modulepreload[^>]*>/g),
    ]
      .map((m) => m[0])
      // A JSON data block is not executed, so CSP does not apply to it.
      .filter((tag) => !tag.includes('type="application/json"'));
    assert(executable.length > 0, `${path}: no script tags`);
    for (const tag of executable) {
      assertStringIncludes(tag, `nonce="${nonce}"`, `${path}: ${tag}`);
    }
  }
});

Deno.test("each request gets a fresh nonce", async () => {
  const nonceOf = async () =>
    (await router.fetch(new Request("http://x/"))).headers
      .get("content-security-policy")?.match(/'nonce-([^']+)'/)?.[1];
  const [a, b] = [await nonceOf(), await nonceOf()];
  assert(a && b && a !== b);
});

Deno.test("non-HTML responses carry no CSP", async () => {
  const res = await router.fetch(new Request("http://x/sw.js"));
  assertEquals(res.headers.get("content-security-policy"), null);
  await res.body?.cancel();
});
