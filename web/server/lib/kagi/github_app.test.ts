import { assert, assertEquals, assertRejects } from "@std/assert";
import { generateKeyPairSync } from "node:crypto";

import {
  appJwt,
  createRepository,
  mintInstallationToken,
  pemToPkcs8,
} from "../../../client/lib/kagi/github_app.ts";
import {
  type GithubAppTokenRequest,
  parseKagiRequest,
} from "../../../client/lib/kagi/protocol.ts";
import {
  type GithubAppSecret,
  secretsProblem,
} from "../../../client/lib/kagi/substitute.ts";

/** A key in the shape GitHub hands out: PKCS#1 PEM. */
const { privateKey: pkcs1Pem, publicKey: spkiPem } = generateKeyPairSync(
  "rsa",
  {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs1", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  },
);

const app: GithubAppSecret = {
  kind: "github-app",
  appId: "123456",
  value: pkcs1Pem,
  hosts: [],
};

const req: GithubAppTokenRequest = {
  type: "github-app-token",
  app: "GH_APP",
  owner: "kbn-one",
  repositories: ["kagi"],
  permissions: { contents: "write" },
};

const b64urlJson = (part: string) =>
  JSON.parse(
    new TextDecoder().decode(
      Uint8Array.fromBase64(part, { alphabet: "base64url" }),
    ),
  );

Deno.test("pemToPkcs8 accepts GitHub's PKCS#1 keys and plain PKCS#8", async () => {
  const pkcs8 = pemToPkcs8(pkcs1Pem);
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pkcs8,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    true,
    ["sign"],
  );
  // Round trip: the PKCS#8 WebCrypto exports is accepted as is.
  const exported = new Uint8Array(await crypto.subtle.exportKey("pkcs8", key));
  const pem =
    `-----BEGIN PRIVATE KEY-----\n${exported.toBase64()}\n-----END PRIVATE KEY-----`;
  assertEquals(pemToPkcs8(pem), exported);
});

Deno.test("appJwt is an RS256 JWT issued by the App that the public key verifies", async () => {
  const now = Date.UTC(2026, 0, 1);
  const jwt = await appJwt(app, now);
  const [h, p, sig] = jwt.split(".");
  assertEquals(b64urlJson(h), { alg: "RS256", typ: "JWT" });
  const payload = b64urlJson(p);
  assertEquals(payload.iss, "123456");
  assertEquals(payload.iat, now / 1000 - 60);
  assertEquals(payload.exp - payload.iat, 600);

  const spki = Uint8Array.fromBase64(
    spkiPem.replace(/-----[^-]+-----|\s+/g, ""),
  );
  const pub = await crypto.subtle.importKey(
    "spki",
    spki,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  assert(
    await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      pub,
      Uint8Array.fromBase64(sig, { alphabet: "base64url" }),
      new TextEncoder().encode(`${h}.${p}`),
    ),
  );
});

