/**
 * A result sealed for the requester, so the server carries it without being able to read it.
 *
 * A requester that wants this sends its own P-256 public key with the request (`seal`, raw,
 * base64url). The phone makes a key pair of its own for the one result, derives a key both ends
 * can derive (ECDH → HKDF-SHA-256 with info `kagi-result-v1:<requester key>:<phone key>`), and
 * seals the result with AES-256-GCM, the transaction id as associated data, so a sealed result
 * cannot be passed off as another transaction's. The requester opens it with its private key.
 *
 * Like the relay (`relay_seal.ts`), this keeps the result out of the server's memory, logs and
 * bugs; a server that means harm could still swap the key in the request, which the phone shows but
 * cannot check.
 *
 * `tools/git_credential_kagi.ts` has its own copy of {@link openSealedResult} (it imports nothing);
 * its tests open what {@link sealResult} seals.
 */

import type { KagiResult, SealedResult } from "./protocol.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const b64 = (bytes: Uint8Array) =>
  bytes.toBase64({ alphabet: "base64url", omitPadding: true });
const unb64 = (text: string) =>
  Uint8Array.fromBase64(text, { alphabet: "base64url" }) as Uint8Array<
    ArrayBuffer
  >;

/** What a sealed result is bound to: its transaction. */
export const sealedResultAad = (txId: string): Uint8Array<ArrayBuffer> =>
  encoder.encode(`kagi-result:${txId}`);

async function resultKey(
  privateKey: CryptoKey,
  peerRaw: Uint8Array<ArrayBuffer>,
  requesterKey: string,
  phoneKey: string,
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
      info: encoder.encode(`kagi-result-v1:${requesterKey}:${phoneKey}`),
    },
    hkdf,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** Seals `result` of transaction `txId` for the requester's key (`seal` of the request). */
export async function sealResult(
  result: KagiResult,
  requesterKey: string,
  txId: string,
): Promise<SealedResult> {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    false,
    ["deriveBits"],
  ) as CryptoKeyPair;
  const phoneKey = b64(
    new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)),
  );
  const key = await resultKey(
    pair.privateKey,
    unb64(requesterKey),
    requesterKey,
    phoneKey,
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: sealedResultAad(txId) },
    key,
    encoder.encode(JSON.stringify(result)),
  );
  return {
    sealed: {
      publicKey: phoneKey,
      iv: b64(iv),
      data: b64(new Uint8Array(data)),
    },
  };
}

/** Opens a result sealed for `requesterKey`, whose private half is `privateKey`. */
export async function openSealedResult(
  { sealed }: SealedResult,
  privateKey: CryptoKey,
  requesterKey: string,
  txId: string,
): Promise<KagiResult> {
  const key = await resultKey(
    privateKey,
    unb64(sealed.publicKey),
    requesterKey,
    sealed.publicKey,
  );
  const plain = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: unb64(sealed.iv),
      additionalData: sealedResultAad(txId),
    },
    key,
    unb64(sealed.data),
  );
  return JSON.parse(decoder.decode(plain)) as KagiResult;
}
