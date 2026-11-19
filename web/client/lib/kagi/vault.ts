/**
 * The approver's secrets, encrypted in `localStorage` with a key only a passkey can produce.
 *
 * The key comes from the WebAuthn PRF extension: on each authentication the authenticator returns
 * HMAC(its per-credential secret, our salt), which never leaves the device unless the user
 * verifies (biometrics / PIN). That output, through HKDF, is the AES-GCM key. So the ciphertext in
 * `localStorage` is useless without the passkey and the user's presence.
 *
 * The names are the exception, on purpose: beside the ciphertext the vault keeps each secret's
 * name, kind, allowed hosts and (for an App) App ID in the clear (`names`), so the vault tab and
 * the agent brief can show them without a passkey. Values never are. The list is for display only:
 * an approval checks the request against the decrypted entries, not against it.
 *
 * A secret can be deleted without the passkey ({@link forgetSecret}): its name leaves the list and
 * goes on `removed`, the unlocked vault leaves it out from then on, and the next unlock re-seals
 * without it, so its value is gone from this device too.
 *
 * PRF needs a recent platform: iOS / iPadOS 18+, Android Chrome, desktop Chrome / Safari with a
 * platform or hybrid authenticator.
 */

import {
  type SecretEntry,
  type SecretSummary,
  summarizeSecret,
} from "./substitute.ts";

const STORAGE_KEY = "kagi.vault";
const INFO = new TextEncoder().encode("kagi vault v1");

export type VaultEntries = Record<string, SecretEntry>;

interface StoredVault {
  v: 1;
  credentialId: string;
  /** The PRF input. Random per vault; not a secret. */
  salt: string;
  iv: string;
  ciphertext: string;
  /**
   * Each secret's name and summary, in the clear. Absent in a vault sealed before names were kept;
   * the next unlock writes it.
   */
  names?: Record<string, SecretSummary>;
  /**
   * Secrets deleted while the vault was closed. Still in the ciphertext until the next unlock, which
   * leaves them out and re-seals; never handed out before that.
   */
  removed?: string[];
}

const summarize = (entries: VaultEntries): Record<string, SecretSummary> =>
  Object.fromEntries(
    Object.entries(entries).map(([name, e]) => [name, summarizeSecret(e)]),
  );

const b64 = (bytes: ArrayBuffer | Uint8Array): string =>
  (bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).toBase64({
    alphabet: "base64url",
    omitPadding: true,
  });
const unb64 = (text: string): Uint8Array<ArrayBuffer> =>
  Uint8Array.fromBase64(text, { alphabet: "base64url" }) as Uint8Array<
    ArrayBuffer
  >;
const random = (n: number): Uint8Array<ArrayBuffer> =>
  crypto.getRandomValues(new Uint8Array(n));

function readStored(): StoredVault | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) as StoredVault : null;
  } catch {
    return null;
  }
}

export const hasVault = (): boolean => readStored() !== null;

/**
 * The secrets' names and summaries, readable without the passkey. `null` with no vault, or with
 * one sealed before names were kept (until it is next opened).
 */
export const vaultNames = (): Record<string, SecretSummary> | null =>
  readStored()?.names ?? null;

/** Whether this browser can do WebAuthn at all (PRF itself is only known after trying). */
export const passkeysAvailable = (): boolean =>
  typeof PublicKeyCredential !== "undefined" &&
  typeof navigator.credentials?.create === "function";

/** An unlocked vault: the entries and the key that re-encrypts them. Keep it only briefly. */
export interface UnlockedVault {
  entries: VaultEntries;
  save(entries: VaultEntries): Promise<void>;
}

async function deriveKey(prfOutput: BufferSource): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    prfOutput,
    "HKDF",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(), info: INFO },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function seal(
  key: CryptoKey,
  credentialId: string,
  salt: string,
  entries: VaultEntries,
): Promise<void> {
  const iv = random(12);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(JSON.stringify(entries)),
  );
  const stored: StoredVault = {
    v: 1,
    credentialId,
    salt,
    iv: b64(iv),
    ciphertext: b64(ciphertext),
    names: summarize(entries),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
}

function requirePasskeys(): void {
  if (!passkeysAvailable()) {
    throw new Error("このブラウザーはパスキーに対応していません。");
  }
}

