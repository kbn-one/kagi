import { assert, assertEquals, assertStringIncludes } from "@std/assert";

import router from "./router.tsx";
import {
  headersFile,
  SECURITY_HEADERS,
  withSecurityHeaders,
} from "./security_headers.ts";
import worker from "./worker.ts";

const assertSecurityHeaders = (res: Response, what: string) => {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    assertEquals(res.headers.get(name), value, `${what}: ${name}`);
  }
};

const assets = {
  fetch: (request: Request) =>
    Promise.resolve(
      new URL(request.url).pathname === "/kagi"
        ? new Response('<html><script nonce="B"></script></html>', {
          headers: { "content-type": "text/html" },
        })
        : new Response("x", { headers: { "content-type": "text/javascript" } }),
    ),
};

Deno.test("the Worker's pages forbid framing and carry the security headers", async () => {
  const res = await worker.fetch(new Request("http://x/kagi"), {
    ASSETS: assets,
  });
  assertStringIncludes(
    res.headers.get("content-security-policy") ?? "",
    "frame-ancestors 'none'",
  );
  assertSecurityHeaders(res, "page");
  await res.body?.cancel();
});

Deno.test("the Worker's API answers, problems included, carry the security headers", async () => {
  const res = await worker.fetch(
    new Request("http://x/api/sub/nosuchsubscription00/res?transaction_id=t"),
  );
  assertEquals(res.status, 404);
  assertSecurityHeaders(res, "api");
  await res.body?.cancel();
});

Deno.test("deno serve's pages and files carry them too", async () => {
  const page = await router.fetch(new Request("http://x/kagi"));
  assertStringIncludes(
    page.headers.get("content-security-policy") ?? "",
    "frame-ancestors 'none'",
  );
  assertSecurityHeaders(page, "page");
  await page.body?.cancel();
  const sw = await router.fetch(new Request("http://x/sw.js"));
  assertSecurityHeaders(sw, "sw.js");
  await sw.body?.cancel();
});

Deno.test("a WebSocket upgrade is handed back untouched", () => {
  // 101 cannot be built in Deno outside an upgrade, so a stand-in with that status.
  const upgrade = { status: 101 } as Response;
  assert(withSecurityHeaders(upgrade) === upgrade);
});

Deno.test("headersFile applies every header to every asset", () => {
  const file = headersFile();
  assert(file.startsWith("/*\n"));
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    assertStringIncludes(file, `\n  ${name}: ${value}`);
  }
});
