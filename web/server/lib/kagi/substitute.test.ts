import { assertEquals } from "@std/assert";

import {
  buildFetch,
  execute,
  scrub,
  secretsProblem,
} from "../../../client/lib/kagi/substitute.ts";

const req = {
  secrets: ["GH_SECRET"],
  url: "https://api.github.com/repos/o/r/issues",
  headers: { authorization: "Bearer [GH_SECRET]" },
  body: { title: "t", nested: ["[GH_SECRET]"] },
};

Deno.test("buildFetch fills placeholders in headers and JSON body", async () => {
  const { url, init } = buildFetch(req, { GH_SECRET: "ghp_x" });
  assertEquals(url, req.url);
  assertEquals(init.method, "POST");
  assertEquals(init.redirect, "error");
  const headers = init.headers as Headers;
  assertEquals(headers.get("authorization"), "Bearer ghp_x");
  assertEquals(headers.get("content-type"), "application/json");
  assertEquals(JSON.parse(String(init.body)), {
    title: "t",
    nested: ["ghp_x"],
  });
  // A string body is sent verbatim, filled.
  const raw = buildFetch({ ...req, body: "token=[GH_SECRET]" }, {
    GH_SECRET: "s",
  });
  assertEquals(raw.init.body, "token=s");
  assertEquals(await Promise.resolve(raw.url), req.url);
});

Deno.test("secretsProblem enforces presence and allowed hosts", () => {
  assertEquals(secretsProblem(req, {})?.includes("GH_SECRET"), true);
  assertEquals(
    secretsProblem(req, { GH_SECRET: { value: "v", hosts: [] } }),
    null,
  );
  assertEquals(
    secretsProblem(req, {
      GH_SECRET: { value: "v", hosts: ["api.github.com"] },
    }),
    null,
  );
  assertEquals(
    secretsProblem(req, { GH_SECRET: { value: "v", hosts: ["evil.example"] } })
      ?.includes("api.github.com"),
    true,
  );
});

Deno.test("scrub replaces every secret value, longest first", () => {
  assertEquals(
    scrub("a=abc b=ab", { SHORT: "ab", LONG: "abc" }),
    "a=[LONG] b=[SHORT]",
  );
  assertEquals(scrub("x", { EMPTY: "" }), "x");
});

Deno.test("execute scrubs the secret out of an echoing response", async () => {
  const echo: typeof fetch = (input, init) =>
    Promise.resolve(
      new Response(
        `${input} ${new Headers(init?.headers).get("authorization")}`,
        { status: 201, headers: { "x-echo": "ghp_x" } },
      ),
    );
  const result = await execute(req, { GH_SECRET: "ghp_x" }, echo);
  assertEquals(result.status, 201);
  assertEquals(result.body, `${req.url} Bearer [GH_SECRET]`);
  assertEquals(result.headers["x-echo"], "[GH_SECRET]");
});
