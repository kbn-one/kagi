/**
 * GET /.well-known/jwks.json — this app's public JSON Web Key Set (RFC 7517).
 *
 * Publishes the RP's ES256 signing public key so the IdP (id.kbn.one) can
 * verify the `private_key_jwt` client assertions the RP sends to
 * `POST /rp/notifications`. Mirror image of the IdP's own JWKS endpoint;
 * consumable by `jose.createRemoteJWKSet`.
 */

import type { Action } from "@remix-run/fetch-router";
import type { routes } from "../../client/routes.ts";
import { getSigningKey } from "../lib/signing-key.ts";

export const jwksAction = {
  async handler(): Promise<Response> {
    const { publicJwk } = await getSigningKey();
    return new Response(JSON.stringify({ keys: [publicJwk] }), {
      headers: {
        "content-type": "application/jwk-set+json",
        "cache-control": "public, max-age=3600",
        "access-control-allow-origin": "*",
      },
    });
  },
} satisfies Action<typeof routes.jwks>;