/** A GitHub that answers the two calls minting makes, and records them. */
function fakeGithub(grantedRepos: string[]) {
  const calls: { url: string; method: string; body?: unknown }[] = [];
  const fetchImpl = ((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({
      url,
      method,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    if (url.endsWith("/installation")) {
      return Promise.resolve(Response.json({ id: 42 }));
    }
    return Promise.resolve(
      Response.json({
        token: "ghs_minted",
        expires_at: "2026-01-01T01:00:00Z",
        permissions: { contents: "write" },
        repositories: grantedRepos.map((name) => ({ name })),
      }, { status: 201 }),
    );
  }) as typeof fetch;
  return { calls, fetchImpl };
}

Deno.test("mintInstallationToken asks for exactly the requested repositories and permissions", async () => {
  const { calls, fetchImpl } = fakeGithub(["kagi"]);
  const result = await mintInstallationToken(req, app, fetchImpl);
  assertEquals(result.status, 201);
  assertEquals(JSON.parse(result.body).token, "ghs_minted");
  assertEquals(calls.map((c) => `${c.method} ${c.url}`), [
    "GET https://api.github.com/repos/kbn-one/kagi/installation",
    "POST https://api.github.com/app/installations/42/access_tokens",
  ]);
  assertEquals(calls[1].body, {
    repositories: ["kagi"],
    permissions: { contents: "write" },
  });
});

Deno.test("a token wider than requested is dropped, not returned", async () => {
  for (const granted of [["kagi", "secret-repo"], []]) {
    const { fetchImpl } = fakeGithub(granted);
    await assertRejects(() => mintInstallationToken(req, app, fetchImpl));
  }
});

Deno.test("an App that is not installed on the repository is a clear error", async () => {
  const fetchImpl = (() =>
    Promise.resolve(
      Response.json({ message: "Not Found" }, { status: 404 }),
    )) as typeof fetch;
  const error = await assertRejects(() =>
    mintInstallationToken(req, app, fetchImpl)
  );
  assert(String(error).includes("kbn-one/kagi"));
});

Deno.test("token requests must name repositories and permissions", () => {
  const base = { type: "github-app-token", app: "GH_APP", owner: "kbn-one" };
  const cases: [unknown, string][] = [
    [
      { ...base, repositories: [], permissions: { contents: "write" } },
      "repositories",
    ],
    [{ ...base, repositories: ["kagi"], permissions: {} }, "permissions"],
    [
      { ...base, repositories: ["kagi"], permissions: { contents: "admin" } },
      "contents",
    ],
    [
      { ...base, repositories: ["o/kagi"], permissions: { contents: "read" } },
      "repositories",
    ],
    [{
      ...base,
      owner: "-bad",
      repositories: ["kagi"],
      permissions: { contents: "read" },
    }, "owner"],
  ];
  for (const [body, fragment] of cases) {
    const parsed = parseKagiRequest(body);
    assert(typeof parsed === "string", JSON.stringify(body));
    assert(parsed.includes(fragment), `${parsed} / ${fragment}`);
  }
  assertEquals(
    parseKagiRequest({
      ...base,
      repositories: ["kagi", "kagi"],
      permissions: { contents: "write" },
    }),
    { ...req, repositories: ["kagi"] },
  );
});

Deno.test("an App key is only usable for token requests, never inside an HTTP request", () => {
  const vault = { GH_APP: app };
  assertEquals(secretsProblem(req, vault), null);
  const exfiltrate = {
    secrets: ["GH_APP"],
    url: "https://api.github.com/gists",
    body: { files: { k: { content: "[GH_APP]" } } },
  };
  assert(secretsProblem(exfiltrate, vault)?.includes("埋め込めません"));
  assert(
    secretsProblem(req, { GH_APP: { value: "x", hosts: [] } })?.includes(
      "GitHub App ではありません",
    ),
  );
});

/** A GitHub that can create repositories, for an organization or a user account. */
function fakeCreator(
  accountType: "Organization" | "User",
  createdAs?: string,
  account = "kbn-one",
) {
  const calls: {
    method: string;
    path: string;
    auth: string;
    body?: unknown;
  }[] = [];
  const fetchImpl = ((input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const auth = new Headers(init?.headers).get("authorization") ?? "";
    calls.push({
      method,
      path: url.pathname,
      auth: auth.startsWith("Bearer ghs_") ? "installation" : "app-jwt",
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    const json = (body: unknown, status = 200) =>
      Promise.resolve(Response.json(body, { status }));
    if (url.pathname.endsWith("/installation")) {
      const isOrgPath = url.pathname.startsWith("/orgs/");
      if (isOrgPath !== (accountType === "Organization")) {
        return json({ message: "Not Found" }, 404);
      }
      return json({ id: 42, account: { type: accountType } });
    }
    if (url.pathname === "/app/installations/42/access_tokens") {
      return json({ token: "ghs_internal_only" }, 201);
    }
    if (url.pathname === "/installation/token") {
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    const body = JSON.parse(String(init!.body));
    return json({
      full_name: createdAs ?? `${account}/${body.name}`,
      html_url: `https://github.com/${account}/${body.name}`,
      clone_url: `https://github.com/${account}/${body.name}.git`,
      private: body.private,
      visibility: body.private ? "private" : "public",
      default_branch: "main",
    }, 201);
  }) as typeof fetch;
  return { calls, fetchImpl };
}

const createReq = {
  type: "github-create-repo",
  app: "GH_APP",
  owner: "kbn-one",
  name: "new-repo",
  visibility: "public",
  description: "made by kagi",
} as const;

Deno.test("createRepository creates a public org repository and revokes its token", async () => {
  const { calls, fetchImpl } = fakeCreator("Organization");
  const result = await createRepository(createReq, app, fetchImpl);
  assertEquals(result.status, 201);
  assertEquals(JSON.parse(result.body), {
    full_name: "kbn-one/new-repo",
    html_url: "https://github.com/kbn-one/new-repo",
    clone_url: "https://github.com/kbn-one/new-repo.git",
    visibility: "public",
    default_branch: "main",
  });
  // The token that created it never reaches the requester.
  assert(!result.body.includes("ghs_internal_only"));
  assertEquals(
    calls.map((c) => `${c.method} ${c.path} (${c.auth})`),
    [
      "GET /orgs/kbn-one/installation (app-jwt)",
      "POST /app/installations/42/access_tokens (app-jwt)",
      "POST /orgs/kbn-one/repos (installation)",
      "DELETE /installation/token (installation)",
    ],
  );
  assertEquals(calls[2].body, {
    name: "new-repo",
    private: false,
    description: "made by kagi",
  });
});

Deno.test("createRepository uses /user/repos for a personal account, and private when asked", async () => {
  const { calls, fetchImpl } = fakeCreator("User", undefined, "kuboon");
  const result = await createRepository(
    { ...createReq, owner: "kuboon", visibility: "private", autoInit: true },
    app,
    fetchImpl,
  );
  assertEquals(JSON.parse(result.body).visibility, "private");
  assertEquals(
    calls.filter((c) => c.method === "POST").map((c) => c.path),
    ["/app/installations/42/access_tokens", "/user/repos"],
  );
  assertEquals(calls.find((c) => c.path === "/user/repos")?.body, {
    name: "new-repo",
    private: true,
    description: "made by kagi",
    auto_init: true,
  });
});

Deno.test("createRepository refuses a result that is not the requested repository, and still revokes", async () => {
  const { calls, fetchImpl } = fakeCreator("Organization", "kbn-one/other");
  await assertRejects(() => createRepository(createReq, app, fetchImpl));
  assertEquals(calls.at(-1)?.path, "/installation/token");
});

Deno.test("create-repo requests must state visibility and a plain name", () => {
  const base = {
    type: "github-create-repo",
    app: "GH_APP",
    owner: "kbn-one",
  } as const;
  const cases: [unknown, string][] = [
    [{ ...base, name: "x" }, "visibility"],
    [{ ...base, name: "x", visibility: "internal" }, "visibility"],
    [{ ...base, name: "a/b", visibility: "public" }, "name"],
    [
      { ...base, name: "x", visibility: "public", description: 1 },
      "description",
    ],
    [{ ...base, name: "x", visibility: "public", autoInit: "yes" }, "autoInit"],
  ];
  for (const [body, fragment] of cases) {
    const parsed = parseKagiRequest(body);
    assert(typeof parsed === "string", JSON.stringify(body));
    assert(parsed.includes(fragment), `${parsed} / ${fragment}`);
  }
  assertEquals(
    parseKagiRequest({ ...base, name: "x", visibility: "public" }),
    { ...base, name: "x", visibility: "public" },
  );
  // Like a token request, it needs an App, never a plain secret.
  assert(
    secretsProblem(
      { ...createReq },
      { GH_APP: { value: "x", hosts: [] } },
    )?.includes("GitHub App ではありません"),
  );
});
