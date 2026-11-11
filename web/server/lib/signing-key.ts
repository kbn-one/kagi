/**
 * The RP's ECDSA P-256 (ES256) signing key.
 *
 * Used to sign `private_key_jwt` client assertions for the IdP and to publish
 * the matching public key at `/.well-known/jwks.json`, from which the IdP
 * fetches it to verify those assertions (RFC 7515 / 7517 / 7521 / 7523).
 *
 * The key is loaded from `RP_SIGNING_KEY_JWK` (a private JWK JSON) when set,
 * otherwise generated once per process. Generation-on-first-use keeps local
 * development zero-config; the public half is always derived from whichever
 * private key is in use, so the JWKS endpoint and the signatures stay in sync.
 */

import { calculateJwkThumbprint, exportJWK, generateKeyPair } from "jose";

import { getConfig } from "../config.ts";

const ALG = "ES256";

/** A public JWK extended with the JWS metadata fields (RFC 7517 §4). */
export type PublicJwk = JsonWebKey & {
  kid: string;
  use: "sig";
  alg: "ES256";
};

export interface SigningKey {
  /** Private key for signing client assertions. */
  readonly privateKey: CryptoKey;
  /** RFC 7638 JWK SHA-256 thumbprint of the public key, used as `kid`. */
  readonly kid: string;
  /** Public JWK with `kid`/`use`/`alg` populated, ready to embed in JWKS. */
  readonly publicJwk: PublicJwk;
}

let signingKeyPromise: Promise<SigningKey> | undefined;

const importPrivateJwk = async (
  jwkText: string,
): Promise<{ privateKey: CryptoKey; publicJwk: JsonWebKey }> => {
  const jwk = JSON.parse(jwkText) as JsonWebKey;
  const privateKey = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign"],
  );
  // Strip the private fields to derive the public JWK.
  const { d: _d, ...publicJwk } = jwk;
  return { privateKey, publicJwk };
};

const generate = async (): Promise<
  { privateKey: CryptoKey; publicJwk: JsonWebKey }
> => {
  const { privateKey, publicKey } = await generateKeyPair(ALG, {
    extractable: true,
  });
  const publicJwk = await exportJWK(publicKey);
  return { privateKey: privateKey as CryptoKey, publicJwk };
};

/**
 * Load (or generate-on-first-use) the RP's signing key. Idempotent; later
 * callers receive the cached value.
 */
export const getSigningKey = (): Promise<SigningKey> => {
  if (!signingKeyPromise) {
    signingKeyPromise = (async () => {
      const { rpSigningKeyJwk } = getConfig();
      const { privateKey, publicJwk } = rpSigningKeyJwk
        ? await importPrivateJwk(rpSigningKeyJwk)
        : await generate();
      const kid = await calculateJwkThumbprint(publicJwk);
      const { kty, crv, x, y } = publicJwk;
      return {
        privateKey,
        kid,
        publicJwk: { kty, crv, x, y, kid, use: "sig", alg: ALG },
      };
    })();
  }
  return signingKeyPromise;
};
