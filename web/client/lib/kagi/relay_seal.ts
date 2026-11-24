/**
 * The phone's half of a relayed call (`server/lib/kagi/relay.ts`): agrees on a key with the
 * single-use Dynamic Worker at the other end of the WebSocket, and sends the call sealed with it,
 * so the server between them only ever carries ciphertext.
 *
 * Must match `RELAY_MODULE` there: P-256 ECDH, HKDF-SHA-256 with info
 * `kagi-relay-v1:<server key>:<phone key>` (raw public keys, base64url), AES-256-GCM with a fresh
 * 12-byte IV and `call` / `result` as associated data.
 */

import type { KagiResult, RelayCall, RelayFrame } from "./protocol.ts";

/** The part of a WebSocket used here. */
export interface RelaySocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(
    type: "message" | "close" | "error",
    listener: (event: { data?: unknown }) => void,
  ): void;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const b64 = (bytes: Uint8Array) =>
  bytes.toBase64({ alphabet: "base64url", omitPadding: true });
const unb64 = (text: string) =>
  Uint8Array.fromBase64(text, { alphabet: "base64url" });

/** The AES-GCM key both ends derive. */
export async function relaySessionKey(
  privateKey: CryptoKey,
  peerRaw: Uint8Array<ArrayBuffer>,
  serverRaw: Uint8Array,
  phoneRaw: Uint8Array,
): Promise<CryptoKey> {
  const peer = await crypto.subtle.importKey(
    "raw",
    peerRaw,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const shared = await crypto.subtle.deriveBits(
    { name: "ECDH", public: peer },
    privateKey,
    256,
  );
  const hkdf = await crypto.subtle.importKey("raw", shared, "HKDF", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(0),
      info: encoder.encode(`kagi-relay-v1:${b64(serverRaw)}:${b64(phoneRaw)}`),
    },
    hkdf,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/**
 * Sends `call` over `socket` (opened on `/api/sub/:id/relay`) and returns the answer, not yet
 * scrubbed. Throws with the reason when the relay or the call fails.
 */
export function sealedCall(
  socket: RelaySocket,
  call: RelayCall,
): Promise<KagiResult> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let key: CryptoKey | undefined;
    const finish = (error: Error | null, result?: KagiResult) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve(result!);
      socket.close(1000);
    };

    const onFrame = async (frame: RelayFrame) => {
      switch (frame.type) {
        case "error":
          return finish(new Error(frame.detail));
        case "key": {
          if (key) return;
          const pair = await crypto.subtle.generateKey(
            { name: "ECDH", namedCurve: "P-256" },
            false,
            ["deriveBits"],
          ) as CryptoKeyPair;
          const phoneRaw = new Uint8Array(
            await crypto.subtle.exportKey("raw", pair.publicKey),
          );
          const serverRaw = unb64(frame.publicKey);
          key = await relaySessionKey(
            pair.privateKey,
            serverRaw,
            serverRaw,
            phoneRaw,
          );
          const iv = crypto.getRandomValues(new Uint8Array(12));
          const sealed = await crypto.subtle.encrypt(
            { name: "AES-GCM", iv, additionalData: encoder.encode("call") },
            key,
            encoder.encode(JSON.stringify(call)),
          );
          const out: RelayFrame = {
            type: "call",
            publicKey: b64(phoneRaw),
            iv: b64(iv),
            data: b64(new Uint8Array(sealed)),
          };
          return socket.send(JSON.stringify(out));
        }
        case "result": {
          if (!key) throw new Error("Result before the key");
          const plain = await crypto.subtle.decrypt(
            {
              name: "AES-GCM",
              iv: unb64(frame.iv),
              additionalData: encoder.encode("result"),
            },
            key,
            unb64(frame.data),
          );
          const answer = JSON.parse(decoder.decode(plain)) as
            | ({ ok: true } & KagiResult)
            | { ok: false; detail: string };
          if (!answer.ok) return finish(new Error(answer.detail));
          return finish(null, {
            status: answer.status,
            headers: answer.headers,
            body: answer.body,
          });
        }
      }
    };

    // Frames are handled one at a time, in order, and a close only after them: the far end closes
    // right after sending the result, before this side has opened it.
    let queue: Promise<void> = Promise.resolve();
    const then = (step: () => Promise<void> | void) => {
      queue = queue.then(step).catch((e) =>
        finish(e instanceof Error ? e : new Error(String(e)))
      );
    };
    socket.addEventListener("message", (event) =>
      then(() => {
        let frame: RelayFrame;
        try {
          frame = JSON.parse(String(event.data)) as RelayFrame;
        } catch {
          return finish(new Error("中継の応答を読めません"));
        }
        return onFrame(frame);
      }));
    socket.addEventListener(
      "close",
      () => then(() => finish(new Error("中継が途中で切れました"))),
    );
    socket.addEventListener(
      "error",
      () =>
        then(() =>
          finish(
            new Error(
              "中継に接続できません（承認済みのリクエストで、まだ中継していないものに限ります）",
            ),
          )
        ),
    );
  });
}