/** Asks the passkey for its PRF output on `salt`. Throws when the user cancels. */
async function prf(credentialId: string, salt: string): Promise<ArrayBuffer> {
  const credential = await navigator.credentials.get({
    publicKey: {
      challenge: random(32),
      rpId: location.hostname,
      allowCredentials: [{ type: "public-key", id: unb64(credentialId) }],
      userVerification: "required",
      extensions: { prf: { eval: { first: unb64(salt) } } },
    },
  }) as PublicKeyCredential | null;
  const first = credential?.getClientExtensionResults().prf?.results?.first;
  if (!first) {
    throw new Error(
      "このパスキーは PRF に対応していません。対応する端末・ブラウザーで作り直してください。",
    );
  }
  return first instanceof ArrayBuffer
    ? first
    : (first as ArrayBufferView).buffer as ArrayBuffer;
}

const unlockWith = async (
  stored: StoredVault,
  prfOutput: ArrayBuffer,
): Promise<UnlockedVault> => {
  const key = await deriveKey(prfOutput);
  let entries: VaultEntries;
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: unb64(stored.iv) },
      key,
      unb64(stored.ciphertext),
    );
    entries = JSON.parse(new TextDecoder().decode(plain));
  } catch {
    throw new Error("秘密を復号できませんでした。");
  }
  const save = (next: VaultEntries) =>
    seal(key, stored.credentialId, stored.salt, next);
  if (stored.removed?.length) {
    // Deleted while closed: drop them for good now that the key is here (this also clears
    // `removed` and rewrites the list).
    for (const name of stored.removed) delete entries[name];
    await save(entries);
  } else if (
    JSON.stringify(stored.names) !== JSON.stringify(summarize(entries))
  ) {
    // A vault from before names were kept, or one whose list drifted: put the list right.
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...stored, names: summarize(entries) }),
    );
  }
  return { entries, save };
};

/** Creates a passkey and an empty vault sealed with it. Replaces any existing vault. */
export async function createVault(): Promise<UnlockedVault> {
  requirePasskeys();
  const credential = await navigator.credentials.create({
    publicKey: {
      rp: { name: "kagi", id: location.hostname },
      user: {
        id: random(16),
        name: `kagi ${new Date().toLocaleDateString()}`,
        displayName: "kagi 承認者",
      },
      challenge: random(32),
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },
        { type: "public-key", alg: -257 },
      ],
      authenticatorSelection: {
        residentKey: "preferred",
        userVerification: "required",
      },
      extensions: { prf: {} },
    },
  }) as PublicKeyCredential | null;
  if (!credential) throw new Error("パスキーを作成できませんでした。");
  if (credential.getClientExtensionResults().prf?.enabled === false) {
    throw new Error("この端末のパスキーは PRF に対応していません。");
  }
  const credentialId = b64(credential.rawId);
  const salt = b64(random(32));
  // The key comes from an authentication, not the registration: not every platform evaluates PRF
  // during `create()`.
  const key = await deriveKey(await prf(credentialId, salt));
  await seal(key, credentialId, salt, {});
  return {
    entries: {},
    save: (next) => seal(key, credentialId, salt, next),
  };
}

/** Authenticates with the passkey and decrypts the vault. */
export async function unlockVault(): Promise<UnlockedVault> {
  const stored = readStored();
  if (!stored) throw new Error("秘密がまだ作成されていません。");
  requirePasskeys();
  return unlockWith(stored, await prf(stored.credentialId, stored.salt));
}

/**
 * Deletes one secret without the passkey. It is gone from the list and from every unlock at once;
 * its value leaves the ciphertext at the next unlock.
 */
export function forgetSecret(name: string): void {
  const stored = readStored();
  if (!stored) return;
  const { [name]: _gone, ...names } = stored.names ?? {};
  const removed = [...new Set([...(stored.removed ?? []), name])];
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ ...stored, names, removed }),
  );
}

/** Forgets the vault on this device. The passkey itself stays in the platform's keychain. */
export const deleteVault = (): void => localStorage.removeItem(STORAGE_KEY);

/**
 * The vault without WebAuthn, for tests: seal and open with a PRF output handed in directly.
 *
 * @internal
 */
export const vaultForTests = {
  async seal(prfOutput: Uint8Array<ArrayBuffer>, entries: VaultEntries) {
    await seal(await deriveKey(prfOutput), "test", "c2FsdA", entries);
  },
  unlock(prfOutput: Uint8Array<ArrayBuffer>): Promise<UnlockedVault> {
    const stored = readStored();
    if (!stored) throw new Error("no vault");
    return unlockWith(stored, prfOutput.buffer);
  },
};
