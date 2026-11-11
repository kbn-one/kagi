/**
 * The RP signing key is the trust anchor for server-initiated push: the IdP
 * verifies our `private_key_jwt` assertions against the public half we publish
 * at `/.well-known/jwks.json`. These tests pin that contract — the published
 * JWK is a valid ES256 verification key whose `kid` is its RFC 7638
 * thumbprint, and a token signed with the private key verifies against it.
 */

import { assertEquals } from "@std/assert";
import { calculateJwkThumbprint, importJWK, jwtVerify, SignJWT } from "jose";

import { getSigningKey } from "./signing-key.ts";
import { jwksAction } from "../controllers/well_known.ts";

Deno.test("publicJwk is an ES256 signing key tagged with its thumbprint kid", async () => {
  const { kid, publicJwk } = await getSigningKey();
  assertEquals(publicJwk.kty, "EC");
  assertEquals(publicJwk.crv, "P-256");
  assertEquals(publicJwk.use, "sig");
  assertEquals(publicJwk.alg, "ES256");
  assertEquals(publicJwk.kid, kid);
  assertEquals(await calculateJwkThumbprint(publicJwk), kid);
});

Deno.test("getSigningKey is cached (stable kid across calls)", async () => {
  const a = await getSigningKey();
  const b = await getSigningKey();
  assertEquals(a.kid, b.kid);
});

Deno.test("a token signed with the private key verifies against the public JWK", async () => {
  const { privateKey, kid, publicJwk } = await getSigningKey();
  const assertion = await new SignJWT({})
    .setProtectedHeader({ alg: "ES256", typ: "client-assertion+jwt", kid })
    .setIssuer("https://rp.example.com")
    .setSubject("https://rp.example.com")
    .setAudience("https://id.kbn.one")
    .setIssuedAt()
    .setExpirationTime("1m")
    .setJti(crypto.randomUUID())
    .sign(privateKey);

  const verifyKey = await importJWK(publicJwk, "ES256");
  const { payload, protectedHeader } = await jwtVerify(assertion, verifyKey, {
    issuer: "https://rp.example.com",
    subject: "https://rp.example.com",
    audience: "https://id.kbn.one",
    algorithms: ["ES256"],
    typ: "client-assertion+jwt",
  });
  assertEquals(protectedHeader.kid, kid);
  assertEquals(payload.iss, "https://rp.example.com");
  assertEquals(typeof payload.jti, "string");
});

Deno.test("GET /.well-known/jwks.json serves the public key set", async () => {
  const res = await jwksAction.handler();
  assertEquals(res.status, 200);
  assertEquals(
    res.headers.get("content-type"),
    "application/jwk-set+json",
  );
  const body = await res.json() as { keys: { kid: string }[] };
  const { kid } = await getSigningKey();
  assertEquals(body.keys.length, 1);
  assertEquals(body.keys[0].kid, kid);
});
