/**
 * git-credential-kagi — a git credential helper that gets each push its own GitHub token, approved
 * on the approver's phone and limited to the one repository being pushed to.
 *
 * git hands the helper the repository (with `credential.useHttpPath`), the helper asks kagi for a
 * `github-app-token` for exactly that `owner/repo`, waits for the approver, and answers git with a
 * token that cannot write anywhere else and expires in an hour. A push to some other repository
 * needs its own approval — which the approver sees, by name, and can refuse.
 *
 * Setup (one repository; `KAGI_URL` is the subscription URL from the kagi screen, without `/req`):
 *
 *   git config credential.https://github.com.useHttpPath true
 *   git config credential.https://github.com.helper \
 *     '!KAGI_URL=https://kagi.kbn.one/api/sub/<id> deno run --allow-net=kagi.kbn.one --allow-env \
 *       https://raw.githubusercontent.com/kbn-one/kagi/main/tools/git_credential_kagi.ts'
 *
 * It also creates repositories, as its own command (the approver sees the name and visibility):
 *
 *   KAGI_URL=… deno run --allow-net=kagi.kbn.one --allow-env …/git_credential_kagi.ts \
 *     create kbn-one/new-repo --public [--description "…"] [--init]
 *
 * Environment: `KAGI_URL` (required), `KAGI_APP` (vault name of the App, default `GH_APP`),
 * `KAGI_PERMISSIONS` (default `contents:write`, comma-separated `name:read|write`).
 *
 * Self-contained on purpose — no imports — so it runs from a URL without the rest of the repo.
 */

export interface HelperEnv {
  KAGI_URL?: string;
  KAGI_APP?: string;
  KAGI_PERMISSIONS?: string;
}

/** Parses git's `key=value` lines. */
function parseCredential(input: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of input.split("\n")) {
    const i = line.indexOf("=");
    if (i > 0) out[line.slice(0, i)] = line.slice(i + 1).trim();
  }
  return out;
}

function parsePermissions(text: string): Record<string, "read" | "write"> {
  const out: Record<string, "read" | "write"> = {};
  for (const part of text.split(",").map((p) => p.trim()).filter(Boolean)) {
    const [name, level] = part.split(":");
    if (level !== "read" && level !== "write") {
      throw new Error(`KAGI_PERMISSIONS: ${part} は name:read か name:write`);
    }
    out[name] = level;
  }
  return out;
}

async function problemDetail(res: Response): Promise<string> {
  try {
    const body = await res.json() as { detail?: string };
    if (body.detail) return body.detail;
  } catch { /* not JSON */ }
  return `HTTP ${res.status}`;
}

/**
 * One helper invocation. Returns what to print for git (empty: "no credential from me").
 *
 * @param action The helper's argument: `get`, `store` or `erase`
 * @param input What git wrote on stdin
 */
export async function run(
  action: string,
  input: string,
  env: HelperEnv,
  log: (message: string) => void = (m) => console.error(m),
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  // kagi tokens are single-use by design; nothing to store or erase.
  if (action !== "get") return "";
  const cred = parseCredential(input);
  if (cred.protocol !== "https" || cred.host !== "github.com") return "";

  const path = (cred.path ?? "").replace(/\.git$/, "").replace(/\/+$/, "");
  const [owner, repo, ...rest] = path.split("/");
  if (!owner || !repo || rest.length) {
    log(
      "kagi: リポジトリが分かりません。git config credential.https://github.com.useHttpPath true を設定してください。",
    );
    return "";
  }

  const result = await askKagi(
    env,
    {
      type: "github-app-token",
      app: env.KAGI_APP || "GH_APP",
      owner,
      repositories: [repo],
      permissions: parsePermissions(env.KAGI_PERMISSIONS || "contents:write"),
    },
    `${owner}/${repo} への push`,
    log,
    fetchImpl,
  );
  const { token } = JSON.parse(result.body) as { token?: string };
  if (!token) throw new Error("kagi: トークンが返ってきませんでした");
  log(`kagi: 承認されました（${owner}/${repo} のみ、1 時間有効）`);
  return `username=x-access-token\npassword=${token}\n`;
}

/** Submits a request to kagi and waits for the approver. Returns the call's result. */
async function askKagi(
  env: HelperEnv,
  request: Record<string, unknown>,
  what: string,
  log: (message: string) => void,
  fetchImpl: typeof fetch,
): Promise<{ status: number; body: string }> {
  const base = env.KAGI_URL?.replace(/\/+$/, "").replace(/\/req$/, "");
  if (!base) throw new Error("KAGI_URL が設定されていません");

  const submitted = await fetchImpl(`${base}/req`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
  });
  if (submitted.status !== 202) {
    throw new Error(`kagi: ${await problemDetail(submitted)}`);
  }
  const { transaction_id } = await submitted.json() as {
    transaction_id: string;
  };
  log(`kagi: ${what}をスマホで承認してください…`);

  while (true) {
    const res = await fetchImpl(
      `${base}/res?transaction_id=${
        encodeURIComponent(transaction_id)
      }&wait=25`,
    );
    if (res.status === 202) {
      await res.body?.cancel();
      continue;
    }
    if (!res.ok) throw new Error(`kagi: ${await problemDetail(res)}`);
    const { response } = await res.json() as {
      response: { status: number; body: string };
    };
    return response;
  }
}

const CREATE_USAGE =
  "使い方: create <owner>/<name> --public|--private [--description <text>] [--init]";

/**
 * `create owner/name --public|--private [--description text] [--init]`: asks the approver to
 * create a repository. Prints the new repository as JSON. Pushing to it is a separate approval.
 */
export async function create(
  args: string[],
  env: HelperEnv,
  log: (message: string) => void = (m) => console.error(m),
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  let target: string | undefined;
  let visibility: "public" | "private" | undefined;
  let description: string | undefined;
  let autoInit = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--public" || a === "--private") {
      if (visibility) throw new Error(CREATE_USAGE);
      visibility = a === "--public" ? "public" : "private";
    } else if (a === "--description") {
      description = args[++i];
      if (description === undefined) throw new Error(CREATE_USAGE);
    } else if (a === "--init") {
      autoInit = true;
    } else if (!a.startsWith("-") && target === undefined) {
      target = a;
    } else {
      throw new Error(CREATE_USAGE);
    }
  }
  const [owner, name, ...rest] = (target ?? "").split("/");
  // Visibility is never defaulted: the requester states it and the approver sees it.
  if (!owner || !name || rest.length || !visibility) {
    throw new Error(CREATE_USAGE);
  }

  const result = await askKagi(
    env,
    {
      type: "github-create-repo",
      app: env.KAGI_APP || "GH_APP",
      owner,
      name,
      visibility,
      ...(description !== undefined ? { description } : {}),
      ...(autoInit ? { autoInit } : {}),
    },
    `${owner}/${name}（${visibility}）の作成`,
    log,
    fetchImpl,
  );
  log(`kagi: ${owner}/${name} を作成しました`);
  return `${result.body}\n`;
}

if (import.meta.main) {
  const env: HelperEnv = {
    KAGI_URL: Deno.env.get("KAGI_URL"),
    KAGI_APP: Deno.env.get("KAGI_APP"),
    KAGI_PERMISSIONS: Deno.env.get("KAGI_PERMISSIONS"),
  };
  try {
    const out = Deno.args[0] === "create"
      ? await create(Deno.args.slice(1), env)
      : await run(
        Deno.args[0] ?? "",
        await new Response(Deno.stdin.readable).text(),
        env,
      );
    await Deno.stdout.write(new TextEncoder().encode(out));
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    Deno.exit(1);
  }
}
