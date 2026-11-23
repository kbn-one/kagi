import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";

import type { RelayCall } from "../../../client/lib/kagi/protocol.ts";
import {
  buildFetch,
  execute,
  executeRelayed,
  scrub,
  secretsProblem,
  summarizeSecret,
  usesRelay,
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

Deno.test("a request goes through the server only with secrets marked relay, all of them", () => {
  const req = {
    secrets: ["A", "B"],
    url: "https://api.example.com/",
    headers: { a: "[A]", b: "[B]" },
  };
  const relayA = { value: "a", hosts: ["api.example.com"], relay: true };
  const relayB = { value: "b", hosts: ["api.example.com"], relay: true };
  const directB = { value: "b", hosts: ["api.example.com"] };

  assertEquals(usesRelay(req, { A: relayA, B: relayB }), true);
  assertEquals(secretsProblem(req, { A: relayA, B: relayB }), null);
  assertEquals(usesRelay(req, { A: directB, B: directB }), false);
  // B was not allowed through the server, and would go there with A.
  assertEquals(usesRelay(req, { A: relayA, B: directB }), true);
  assertStringIncludes(
    secretsProblem(req, { A: relayA, B: directB }) ?? "",
    "B",
  );
  // The clear-text summary says the same.
  assertEquals(
    usesRelay(req, { A: summarizeSecret(relayA), B: summarizeSecret(relayB) }),
    true,
  );
});

Deno.test("executeRelayed sends the filled call and scrubs the server's answer", async () => {
  const sent: RelayCall[] = [];
  const result = await executeRelayed(
    {
      secrets: ["KEY"],
      url: "https://api.example.com/[KEY]",
      method: "POST",
      headers: { "x-api-key": "[KEY]" },
      body: { key: "[KEY]" },
    },
    { KEY: "s3cret" },
    (call) => {
      sent.push(call);
      return Promise.resolve(Response.json({
        status: 200,
        headers: { "x-echo": "s3cret" },
        body: "you sent s3cret",
      }));
    },
  );
  assertEquals(sent, [{
    url: "https://api.example.com/s3cret",
    method: "POST",
    headers: { "x-api-key": "s3cret", "content-type": "application/json" },
    body: '{"key":"s3cret"}',
  }]);
  assertEquals(result, {
    status: 200,
    headers: { "x-echo": "[KEY]" },
    body: "you sent [KEY]",
  });

  await assertRejects(
    () =>
      executeRelayed(
        { secrets: ["KEY"], url: "https://api.example.com/" },
        { KEY: "s3cret" },
        () =>
          Promise.resolve(
            Response.json({ detail: "leaked s3cret" }, { status: 403 }),
          ),
      ),
    Error,
    "[KEY]",
  );
});
