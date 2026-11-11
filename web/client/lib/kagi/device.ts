/**
 * This phone as an approver: its subscription id and its device key.
 *
 * The device key (ECDSA P-256) is generated non-extractable and kept in IndexedDB, which can hold a
 * `CryptoKey` as is — `localStorage` cannot. Only its public half ever leaves the browser: it is
 * registered with the subscription, and the server checks the WebSocket challenge against it, so
 * knowing a subscription id is not enough to pose as its approver.
 */

import { challengeMessage } from "./protocol.ts";
import { routes } from "../../routes.ts";

const SUB_KEY = "kagi.sub";
const DB = "kagi";
const STORE = "keys";
const DEVICE_KEY = "device";

export interface Subscription {
  id: string;
  userId: string;
  createdAt: number;
}

export function readSubscription(): Subscription | null {
  try {
    const raw = localStorage.getItem(SUB_KEY);
    return raw ? JSON.parse(raw) as Subscription : null;
  } catch {
    return null;
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idb<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest,
): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = run(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result as T);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

const loadKeyPair = () =>
  idb<CryptoKeyPair | undefined>("readonly", (s) => s.get(DEVICE_KEY));

/** Registers this phone as a new subscription for `userId`. */
export async function createSubscription(
  userId: string,
): Promise<Subscription> {
  const keys = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign", "verify"],
  );
  const publicKey = await crypto.subtle.exportKey("jwk", keys.publicKey);
  const id = crypto.getRandomValues(new Uint8Array(16)).toBase64({
    alphabet: "base64url",
    omitPadding: true,
  });

  const res = await fetch(routes.api.sub.register.href({ id }), {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ userId, publicKey }),
  });
  if (!res.ok) throw new Error(await problemDetail(res));

  await idb("readwrite", (s) => s.put(keys, DEVICE_KEY));
  const sub: Subscription = { id, userId, createdAt: Date.now() };
  localStorage.setItem(SUB_KEY, JSON.stringify(sub));
  return sub;
}

/** Forgets the subscription on this phone. Requests to its id then have no approver. */
export async function forgetSubscription(): Promise<void> {
  localStorage.removeItem(SUB_KEY);
  await idb("readwrite", (s) => s.delete(DEVICE_KEY));
}

/** Signs the server's WebSocket challenge with the device key. */
export async function signChallenge(
  subId: string,
  nonce: string,
): Promise<string> {
  const keys = await loadKeyPair();
  if (!keys) throw new Error("この端末の鍵が見つかりません。");
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    keys.privateKey,
    new TextEncoder().encode(challengeMessage(subId, nonce)),
  );
  return new Uint8Array(signature).toBase64({
    alphabet: "base64url",
    omitPadding: true,
  });
}

/** The `detail` of a problem response, or the status. */
export async function problemDetail(res: Response): Promise<string> {
  try {
    const body = await res.json() as { detail?: unknown };
    if (typeof body.detail === "string") return body.detail;
  } catch { /* not JSON */ }
  return `HTTP ${res.status}`;
}
