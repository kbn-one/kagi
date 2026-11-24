import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";

import {
  parseKagiRequest,
  type RelayCall,
} from "../../../client/lib/kagi/protocol.ts";
import {
  buildFetch,
  execute,
  executeRelayed,
  scrub,
  secretsProblem,
  summarizeSecret,
  textSecretFrom,
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

Deno.test("executeRelayed sends the filled call and scrubs the answer", async () => {
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
      return Promise.resolve({
        status: 200,
        headers: { "x-echo": "s3cret" },
        body: "you sent s3cret",
      });
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
        () => Promise.reject(new Error("The call failed: leaked s3cret")),
      ),
    Error,
    "leaked [KEY]",
  );
});

Deno.test("textSecretFrom: editing keeps the saved value when the field is left empty", () => {
  const saved = { value: "old", hosts: ["a.example"] };
  assertEquals(
    textSecretFrom({ value: "", hosts: ["b.example"], relay: true }, saved),
    { value: "old", hosts: ["b.example"], relay: true },
  );
  assertEquals(
    textSecretFrom({ value: "new", hosts: ["a.example"], relay: false }, saved),
    { value: "new", hosts: ["a.example"] },
  );
  // Hosts are not carried over: an edit that clears them is refused.
  assertThrows(
    () => textSecretFrom({ value: "new", hosts: [], relay: false }, saved),
    Error,
    "ホスト",
  );
  // Adding needs a value; an App's key is never carried over into a text secret.
  assertThrows(
    () => textSecretFrom({ value: "", hosts: [], relay: false }),
    Error,
    "値",
  );
  assertThrows(
    () =>
      textSecretFrom({ value: "", hosts: [], relay: false }, {
        kind: "github-app",
        appId: "1",
        value: "PEM",
        hosts: [],
      }),
    Error,
    "値",
  );
  assertThrows(
    () => textSecretFrom({ value: "v", hosts: [], relay: true }),
    Error,
    "ホスト",
  );
});

Deno.test("execute scrubs the secret out of a failure, which goes to the requester", async () => {
  // WebKit and Gecko quote a refused header value, filled in, in their TypeError.
  const quoting: typeof fetch = (_url, init) => {
    const auth = (init?.headers as Headers).get("authorization");
    return Promise.reject(
      new TypeError(`Header 'authorization' has invalid value: '${auth}'`),
    );
  };
  const error = await assertRejects(
    () => execute(req, { GH_SECRET: "ghp_x" }, quoting),
    Error,
  );
  assertEquals(
    error.message,
    "Header 'authorization' has invalid value: 'Bearer [GH_SECRET]'",
  );
});

Deno.test("buildFetch reports a refused header by name, never its filled value", () => {
  // A secret value with a newline in it: the browser refuses the header.
  const error = assertThrows(
    () => buildFetch(req, { GH_SECRET: "ghp_x\nInjected: 1" }),
    Error,
  );
  assertEquals(
    error.message,
    "ヘッダー authorization に送れない文字が入っています",
  );
});

Deno.test("parseKagiRequest refuses headers the browser could not send", () => {
  const base = { secrets: ["T"], url: "https://api.example.com/x" };
  for (
    const headers of [
      { authorization: "Bearer [T]\u0000" },
      { authorization: "Bearer [T]\r\nx-injected: 1" },
      { authorization: "Bearer [T]\u3042" },
      { "x\u0000y": "[T]" },
      { "x y": "[T]" },
      { "": "[T]" },
    ]
  ) {
    const parsed = parseKagiRequest({ ...base, headers });
    assertEquals(typeof parsed, "string", JSON.stringify(headers));
  }
  // Placeholders, tabs and Latin-1 are fine, in names as in values.
  const ok = parseKagiRequest({
    ...base,
    headers: { authorization: "Bearer\t[T] \u00e9", "x-[T]": "1" },
  });
  assertEquals(typeof ok, "object");
});

Deno.test("parseKagiRequest: https only, and no user part to hide the host behind", () => {
  const base = { secrets: ["T"], headers: { authorization: "Bearer [T]" } };
  for (
    const url of [
      "http://api.example.com/x",
      "https://api.github.com@evil.example/x",
      "https://user:pass@api.example.com/x",
    ]
  ) {
    assertEquals(typeof parseKagiRequest({ ...base, url }), "string", url);
  }
  assertEquals(
    typeof parseKagiRequest({ ...base, url: "https://api.example.com/a@b" }),
    "object",
  );
});

Deno.test("parseKagiRequest: a github-api path is called as the approver reads it", () => {
  const scope = {
    type: "github-api",
    app: "GH_APP",
    owner: "kbn-one",
    repositories: ["kagi"],
    permissions: { issues: "write" },
  };
  for (
    const path of [
      "/repos/kbn-one/kagi/%2e%2e/%2e%2e/%2e%2e/orgs/kbn-one/members",
      "/repos/kbn-one/kagi/%2E%2E/x",
      "/repos/kbn-one/kagi/issues%2f1",
      "/repos/kbn-one/kagi/%5c..",
    ]
  ) {
    assertEquals(typeof parseKagiRequest({ ...scope, path }), "string", path);
  }
  // An encoded character in the query is fine: it does not move the call.
  assertEquals(
    typeof parseKagiRequest({
      ...scope,
      path: "/repos/kbn-one/kagi/issues?labels=a%2Fb",
    }),
    "object",
  );
});

Deno.test("parseKagiRequest: only repository permissions", () => {
  const scope = {
    type: "github-app-token",
    app: "GH_APP",
    owner: "kbn-one",
    repositories: ["kagi"],
  };
  for (
    const permissions of [
      { members: "write" },
      { organization_administration: "write" },
      { contents: "write", email_addresses: "read" },
      { not_a_permission: "read" },
    ]
  ) {
    assertEquals(
      typeof parseKagiRequest({ ...scope, permissions }),
      "string",
      JSON.stringify(permissions),
    );
  }
  assertEquals(
    typeof parseKagiRequest({
      ...scope,
      permissions: { contents: "write", pull_requests: "write" },
    }),
    "object",
  );
});

Deno.test("a secret needs hosts: saving refuses none, and one saved without them goes nowhere", () => {
  assertThrows(
    () => textSecretFrom({ value: "v", hosts: [], relay: false }),
    Error,
    "ホスト",
  );
  assertEquals(
    textSecretFrom({ value: "v", hosts: ["API.Example.com"], relay: false }),
    { value: "v", hosts: ["api.example.com"] },
  );
  assertStringIncludes(
    secretsProblem(req, { GH_SECRET: { value: "v", hosts: [] } }) ?? "",
    "未設定",
  );
});
