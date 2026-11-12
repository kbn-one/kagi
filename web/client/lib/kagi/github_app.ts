/**
 * Minting a GitHub App installation token on the approver's phone.
 *
 * The App's private key stays in the vault. To answer a {@link GithubAppTokenRequest} the phone:
 *
 * 1. signs a short-lived App JWT (RS256) with the private key,
 * 2. finds the App's installation for `owner/repositories[0]`,
 * 3. asks that installation for a token limited to `repositories` and `permissions`.
 *
 * GitHub makes the limit real: the token cannot write to any other repository, cannot do more than
 * `permissions`, and expires in an hour. That is what keeps a requester holding it from carrying
 * code into a repository nobody approved.
 */

import type { GithubAppTokenRequest, KagiResult } from "./protocol.ts";
import type { GithubAppSecret } from "./substitute.ts";

const API = "https://api.github.com";

const b64url = (bytes: Uint8Array): string =>
  bytes.toBase64({ alphabet: "base64url", omitPadding: true });

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

/** A DER length: short form below 128, long form above. */
function derLength(n: number): Uint8Array {
  if (n < 0x80) return Uint8Array.of(n);
  const bytes: number[] = [];
  for (let v = n; v > 0; v = Math.floor(v / 256)) bytes.unshift(v & 0xff);
  return Uint8Array.of(0x80 | bytes.length, ...bytes);
}

function der(tag: number, ...parts: Uint8Array[]): Uint8Array {
  const body = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    body.set(p, offset);
    offset += p.length;
  }
  const len = derLength(body.length);
  const out = new Uint8Array(1 + len.length + body.length);
  out[0] = tag;
  out.set(len, 1);
  out.set(body, 1 + len.length);
  return out;
}

/** AlgorithmIdentifier for rsaEncryption (1.2.840.113549.1.1.1) with NULL parameters. */
const RSA_ALGORITHM = Uint8Array.of(
  0x30,
  0x0d,
  0x06,
  0x09,
  0x2a,
  0x86,
  0x48,
  0x86,
  0xf7,
  0x0d,
  0x01,
  0x01,
  0x01,
  0x05,
  0x00,
);

/**
 * The PKCS#8 DER of a PEM private key. GitHub hands out PKCS#1 (`BEGIN RSA PRIVATE KEY`), which
 * WebCrypto cannot import, so that is wrapped: PrivateKeyInfo { version 0, rsaEncryption, key }.
 */
export function pemToPkcs8(pem: string): Uint8Array<ArrayBuffer> {
  const match = pem.match(
    /-----BEGIN (RSA )?PRIVATE KEY-----([\s\S]+?)-----END \1?PRIVATE KEY-----/,
  );
  if (!match) {
    throw new Error("PEM の秘密鍵（BEGIN … PRIVATE KEY）ではありません。");
  }
  const body = Uint8Array.fromBase64(match[2].replace(/\s+/g, ""));
  const pkcs8 = match[1]
    ? der(0x30, Uint8Array.of(0x02, 0x01, 0x00), RSA_ALGORITHM, der(0x04, body))
    : body;
  return new Uint8Array(pkcs8) as Uint8Array<ArrayBuffer>;
}

/** The App JWT: RS256, issued by the App, valid for nine minutes (GitHub allows ten). */
export async function appJwt(
  app: GithubAppSecret,
  now = Date.now(),
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToPkcs8(app.value),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const iat = Math.floor(now / 1000) - 60; // GitHub's recommendation for clock drift
  const header = b64url(utf8(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const payload = b64url(
    utf8(JSON.stringify({ iat, exp: iat + 600, iss: app.appId })),
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    utf8(`${header}.${payload}`) as Uint8Array<ArrayBuffer>,
  );
  return `${header}.${payload}.${b64url(new Uint8Array(signature))}`;
}

async function githubError(res: Response, what: string): Promise<Error> {
  let message = "";
  try {
    message = ((await res.json()) as { message?: string }).message ?? "";
  } catch { /* not JSON */ }
  return new Error(
    `${what}: HTTP ${res.status}${message ? ` ${message}` : ""}`,
  );
}

/**
 * Mints the token the request asks for. Throws when GitHub refuses, or when its answer is not
 * limited to the requested repositories — in which case the token is dropped, not returned.
 */
export async function mintInstallationToken(
  req: GithubAppTokenRequest,
  app: GithubAppSecret,
  fetchImpl: typeof fetch = fetch,
): Promise<KagiResult> {
  const jwt = await appJwt(app);
  const headers = {
    authorization: `Bearer ${jwt}`,
    accept: "application/vnd.github+json",
  };

  const owner = encodeURIComponent(req.owner);
  const installation = await fetchImpl(
    `${API}/repos/${owner}/${
      encodeURIComponent(req.repositories[0])
    }/installation`,
    { headers },
  );
  if (!installation.ok) {
    throw await githubError(
      installation,
      `GitHub App が ${req.owner}/${
        req.repositories[0]
      } にインストールされていません`,
    );
  }
  const { id } = (await installation.json()) as { id: number };

  const res = await fetchImpl(`${API}/app/installations/${id}/access_tokens`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({
      repositories: req.repositories,
      permissions: req.permissions,
    }),
    redirect: "error",
  });
  if (!res.ok) throw await githubError(res, "トークンを発行できませんでした");
  const body = await res.text();

  const granted = JSON.parse(body) as {
    repositories?: { name: string; full_name?: string }[];
  };
  const names = (granted.repositories ?? []).map((r) => r.name);
  const wanted = new Set(req.repositories);
  if (names.length === 0 || names.some((n) => !wanted.has(n))) {
    throw new Error(
      "GitHub が指定外のリポジトリを含むトークンを返したため破棄しました。",
    );
  }

  return {
    status: res.status,
    headers: { "content-type": "application/json" },
    body,
  };
}
