import { assert, assertEquals, assertRejects } from "@std/assert";

import { run } from "./git_credential_kagi.ts";
import {
  challengeMessage,
  type ClientMessage,
  type ServerMessage,
} from "../web/client/lib/kagi/protocol.ts";
import { createMemoryHub } from "../web/server/lib/kagi/hub.ts";
import { parseSubPath, type Upgrade } from "../web/server/lib/kagi/room.ts";

const SUB = "abcdefghijklmnopqrstuv";
const BASE = `https://kagi.example/api/sub/${SUB}`;

/** A phone that approves (or rejects) every request, answering with a token. */
async function setup(approve: boolean) {
  const seen: unknown[] = [];
  let phone!: EventTarget & { send(text: string): void; readyState: number };
  const upgrade: Upgrade = () => {
    const target = new EventTarget() as typeof phone;
    target.readyState = WebSocket.OPEN;
    target.send = (text: string) => void onServer(JSON.parse(text));
    phone = target;
    return {
      socket: target as unknown as WebSocket,
      response: new Response(null),
    };
  };
  const hub = createMemoryHub({ upgrade, notify: () => Promise.resolve(true) });
  const keys = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const emit = (m: ClientMessage) =>
    phone.dispatchEvent(
      new MessageEvent("message", { data: JSON.stringify(m) }),
    );
  let ready!: () => void;
  const authed = new Promise<void>((r) => (ready = r));
  const onServer = async (m: ServerMessage) => {
    if (m.type === "ready") ready();
    if (m.type === "challenge") {
      const sig = await crypto.subtle.sign(
        { name: "ECDSA", hash: "SHA-256" },
        keys.privateKey,
        new TextEncoder().encode(challengeMessage(SUB, m.nonce)),
      );
      emit({
        type: "auth",
        signature: new Uint8Array(sig).toBase64({
          alphabet: "base64url",
          omitPadding: true,
        }),
      });
    } else if (m.type === "tx" && m.transaction.status === "pending") {
      seen.push(m.transaction.request);
      emit({ type: "decision", txId: m.transaction.id, approved: approve });
      if (approve) emit({ type: "done", txId: m.transaction.id });
    } else if (m.type === "get") {
      emit({
        type: "result",
        txId: m.txId,
        result: {
          status: 201,
          headers: {},
          body: JSON.stringify({ token: "ghs_one_repo", repositories: [] }),
        },
      });
    }
  };

  const fetchImpl = ((input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    const target = parseSubPath(new URL(request.url).pathname, request.method)!;
    return hub.dispatch(target.subId, target.action, request);
  }) as typeof fetch;

  await fetchImpl(BASE, {
    method: "PUT",
    body: JSON.stringify({
      userId: "u1",
      publicKey: await crypto.subtle.exportKey("jwk", keys.publicKey),
    }),
  });
  await fetchImpl(`${BASE}/ws`, { headers: { upgrade: "websocket" } });
  // The handshake (sign the challenge, get `ready`) finishes after the upgrade returns.
  await authed;
  return { fetchImpl, seen };
}

const gitInput = (path: string) =>
  `protocol=https\nhost=github.com\npath=${path}\n\n`;

Deno.test("asks for a token for exactly the repository git is pushing to", async () => {
  const { fetchImpl, seen } = await setup(true);
  const out = await run(
    "get",
    gitInput("kbn-one/kagi.git"),
    { KAGI_URL: BASE },
    () => {},
    fetchImpl,
  );
  assertEquals(out, "username=x-access-token\npassword=ghs_one_repo\n");
  assertEquals(seen, [{
    type: "github-app-token",
    app: "GH_APP",
    owner: "kbn-one",
    repositories: ["kagi"],
    permissions: { contents: "write" },
  }]);
});

Deno.test("a rejected push fails with the approver's answer", async () => {
  const { fetchImpl } = await setup(false);
  const error = await assertRejects(() =>
    run(
      "get",
      gitInput("kbn-one/kagi"),
      { KAGI_URL: BASE },
      () => {},
      fetchImpl,
    )
  );
  assert(String(error).includes("rejected"));
});

Deno.test("without a repository path, or for another host, it gives git nothing", async () => {
  const fail = (() => {
    throw new Error("must not call kagi");
  }) as typeof fetch;
  const logs: string[] = [];
  assertEquals(
    await run(
      "get",
      "protocol=https\nhost=github.com\n\n",
      { KAGI_URL: BASE },
      (m) => logs.push(m),
      fail,
    ),
    "",
  );
  assert(logs[0].includes("useHttpPath"));
  assertEquals(
    await run(
      "get",
      gitInput("a/b").replace("github.com", "gitlab.com"),
      { KAGI_URL: BASE },
      () => {},
      fail,
    ),
    "",
  );
  assertEquals(await run("store", gitInput("a/b"), {}, () => {}, fail), "");
});
