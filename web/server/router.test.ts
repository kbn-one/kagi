import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import router from "./router.tsx";

Deno.test("GET / returns the shell with nav links and the runtime script", async () => {
  const res = await router.fetch(new Request("http://x/"));
  assertEquals(res.status, 200);
  assertStringIncludes(res.headers.get("content-type") ?? "", "text/html");
  const html = await res.text();
  assertStringIncludes(html, "<!DOCTYPE html>");
  assertStringIncludes(html, "<h1>kagi</h1>");
  assertStringIncludes(html, 'href="/kagi"');
  assertStringIncludes(html, 'href="/my"');
  assertStringIncludes(html, '<script type="module" src="/assets/hydration');
  // Soft navigation is the runtime's default now; no frame target attributes.
  assert(!html.includes("rmx-target"));
});

Deno.test("GET /my embeds idp-origin meta and links to the approver screen", async () => {
  const res = await router.fetch(new Request("http://x/my"));
  assertEquals(res.status, 200);
  const html = await res.text();
  assertStringIncludes(html, '<meta name="idp-origin"');
  assertStringIncludes(html, "https://id.kbn.one");
  assertStringIncludes(html, 'href="/kagi"');
});

Deno.test("og:image is absolute on the deployed origin", async () => {
  const html = await (await router.fetch(new Request("http://x/kagi"))).text();
  assertStringIncludes(
    html,
    '<meta property="og:image" content="https://kagi.kbn.one/og/kagi.png"',
  );
  const card = await router.fetch(new Request("http://x/og/kagi.png"));
  assertEquals(card.status, 200);
  assertEquals(card.headers.get("content-type"), "image/png");
  await card.body?.cancel();
});

Deno.test("GET /sw.js serves the worker with a root scope", async () => {
  const res = await router.fetch(new Request("http://x/sw.js"));
  assertEquals(res.status, 200);
  assertStringIncludes(res.headers.get("content-type") ?? "", "javascript");
  assertEquals(res.headers.get("service-worker-allowed"), "/");
  assertStringIncludes(await res.text(), "addEventListener");
});

Deno.test("GET /.well-known/jwks.json publishes the RP key", async () => {
  const res = await router.fetch(
    new Request("http://x/.well-known/jwks.json"),
  );
  assertEquals(res.status, 200);
  const body = await res.json() as { keys: { kty: string }[] };
  assertEquals(body.keys[0].kty, "EC");
});

Deno.test("HTML responses carry a nonce-based CSP, and every executable tag has the nonce", async () => {
  for (const path of ["/", "/kagi", "/my"]) {
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

Deno.test("GET /kagi renders the approver island", async () => {
  const res = await router.fetch(new Request("http://x/kagi"));
  assertEquals(res.status, 200);
  const html = await res.text();
  assertStringIncludes(html, "/assets/islands/kagi_app");
  assertStringIncludes(html, "<h2>秘密</h2>");
});

Deno.test("/api/sub answers problems for unknown subscriptions", async () => {
  const res = await router.fetch(
    new Request("http://x/api/sub/abcdefghijklmnopqrstuv/res?transaction_id=x"),
  );
  assertEquals(res.status, 404);
  assertEquals(res.headers.get("content-type"), "application/problem+json");
  // Ids that are not ours never reach a room.
  const bad = await router.fetch(new Request("http://x/api/sub/short/res"));
  assertEquals(bad.status, 404);
});

Deno.test("GET /docs explains setup, requests and the git credential helper", async () => {
  const res = await router.fetch(new Request("http://x/docs"));
  assertEquals(res.status, 200);
  const html = await res.text();
  assertStringIncludes(html, "<h1>使い方</h1>");
  assertStringIncludes(html, "github-app-token");
  assertStringIncludes(html, "credential.https://github.com.useHttpPath");
  assertStringIncludes(html, "tools/git_credential_kagi.ts");
  assertStringIncludes(html, "Generate a private key");
  // Reachable from every page, so the static build writes it.
  const home = await (await router.fetch(new Request("http://x/"))).text();
  assertStringIncludes(home, 'href="/docs"');
});
